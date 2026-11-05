import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/db/types.gen";
import { nextSendingSlot } from "../../lib/domain/messaging/sending-window";
import { runMessagingTick } from "../../lib/jobs/messaging-core";
import { createMockSmsProvider } from "../../lib/providers/sms/mock";
import type { MessagingProvider } from "../../lib/providers/sms/types";
import { env, run, service } from "./helpers";

/**
 * Spec §41 "Killing the dispatcher mid-send and re-running it produces zero
 * duplicate messages", on the seeded Autoservis Dvořák with the real tick:
 *
 * 1. a dispatcher dies after claiming a batch (rows left in 'sending');
 * 2. the next run crashes inside the provider call after a few sends;
 * 3. further runs finish the queue.
 *
 * Every idempotency key reaches the provider at most once; rows whose
 * outcome is unknown go to manual review instead of being resent.
 */

const name = `E2E pád dispečera ${run}`;
const db = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
let companyId = "";

/** A mock gateway that counts sends per key; call N+1 crashes (outcome unknown). */
function countingProvider(sends: Map<string, number>, crashAfter = Infinity): MessagingProvider {
  const inner = createMockSmsProvider({ latencyMs: 0 });
  let calls = 0;
  return {
    ...inner,
    async send(msg) {
      calls++;
      sends.set(msg.idempotencyKey, (sends.get(msg.idempotencyKey) ?? 0) + 1);
      if (calls === crashAfter + 1) throw new Error("simulated crash during the provider call");
      return inner.send(msg);
    },
  };
}

function tick(now: Date, provider: MessagingProvider) {
  return runMessagingTick({
    db,
    provider,
    now: () => now,
    ratePerSecond: 100,
    maxPerTick: 25,
    optOutBase: "example.cz/o",
    suppressionPepper: env.SUPPRESSION_PEPPER ?? "",
    whitelist: { realProvider: false, production: false, numbers: [] },
    sleep: async () => {},
  });
}

test.beforeAll(async () => {
  const { data } = await service.from("companies").select("id").eq("name", "Autoservis Dvořák s.r.o.").single();
  if (!data) throw new Error("Seed data missing: run `pnpm db:seed`.");
  companyId = data.id;
});

test.afterAll(async () => {
  await service.from("campaigns").delete().eq("name", name);
});

test("a dispatcher killed mid-send never causes a duplicate SMS", async () => {
  test.setTimeout(180_000);
  const at = nextSendingSlot(new Date(Date.now() + 7 * 86_400_000));
  const { data: campaign } = await service
    .from("campaigns")
    .insert({
      company_id: companyId,
      name,
      segment_preset: "no_visit_12m",
      segment_rules_snapshot: {
        all: [{ field: "vehicle.last_visit_at", op: "between_months_ago", value: [12, 18] }],
      },
      scheduled_at: new Date(at.getTime() - 60_000).toISOString(),
    })
    .select("id")
    .single();
  await service.from("campaign_steps").insert({
    company_id: companyId,
    campaign_id: campaign!.id,
    step_number: 0,
    delay_days: 0,
    body_template: "{{osloveni}} rádi vás zase uvidíme v {{servis}}. Volejte {{telefon}}. {{odhlaseni}}",
  });
  await service.from("campaigns").update({ status: "scheduled" }).eq("id", campaign!.id);

  const sends = new Map<string, number>();
  // Start: snapshot + queued messages, first batch of 25 sent.
  const first = await tick(at, countingProvider(sends));
  expect(first.started).toEqual([campaign!.id]);

  // 1. A dispatcher claims a batch and dies before calling the provider.
  const { data: orphaned } = await db.rpc("claim_messages", { p_limit: 10, p_now: at.toISOString() });
  expect(orphaned!.length).toBe(10);

  // 2. The next run crashes inside the provider after 3 calls.
  await tick(at, countingProvider(sends, 3));

  // 3. Later runs finish the queue; the orphans go to review after 10 minutes.
  for (let i = 1; i <= 30; i++) {
    const r = await tick(new Date(at.getTime() + i * 60_000), countingProvider(sends));
    if (r.sent === 0 && r.flagged === 0 && i > 11) break;
  }

  const { data: messages } = await service
    .from("messages")
    .select("idempotency_key, status, error_code")
    .eq("campaign_id", campaign!.id)
    .limit(5000);
  const duplicates = [...sends.entries()].filter(([, n]) => n > 1);
  expect(duplicates).toEqual([]);
  // The orphans were never sent; they and the crashed call wait for a human.
  const orphanKeys = new Set(orphaned!.map((m) => m.idempotency_key));
  for (const key of orphanKeys) expect(sends.has(key)).toBe(false);
  const review = messages!.filter((m) => m.status === "needs_review");
  expect(review.length).toBe(orphaned!.length + 1);
  expect(review.map((m) => m.error_code).sort()).toEqual(
    [...Array(orphaned!.length).fill("stuck_in_sending"), "provider_exception"].sort(),
  );
  // Everything else was handed over exactly once.
  const handedOver = messages!.filter((m) => ["sent", "delivered", "undelivered", "failed"].includes(m.status));
  expect(handedOver.length + review.length).toBe(messages!.length);
  for (const m of handedOver) expect(sends.get(m.idempotency_key)).toBe(1);
});
