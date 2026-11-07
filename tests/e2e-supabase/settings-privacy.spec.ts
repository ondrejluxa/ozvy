import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/db/types.gen";
import { suppressionHash } from "../../lib/domain/messaging/opt-out";
import { runHealthCheck } from "../../lib/jobs/alerts-core";
import { PASSWORD, cleanup, createUser, email, env, freshTotp, run, signIn } from "./helpers";

/**
 * ADR-018 (local-only Phase 1 completion) on the real local stack: client
 * settings (profile, users, data and privacy, history), role change and
 * removal, data subject requests from request to erasure, retention
 * objection, the audit log screens, the all-campaigns view, and alerts for
 * stuck imports and due requests.
 */

const db = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const adminEmail = email("settings-admin");
const ownerEmail = email("settings-owner");
const managerEmail = email("settings-manager");
const users: string[] = [];
const usedSteps = new Set<number>();
let totpSecret = "";
let adminId = "";
let ownerId = "";
let managerId = "";
let companyId = "";
let customerId = "";
let stuckImportId = "";
const PHONE = "+420777018001";
const companyName = `Autoservis E2E Nastavení ${run}`;

async function operator(page: Page) {
  await signIn(page, adminEmail);
  await page.getByLabel("Ověřovací kód").fill(await freshTotp(totpSecret, usedSteps));
  await page.getByRole("button", { name: "Ověřit" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function owner(page: Page) {
  await signIn(page, ownerEmail);
  await expect(page).toHaveURL(/\/app$/);
}

async function confirmIn(page: Page, label: string | RegExp) {
  await page.getByRole("dialog").getByRole("button", { name: label }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function auditActions(filter: { company?: string; actor?: string }) {
  let q = db.from("audit_logs").select("action, actor_type, metadata").order("id");
  if (filter.company) q = q.eq("company_id", filter.company);
  if (filter.actor) q = q.eq("actor_user_id", filter.actor);
  const { data } = await q;
  return data ?? [];
}

test.describe.serial("settings, users, privacy and audit", () => {
  test.beforeAll(async () => {
    adminId = await createUser(adminEmail, "Operátor Nastavení");
    ownerId = await createUser(ownerEmail, "Majitel Nastavení");
    managerId = await createUser(managerEmail, "Vedoucí Nastavení");
    users.push(adminId, ownerId, managerId);
    await db.from("platform_admins").insert({ user_id: adminId });
    const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    await client.auth.signInWithPassword({ email: adminEmail, password: PASSWORD });
    const { data: enrolled, error } = await client.auth.mfa.enroll({ factorType: "totp" });
    if (error || !enrolled) throw error ?? new Error("enroll failed");
    totpSecret = enrolled.totp.secret;
    await client.auth.mfa.challengeAndVerify({ factorId: enrolled.id, code: await freshTotp(totpSecret, usedSteps) });

    const { data: company } = await db
      .from("companies")
      .insert({ name: companyName, city: "Kolín", status: "active", dpa_signed_at: new Date().toISOString() })
      .select("id")
      .single();
    companyId = company!.id;
    await db.from("memberships").insert([
      { user_id: ownerId, company_id: companyId, role: "shop_owner" },
      { user_id: managerId, company_id: companyId, role: "shop_manager" },
    ]);
    const { data: customer } = await db
      .from("customers")
      .insert({
        company_id: companyId,
        first_name: "Erik",
        last_name: "Smazatelný",
        phone_e164: PHONE,
        phone_type: "mobile",
        email: "erik@example.cz",
        legal_basis: "existing_customer",
        last_visit_at: "2025-02-01",
      })
      .select("id")
      .single();
    customerId = customer!.id;
    await db
      .from("vehicles")
      .insert({ company_id: companyId, customer_id: customerId, brand: "Škoda", model: "Fabia" });
    const { data: campaign } = await db
      .from("campaigns")
      .insert({ company_id: companyId, name: `Kampaň ${run}`, segment_rules_snapshot: { all: [] } })
      .select("id")
      .single();
    await db.from("messages").insert({
      company_id: companyId,
      campaign_id: campaign!.id,
      customer_id: customerId,
      to_address: PHONE,
      body_rendered: "Dobrý den, Eriku, ozvěte se nám.",
      idempotency_key: `e2e-settings-${run}`,
      opt_out_token: `St${run}`.slice(0, 8).padEnd(8, "x"),
      status: "delivered",
    });
    // A long-inactive customer flagged by last night's retention run.
    await db.from("customers").insert({
      company_id: companyId,
      first_name: "Starý",
      last_name: "Zákazník",
      last_visit_at: "2019-03-01",
      retention_flagged_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    });
  });

  test.afterAll(async () => {
    await cleanup(users, [companyId]);
  });

  test("owner: settings tabs, contact details, users (role change, removal, last owner)", async ({ page }) => {
    test.setTimeout(120_000);
    await owner(page);
    await page.getByRole("link", { name: "Nastavení" }).first().click();
    await expect(page).toHaveURL(/\/app\/settings$/);
    for (const tab of ["Profil servisu", "Uživatelé", "Data a soukromí", "Historie změn"]) {
      await expect(page.getByRole("link", { name: tab, exact: true })).toBeVisible();
    }

    const form = page.getByTestId("shop-contact-form");
    await form.locator('input[name="contact_person"]').fill("Jan Nastavení");
    await form.locator('input[name="phone"]').fill("321 018 001");
    await form.getByRole("button", { name: "Uložit změny" }).click();
    await expect(page.getByText("Uloženo.")).toBeVisible();
    const { data: saved } = await db.from("companies").select("contact_person, phone").eq("id", companyId).single();
    expect(saved).toEqual({ contact_person: "Jan Nastavení", phone: "+420321018001" });

    await page.getByRole("link", { name: "Uživatelé", exact: true }).click();
    const rows = page.getByTestId("member-row");
    await expect(rows).toHaveCount(2);
    // The only owner cannot demote themselves.
    await expect(page.getByLabel("Role uživatele Majitel Nastavení")).toBeDisabled();
    await page.getByLabel("Role uživatele Vedoucí Nastavení").selectOption("shop_owner");
    await expect(page.getByText("Role je změněná.")).toBeVisible();
    await expect(page.getByLabel("Role uživatele Majitel Nastavení")).toBeEnabled();
    await page.getByLabel("Role uživatele Vedoucí Nastavení").selectOption("shop_manager");
    // Every role select is disabled while an action runs: wait for the saved state, not just "disabled".
    await expect
      .poll(async () =>
        (await auditActions({ company: companyId, actor: ownerId }))
          .filter((a) => a.action === "user.role_changed")
          .map((a) => (a.metadata as { new_role: string }).new_role),
      )
      .toEqual(["shop_owner", "shop_manager"]);
    await expect(page.getByLabel("Role uživatele Vedoucí Nastavení")).toHaveValue("shop_manager");
    await expect(page.getByLabel("Role uživatele Majitel Nastavení")).toBeDisabled();
    const actions = (await auditActions({ company: companyId, actor: ownerId })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["company.settings_changed", "user.role_changed"]));
  });

  test("manager: profile and users read-only, no data or history tabs", async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, managerEmail);
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/app/settings");
    await expect(page.getByRole("link", { name: "Profil servisu", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Data a soukromí", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("shop-contact-form")).toHaveCount(0);
    await expect(page.getByText("Jan Nastavení")).toBeVisible();
    await page.goto("/app/settings?tab=users");
    await expect(page.getByText("Uživatele servisu spravuje majitel.")).toBeVisible();
    await expect(page.getByRole("combobox")).toHaveCount(0);
    const history = await page.goto("/app/settings?tab=history");
    expect(history?.status()).toBe(404);
    // A manager cannot ask for a customer's data either (customers.export is the owner's).
    await page.goto(`/app/customers/${customerId}`);
    await expect(page.getByTestId("customer-privacy")).toHaveCount(0);
  });

  test("owner: requests an erasure, sees it under Data a soukromí, keeps flagged customers", async ({ page }) => {
    test.setTimeout(120_000);
    await owner(page);
    await page.goto(`/app/customers/${customerId}`);
    await page.getByTestId("request-erasure").click();
    await confirmIn(page, "Odeslat žádost");
    await expect(page.getByText("Žádost je odeslaná operátorovi.")).toBeVisible();
    const { data: requests } = await db
      .from("data_subject_requests")
      .select("type, source, status, subject_reference")
      .eq("company_id", companyId);
    expect(requests).toEqual([{ type: "erasure", source: "shop", status: "open", subject_reference: customerId }]);

    await page.goto("/app/settings?tab=data");
    await expect(page.getByTestId("dsr-row")).toContainText("smazání");
    await expect(page.getByTestId("dsr-row")).toContainText("Čeká");
    await expect(page.getByTestId("retention-count")).toContainText("1 zákazník bude smazán");
    await page.getByRole("button", { name: "Ponechat všechny" }).click();
    await confirmIn(page, "Ponechat");
    await expect(page.getByTestId("retention-none")).toBeVisible();
    const { data: kept } = await db
      .from("customers")
      .select("retention_flagged_at, retention_kept_at")
      .eq("company_id", companyId)
      .eq("first_name", "Starý")
      .single();
    expect(kept!.retention_flagged_at).toBeNull();
    expect(kept!.retention_kept_at).not.toBeNull();

    await page.goto("/app/settings?tab=history");
    await expect(page.getByTestId("audit-row").first()).toBeVisible();
    await expect(page.getByTestId("audit-log")).toContainText("Přijetí žádosti o osobní údaje");
    // The simplified history shows no technical details.
    await expect(page.getByTestId("audit-log")).not.toContainText("dsr.created");
  });

  test("operator: exports, erases the customer, and the audit log tells the story", async ({ page }) => {
    test.setTimeout(150_000);
    await operator(page);
    await page.goto(`/admin/companies/${companyId}/privacy`);
    await expect(page.getByTestId("dsr-row")).toContainText("Požádal servis");

    const exported = await page.request.get(`/admin/companies/${companyId}/customers/${customerId}/export`);
    expect(exported.status()).toBe(200);
    expect(exported.headers()["content-disposition"]).toMatch(/attachment; filename="export-zakaznika-[0-9a-f]{8}-/);
    const body = await exported.json();
    expect(body.subject).toMatchObject({ firstName: "Erik", phone: PHONE, email: "erik@example.cz" });
    expect(body.messages[0].body).toContain("Eriku");

    await page.getByTestId("complete-erasure").click();
    await confirmIn(page, "Trvale smazat zákazníka");
    await expect(page.getByTestId("dsr-row")).toContainText("Vyřízeno");
    await expect(page.getByTestId("dsr-row")).toContainText("Smazaný zákazník");

    expect((await db.from("customers").select("id").eq("id", customerId)).data).toEqual([]);
    const { data: message } = await db
      .from("messages")
      .select("body_rendered, to_address, customer_id, status")
      .eq("idempotency_key", `e2e-settings-${run}`)
      .single();
    expect(message).toEqual({
      body_rendered: "[redacted]",
      to_address: "[redacted]",
      customer_id: null,
      status: "delivered",
    });
    const { count } = await db
      .from("suppression_list")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("address_hash", suppressionHash(PHONE, env.SUPPRESSION_PEPPER!));
    expect(count).toBe(1);

    const actions = (await auditActions({ company: companyId, actor: adminId })).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(["admin.company_viewed", "customer.exported", "customer.deleted", "dsr.completed"]),
    );
    // Viewed once per sign-in, however many pages of the shop were opened.
    expect(actions.filter((a) => a === "admin.company_viewed")).toHaveLength(1);

    await page.goto(`/admin/companies/${companyId}/audit?akce=dsr`);
    const rows = page.getByTestId("audit-row");
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId("audit-log")).toContainText("dsr.created");
    await expect(page.getByTestId("audit-log")).toContainText("dsr.completed");
    await expect(page.getByTestId("audit-log")).not.toContainText("customer.deleted");

    await page.goto("/admin/system/audit?akce=customer");
    await expect(page.getByTestId("audit-log")).toContainText(companyName);
  });

  test("operator: all campaigns of every shop in one list", async ({ page }) => {
    test.setTimeout(90_000);
    await operator(page);
    await page.goto("/admin/campaigns");
    const row = page.getByTestId("campaign-row").filter({ hasText: `Kampaň ${run}` });
    await expect(row).toBeVisible();
    await expect(row.getByRole("link", { name: companyName })).toHaveAttribute("href", `/admin/companies/${companyId}`);
    // A second shop's campaign is in the same list, linked to its own shop.
    const { data: other } = await db.from("companies").select("id").eq("name", "Autoservis Dvořák s.r.o.").single();
    const { data: theirs } = await db
      .from("campaigns")
      .insert({ company_id: other!.id, name: `Cizí kampaň ${run}`, segment_rules_snapshot: { all: [] } })
      .select("id")
      .single();
    try {
      await page.reload();
      const otherRow = page.getByTestId("campaign-row").filter({ hasText: `Cizí kampaň ${run}` });
      await expect(otherRow.getByRole("link", { name: "Autoservis Dvořák s.r.o." })).toBeVisible();
      await expect(otherRow.getByRole("link", { name: `Cizí kampaň ${run}` })).toHaveAttribute(
        "href",
        `/admin/companies/${other!.id}/campaigns/${theirs!.id}`,
      );
    } finally {
      await db.from("campaigns").delete().eq("id", theirs!.id);
    }
  });

  test("owner: removes a user; the last owner stays", async ({ page }) => {
    test.setTimeout(90_000);
    await owner(page);
    await page.goto("/app/settings?tab=users");
    await page
      .getByTestId("member-row")
      .filter({ hasText: "Vedoucí Nastavení" })
      .getByRole("button", { name: "Odebrat" })
      .click();
    await confirmIn(page, "Odebrat");
    await expect(page.getByTestId("member-row")).toHaveCount(1);
    await expect(page.getByTestId("member-row").getByRole("button", { name: "Odebrat" })).toHaveCount(0);
    const removed = (await auditActions({ company: companyId, actor: ownerId })).find(
      (a) => a.action === "user.removed",
    );
    expect(removed?.metadata).toMatchObject({ target_user_id: managerId, role: "shop_manager" });
  });

  test("the new screens work at 390 px without sideways scrolling (spec UX rule)", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const fits = async (path: string) => {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width, path).toBeLessThanOrEqual(390);
    };
    await owner(page);
    for (const tab of ["", "?tab=users", "?tab=data", "?tab=history"]) await fits(`/app/settings${tab}`);
    await page.context().clearCookies();
    await operator(page);
    for (const path of ["privacy", "audit", "settings"]) await fits(`/admin/companies/${companyId}/${path}`);
    await fits("/admin/system/audit");
    await fits("/admin/campaigns");
  });

  test("health check: a stuck import and a request at day 20 raise alerts", async () => {
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    const { data: stuck } = await db
      .from("imports")
      .insert({ company_id: companyId, type: "customers", status: "validating", updated_at: minutesAgo(31) })
      .select("id")
      .single();
    const { data: request } = await db
      .from("data_subject_requests")
      .insert({
        company_id: companyId,
        type: "access",
        subject_reference: "00000000-0000-4000-8000-000000000018",
        created_at: minutesAgo(21 * 24 * 60),
      })
      .select("id")
      .single();
    await runHealthCheck(db, new Date());
    const { data: alerts } = await db
      .from("alerts")
      .select("dedupe_key, type, status")
      .eq("company_id", companyId)
      .neq("status", "resolved");
    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dedupe_key: `import_stuck:${stuck!.id}`, type: "import_stuck" }),
        expect.objectContaining({ dedupe_key: `dsr_due:${request!.id}`, type: "dsr_due" }),
      ]),
    );
    stuckImportId = stuck!.id;
  });

  test("operator: a stuck import explains itself and can be cancelled", async ({ page }) => {
    test.setTimeout(90_000);
    await operator(page);
    await page.goto(`/admin/companies/${companyId}/imports/${stuckImportId}`);
    await expect(page.getByTestId("import-working")).toBeVisible();
    await expect(page.getByText(/Zpracování se už 30 minut nepohnulo/)).toBeVisible();
    await page.getByRole("button", { name: "Zrušit import" }).click();
    await expect
      .poll(async () => (await db.from("imports").select("status").eq("id", stuckImportId).single()).data?.status)
      .toBe("cancelled");
  });
});
