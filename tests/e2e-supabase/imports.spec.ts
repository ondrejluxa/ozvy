import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { PASSWORD, cleanup, createUser, email, env, freshTotp, run, service, signIn } from "./helpers";

/**
 * Slice 7 (spec §11, §40.7, §41 DoD): the operator imports the messy
 * fixtures end to end. Windows-1250 CSV with review, error CSV, commit and a
 * re-import that creates no duplicates; a two-sheet XLSX; a broken file;
 * no import without a DPA; no real-looking data outside production.
 * Jobs run inline (JOB_RUNNER=inline).
 */

const fixtures = join(process.cwd(), "supabase", "seed", "fixtures");
const adminEmail = email("imports-admin");
const users: string[] = [];
const companies: string[] = [];
const usedSteps = new Set<number>();
let companyId = "";
let totpSecret = "";

async function newCompany(name: string, dpa: boolean): Promise<string> {
  const { data, error } = await service
    .from("companies")
    .insert({ name, city: "Kolín", status: "active", dpa_signed_at: dpa ? new Date().toISOString() : null })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("company insert failed");
  companies.push(data.id);
  return data.id;
}

async function count(table: "customers" | "vehicles" | "visits", company: string): Promise<number> {
  const { count: n } = await service.from(table).select("id", { count: "exact", head: true }).eq("company_id", company);
  return n ?? 0;
}

/** Uploads a file and waits for the mapping step (or a failure). */
async function upload(page: Page, company: string, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto(`/admin/companies/${company}/imports`);
  // The dev server compiles on first visit: click only once the form is interactive.
  await page.waitForLoadState("networkidle");
  await page
    .getByLabel("Soubor (CSV, TXT nebo XLSX, max. 20 MB)")
    .setInputFiles(typeof file === "string" ? join(fixtures, file) : file);
  await page.getByRole("button", { name: "Nahrát soubor" }).click();
  await expect(page).toHaveURL(/\/imports\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByTestId("import-working")).toHaveCount(0, { timeout: 60_000 });
  return /\/imports\/([0-9a-f-]{36})$/.exec(page.url())![1];
}

async function confirmMapping(page: Page) {
  await page.getByLabel(/Majitel servisu písemně potvrdil/).check();
  await page.getByRole("button", { name: "Zkontrolovat data" }).click();
  await expect(page.getByRole("heading", { name: "Kontrola dat", exact: true })).toBeVisible({ timeout: 60_000 });
}

async function commit(page: Page) {
  await page.getByRole("button", { name: /^Importovat/ }).click();
  await expect(page.getByRole("heading", { name: "Import dokončen", exact: true })).toBeVisible({ timeout: 120_000 });
}

