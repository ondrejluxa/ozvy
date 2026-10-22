import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { env, service, signIn } from "./helpers";

/**
 * Slice 6 (spec §40.6) on the seeded world: search, filters, customer
 * detail, contact editing with audit, and spec §38 critical scenario 5 (a
 * manager of company A requesting a customer of company B gets 404, and the
 * database returns zero rows). Requires `pnpm db:seed`.
 */

const MANAGER = "vedouci@horak.example.cz";
const password = env.SEED_USER_PASSWORD ?? "";
let horakId = "";
let dvorakId = "";
let edited: {
  id: string;
  first_name: string | null;
  phone_e164: string | null;
  phone_type: string;
  notes: string | null;
};

test.describe.serial("customers on real data", () => {
  test.beforeAll(async () => {
    const { data } = await service
      .from("companies")
      .select("id, name")
      .in("name", ["Pneu & Servis Horák", "Autoservis Dvořák s.r.o."]);
    if (data?.length !== 2) throw new Error("Seed data missing: run `pnpm db:seed`.");
    horakId = data.find((c) => c.name.startsWith("Pneu"))!.id;
    dvorakId = data.find((c) => c.name.startsWith("Autoservis"))!.id;
  });

  test.afterAll(async () => {
    // Put the edited seed customer back as it was.
    if (edited) {
      const { id, ...original } = edited;
      await service.from("customers").update(original).eq("id", id);
    }
  });

  test("manager searches and filters the customer list", async ({ page }) => {
    await signIn(page, MANAGER, password);
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/app/customers");
    await expect(page.getByTestId("customer-total")).toContainText(/3\s200 zákazníků/);

    await page.getByLabel("Hledat jméno, telefon nebo SPZ").fill("dvorak");
    await page.getByRole("button", { name: "Filtrovat" }).click();
    await expect(page).toHaveURL(/q=dvorak/);
    const names = await page.locator("tbody tr td:first-child").allTextContents();
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => /Dvořák/.test(n))).toBe(true);

    // Plate search: take a real plate from the seed and search without the space.
    const { data: vehicle } = await service
      .from("vehicles")
      .select("license_plate_display, license_plate_norm")
      .eq("company_id", horakId)
      .limit(1)
      .single();
    await page.goto(`/app/customers?q=${vehicle!.license_plate_norm}`);
    await expect(page.locator("tbody")).toContainText(vehicle!.license_plate_display!);

    // Filters combine; eligible + ineligible = all customers.
    const total = async (query: string) => {
      await page.goto(`/app/customers?${query}`);
      const text = (await page.getByTestId("customer-total").textContent()) ?? "";
      return Number(text.replace(/\D/g, ""));
    };
    const eligible = await total("eligibility=eligible");
    const ineligible = await total("eligibility=ineligible");
    expect(eligible + ineligible).toBe(3_200);
    expect(await total("status=at_risk&category=tyre_change")).toBeGreaterThan(0);
    await page.goto("/app/customers?q=zzzzqqq");
    await expect(page.getByText("Žádný zákazník neodpovídá filtrům.")).toBeVisible();
  });

  test("manager opens a customer and edits the contact", async ({ page }) => {
    const { data: customer } = await service
      .from("customers")
      .select("id, first_name, last_name, phone_e164, phone_type, notes")
      .eq("company_id", horakId)
      .not("phone_e164", "is", null)
      .order("last_name")
      .limit(1)
      .single();
    edited = {
      id: customer!.id,
      first_name: customer!.first_name,
      phone_e164: customer!.phone_e164,
      phone_type: customer!.phone_type,
      notes: customer!.notes,
    };

    await signIn(page, MANAGER, password);
    await expect(page).toHaveURL(/\/app$/);
    await page.goto(`/app/customers/${customer!.id}`);
    await expect(page.getByRole("heading", { name: new RegExp(customer!.last_name!) })).toBeVisible();
    await expect(page.getByText("Vozidla a návštěvy")).toBeVisible();
    await expect(page.getByTestId("customer-eligibility")).toBeVisible();

    await page.getByRole("button", { name: "Upravit kontakt" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Telefon").fill("12");
    await dialog.getByRole("button", { name: "Uložit" }).click();
    await expect(dialog.getByText("Zadejte české telefonní číslo.")).toBeVisible();
    await dialog.getByLabel("Telefon").fill("+420 777 000 123");
    await dialog.getByLabel("Poznámka").fill("Volat po 16:00");
    await dialog.getByRole("button", { name: "Uložit" }).click();
    await expect(page.getByText("Kontakt uložen.")).toBeVisible();
    await expect(page.getByTestId("customer-phone")).toContainText("+420 777 000 123");

    const { data: after } = await service
      .from("customers")
      .select("phone_e164, phone_type, notes")
      .eq("id", customer!.id)
      .single();
    expect(after).toEqual({ phone_e164: "+420777000123", phone_type: "mobile", notes: "Volat po 16:00" });
    const { data: audit } = await service
      .from("audit_logs")
      .select("metadata")
      .eq("action", "customer.updated")
      .eq("entity_id", customer!.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(String((audit!.metadata as { fields: string }).fields)).toContain("phone_e164");
    expect(JSON.stringify(audit!.metadata)).not.toContain("777");
  });

  test("critical scenario 5: another company's customer is a 404 and zero rows", async ({ page }) => {
    const { data: foreign } = await service.from("customers").select("id").eq("company_id", dvorakId).limit(1).single();

    await signIn(page, MANAGER, password);
    await expect(page).toHaveURL(/\/app$/);
    const response = await page.goto(`/app/customers/${foreign!.id}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Stránka nebyla nalezena" })).toBeVisible();

    const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    await client.auth.signInWithPassword({ email: MANAGER, password });
    const direct = await client.from("customers").select("id").eq("id", foreign!.id);
    expect(direct.data).toEqual([]);
    const listed = await client.rpc("list_customers", { p_company_id: dvorakId, p_today: "2026-10-23" });
    expect(listed.data).toEqual([]);
    const write = await client.from("customers").update({ notes: "x" }).eq("id", foreign!.id).select("id");
    expect(write.data ?? []).toEqual([]);
  });
});
