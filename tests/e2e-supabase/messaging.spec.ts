import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/db/types.gen";
import { suppressionHash } from "../../lib/domain/messaging/opt-out";
import { nextSendingSlot } from "../../lib/domain/messaging/sending-window";
import { runMessagingTick } from "../../lib/jobs/messaging-core";
import { createMockSmsProvider } from "../../lib/providers/sms/mock";
import { PASSWORD, cleanup, createUser, email, env, freshTotp, run, service, signIn } from "./helpers";

/**
 * Slice 12 (spec §12, §16, §40.12) on the seeded Autoservis Dvořák: the
 * operator schedules a campaign, the messaging tick (driven here with an
 * injected clock and the mock SMS provider) snapshots recipients with a
 * holdout and sends; the owner pauses, follow-ups wait, the operator resumes;
 * the global kill switch stops everything; stuck messages go to review.
 * Requires `pnpm db:seed`.
 */

const adminEmail = email("messaging-admin");
const OWNER = "majitel@dvorak.example.cz";
const seedPassword = env.SEED_USER_PASSWORD ?? "";
const campaignName = `E2E odesílání ${run}`;
const users: string[] = [];
const usedSteps = new Set<number>();
let totpSecret = "";
let companyId = "";
let campaignId = "";
const startedAt = new Date().toISOString();
/** Seeded customers this run opts out; restored afterwards so other suites see the seed. */
const optedOut: string[] = [];
const extraCustomers: string[] = [];

const db = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function tick(now: Date) {
  return runMessagingTick({
    db,
    provider: createMockSmsProvider({ latencyMs: 0 }),
    now: () => now,
    ratePerSecond: 100,
    maxPerTick: 5000,
    optOutBase: "example.cz/o",
    suppressionPepper: env.SUPPRESSION_PEPPER ?? "",
    whitelist: { realProvider: false, production: false, numbers: [] },
    sleep: async () => {},
  });
}

