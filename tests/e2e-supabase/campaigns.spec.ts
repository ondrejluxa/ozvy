import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { PASSWORD, cleanup, createUser, email, env, freshTotp, latestEmailLink, run, service, signIn } from "./helpers";

/**
 * Slice 10 (spec §12, §40.10, flows F3 and F4) on the seeded world:
 * Pneu & Servis Horák approves campaigns itself, Autoservis Dvořák leaves it
 * to the operator. Nothing is sent (slice 12). Requires `pnpm db:seed`.
 */

const adminEmail = email("campaigns-admin");
const OWNER = "majitel@horak.example.cz";
const MANAGER = "vedouci@horak.example.cz";
const seedPassword = env.SEED_USER_PASSWORD ?? "";
const users: string[] = [];
const usedSteps = new Set<number>();
const names = { horak: `E2E kampaň Horák ${run}`, dvorak: `E2E kampaň Dvořák ${run}` };
let totpSecret = "";
let horakId = "";
let dvorakId = "";

async function operator(page: Page) {
  await signIn(page, adminEmail);
  await page.getByLabel("Ověřovací kód").fill(await freshTotp(totpSecret, usedSteps));
  await page.getByRole("button", { name: "Ověřit" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

/** Builder: segment → AI message (+ optional follow-up) → name → review. */
async function buildCampaign(page: Page, companyId: string, name: string, followup: boolean) {
  await page.goto(`/admin/companies/${companyId}/campaigns/new?preset=no_visit_12m`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("builder-segment")).toHaveText("Bez návštěvy 12+ měsíců");
  await page.getByRole("button", { name: "Pokračovat" }).click();
  await page.getByRole("button", { name: "Vygenerovat zprávu pomocí AI" }).click();
  await expect(page.getByLabel("Šablona zprávy")).not.toHaveValue("", { timeout: 15_000 });
  await expect(page.getByText("Odkaz na odhlášení je ve zprávě")).toBeVisible();
  if (followup) {
    await page.getByRole("button", { name: "Přidat připomínku" }).click();
    await expect(page.getByLabel("Šablona zprávy")).toHaveValue(/\{\{odhlaseni\}\}/);
  }
  await page.getByRole("button", { name: "Pokračovat" }).click();
  await page.getByLabel("Název kampaně").fill(name);
  await page.getByRole("button", { name: "Pokračovat" }).click();
  await expect(page.getByRole("heading", { name: "Kontrola před odesláním" })).toBeVisible();
}

test.describe.serial("campaigns without sending", () => {
  test.beforeAll(async () => {
    const { data } = await service
      .from("companies")
      .select("id, name")
      .in("name", ["Pneu & Servis Horák", "Autoservis Dvořák s.r.o."]);
    if (data?.length !== 2) throw new Error("Seed data missing: run `pnpm db:seed`.");
    horakId = data.find((c) => c.name.startsWith("Pneu"))!.id;
    dvorakId = data.find((c) => c.name.startsWith("Autoservis"))!.id;
    const adminId = await createUser(adminEmail, "Operátor Kampaně");
    users.push(adminId);
    await service.from("platform_admins").insert({ user_id: adminId });
    const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    await client.auth.signInWithPassword({ email: adminEmail, password: PASSWORD });
    const { data: enrolled, error } = await client.auth.mfa.enroll({ factorType: "totp" });
    if (error || !enrolled) throw error ?? new Error("enroll failed");
    totpSecret = enrolled.totp.secret;
    await client.auth.mfa.challengeAndVerify({ factorId: enrolled.id, code: await freshTotp(totpSecret, usedSteps) });
  });

  test.afterAll(async () => {
    await service.from("campaigns").delete().in("name", Object.values(names));
    await cleanup(users, []);
  });

  test("client-approval shop: submit, owner returns, operator edits, owner approves, operator cancels", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    await operator(page);
    await buildCampaign(page, horakId, names.horak, true);
    await expect(page.getByText("Kampaň odejde ke schválení majiteli servisu.")).toBeVisible();
    await page.getByRole("button", { name: "Odeslat ke schválení" }).click();
    await expect(page.getByText("Kampaň čeká na schválení klientem.")).toBeVisible();
    await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);
    const campaignId = /campaigns\/([0-9a-f-]{36})$/.exec(page.url())![1];

    const { data: stored } = await service
      .from("campaigns")
      .select("status, approved_recipient_count, holdout_pct, campaign_steps(step_number, delay_days)")
      .eq("id", campaignId)
      .single();
    expect(stored).toMatchObject({ status: "waiting_for_approval", holdout_pct: 0.1 });
    expect(stored!.approved_recipient_count).toBeGreaterThan(50);
    expect(stored!.campaign_steps.sort((a, b) => a.step_number - b.step_number)).toEqual([
      { step_number: 0, delay_days: 0 },
      { step_number: 1, delay_days: 3 },
    ]);
    await expect(page.getByTestId("step-1")).toContainText("Připomínka 1");

    // The owner gets the approval e-mail (spec F4) and returns the campaign with a comment.
    const link = await latestEmailLink(OWNER, new RegExp(`https?://[^"\\s]+/app/campaigns/${campaignId}`));
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signIn(ownerPage, OWNER, seedPassword);
    await expect(ownerPage).toHaveURL(/\/app$/);
    await ownerPage.goto(link.replace(/^https?:\/\/[^/]+/, ""));
    await expect(ownerPage.getByTestId("approval-panel")).toBeVisible();
    await expect(ownerPage.getByTestId("detail-recipients")).toHaveText(/\d/);
    await ownerPage.getByRole("button", { name: "Vrátit s komentářem" }).click();
    await ownerPage.getByLabel("Co upravit").fill("Prosím zmínit sezónní prohlídku.");
    await ownerPage.getByRole("button", { name: "Vrátit operátorovi" }).click();
    await expect(ownerPage.getByText("Kampaň vrácena s komentářem.")).toBeVisible();

    // The operator sees the comment, edits the draft and resubmits.
    await page.reload();
    await expect(page.getByTestId("returned-comment")).toContainText("sezónní prohlídku");
    await page.getByRole("link", { name: "Upravit" }).click();
    await expect(page).toHaveURL(/\/edit$/);
    const template = page.getByLabel("Šablona zprávy");
    await template.fill(
      `${await template.inputValue()} `.replace("{{odhlaseni}} ", "Sezónní prohlídka čeká. {{odhlaseni}}"),
    );
    await page.getByRole("button", { name: "Pokračovat" }).click();
    await page.getByRole("button", { name: "Pokračovat" }).click();
    await page.getByRole("button", { name: "Uložit změny" }).click();
    await expect(page.getByText("Koncept uložen.")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}$`));
    await page.getByRole("button", { name: "Odeslat ke schválení" }).click();
    await expect(page.getByText("Kampaň čeká na schválení klientem.")).toBeVisible();

    // A manager may look but not decide.
    const managerContext = await browser.newContext();
    const managerPage = await managerContext.newPage();
    await signIn(managerPage, MANAGER, seedPassword);
    await expect(managerPage).toHaveURL(/\/app$/);
    await managerPage.goto(`/app/campaigns/${campaignId}`);
    await expect(managerPage.getByText("Kampaň čeká na schválení majitelem servisu.")).toBeVisible();
    await expect(managerPage.getByTestId("approval-panel")).toHaveCount(0);
    await managerContext.close();

    // The owner approves.
    await ownerPage.goto(`/app/campaigns/${campaignId}`);
    await ownerPage.getByRole("button", { name: "Schválit" }).click();
    await expect(ownerPage.getByText("Kampaň schválena a naplánována.")).toBeVisible();
    const { data: approved } = await service
      .from("campaigns")
      .select("status, approved_by")
      .eq("id", campaignId)
      .single();
    expect(approved!.status).toBe("scheduled");
    expect(approved!.approved_by).not.toBeNull();
    await ownerContext.close();

    // The operator cancels the scheduled campaign.
    await page.reload();
    await page.getByRole("button", { name: "Zrušit kampaň" }).click();
    await page.getByRole("button", { name: "Ano, zrušit" }).click();
    await expect(page.getByText("Kampaň zrušena.")).toBeVisible();
    const { data: audits } = await service.from("audit_logs").select("action").eq("entity_id", campaignId).order("id");
    expect(audits!.map((a) => a.action)).toEqual([
      "campaign.created",
      "campaign.submitted",
      "campaign.rejected",
      "campaign.updated",
      "campaign.submitted",
      "campaign.approved",
      "campaign.scheduled",
      "campaign.cancelled",
    ]);
  });

  test("operator-approved shop: the operator confirms and the campaign is scheduled", async ({ page }) => {
    test.setTimeout(180_000);
    await operator(page);
    await buildCampaign(page, dvorakId, names.dvorak, false);
    const schedule = page.getByRole("button", { name: "Naplánovat kampaň" });
    await expect(schedule).toBeDisabled();
    await page.getByLabel(/Potvrzuji naplánování kampaně/).check();
    await schedule.click();
    await expect(page.getByText("Kampaň je naplánovaná.")).toBeVisible();
    const { data } = await service.from("campaigns").select("status, approved_by").eq("name", names.dvorak).single();
    expect(data!.status).toBe("scheduled");
    expect(data!.approved_by).toBe(users[0]);
    await page.goto(`/admin/companies/${dvorakId}/campaigns`);
    await expect(page.getByTestId("campaign-row").filter({ hasText: names.dvorak })).toContainText("Naplánovaná");
  });
});
