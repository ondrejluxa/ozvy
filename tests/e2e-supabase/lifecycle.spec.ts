import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { PASSWORD, cleanup, createUser, email, env, freshTotp, run, service, signIn } from "./helpers";

/**
 * Slice 8 (spec §12, §40.8): service category mapping, "Přepočítat teď",
 * and a threshold change that recomputes statuses right away.
 */

const adminEmail = email("lifecycle-admin");
const users: string[] = [];
const usedSteps = new Set<number>();
let totpSecret = "";
let companyId = "";
let recentCustomer = "";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

test.describe.serial("lifecycle and service categories", () => {
  test.beforeAll(async () => {
    const adminId = await createUser(adminEmail, "Operátor Stavy");
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

    const { data: company } = await service
      .from("companies")
      .insert({ name: `Autoservis E2E Stavy ${run}`, status: "active", dpa_signed_at: new Date().toISOString() })
      .select("id")
      .single();
    companyId = company!.id;
    const { data: customers } = await service
      .from("customers")
      .insert([
        {
          company_id: companyId,
          last_name: "Nedávný",
          phone_e164: "+420777100001",
          phone_type: "mobile",
          legal_basis: "consent",
        },
        {
          company_id: companyId,
          last_name: "Dávný",
          phone_e164: "+420777100002",
          phone_type: "mobile",
          legal_basis: "consent",
        },
      ])
      .select("id, last_name");
    recentCustomer = customers!.find((c) => c.last_name === "Nedávný")!.id;
    const old = customers!.find((c) => c.last_name === "Dávný")!.id;
    await service.from("visits").insert([
      {
        company_id: companyId,
        customer_id: recentCustomer,
        visited_at: daysAgo(150),
        service_type_raw: "Geometrie",
        service_category: "repair_other",
      },
      {
        company_id: companyId,
        customer_id: old,
        visited_at: daysAgo(400),
        service_type_raw: "GEOMETRIE",
        service_category: "repair_other",
      },
      {
        company_id: companyId,
        customer_id: old,
        visited_at: daysAgo(500),
        service_type_raw: "Přezutí kol",
        service_category: "tyre_change",
      },
    ]);
  });

  test.afterAll(async () => {
    await cleanup(users, [companyId]);
  });

  test.beforeEach(async ({ page }) => {
    await signIn(page, adminEmail);
    await expect(page).toHaveURL(/\/mfa/);
    await page.getByLabel("Ověřovací kód").fill(await freshTotp(totpSecret, usedSteps));
    await page.getByRole("button", { name: "Ověřit" }).click();
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("operator re-categorises a work description and recomputes statuses", async ({ page }) => {
    await page.goto(`/admin/companies/${companyId}/services`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("lifecycle-computed")).toHaveText("Zatím nepřepočítáno.");
    const geometrie = page.getByTestId("service-label").filter({ hasText: "GEOMETRIE" });
    await expect(geometrie).toContainText("2");
    await expect(geometrie).toContainText("Automaticky");

    await page.getByLabel("Kategorie pro GEOMETRIE").selectOption("tyre_change");
    await expect(page.getByText(/kategorie uložena, přeřazeno 2 návštěvy/)).toBeVisible();
    const { data: visits } = await service
      .from("visits")
      .select("service_category")
      .eq("company_id", companyId)
      .eq("service_label_norm", "geometrie");
    expect(visits!.map((v) => v.service_category)).toEqual(["tyre_change", "tyre_change"]);
    const { data: mapping } = await service
      .from("service_category_mappings")
      .select("category")
      .eq("company_id", companyId)
      .eq("raw_value_norm", "geometrie")
      .single();
    expect(mapping!.category).toBe("tyre_change");
    await page.reload();
    await expect(page.getByTestId("service-label").filter({ hasText: "GEOMETRIE" })).toContainText("Uloženo");

    await page.getByRole("button", { name: "Přepočítat teď" }).click();
    await expect(page.getByText("Přepočet spuštěn.")).toBeVisible();
    await expect(async () => {
      await page.reload();
      await expect(page.getByTestId("lifecycle-computed")).toContainText("Naposledy přepočítáno", { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    const { data: recent } = await service
      .from("customers")
      .select("lifecycle_status, visit_count, eligibility_reason")
      .eq("id", recentCustomer)
      .single();
    expect(recent).toEqual({ lifecycle_status: "active", visit_count: 1, eligibility_reason: null });
  });

  test("stricter thresholds in settings recompute statuses right away", async ({ page }) => {
    await page.goto(`/admin/companies/${companyId}/settings`);
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Aktivní do (měsíců)").fill("3");
    await page.getByLabel("Ohrožený do (měsíců)").fill("4");
    await page.getByRole("button", { name: "Uložit změny" }).last().click();
    await expect(page.getByText("Uloženo.").first()).toBeVisible();
    // A visit ~5 months ago is beyond both new thresholds.
    await expect(async () => {
      const { data } = await service.from("customers").select("lifecycle_status").eq("id", recentCustomer).single();
      expect(data!.lifecycle_status).toBe("inactive");
    }).toPass({ timeout: 30_000 });
  });
});
