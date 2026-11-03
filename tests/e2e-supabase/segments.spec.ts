import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { PASSWORD, cleanup, createUser, email, env, freshTotp, run, service, signIn } from "./helpers";

/**
 * Slice 9 (spec §12, §40.9) on the seeded world: preset counts on the
 * Segmenty tab match the database, and the operator builds, previews, saves
 * and archives a segment. Requires `pnpm db:seed`.
 */

const adminEmail = email("segments-admin");
const users: string[] = [];
const usedSteps = new Set<number>();
let totpSecret = "";
let dvorakId = "";
const nbsp = String.fromCharCode(0xa0);
/** Number as the UI prints it: Czech grouping with a no-break space. */
const czInt = (n: number) => n.toLocaleString("cs-CZ").replace(/\s/g, nbsp);
const segmentName = `E2E segment ${run}`;

test.describe.serial("segments", () => {
  test.beforeAll(async () => {
    const { data } = await service.from("companies").select("id").eq("name", "Autoservis Dvořák s.r.o.").single();
    if (!data) throw new Error("Seed data missing: run `pnpm db:seed`.");
    dvorakId = data.id;
    const adminId = await createUser(adminEmail, "Operátor Segmenty");
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
    await service.from("segments").delete().eq("company_id", dvorakId).eq("name", segmentName);
    await cleanup(users, []);
  });

  test("presets show live counts; a built segment is previewed, saved and archived", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, adminEmail);
    await page.getByLabel("Ověřovací kód").fill(await freshTotp(totpSecret, usedSteps));
    await page.getByRole("button", { name: "Ověřit" }).click();
    await expect(page).toHaveURL(/\/admin$/);

    await page.goto(`/admin/companies/${dvorakId}/segments`);
    await page.waitForLoadState("networkidle");
    const row = page.getByTestId("preset-no_visit_12m");
    await expect(row).toContainText("Bez návštěvy 12+ měsíců");

    // The page shows what the database computes for the same rules.
    const { data: counts } = await service.rpc("segment_preview", {
      p_company_id: dvorakId,
      p_rules: { all: [{ field: "vehicle.last_visit_at", op: "between_months_ago", value: [12, 18] }] },
      p_preset_key: "no_visit_12m",
    });
    const eligible = (counts as { eligible: number }).eligible;
    expect(eligible).toBeGreaterThan(50);
    await expect(row.getByTestId("eligible")).toHaveText(czInt(eligible));
    await expect(row).toContainText("Bez mobilního čísla");

    // Build the same rule by hand: same count.
    await page.getByLabel("Poslední návštěva před alespoň (měsíců)").fill("12");
    await page.getByLabel("…a méně než (měsíců)").fill("18");
    await page.getByRole("button", { name: "Spočítat" }).click();
    await expect(page.getByTestId("preview-eligible")).toHaveText(czInt(eligible));
    await expect(page.getByText("Ukázka zákazníků")).toBeVisible();

    await page.getByLabel("Název segmentu").fill(segmentName);
    await page.getByRole("button", { name: "Uložit segment" }).click();
    await expect(page.getByText("Segment uložen.")).toBeVisible();
    const saved = page.getByTestId("saved-segment").filter({ hasText: segmentName });
    await expect(saved).toBeVisible();
    const { data: stored } = await service.from("segments").select("rules").eq("name", segmentName).single();
    expect(stored!.rules).toEqual({
      all: [{ field: "vehicle.last_visit_at", op: "between_months_ago", value: [12, 18] }],
    });

    await saved.getByRole("button", { name: "Archivovat" }).click();
    await expect(page.getByTestId("saved-segment").filter({ hasText: segmentName })).toHaveCount(0);
  });

  test("invalid builder input is explained", async ({ page }) => {
    await signIn(page, adminEmail);
    await page.getByLabel("Ověřovací kód").fill(await freshTotp(totpSecret, usedSteps));
    await page.getByRole("button", { name: "Ověřit" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto(`/admin/companies/${dvorakId}/segments`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Spočítat" }).click();
    await expect(page.getByText("Zadejte aspoň jedno pravidlo.")).toBeVisible();
    await page.getByLabel("Poslední návštěva před alespoň (měsíců)").fill("18");
    await page.getByLabel("…a méně než (měsíců)").fill("12");
    await page.getByRole("button", { name: "Spočítat" }).click();
    await expect(page.getByText("Horní hranice musí být větší než dolní.")).toBeVisible();
  });
});
