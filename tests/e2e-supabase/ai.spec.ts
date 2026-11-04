import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { PASSWORD, cleanup, createUser, email, env, freshTotp, run, service, signIn } from "./helpers";

/**
 * Slice 11 (spec §15, §40.11) on the seeded Autoservis Dvořák with the mock
 * AI provider: every generation is logged with the chosen variant and linked
 * to the campaign; vocatives come from rules + an AI batch and are reviewed
 * by the operator; personalised greetings are off until the shop turns them on.
 * Requires `pnpm db:seed`.
 */

const adminEmail = email("ai-admin");
const campaignName = `E2E AI kampaň ${run}`;
const TEMP_SURNAME = "Klaus";
const users: string[] = [];
const usedSteps = new Set<number>();
let totpSecret = "";
let companyId = "";
let tempCustomerId = "";

async function operator(page: Page) {
  await signIn(page, adminEmail);
  await page.getByLabel("Ověřovací kód").fill(await freshTotp(totpSecret, usedSteps));
  await page.getByRole("button", { name: "Ověřit" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function generations(kind: string) {
  const { data } = await service
    .from("ai_generations")
    .select("id, kind, model, prompt_version, input, output, chosen_index, campaign_id, tokens_in, tokens_out")
    .eq("company_id", companyId)
    .eq("created_by", users[0])
    .eq("kind", kind)
    .order("created_at");
  return data ?? [];
}

async function setGreeting(enabled: boolean) {
  const { data } = await service.from("companies").select("settings").eq("id", companyId).single();
  const settings = { ...(data!.settings as Record<string, unknown>), personalized_greeting: enabled };
  await service.from("companies").update({ settings }).eq("id", companyId);
}

test.describe.serial("AI templates and vocatives", () => {
  test.beforeAll(async () => {
    const { data } = await service.from("companies").select("id").eq("name", "Autoservis Dvořák s.r.o.").single();
    if (!data) throw new Error("Seed data missing: run `pnpm db:seed`.");
    companyId = data.id;
    await service.from("name_vocatives").delete().eq("company_id", companyId);
    await setGreeting(false);
    // A surname no rule covers, so the AI batch runs (surnames only).
    const { data: customer } = await service
      .from("customers")
      .insert({ company_id: companyId, first_name: "Testovací", last_name: TEMP_SURNAME })
      .select("id")
      .single();
    tempCustomerId = customer!.id;

    const adminId = await createUser(adminEmail, "Operátor AI");
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
    await setGreeting(false);
    await service.from("campaigns").delete().eq("name", campaignName);
    await service.from("ai_generations").delete().eq("company_id", companyId).in("created_by", users);
    await service.from("name_vocatives").delete().eq("company_id", companyId);
    if (tempCustomerId) await service.from("customers").delete().eq("id", tempCustomerId);
    await cleanup(users, []);
  });

  test("generations are validated, logged with the chosen variant and linked to the campaign", async ({ page }) => {
    test.setTimeout(180_000);
    await operator(page);
    await page.goto(`/admin/companies/${companyId}/campaigns/new?preset=no_visit_12m`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Pokračovat" }).click();
    await page.getByRole("button", { name: "Vygenerovat zprávu pomocí AI" }).click();
    const template = page.getByLabel("Šablona zprávy");
    await expect(template).not.toHaveValue("", { timeout: 15_000 });

    await expect.poll(async () => (await generations("campaign_template")).length).toBe(1);
    const [generated] = await generations("campaign_template");
    expect(generated).toMatchObject({
      model: "mock-czech-sms",
      prompt_version: "campaign-template.v1",
      chosen_index: 0,
      campaign_id: null,
      input: { presetKey: "no_visit_12m", companyName: "Autoservis Dvořák s.r.o.", offer: null },
    });
    expect((generated.output as { variants: string[] }).variants).toHaveLength(3);
    expect(generated.tokens_in).toBeGreaterThan(0);
    // Company-level context only (spec §15).
    expect(Object.keys(generated.input as object).sort()).toEqual(["city", "companyName", "offer", "presetKey"]);

    // Picking another variant is recorded.
    await page.getByRole("button", { name: "Přátelský" }).click();
    await expect(template).toHaveValue((generated.output as { variants: string[] }).variants[1]);
    await expect.poll(async () => (await generations("campaign_template"))[0].chosen_index).toBe(1);

    // A rewrite is its own logged generation.
    await page.getByRole("button", { name: "Kratší" }).click();
    await expect.poll(async () => (await generations("campaign_rewrite")).length).toBe(1);
    const [rewrite] = await generations("campaign_rewrite");
    expect(rewrite).toMatchObject({ chosen_index: 0, input: { action: "shorter" } });
    await expect(template).toHaveValue((rewrite.output as { variants: string[] }).variants[0]);

    // Saving the draft links both generations to the campaign.
    await page.getByRole("button", { name: "Pokračovat" }).click();
    await page.getByLabel("Název kampaně").fill(campaignName);
    await page.getByRole("button", { name: "Pokračovat" }).click();
    await page.getByRole("button", { name: "Uložit jako koncept" }).click();
    await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);
    const campaignId = /campaigns\/([0-9a-f-]{36})$/.exec(page.url())![1];
    const linked = [...(await generations("campaign_template")), ...(await generations("campaign_rewrite"))];
    expect(linked.map((g) => g.campaign_id)).toEqual([campaignId, campaignId]);
  });

  test("vocatives: rules + AI batch, operator review, greeting only when turned on", async ({ page }) => {
    test.setTimeout(240_000);
    await operator(page);
    await page.goto(`/admin/companies/${companyId}/vocatives`);
    await expect(page.getByTestId("vocatives-total")).toHaveText("0");
    await expect(page.getByTestId("greeting-setting")).toContainText("vypnuté");
    const missing = Number((await page.getByTestId("vocatives-missing").textContent())!.replace(/\D/g, ""));
    expect(missing).toBeGreaterThan(10);

    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Navrhnout oslovení" }).click();
    await expect(page.getByText("Návrhy se připravují.")).toBeVisible();
    await expect
      .poll(
        async () => {
          await page.reload();
          return page.getByTestId("vocatives-missing").textContent();
        },
        { timeout: 60_000, intervals: [2_000] },
      )
      .toBe("0");
    const { count } = await service
      .from("name_vocatives")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId);
    expect(count).toBe(missing);

    // Rules covered the Czech surnames; only the temp surname went to the (mock) AI.
    const { data: rule } = await service
      .from("name_vocatives")
      .select("surname, vocative, gender, source")
      .eq("company_id", companyId)
      .eq("source", "rule")
      .limit(500);
    expect(rule!.length).toBeGreaterThan(10);
    const [batch] = await generations("vocatives");
    expect(batch).toMatchObject({ prompt_version: "vocatives.v1", input: { surnames: [TEMP_SURNAME] } });

    // The AI suggestion waits for review; the operator approves it.
    const row = page.getByTestId("vocative-review-row").filter({ hasText: TEMP_SURNAME });
    await expect(row).toBeVisible();
    await expect(row.getByLabel(`Oslovení pro ${TEMP_SURNAME}`)).toHaveValue("Klausi");
    await expect(row).toContainText("Dobrý den, pane Klausi,");
    await row.getByRole("button", { name: "Schválit" }).click();
    await expect(page.getByText(`Oslovení pro ${TEMP_SURNAME} schváleno.`)).toBeVisible();
    await expect(page.getByTestId("vocative-reviewed-row").filter({ hasText: TEMP_SURNAME })).toContainText(
      "Dobrý den, pane Klausi,",
    );
    const { data: reviewed } = await service
      .from("name_vocatives")
      .select("reviewed_by, reviewed_at, source")
      .eq("company_id", companyId)
      .eq("surname", TEMP_SURNAME)
      .single();
    expect(reviewed).toMatchObject({ reviewed_by: users[0], source: "ai" });

    // Off by default: previews greet with "Dobrý den,".
    const builder = async () => {
      await page.goto(`/admin/companies/${companyId}/campaigns/new?preset=no_visit_12m`);
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Pokračovat" }).click();
      await page.getByRole("button", { name: "Vygenerovat zprávu pomocí AI" }).click();
      await expect(page.getByLabel("Šablona zprávy")).not.toHaveValue("", { timeout: 15_000 });
      const texts: string[] = [];
      for (let i = 0; i < 5; i++) {
        texts.push((await page.getByTestId("sms-text").textContent()) ?? "");
        await page.getByRole("button", { name: "→" }).click();
      }
      return texts;
    };
    expect((await builder()).every((t) => /^Dobrý den, (?!pan)/.test(t))).toBe(true);

    // The operator turns greetings on in the shop settings.
    await page.goto(`/admin/companies/${companyId}/settings`);
    await page.getByLabel("Oslovovat zákazníky příjmením").check();
    await page.getByRole("button", { name: "Uložit změny" }).last().click();
    await expect(page.getByText("Uloženo.").first()).toBeVisible();
    const { data: company } = await service.from("companies").select("settings").eq("id", companyId).single();
    expect(company!.settings).toMatchObject({ personalized_greeting: true });

    const texts = await builder();
    expect(texts.some((t) => /^Dobrý den, pan(e|í) \p{Lu}/u.test(t))).toBe(true);
  });
});
