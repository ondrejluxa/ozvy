import { expect, test } from "@playwright/test";
import {
  PASSWORD,
  anon,
  cleanup,
  createCompany,
  createUser,
  email,
  freshTotp,
  latestEmailLink,
  run,
  service,
  signIn,
} from "./helpers";

/**
 * Slice 3 (spec §40.3, §20) on the local Supabase stack: invite-only access,
 * generic login errors, mandatory TOTP for the operator, invitations by
 * email, password reset, and company scoping for shop users.
 */

test.describe.serial("auth on real Supabase", () => {
  const users: string[] = [];
  const companies: string[] = [];
  const usedSteps = new Set<number>();
  let adminSecret = "";
  const adminEmail = email("admin");
  const managerEmail = email("manager");
  const invitedEmail = email("invited");
  const companyA = `Autoservis E2E A ${run}`;
  const companyB = `Autoservis E2E B ${run}`;
  let companyAId = "";

  test.beforeAll(async () => {
    companyAId = await createCompany(companyA);
    companies.push(companyAId, await createCompany(companyB));
    const adminId = await createUser(adminEmail, "Operátor E2E");
    users.push(adminId);
    await service.from("platform_admins").insert({ user_id: adminId });
    const managerId = await createUser(managerEmail, "Vedoucí E2E");
    users.push(managerId);
    await service.from("memberships").insert({ user_id: managerId, company_id: companyAId, role: "shop_manager" });
  });

  test.afterAll(async () => {
    const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
    const invited = data.users.find((u) => u.email === invitedEmail);
    if (invited) users.push(invited.id);
    await cleanup(users, companies);
  });

  test("protected areas require sign-in", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login\?next=%2Fapp/);
    await expect(page.getByRole("note")).toHaveCount(0); // no demo bar on real data
  });

  test("public sign-up is disabled (invite-only)", async () => {
    const { data, error } = await anon.auth.signUp({ email: email("signup"), password: PASSWORD });
    expect(data.user).toBeNull();
    expect(error?.code).toBe("signup_disabled");
  });

  test("wrong password gives a generic error and is audited", async ({ page }) => {
    const before = await service
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("action", "auth.login_failed");
    await signIn(page, adminEmail, "SpatneHeslo2026");
    await expect(page.locator("form [role=alert]")).toHaveText("Nesprávný e-mail nebo heslo.");
    await expect(page.getByLabel("E-mail")).toHaveValue(adminEmail); // input kept after failure
    await signIn(page, email("nobody"), PASSWORD);
    await expect(page.locator("form [role=alert]")).toHaveText("Nesprávný e-mail nebo heslo.");
    const after = await service
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("action", "auth.login_failed");
    expect((after.count ?? 0) - (before.count ?? 0)).toBe(2);
  });

  test("operator must enrol TOTP before reaching /admin", async ({ page }) => {
    await signIn(page, adminEmail);
    await expect(page).toHaveURL(/\/mfa/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/mfa/); // aal1 is not enough
    await page.getByRole("button", { name: "Zobrazit QR kód" }).click();
    adminSecret = (await page.getByTestId("totp-secret").textContent())!.trim();
    await page.getByLabel("Ověřovací kód").fill(await freshTotp(adminSecret, usedSteps));
    await page.getByRole("button", { name: "Ověřit" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByText(companyA)).toBeVisible();
    await expect(page.getByText(companyB)).toBeVisible();
    const { count } = await service
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("action", "auth.mfa_enrolled")
      .eq("actor_user_id", users[0]);
    expect(count).toBe(1);
  });

  test("operator signs in again with a TOTP code", async ({ page }) => {
    await signIn(page, adminEmail);
    await expect(page).toHaveURL(/\/mfa/);
    await page.getByLabel("Ověřovací kód").fill("000000");
    await page.getByRole("button", { name: "Ověřit" }).click();
    await expect(page.locator("form [role=alert]")).toContainText("Kód nesouhlasí");
    await page.getByLabel("Ověřovací kód").fill(await freshTotp(adminSecret, usedSteps));
    await page.getByRole("button", { name: "Ověřit" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    // Screens not yet on real data are clearly unavailable, never demo data.
    await page.goto("/admin/campaigns");
    await expect(page.getByRole("heading", { name: "Tato část se připravuje" })).toBeVisible();
  });

  test("shop manager sees only their own company and never /admin", async ({ page }) => {
    await signIn(page, managerEmail);
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { name: companyA })).toBeVisible();
    await expect(page.getByText("Vedoucí servisu")).toBeVisible();
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.getByText(companyB)).toHaveCount(0);
  });

  test("operator invites a new owner by email; the link works once", async ({ page, browser }) => {
    await signIn(page, adminEmail);
    await page.getByLabel("Ověřovací kód").fill(await freshTotp(adminSecret, usedSteps));
    await page.getByRole("button", { name: "Ověřit" }).click();
    await expect(page).toHaveURL(/\/admin$/);

    // The overview shows clients by health; inviting happens on the clients list.
    await page.goto("/admin/companies");
    const row = page.locator("tr", { hasText: companyA });
    await row.getByRole("button", { name: "Pozvat uživatele" }).click();
    await page.getByRole("dialog").getByLabel("E-mail").fill(invitedEmail);
    await page.getByRole("dialog").getByLabel("Role").selectOption("shop_owner");
    await page.getByRole("dialog").getByRole("button", { name: "Poslat pozvánku" }).click();
    await expect(page.getByText("Pozvánka odeslána.")).toBeVisible();

    const link = await latestEmailLink(invitedEmail, /http:\/\/localhost:3200\/accept-invite\?token=[A-Za-z0-9_-]{43}/);
    const { data: stored } = await service.from("invitations").select("token_hash").eq("email", invitedEmail).single();
    expect(link).not.toContain(stored!.token_hash); // only the hash is stored

    const guest = await browser.newContext();
    const invitee = await guest.newPage();
    await invitee.goto(link);
    await expect(invitee.getByText(`Byli jste pozváni do účtu ${companyA} jako majitel.`)).toBeVisible();
    await invitee.getByLabel("Jméno a příjmení").fill("Pavel Pozvaný");
    await invitee.getByLabel("Heslo", { exact: true }).fill("kratke1");
    await invitee.getByLabel("Heslo znovu").fill("kratke1");
    await invitee.getByRole("button", { name: "Vytvořit účet a vstoupit" }).click();
    await expect(invitee.locator("form [role=alert]")).toContainText("alespoň 12 znaků");
    await invitee.getByLabel("Heslo", { exact: true }).fill(PASSWORD);
    await invitee.getByLabel("Heslo znovu").fill(PASSWORD);
    await invitee.getByRole("button", { name: "Vytvořit účet a vstoupit" }).click();
    await expect(invitee).toHaveURL(/\/app$/);
    await expect(invitee.getByRole("heading", { name: companyA })).toBeVisible();
    await expect(invitee.getByText("Majitel")).toBeVisible();
    await guest.close();

    const reuse = await browser.newContext();
    const again = await reuse.newPage();
    await again.goto(link);
    await expect(again.getByText("Pozvánka už byla použita. Přihlaste se.")).toBeVisible();
    await reuse.close();
  });

  test("password reset by email", async ({ page }) => {
    await page.goto("/reset-password");
    await page.getByLabel("E-mail").fill(managerEmail);
    await page.getByRole("button", { name: "Poslat odkaz" }).click();
    await expect(page.getByRole("status")).toContainText("Pokud u nás účet s tímto e-mailem existuje");

    const link = await latestEmailLink(managerEmail, /http:\/\/localhost:3200\/auth\/confirm\?[^"\s<]+/);
    await page.goto(link);
    await expect(page).toHaveURL(/\/update-password$/);
    const newPassword = "NoveHesloE2E2026";
    await page.getByLabel("Nové heslo", { exact: true }).fill(newPassword);
    await page.getByLabel("Nové heslo znovu").fill(newPassword);
    await page.getByRole("button", { name: "Uložit heslo" }).click();
    await expect(page).toHaveURL(/\/app$/);

    await page.getByRole("button", { name: "Odhlásit se" }).first().click();
    await expect(page).toHaveURL(/\/login$/);
    await signIn(page, managerEmail, newPassword);
    await expect(page).toHaveURL(/\/app$/);
  });
});