async function operator(page: Page) {
  await signIn(page, adminEmail);
  await page.getByLabel("Ověřovací kód").fill(await freshTotp(totpSecret, usedSteps));
  await page.getByRole("button", { name: "Ověřit" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function messageCounts(step: number) {
  const { data } = await service
    .from("messages")
    .select("status")
    .eq("campaign_id", campaignId)
    .eq("step_number", step)
    .limit(5000);
  const counts: Record<string, number> = {};
  for (const m of data ?? []) counts[m.status] = (counts[m.status] ?? 0) + 1;
  return counts;
}

async function campaignStatus() {
  const { data } = await service.from("campaigns").select("status").eq("id", campaignId).single();
  return data!.status;
}

test.describe.serial("messaging: snapshot, dispatch, pause, follow-ups, kill switch", () => {
  test.beforeAll(async () => {
    const { data } = await service.from("companies").select("id").eq("name", "Autoservis Dvořák s.r.o.").single();
    if (!data) throw new Error("Seed data missing: run `pnpm db:seed`.");
    companyId = data.id;
    await service.from("platform_settings").update({ sending_paused: false }).eq("id", true);
    const adminId = await createUser(adminEmail, "Operátor Odesílání");
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
    await service
      .from("platform_settings")
      .update({ sending_paused: false, sending_paused_reason: null })
      .eq("id", true);
    // Deleting the campaign removes its enrollments and messages (and the contact history).
    await service.from("campaigns").delete().eq("name", campaignName);
    if (extraCustomers.length) await service.from("customers").delete().in("id", extraCustomers);
    await service.from("suppression_list").delete().eq("company_id", companyId).gte("created_at", startedAt);
    if (optedOut.length) {
      await service.from("customers").update({ lifecycle_status: "inactive" }).in("id", optedOut);
      await service.rpc("recompute_lifecycle", { p_company_id: companyId, p_customer_ids: optedOut });
    }
    await cleanup(users, []);
  });

  test("schedule, start with holdout, send, owner pauses, operator resumes, follow-ups, kill switch, review", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    await operator(page);

    // The operator builds and schedules a campaign with one follow-up after 3 days.
    await page.goto(`/admin/companies/${companyId}/campaigns/new?preset=no_visit_12m`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Pokračovat" }).click();
    await page.getByRole("button", { name: "Vygenerovat zprávu pomocí AI" }).click();
    await expect(page.getByLabel("Šablona zprávy")).not.toHaveValue("", { timeout: 15_000 });
    await page.getByRole("button", { name: "Přidat připomínku" }).click();
    await page.getByRole("button", { name: "Pokračovat" }).click();
    await page.getByLabel("Název kampaně").fill(campaignName);
    await page.getByRole("button", { name: "Pokračovat" }).click();
    await page.getByLabel(/Potvrzuji naplánování kampaně/).check();
    await page.getByRole("button", { name: "Naplánovat kampaň" }).click();
    await expect(page.getByText("Kampaň je naplánovaná.")).toBeVisible();
    await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);
    campaignId = /campaigns\/([0-9a-f-]{36})$/.exec(page.url())![1];
    const { data: scheduled } = await service
      .from("campaigns")
      .select("scheduled_at, approved_recipient_count")
      .eq("id", campaignId)
      .single();
    const sendAt = new Date(new Date(scheduled!.scheduled_at!).getTime() + 60_000);

    // Before the send time nothing happens.
    expect((await tick(new Date(sendAt.getTime() - 3_600_000))).started).toEqual([]);

    // At the send time: snapshot with a 10 % holdout, step-0 messages sent.
    const first = await tick(sendAt);
    expect(first.started).toEqual([campaignId]);
    expect(first.failed).toEqual([]);
    expect(await campaignStatus()).toBe("active");
    const { data: enrollments } = await service
      .from("campaign_enrollments")
      .select("id, is_holdout, first_sent_at, customer_id")
      .eq("campaign_id", campaignId)
      .limit(5000);
    const holdout = enrollments!.filter((e) => e.is_holdout);
    const contacted = enrollments!.filter((e) => !e.is_holdout);
    expect(Math.abs(enrollments!.length - scheduled!.approved_recipient_count!)).toBeLessThanOrEqual(
      scheduled!.approved_recipient_count! * 0.2,
    );
    expect(holdout.length).toBe(Math.round(enrollments!.length * 0.1));
    const step0 = await messageCounts(0);
    expect((step0.sent ?? 0) + (step0.failed ?? 0)).toBe(contacted.length);
    expect(step0.failed ?? 0).toBeLessThan(contacted.length * 0.06);
    // Holdout customers never get a message.
    const { count: holdoutMessages } = await service
      .from("messages")
      .select("id", { count: "exact", head: true })
      .in(
        "enrollment_id",
        holdout.map((h) => h.id),
      );
    expect(holdoutMessages).toBe(0);
    const { data: sample } = await service
      .from("messages")
      .select("body_rendered, opt_out_token, to_address, customer_id, idempotency_key")
      .eq("campaign_id", campaignId)
      .eq("status", "sent")
      .limit(1)
      .single();
    expect(sample!.body_rendered).toContain(`Odhlásit: example.cz/o/${sample!.opt_out_token}`);
    const { data: customer } = await service
      .from("customers")
      .select("phone_e164")
      .eq("id", sample!.customer_id!)
      .single();
    expect(sample!.to_address).toBe(customer!.phone_e164);

    // The same tick again changes nothing (idempotent).
    const again = await tick(sendAt);
    expect([again.started.length, again.sent, again.followups]).toEqual([0, 0, 0]);

    // The operator sees the progress.
    await page.goto(`/admin/companies/${companyId}/campaigns/${campaignId}`);
    await expect(page.getByTestId("delivery-contacted")).toHaveText(String(step0.sent));
    await expect(page.getByTestId("delivery-holdout")).toHaveText(String(holdout.length));

    // The owner pauses the campaign from the client app.
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signIn(ownerPage, OWNER, seedPassword);
    await expect(ownerPage).toHaveURL(/\/app$/);
    await ownerPage.goto(`/app/campaigns/${campaignId}`);
    await expect(ownerPage.getByTestId("delivery-panel")).toBeVisible();
    await ownerPage.getByRole("button", { name: "Pozastavit kampaň" }).click();
    await expect(ownerPage.getByText("Kampaň pozastavena. Další zprávy neodejdou.")).toBeVisible();
    expect(await campaignStatus()).toBe("paused");
    await ownerContext.close();

    // Follow-ups wait while paused.
    const followupAt = nextSendingSlot(new Date(sendAt.getTime() + 3 * 86_400_000 + 3_600_000));
    expect((await tick(followupAt)).followups).toBe(0);

    // The operator resumes; the follow-up goes to every still-eligible contacted customer.
    await page.reload();
    await page.getByRole("button", { name: "Pokračovat v odesílání" }).click();
    await expect(page.getByText("Odesílání pokračuje.")).toBeVisible();
    const resumed = await tick(followupAt);
    expect(resumed.followups).toBeGreaterThan(0);
    expect(resumed.followups).toBeLessThanOrEqual(step0.sent ?? 0);
    const step1 = await messageCounts(1);
    expect((step1.sent ?? 0) + (step1.failed ?? 0)).toBe(resumed.followups);
    expect((await tick(followupAt)).followups).toBe(0);

    // Global kill switch: nothing moves until it is switched back.
    await page.goto("/admin/system");
    await page.getByLabel("Důvod zastavení").fill("E2E test výpadku brány");
    await page.getByRole("button", { name: "Zastavit veškeré odesílání" }).click();
    await expect(page.getByTestId("kill-switch-state")).toHaveText("Odesílání zastaveno");
    expect((await tick(followupAt)).killSwitch).toBe(true);
    await page.getByRole("button", { name: "Obnovit odesílání" }).click();
    await expect(page.getByTestId("kill-switch-state")).toHaveText("Odesílání běží");

    // A message stuck in 'sending' goes to review and is resolved by hand, never resent.
    const { data: stuck } = await service
      .from("messages")
      .select("id")
      .eq("campaign_id", campaignId)
      .in("status", ["sent", "delivered"])
      .eq("step_number", 1)
      .limit(1)
      .single();
    await service
      .from("messages")
      .update({ status: "sending", sending_started_at: new Date(followupAt.getTime() - 20 * 60_000).toISOString() })
      .eq("id", stuck!.id);
    expect((await tick(followupAt)).flagged).toBe(1);
    await page.reload();
    const row = page.getByTestId("review-message").filter({ hasText: campaignName });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Neodešla" }).click();
    await expect(page.getByText("Výsledek uložen.")).toBeVisible();
    const { data: resolved } = await service.from("messages").select("status, error_code").eq("id", stuck!.id).single();
    expect(resolved).toEqual({ status: "failed", error_code: "manual_review_failed" });

    // Audit trail of the run.
    const { data: audits } = await service
      .from("audit_logs")
      .select("action, actor_type")
      .eq("entity_id", campaignId)
      .order("id");
    expect(audits!.map((a) => a.action)).toEqual(
      expect.arrayContaining(["campaign.send_started", "campaign.paused", "campaign.resumed"]),
    );
    expect(audits!.find((a) => a.action === "campaign.send_started")!.actor_type).toBe("system");
  });

  test("opt-out link, STOP reply, delivery reports, suppression of the number at send time", async ({
    browser,
    request,
  }) => {
    test.setTimeout(180_000);
    const pepper = env.SUPPRESSION_PEPPER ?? "";
    const secret = env.SMS_WEBHOOK_SECRET ?? "";
    const { data: msgs } = await service
      .from("messages")
      .select("id, opt_out_token, to_address, customer_id, enrollment_id, provider_message_id")
      .eq("campaign_id", campaignId)
      .eq("step_number", 0)
      .in("status", ["sent", "delivered"])
      .order("id")
      .limit(3);
    const [a, b, c] = msgs!;
    optedOut.push(a.customer_id!, b.customer_id!);
    const customer = async (id: string) =>
      (await service.from("customers").select("lifecycle_status, eligibility_reason").eq("id", id).single()).data!;

    // Opening the link changes nothing; the button opts the number out for this shop.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/o/${a.opt_out_token}`);
    await expect(page.getByText("Dvořák").first()).toBeVisible();
    expect((await customer(a.customer_id!)).lifecycle_status).not.toBe("opted_out");
    await page.getByRole("button", { name: "Odhlásit se" }).click();
    await expect(page.getByTestId("opt-out-done")).toBeVisible();
    expect(await customer(a.customer_id!)).toEqual({ lifecycle_status: "opted_out", eligibility_reason: "opted_out" });
    const { data: enrollment } = await service
      .from("campaign_enrollments")
      .select("stage, stopped_reason")
      .eq("id", a.enrollment_id!)
      .single();
    expect(enrollment).toEqual({ stage: "opted_out", stopped_reason: "opted_out" });
    const { data: entry } = await service
      .from("suppression_list")
      .select("reason")
      .eq("company_id", companyId)
      .eq("address_hash", suppressionHash(a.to_address, pepper))
      .single();
    expect(entry!.reason).toBe("opt_out_link");
    // Coming back shows the done state; an unknown token is a plain 404.
    await page.goto(`/o/${a.opt_out_token}`);
    await expect(page.getByTestId("opt-out-done")).toBeVisible();
    expect((await page.goto("/o/Zz9Zz9Zz"))!.status()).toBe(404);
    await context.close();

    // Gateway callbacks: wrong secret refused; a STOP reply and a negative DLR applied.
    expect((await request.post("/api/webhooks/sms/mock?secret=wrong", { data: { events: [] } })).status()).toBe(401);
    const callback = {
      events: [
        { type: "inbound", from: b.to_address.slice(1), text: "Odhlásit" },
        { type: "undelivered", messageId: c.provider_message_id },
      ],
    };
    const url = `/api/webhooks/sms/mock?secret=${secret}`;
    expect((await request.post(url, { data: callback })).status()).toBe(200);
    await expect.poll(async () => (await customer(b.customer_id!)).lifecycle_status).toBe("opted_out");
    const { data: keyword } = await service
      .from("suppression_list")
      .select("reason")
      .eq("company_id", companyId)
      .eq("address_hash", suppressionHash(b.to_address, pepper))
      .single();
    expect(keyword!.reason).toBe("keyword");
    // Once applied, the reply's number and text are not kept (ADR-017). Processing runs
    // after the response, so wait until the event is marked processed.
    const latestInbound = async () =>
      (
        await service
          .from("message_events")
          .select("payload, processed_at")
          .eq("provider_id", "mock")
          .eq("type", "inbound")
          .order("received_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data;
    await expect.poll(async () => (await latestInbound())?.processed_at ?? null).not.toBeNull();
    const inbound = await latestInbound();
    expect(JSON.stringify(inbound!.payload)).not.toContain(b.to_address.slice(1));
    expect(inbound!.payload).not.toHaveProperty("_text");
    await expect
      .poll(async () => (await service.from("messages").select("status").eq("id", c.id).single()).data!.status)
      .toBe("undelivered");
    // A retried callback is stored once.
    expect((await request.post(url, { data: callback })).status()).toBe(200);
    const { count } = await service
      .from("message_events")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", "mock")
      .eq("provider_event_id", `${c.provider_message_id}:undelivered`);
    expect(count).toBe(1);

    // The number stays suppressed for this shop even on a new customer record (e.g. a re-import).
    const { data: twin } = await service
      .from("customers")
      .insert({
        company_id: companyId,
        first_name: "Nový",
        last_name: "Záznam",
        phone_e164: a.to_address,
        phone_type: "mobile",
        legal_basis: "existing_customer",
        last_visit_at: "2026-01-15",
      })
      .select("id")
      .single();
    extraCustomers.push(twin!.id);
    const { data: queued } = await service
      .from("messages")
      .insert({
        company_id: companyId,
        customer_id: twin!.id,
        to_address: a.to_address,
        body_rendered: "Test {{servis}}",
        idempotency_key: `e2e-suppressed-${run}`,
        opt_out_token: `Sup${run.slice(-5).padStart(5, "x")}`.replace(/[^A-Za-z0-9]/g, "x").slice(0, 8),
      })
      .select("id")
      .single();
    await tick(nextSendingSlot(new Date(Date.now() + 60_000)));
    const { data: stopped } = await service.from("messages").select("status, error_code").eq("id", queued!.id).single();
    expect(stopped).toEqual({ status: "cancelled", error_code: "suppressed" });
  });
});
