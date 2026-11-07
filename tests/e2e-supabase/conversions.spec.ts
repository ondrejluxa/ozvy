import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { PASSWORD, cleanup, createUser, email, env, freshTotp, run, service, signIn } from "./helpers";

/**
 * Slice 14 (spec §14, §40.14, flow F5) on the seeded Autoservis Dvořák: the
 * operator marks a contacted customer booked and completed with the job
 * value on the campaign page; a holdout return is recorded but not counted;
 * the owner edits and reverts on the customer page. Monthly stats follow.
 * Requires `pnpm db:seed`.
 */

const adminEmail = email("conversions-admin");
const OWNER = "majitel@dvorak.example.cz";
const seedPassword = env.SEED_USER_PASSWORD ?? "";
const campaignName = `E2E návraty ${run}`;
const users: string[] = [];
const usedSteps = new Set<number>();
let totpSecret = "";
let companyId = "";
let campaignId = "";
let treated = { id: "", name: "", enrollment: "" };
let holdout = { id: "", name: "", enrollment: "" };
const day = 86_400_000;

async function operator(page: Page) {
  await signIn(page, adminEmail);
  await page.getByLabel("Ověřovací kód").fill(await freshTotp(totpSecret, usedSteps));
  await page.getByRole("button", { name: "Ověřit" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function conversion(enrollmentId: string) {
  const { data } = await service
    .from("conversions")
    .select("stage, revenue_minor, source, is_holdout, confirmed_by")
    .eq("enrollment_id", enrollmentId)
    .maybeSingle();
  return data;
}

test.describe.serial("conversions", () => {
  test.beforeAll(async () => {
    const { data: company } = await service
      .from("companies")
      .select("id")
      .eq("name", "Autoservis Dvořák s.r.o.")
      .single();
    if (!company) throw new Error("Seed data missing: run `pnpm db:seed`.");
    companyId = company.id;
    const { data: customers } = await service
      .from("customers")
      .select("id, first_name, last_name")
      .eq("company_id", companyId)
      .not("first_name", "is", null)
      .not("last_name", "is", null)
      .order("id")
      .limit(2);
    const name = (c: { first_name: string | null; last_name: string | null }) => `${c.first_name} ${c.last_name}`;

    // A campaign that started 10 days ago: one contacted customer, one in the holdout.
    const started = new Date(Date.now() - 10 * day).toISOString();
    const windowEnds = new Date(Date.now() + 50 * day).toISOString();
    const { data: campaign } = await service
      .from("campaigns")
      .insert({
        company_id: companyId,
        name: campaignName,
        segment_preset: "no_visit_12m",
        segment_rules_snapshot: { all: [] },
      })
      .select("id")
      .single();
    if (!campaign) throw new Error("campaign setup failed");
    campaignId = campaign.id;
    for (const status of ["scheduled", "sending", "active"] as const) {
      await service.from("campaigns").update({ status, started_at: started }).eq("id", campaignId);
    }
    const { data: enrollments, error: insertError } = await service
      .from("campaign_enrollments")
      .insert([
        {
          company_id: companyId,
          campaign_id: campaignId,
          customer_id: customers![0].id,
          is_holdout: false,
          first_sent_at: started,
          window_ends_at: windowEnds,
        },
        {
          company_id: companyId,
          campaign_id: campaignId,
          customer_id: customers![1].id,
          is_holdout: true,
          first_sent_at: null,
          window_ends_at: windowEnds,
        },
      ])
      .select("id, customer_id");
    if (insertError) throw new Error(`enrollment setup failed: ${insertError.message}`);
    const enrollmentOf = (customerId: string) => enrollments!.find((e) => e.customer_id === customerId)!.id;
    treated = { id: customers![0].id, name: name(customers![0]), enrollment: enrollmentOf(customers![0].id) };
    holdout = { id: customers![1].id, name: name(customers![1]), enrollment: enrollmentOf(customers![1].id) };

    const adminId = await createUser(adminEmail, "Operátor Návraty");
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
    // Enrollments and conversions go with the campaign; the stats trigger recomputes the month.
    await service.from("campaigns").delete().eq("name", campaignName);
    await cleanup(users, []);
  });

  test("operator: booked, completed with value, holdout recorded but not counted", async ({ page }) => {
    test.setTimeout(180_000);
    await operator(page);
    await page.goto(`/admin/companies/${companyId}/campaigns/${campaignId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("campaign-results")).toBeVisible();
    await expect(page.getByTestId("holdout-comparison")).toContainText("Nedostatek dat pro porovnání");

    const row = page.getByTestId("recipient-row").filter({ hasText: treated.name });
    await row.getByRole("button", { name: "Objednal se" }).click();
    await expect(page.getByText(`${treated.name} se objednal`)).toBeVisible();
    await expect.poll(async () => (await conversion(treated.enrollment))?.stage).toBe("booked");

    await row.getByRole("button", { name: "Dokončeno" }).click();
    await page.getByLabel("Částka zakázky (Kč)").fill("4 800");
    await page.getByRole("button", { name: "Uložit" }).click();
    await expect(page.getByText(/4\s800\sKč započteno do vrácených tržeb/)).toBeVisible();
    expect(await conversion(treated.enrollment)).toMatchObject({
      stage: "completed",
      revenue_minor: 480_000,
      source: "manual_confirmed",
      is_holdout: false,
      confirmed_by: users[0],
    });
    await expect(page.getByTestId("results-revenue")).toHaveText(/4\s800\sKč/);

    // The holdout return is recorded, never counted.
    await page.goto(`/admin/companies/${companyId}/campaigns/${campaignId}?stav=holdout`);
    await expect(page.getByTestId("recipient-row")).toHaveCount(1);
    await page.getByTestId("recipient-row").getByRole("button", { name: "Dokončeno" }).click();
    await expect(page.getByText("Zákazník je v kontrolní skupině.", { exact: false })).toBeVisible();
    await page.getByLabel("Částka zakázky (Kč)").fill("3000");
    await page.getByRole("button", { name: "Uložit" }).click();
    await expect(page.getByText("Uloženo do kontrolní skupiny")).toBeVisible();
    expect(await conversion(holdout.enrollment)).toMatchObject({
      stage: "completed",
      is_holdout: true,
      revenue_minor: 300_000,
    });
    await expect(page.getByTestId("results-revenue")).toHaveText(/4\s800\sKč/);

    // Monthly stats follow at once, without the holdout.
    const month = new Date().toISOString().slice(0, 7) + "-01";
    const { data: stats } = await service
      .from("company_monthly_stats")
      .select("recovered_revenue_minor, completed_count")
      .eq("company_id", companyId)
      .eq("month", month)
      .single();
    expect(Number(stats!.recovered_revenue_minor)).toBeGreaterThanOrEqual(480_000);
    const { data: audits } = await service
      .from("audit_logs")
      .select("action, metadata")
      .eq("entity_id", treated.enrollment)
      .order("id");
    expect(audits!.map((a) => a.action)).toEqual(["conversion.marked", "conversion.marked"]);
    // Spec §23: booking and completion are "marked", told apart by the stage.
    expect(audits!.map((a) => (a.metadata as { stage?: string }).stage)).toEqual(["booked", "completed"]);
  });

  test("owner: edits the job value and reverts on the customer page", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, OWNER, seedPassword);
    await expect(page).toHaveURL(/\/app$/);
    await page.goto(`/app/customers/${treated.id}`);
    const entry = page.getByTestId("customer-enrollment").filter({ hasText: campaignName });
    await expect(entry.getByTestId("enrollment-stage")).toHaveText("Dokončeno");
    await entry.getByRole("button", { name: "Upravit tržbu" }).click();
    await page.getByLabel("Částka zakázky (Kč)").fill("5200");
    await page.getByRole("button", { name: "Uložit" }).click();
    await expect(page.getByText(/5\s200\sKč započteno/)).toBeVisible();
    expect((await conversion(treated.enrollment))?.revenue_minor).toBe(520_000);

    await entry.getByRole("button", { name: "Vrátit zpět" }).click();
    await entry.getByRole("button", { name: "Ano, vrátit" }).click();
    await expect(page.getByText("Výsledek vrácen zpět.")).toBeVisible();
    expect(await conversion(treated.enrollment)).toBeNull();
    await expect(entry.getByTestId("enrollment-stage")).toHaveText("Osloven");
  });
});
