import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { env, freshTotp, service, signIn } from "./helpers";

/**
 * Slice 4 demo target (spec §42 "First session") on the seeded world:
 * the seeded operator sees the companies, opens one and sees its customers;
 * a seeded shop manager sees only their own company's customers.
 * Requires `pnpm db:seed`. Resets the seeded operator's MFA factor before
 * and after, so the account stays in its seeded state.
 */

const OPERATOR = "operator@navrat.example.cz";
const HORAK_MANAGER = "vedouci@horak.example.cz";
const NADRAZI_OWNER = "majitel@nadrazi.example.cz";
const password = env.SEED_USER_PASSWORD ?? "";
const usedSteps = new Set<number>();
const ids: Record<"dvorak" | "horak" | "nadrazi", string> = { dvorak: "", horak: "", nadrazi: "" };

async function resetOperatorMfa() {
  const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
  const user = data.users.find((u) => u.email === OPERATOR);
  if (!user) throw new Error("Seeded operator missing: run `pnpm db:seed`.");
  const { data: factors } = await service.auth.admin.mfa.listFactors({ userId: user.id });
  for (const f of factors?.factors ?? []) await service.auth.admin.mfa.deleteFactor({ id: f.id, userId: user.id });
}

test.describe.serial("seeded world", () => {
  test.beforeAll(async () => {
    expect(password, "SEED_USER_PASSWORD missing: run `pnpm env:local`").not.toBe("");
    const { data } = await service
      .from("companies")
      .select("id, name")
      .in("name", ["Autoservis Dvořák s.r.o.", "Pneu & Servis Horák", "Garáž U Nádraží"]);
    if (data?.length !== 3) throw new Error("Seed data missing: run `pnpm db:seed`.");
    for (const c of data) {
      if (c.name.startsWith("Autoservis")) ids.dvorak = c.id;
      else if (c.name.startsWith("Pneu")) ids.horak = c.id;
      else ids.nadrazi = c.id;
    }
    await resetOperatorMfa();
  });

  test.afterAll(resetOperatorMfa);

  test("seeded operator sees the companies, opens one and sees its customers", async ({ page }) => {
    await signIn(page, OPERATOR, password);
    await expect(page).toHaveURL(/\/mfa/);
    await page.getByRole("button", { name: "Zobrazit QR kód" }).click();
    const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
    await page.getByLabel("Ověřovací kód").fill(await freshTotp(secret, usedSteps));
    await page.getByRole("button", { name: "Ověřit" }).click();
    await expect(page).toHaveURL(/\/admin$/);

    await page.goto("/admin/companies");
    const dvorakRow = page.getByRole("row", { name: /Autoservis Dvořák/ });
    await expect(dvorakRow).toContainText(/1\s800/);
    await expect(page.getByRole("row", { name: /Pneu & Servis Horák/ })).toContainText(/3\s200/);
    await expect(page.getByRole("row", { name: /Garáž U Nádraží/ })).toContainText("600");

    await dvorakRow.getByRole("link", { name: "Autoservis Dvořák s.r.o." }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/companies/${ids.dvorak}$`));
    await expect(page.getByRole("heading", { name: "Autoservis Dvořák s.r.o." })).toBeVisible();
    await expect(page.getByText(/1\s800 zákazníků/)).toBeVisible();
    await expect(page.getByText(/2\s300 vozidel/)).toBeVisible();
    await expect(page.getByText("Profil servisu")).toBeVisible();

    await page.getByRole("link", { name: "Zákazníci" }).last().click();
    await expect(page).toHaveURL(/\/customers$/);
    await expect(page.getByTestId("customer-total")).toContainText(/1\s800 zákazníků/);
    await expect(page.locator("tbody tr")).toHaveCount(50);
    await expect(page.getByText("Strana 1 z 36")).toBeVisible();
    await page.getByRole("link", { name: "Další" }).click();
    await expect(page).toHaveURL(/\?page=2$/);
    await expect(page.getByText("Strana 2 z 36")).toBeVisible();

    // The operator opens a customer of this company.
    await page.locator("tbody tr td a").first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/companies/${ids.dvorak}/customers/[0-9a-f-]{36}$`));
    await expect(page.getByText("Vozidla a návštěvy")).toBeVisible();
    await expect(page.getByRole("button", { name: "Upravit kontakt" })).toBeVisible();

    // Unknown or malformed company IDs are a plain 404.
    await page.goto("/admin/companies/00000000-0000-4000-8000-000000000000");
    await expect(page.getByRole("heading", { name: "Stránka nebyla nalezena" })).toBeVisible();
  });

  test("seeded shop manager sees only their own company's customers", async ({ page }) => {
    await signIn(page, HORAK_MANAGER, password);
    await expect(page).toHaveURL(/\/app$/);
    await page.getByRole("link", { name: "Zákazníci" }).first().click();
    await expect(page).toHaveURL(/\/app\/customers$/);
    await expect(page.getByTestId("customer-total")).toContainText(/3\s200 zákazníků/);

    await page.goto("/admin/companies");
    await expect(page).toHaveURL(/\/forbidden$/);
    await page.goto(`/admin/companies/${ids.dvorak}/customers`);
    await expect(page).toHaveURL(/\/forbidden$/);

    // The database agrees: the manager's own session reads Horák rows only.
    const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    await client.auth.signInWithPassword({ email: HORAK_MANAGER, password });
    const own = await client.from("customers").select("id", { count: "exact", head: true });
    expect(own.count).toBe(3_200);
    const foreign = await client.from("customers").select("id").neq("company_id", ids.horak).limit(5);
    expect(foreign.data).toEqual([]);
    const { data: dvorakCustomer } = await service
      .from("customers")
      .select("id")
      .eq("company_id", ids.dvorak)
      .limit(1)
      .single();
    const direct = await client.from("customers").select("id").eq("id", dvorakCustomer!.id);
    expect(direct.data).toEqual([]);
    const companies = await client.from("companies").select("id");
    expect(companies.data).toEqual([{ id: ids.horak }]);
  });

  test("seeded owner of the sparse shop sees its 600 customers", async ({ page }) => {
    await signIn(page, NADRAZI_OWNER, password);
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/app/customers");
    await expect(page.getByTestId("customer-total")).toContainText("600 zákazníků");
    await expect(page.getByText("Bez vozidla").first()).toBeVisible();
  });
});