test.describe.serial("imports", () => {
  test.beforeAll(async () => {
    const adminId = await createUser(adminEmail, "Operátor Importy");
    users.push(adminId);
    await service.from("platform_admins").insert({ user_id: adminId });
    // Enrol TOTP once through the API; each test then verifies a fresh code.
    const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    await client.auth.signInWithPassword({ email: adminEmail, password: PASSWORD });
    const { data: enrolled, error } = await client.auth.mfa.enroll({ factorType: "totp" });
    if (error || !enrolled) throw error ?? new Error("enroll failed");
    totpSecret = enrolled.totp.secret;
    await client.auth.mfa.challengeAndVerify({ factorId: enrolled.id, code: await freshTotp(totpSecret, usedSteps) });
    companyId = await newCompany(`Autoservis E2E Import ${run}`, true);
  });

  test.afterAll(async () => {
    for (const id of companies) {
      const { data } = await service.storage.from("imports").list(id, { limit: 100 });
      for (const folder of data ?? []) {
        await service.storage
          .from("imports")
          .remove([`${id}/${folder.name}/source.csv`, `${id}/${folder.name}/source.xlsx`]);
      }
    }
    await cleanup(users, companies);
  });

  test.beforeEach(async ({ page }) => {
    await signIn(page, adminEmail);
    await expect(page).toHaveURL(/\/mfa/);
    await page.getByLabel("Ověřovací kód").fill(await freshTotp(totpSecret, usedSteps));
    await page.getByRole("button", { name: "Ověřit" }).click();
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("Windows-1250 CSV: map, review, error CSV, commit, re-import without duplicates", async ({ page }) => {
    test.setTimeout(300_000);
    const importId = await upload(page, companyId, "dvorak-export-cp1250.csv");
    await expect(page.getByRole("heading", { name: "Přiřazení sloupců", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ukázka prvních řádků", exact: true })).toBeVisible();
    await expect(page.locator("table").first()).toContainText("Číslo zákazníka");
    await expect(page.locator("table").first()).toContainText(/ř|ž|č/); // diacritics decoded correctly
    await expect(page.getByLabel("Telefon", { exact: true })).toHaveValue("3");

    // Confirmation of the legal basis is required.
    await page.getByRole("button", { name: "Zkontrolovat data" }).click();
    await expect(page.getByText("Potvrďte, že majitel servisu právní základ potvrdil.")).toBeVisible();
    await confirmMapping(page);

    const { data: imp } = await service
      .from("imports")
      .select("counts, encoding, delimiter")
      .eq("id", importId)
      .single();
    const counts = imp!.counts as Record<string, number>;
    expect(imp).toMatchObject({ encoding: "windows-1250", delimiter: ";" });
    expect(counts.total).toBe(431);
    expect(counts.warning).toBeGreaterThan(0); // fixed lines
    await expect(page.getByTestId("import-counts")).toContainText("431");

    const csv = await page.request.get(`/admin/companies/${companyId}/imports/${importId}/errors`);
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    expect(await csv.text()).toContain("Pevná linka");

    await page.getByRole("link", { name: /S upozorněním/ }).click();
    await expect(page.locator("tbody")).toContainText("Pevná linka");

    await commit(page);
    const created = Number((await page.getByTestId("result-customersCreated").textContent())!.replace(/\D/g, ""));
    expect(created).toBeGreaterThan(100);
    expect(await count("customers", companyId)).toBe(created);
    const visitsAfterFirst = await count("visits", companyId);
    const vehiclesAfterFirst = await count("vehicles", companyId);
    expect(visitsAfterFirst).toBe(counts.valid + counts.warning);
    const { data: lifecycle } = await service
      .from("customers")
      .select("lifecycle_status, last_visit_at, legal_basis")
      .eq("company_id", companyId)
      .limit(5);
    expect(lifecycle!.every((c) => c.last_visit_at && c.legal_basis === "existing_customer")).toBe(true);
    const { count: audits } = await service
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("action", ["import.uploaded", "import.committed"]);
    expect(audits).toBe(2);

    // Customers are visible in the list right away.
    await page.goto(`/admin/companies/${companyId}/customers`);
    await expect(page.getByTestId("customer-total")).toContainText(String(created));

    // Re-import the same file: saved mapping, matches, zero new rows.
    await upload(page, companyId, "dvorak-export-cp1250.csv");
    await expect(page.getByText("Použili jsme mapování uložené z minulého importu.")).toBeVisible();
    await confirmMapping(page);
    await expect(page.getByText(/řádků patří stávajícím zákazníkům/)).toBeVisible();
    // Exclude one row during review; counts follow.
    await page.getByRole("link", { name: /V pořádku/ }).click();
    await page.getByRole("button", { name: "Vyřadit" }).first().click();
    await expect(page.getByRole("link", { name: /Vyřazené/ })).toContainText("1");
    await commit(page);
    await expect(page.getByTestId("result-customersCreated")).toHaveText("0");
    await expect(page.getByTestId("result-visitsCreated")).toHaveText("0");
    expect(await count("customers", companyId)).toBe(created);
    expect(await count("visits", companyId)).toBe(visitsAfterFirst);
    expect(await count("vehicles", companyId)).toBe(vehiclesAfterFirst);
  });

  test("two-sheet XLSX: first sheet, summary row skipped, surname-first names", async ({ page }) => {
    test.setTimeout(180_000);
    const xlsxCompany = await newCompany(`Pneu E2E Import ${run}`, true);
    await upload(page, xlsxCompany, "horak-export.xlsx");
    await expect(page.getByLabel("List")).toHaveValue("Zakázky");
    await expect(page.getByLabel("Celé jméno (Příjmení Jméno)")).toHaveValue("1");
    await confirmMapping(page);
    await commit(page);
    const { data: summary } = await service
      .from("customers")
      .select("id")
      .eq("company_id", xlsxCompany)
      .or("first_name.eq.Celkem,last_name.eq.Celkem");
    expect(summary).toEqual([]);
    const customers = await count("customers", xlsxCompany);
    expect(customers).toBeGreaterThan(80);
    expect(customers).toBeLessThanOrEqual(90);
    const { data: fixed } = await service
      .from("customers")
      .select("id")
      .eq("company_id", xlsxCompany)
      .eq("phone_type", "fixed");
    expect(fixed!.length).toBeGreaterThan(0);
  });

  test("a broken file fails with a clear reason", async ({ page }) => {
    await upload(page, companyId, "broken.csv");
    await expect(page.getByTestId("import-error")).toContainText("neuzavřené uvozovky");
  });

  test("real-looking data is refused outside production", async ({ page }) => {
    const realLooking = Buffer.from(
      "Jméno;Příjmení;Telefon;E-mail;Datum\nJan;Novák;777123456;jan.novak@seznam.cz;1.3.2025\n",
    );
    await upload(page, companyId, { name: "skutecna-data.csv", mimeType: "text/csv", buffer: realLooking });
    await page.getByLabel(/Majitel servisu písemně potvrdil/).check();
    await page.getByRole("button", { name: "Zkontrolovat data" }).click();
    await expect(page.getByTestId("import-error")).toContainText("jen testovací data", { timeout: 60_000 });
  });

  test("no import before the processing agreement is confirmed", async ({ page }) => {
    const noDpa = await newCompany(`Bez smlouvy E2E ${run}`, false);
    await page.goto(`/admin/companies/${noDpa}/imports`);
    await expect(page.getByTestId("import-dpa-missing")).toBeVisible();
    await expect(page.getByLabel("Soubor (CSV, TXT nebo XLSX, max. 20 MB)")).toHaveCount(0);
  });
});
