import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import messages from "../../messages/cs.json";
import type { Database } from "../../lib/db/types.gen";
import { buildDigest, runHealthCheck } from "../../lib/jobs/alerts-core";
import { PASSWORD, cleanup, createUser, email, env, freshTotp, run, service, signIn } from "./helpers";

/**
 * Slice 15 (spec §9, §10, §40.15, §41) on the seeded Autoservis Dvořák:
 * the operator sets the subscription price; a confirmed return shows on the
 * owner's dashboard (hero, KPIs, recent returns, current campaign) and in
 * Výsledky, readable at 390 px; a failed campaign raises an alert in
 * Attention Required that resolves when the cause is gone; the digest
 * summarises it. Requires `pnpm db:seed`.
 */

const adminEmail = email("dashboards-admin");
const OWNER = "majitel@dvorak.example.cz";
const seedPassword = env.SEED_USER_PASSWORD ?? "";
const names = { active: `E2E přehled ${run}`, failed: `E2E selhaná ${run}` };
const users: string[] = [];
const usedSteps = new Set<number>();
let totpSecret = "";
let companyId = "";
let customer = { id: "", name: "" };
let failedId = "";
const day = 86_400_000;

const db = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function operator(page: Page) {
  await signIn(page, adminEmail);
  await page.getByLabel("Ověřovací kód").fill(await freshTotp(totpSecret, usedSteps));
  await page.getByRole("button", { name: "Ověřit" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function campaign(name: string, statuses: string[], startedAt: string) {
  const { data } = await service
    .from("campaigns")
    .insert({ company_id: companyId, name, segment_preset: "no_visit_12m", segment_rules_snapshot: { all: [] } })
    .select("id")
    .single();
  for (const status of statuses) {
    await service
      .from("campaigns")
      .update({ status: status as "scheduled", started_at: startedAt })
      .eq("id", data!.id);
  }
  return data!.id;
}

test.describe.serial("dashboards", () => {
  test.beforeAll(async () => {
    const { data: company } = await service
      .from("companies")
      .select("id")
      .eq("name", "Autoservis Dvořák s.r.o.")
      .single();
    if (!company) throw new Error("Seed data missing: run `pnpm db:seed`.");
    companyId = company.id;
    await service.from("alerts").delete().eq("company_id", companyId);
    const { data: c } = await service
      .from("customers")
      .select("id, first_name, last_name")
      .eq("company_id", companyId)
      .not("last_name", "is", null)
      .order("id")
      .limit(1)
      .single();
    customer = { id: c!.id, name: `${c!.first_name} ${c!.last_name}` };

    // A running campaign with one confirmed return of 4 800 Kč today.
    const started = new Date(Date.now() - 5 * day).toISOString();
    const activeId = await campaign(names.active, ["scheduled", "sending", "active"], started);
    const { data: enrollment } = await service
      .from("campaign_enrollments")
      .insert({
        company_id: companyId,
        campaign_id: activeId,
        customer_id: customer.id,
        is_holdout: false,
        first_sent_at: started,
        window_ends_at: new Date(Date.now() + 55 * day).toISOString(),
      })
      .select("id")
      .single();
    const { error } = await service.rpc("record_conversion", {
      p_company_id: companyId,
      p_enrollment_id: enrollment!.id,
      p_action: "complete",
      p_at: new Date().toISOString(),
      p_revenue_minor: 480_000,
    });
    if (error) throw new Error(error.message);

    const adminId = await createUser(adminEmail, "Operátor Přehled");
    users.push(adminId);
    await service.from("platform_admins").insert({ user_id: adminId });
    const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    await client.auth.signInWithPassword({ email: adminEmail, password: PASSWORD });
    const { data: enrolled, error: mfaError } = await client.auth.mfa.enroll({ factorType: "totp" });
    if (mfaError || !enrolled) throw mfaError ?? new Error("enroll failed");
    totpSecret = enrolled.totp.secret;
    await client.auth.mfa.challengeAndVerify({ factorId: enrolled.id, code: await freshTotp(totpSecret, usedSteps) });
  });

  test.afterAll(async () => {
    await service.from("campaigns").delete().in("name", Object.values(names));
    await service.from("companies").update({ subscription_price_minor: 0 }).eq("id", companyId);
    await runHealthCheck(db, new Date());
    await cleanup(users, []);
  });

  test("operator sets the subscription price; the owner sees the return on Přehled and Výsledky", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    await operator(page);
    await page.goto(`/admin/companies/${companyId}/settings`);
    await page.getByLabel("Měsíční předplatné (Kč)").fill("4 990");
    await page.getByRole("button", { name: "Uložit změny" }).first().click();
    await expect(page.getByText("Uloženo.").first()).toBeVisible();
    const { data: stored } = await service
      .from("companies")
      .select("subscription_price_minor")
      .eq("id", companyId)
      .single();
    expect(Number(stored!.subscription_price_minor)).toBe(499_000);

    const owner = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const ownerPage = await owner.newPage();
    await signIn(ownerPage, OWNER, seedPassword);
    await expect(ownerPage).toHaveURL(/\/app$/);
    await expect(ownerPage.getByTestId("hero-revenue")).toHaveText(/4\s800\sKč/);
    const kpis = ownerPage.getByTestId("client-kpis");
    await expect(kpis).toContainText(/4\s990\sKč/);
    // 4 800 / 4 990 = 0,96, shown with one decimal.
    await expect(kpis).toContainText(/1,0\s?×/);
    await expect(ownerPage.getByTestId("recent-return").first()).toContainText(customer.name);
    await expect(ownerPage.getByTestId("current-campaign").filter({ hasText: names.active })).toBeVisible();
    await expect(ownerPage.getByRole("heading", { name: "Autoservis Dvořák s.r.o." })).toBeVisible();
    expect(await ownerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await ownerPage.goto("/app/results");
    await expect(ownerPage.getByTestId("results-campaign").filter({ hasText: names.active })).toContainText(
      /4\s800\sKč/,
    );
    await expect(ownerPage.getByTestId("holdout-insufficient")).toBeVisible();
    expect(await ownerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await owner.close();
  });

  test("Attention Required: a failed campaign opens an alert that resolves when it is gone; digest", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    failedId = await campaign(names.failed, ["scheduled", "sending", "failed"], new Date().toISOString());
    const first = await runHealthCheck(db, new Date());
    expect(first.opened).toBeGreaterThanOrEqual(1);

    await operator(page);
    const alert = page.getByTestId("attention-required").getByRole("listitem").filter({ hasText: names.failed });
    await expect(alert).toContainText("Autoservis Dvořák s.r.o.");
    await expect(page.getByTestId("admin-kpis")).toContainText(/4\s990\sKč/);
    await expect(
      page.getByTestId("client-row").filter({ hasText: "Autoservis Dvořák" }).getByTestId("client-alerts"),
    ).not.toHaveText("—");
    await alert.getByRole("link", { name: "Otevřít kampaň" }).click();
    await expect(page).toHaveURL(new RegExp(`/campaigns/${failedId}$`));

    const titles = Object.fromEntries(
      Object.entries(messages.alerts as Record<string, unknown>)
        .filter(([, v]) => typeof v === "object" && v !== null && "digest" in v)
        .map(([k, v]) => [k, (v as { digest: string }).digest]),
    );
    const digest = await buildDigest(db, new Date(), { titles, appUrl: "http://localhost:3200" });
    expect(digest.subject).toMatch(/^Vyžaduje pozornost: \d+ upozornění · \d+ kampan/);
    expect(digest.text).toContain("Autoservis Dvořák s.r.o.: Kampaň selhala nebo má víc než 5 % chyb");

    // The cause disappears: the alert is resolved, not deleted.
    await service.from("campaigns").delete().eq("id", failedId);
    const second = await runHealthCheck(db, new Date());
    expect(second.resolved).toBeGreaterThanOrEqual(1);
    const { data: resolved } = await service
      .from("alerts")
      .select("status, resolved_at")
      .eq("dedupe_key", `campaign_failed:${failedId}`)
      .single();
    expect(resolved!.status).toBe("resolved");
    await page.goto("/admin");
    await expect(page.getByTestId("attention-required").getByText(names.failed)).toHaveCount(0);
  });
});
