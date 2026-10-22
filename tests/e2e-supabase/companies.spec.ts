import { expect, test } from "@playwright/test";
import { cleanup, createUser, email, freshTotp, run, service, signIn } from "./helpers";

/**
 * Slice 5 (spec §40.5, flow F1): the operator onboards a shop: profile,
 * settings with validated defaults, DPA upload, sending switch, owner
 * invitation. Every step is checked in the UI, the database and the audit log.
 */

const adminEmail = email("companies-admin");
const ownerEmail = email("companies-owner");
const companyName = `Autoservis E2E Onboarding ${run}`;
const users: string[] = [];
const companies: string[] = [];
const usedSteps = new Set<number>();

async function auditCount(action: string, companyId: string): Promise<number> {
  const { count } = await service
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("action", action)
    .eq("company_id", companyId);
  return count ?? 0;
}

test.beforeAll(async () => {
  const adminId = await createUser(adminEmail, "Operátor Onboarding");
  users.push(adminId);
  await service.from("platform_admins").insert({ user_id: adminId });
});

test.afterAll(async () => {
  const { data } = await service.from("companies").select("id, dpa_document_path").eq("name", companyName);
  for (const c of data ?? []) {
    companies.push(c.id);
    if (c.dpa_document_path) await service.storage.from("company-documents").remove([c.dpa_document_path]);
  }
  await cleanup(users, [...new Set(companies)]);
});

