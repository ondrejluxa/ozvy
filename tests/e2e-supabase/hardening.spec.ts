import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { PASSWORD, cleanup, createUser, email, env, freshTotp, run, service, signIn } from "./helpers";

/**
 * Slice 16 (spec §10, §22, §25, §41): security headers, the health probe,
 * the sign-in limit, and the operator's read-only support view with its
 * logged reason. Requires `pnpm db:seed`.
 */

const adminEmail = email("hardening-admin");
const users: string[] = [];
const usedSteps = new Set<number>();
let totpSecret = "";
let companyId = "";

async function operator(page: Page) {
  await signIn(page, adminEmail);
  await page.getByLabel("Ověřovací kód").fill(await freshTotp(totpSecret, usedSteps));
  await page.getByRole("button", { name: "Ověřit" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test.describe.serial("hardening", () => {
  test.beforeAll(async () => {
    const { data } = await service.from("companies").select("id").eq("name", "Autoservis Dvořák s.r.o.").single();
    if (!data) throw new Error("Seed data missing: run `pnpm db:seed`.");
    companyId = data.id;
    const adminId = await createUser(adminEmail, "Operátor Podpora");
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
    await cleanup(users, []);
  });

  test("security headers on every page; the opt-out page sends no referrer", async ({ request }) => {
    const res = await request.get("/login");
    const h = res.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"]).toContain("object-src 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["strict-transport-security"]).toContain("max-age=");
    expect(h["permissions-policy"]).toContain("camera=()");
    expect(h["x-powered-by"]).toBeUndefined();
    const optOut = await request.get("/o/Zz9Zz9Zz");
    expect(optOut.headers()["referrer-policy"]).toBe("no-referrer");
  });

  test("health probe answers with status words only", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", db: "ok" });
    expect(Object.keys(body).sort()).toEqual(["db", "dbMs", "status"]);
  });

  test("ten failed sign-ins lock the address for 15 minutes, even with the right password", async ({ page }) => {
    test.setTimeout(120_000);
    const victim = email("limit");
    users.push(await createUser(victim, "Zamčený Účet"));
    await page.goto("/login");
    for (let i = 0; i < 10; i++) {
      await page.getByLabel("E-mail").fill(victim);
      await page.getByLabel("Heslo", { exact: true }).fill(`spatne-heslo-${i}`);
      // Wait for each attempt to finish: the error text stays visible between attempts.
      await Promise.all([
        page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/login")),
        page.getByRole("button", { name: "Přihlásit se" }).click(),
      ]);
      await expect(page.getByText("Nesprávný e-mail nebo heslo.")).toBeVisible();
    }
    await page.getByLabel("E-mail").fill(victim);
    await page.getByLabel("Heslo", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Přihlásit se" }).click();
    await expect(page.getByText("Příliš mnoho pokusů. Zkuste to prosím za chvíli.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("support view: reason logged, banner, read-only, exit", async ({ page }) => {
    test.setTimeout(120_000);
    await operator(page);
    await page.goto(`/admin/companies/${companyId}`);
    await page.getByRole("button", { name: "Otevřít účet klienta" }).click();
    await page.getByLabel("Důvod").selectOption("troubleshooting");
    await page.getByLabel("Poznámka (nepovinné)").fill(`E2E kontrola ${run}`);
    await page.getByRole("button", { name: "Otevřít jen pro čtení" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByTestId("support-view-banner")).toContainText("Autoservis Dvořák s.r.o.");
    await expect(page.getByTestId("support-view-banner")).toContainText("pouze čtení");
    await expect(page.getByRole("heading", { name: "Autoservis Dvořák s.r.o." })).toBeVisible();

    // Read-only: no contact editing on a customer page.
    const { data: customer } = await service
      .from("customers")
      .select("id")
      .eq("company_id", companyId)
      .order("id")
      .limit(1)
      .single();
    await page.goto(`/app/customers/${customer!.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upravit kontakt" })).toHaveCount(0);

    const { data: started } = await service
      .from("audit_logs")
      .select("metadata")
      .eq("action", "admin.support_view_started")
      .eq("actor_user_id", users[0])
      .single();
    expect(started!.metadata).toMatchObject({ reason: "troubleshooting", note: `E2E kontrola ${run}` });

    await page.getByTestId("support-view-banner").getByRole("button", { name: "Ukončit" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/companies/${companyId}$`));
    const { count } = await service
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("action", "admin.support_view_ended")
      .eq("actor_user_id", users[0]);
    expect(count).toBe(1);
    // Without the support cookie the operator has no client view.
    await page.goto("/app");
    await expect(page).toHaveURL(/\/admin$/);
  });
});