test("operator onboards a new shop end to end", async ({ page }) => {
  test.setTimeout(180_000);
  let companyId = "";

  await test.step("sign in with MFA", async () => {
    await signIn(page, adminEmail);
    await page.getByRole("button", { name: "Zobrazit QR kód" }).click();
    const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
    await page.getByLabel("Ověřovací kód").fill(await freshTotp(secret, usedSteps));
    await page.getByRole("button", { name: "Ověřit" }).click();
    await expect(page).toHaveURL(/\/admin$/);
  });

  await test.step("create the company; invalid input is explained and kept", async () => {
    await page.goto("/admin/companies");
    // The dev server may still be hydrating after a Fast Refresh rebuild: retry the click.
    await expect(async () => {
      await page.getByRole("link", { name: "Nový klient" }).click();
      await expect(page).toHaveURL(/\/admin\/companies\/new$/, { timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    await page.getByLabel("Název servisu").fill(companyName);
    await page.getByLabel("IČO").fill("12345678");
    await page.getByLabel("Odesílatel SMS").fill("Auto E2E");
    await page.getByRole("button", { name: "Založit klienta" }).click();
    await expect(page.getByText("IČO nemá platný tvar")).toBeVisible();
    await expect(page.getByText("3–11 znaků: písmena bez diakritiky")).toBeVisible();
    await expect(page.getByLabel("Název servisu")).toHaveValue(companyName);

    await page.getByLabel("IČO").fill("25596641");
    await page.getByLabel("Odesílatel SMS").fill("AutoE2E");
    await page.getByLabel("PSČ").fill("28002");
    await page.getByRole("button", { name: "Založit klienta" }).click();
    await expect(page).toHaveURL(/\/admin\/companies\/[0-9a-f-]{36}\/settings$/);
    companyId = /companies\/([0-9a-f-]{36})/.exec(page.url())![1];
    companies.push(companyId);

    const { data } = await service.from("companies").select("*").eq("id", companyId).single();
    expect(data).toMatchObject({
      ico: "25596641",
      postal_code: "280 02",
      default_sender_name: "AutoE2E",
      status: "onboarding",
      sending_enabled: false,
      service_mode: "managed",
      average_job_value_minor: 350_000,
    });
    expect(data!.settings).toMatchObject({ max_lookback_months: 48, holdout_pct: 0.1 });
    expect(await auditCount("company.created", companyId)).toBe(1);
  });

  await test.step("sending stays off without a DPA", async () => {
    await expect(page.getByRole("switch", { name: "Odesílání SMS" })).toBeDisabled();
    await expect(page.getByText("Nejdřív potvrďte zpracovatelskou smlouvu.")).toBeVisible();
  });

  await test.step("settings are validated and saved", async () => {
    await page.getByLabel("Ohrožený do (měsíců)").fill("6");
    await page.getByRole("button", { name: "Uložit změny" }).last().click();
    await expect(page.getByText("Musí být víc než hranice pro aktivní.")).toBeVisible();
    await page.getByLabel("Ohrožený do (měsíců)").fill("14");
    await page.getByLabel("Kontrolní skupina (%)").fill("15");
    await page.getByRole("button", { name: "Uložit změny" }).last().click();
    await expect(page.getByText("Uloženo.").first()).toBeVisible();
    const { data } = await service.from("companies").select("settings").eq("id", companyId).single();
    expect(data!.settings).toMatchObject({
      lifecycle: { active_max_months: 9, at_risk_max_months: 14 },
      holdout_pct: 0.15,
    });
    const { data: rows } = await service
      .from("audit_logs")
      .select("metadata")
      .eq("action", "company.settings_changed")
      .eq("company_id", companyId);
    expect(rows!.map((r) => r.metadata)).toContainEqual({ section: "settings", fields: "lifecycle,holdout_pct" });
  });

  await test.step("DPA: only a confirmed PDF is accepted; download via a signed URL", async () => {
    const file = page.getByLabel("Podepsaná smlouva (PDF, max. 10 MB)");
    await file.setInputFiles({ name: "smlouva.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a pdf") });
    await page.getByLabel("Zpracovatelská smlouva podepsána").check();
    await page.getByRole("button", { name: "Nahrát a potvrdit" }).click();
    await expect(page.getByText("Soubor není PDF.")).toBeVisible();

    const pdf = Buffer.from("%PDF-1.4\n% E2E fixture, not a real agreement\n%%EOF\n");
    await file.setInputFiles({ name: "smlouva.pdf", mimeType: "application/pdf", buffer: pdf });
    await page.getByLabel("Zpracovatelská smlouva podepsána").uncheck();
    await page.getByRole("button", { name: "Nahrát a potvrdit" }).click();
    await expect(page.getByText("Potvrďte, že je smlouva podepsaná.")).toBeVisible();

    await file.setInputFiles({ name: "smlouva.pdf", mimeType: "application/pdf", buffer: pdf });
    await page.getByLabel("Zpracovatelská smlouva podepsána").check();
    await page.getByRole("button", { name: "Nahrát a potvrdit" }).click();
    await expect(page.getByText(/^Podepsána /)).toBeVisible();
    expect(await auditCount("company.dpa_confirmed", companyId)).toBe(1);

    const redirect = await page.request.get(`/admin/companies/${companyId}/dpa`, { maxRedirects: 0 });
    expect(redirect.status()).toBe(303);
    const signedUrl = redirect.headers()["location"];
    expect(signedUrl).toContain("token=");
    const download = await page.request.get(signedUrl);
    expect(download.status()).toBe(200);
    expect((await download.body()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  await test.step("sending can now be switched on", async () => {
    const toggle = page.getByRole("switch", { name: "Odesílání SMS" });
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(page.getByText("Odesílání zapnuto.")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    const { data } = await service.from("companies").select("sending_enabled").eq("id", companyId).single();
    expect(data!.sending_enabled).toBe(true);
    expect(await auditCount("company.sending_enabled", companyId)).toBe(1);
  });

  await test.step("invite the owner; the invitation is listed as pending", async () => {
    await page.getByRole("button", { name: "Pozvat uživatele" }).click();
    await page.getByRole("dialog").getByLabel("E-mail").fill(ownerEmail);
    await page.getByRole("button", { name: "Poslat pozvánku" }).click();
    await expect(page.getByText("Pozvánka odeslána.")).toBeVisible();
    await expect(page.getByTestId("company-users")).toContainText(ownerEmail);
    await expect(page.getByTestId("company-users")).toContainText("Čeká na přijetí");
  });

  await test.step("onboarding is complete on the overview", async () => {
    await page.getByRole("link", { name: "Přehled" }).last().click();
    await expect(page).toHaveURL(new RegExp(`/admin/companies/${companyId}$`));
    await expect(page.getByText("Profil servisu")).toBeVisible();
    await expect(page.getByTestId("onboarding-checklist")).toHaveCount(0);
  });

  await test.step("pausing the cooperation switches sending off", async () => {
    await page.goto(`/admin/companies/${companyId}/settings`);
    await page.getByLabel("Stav spolupráce").selectOption("paused");
    await page.getByRole("button", { name: "Uložit změny" }).first().click();
    await expect(page.getByText("Uloženo.").first()).toBeVisible();
    const { data } = await service.from("companies").select("status, sending_enabled").eq("id", companyId).single();
    expect(data).toEqual({ status: "paused", sending_enabled: false });
  });
});
