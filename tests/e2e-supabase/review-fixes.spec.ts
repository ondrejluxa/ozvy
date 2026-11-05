import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/db/types.gen";
import { pragueParts, pragueTime, toDateOnly } from "../../lib/domain/dates";
import { isWithinSendingWindow } from "../../lib/domain/messaging/sending-window";
import { runHealthCheck } from "../../lib/jobs/alerts-core";
import { runMessagingTick, type MessagingDeps } from "../../lib/jobs/messaging-core";
import { createMockSmsProvider } from "../../lib/providers/sms/mock";
import type { MessagingProvider } from "../../lib/providers/sms/types";
import { env, run, service } from "./helpers";

/**
 * Phase 1 review fixes (ADR-017) against the real local stack: MFA enforced
 * by the database, recipient lists over 1,000, the send time budget, and the
 * SMS gateway circuit breaker (trip, alert, pause, probe, recovery, no
 * duplicate sends). Requires `pnpm db:seed`.
 */

const db = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const names = {
  large: `E2E nad tisíc ${run}`,
  budget: `E2E časový limit ${run}`,
  breaker: `E2E jistič ${run}`,
};
const minute = 60_000;

/** A weekday 10:00 Prague, at least a week ahead, with the next hour inside the sending window. */
function sendingMorning(daysAhead: number): Date {
  for (let d = daysAhead; d < daysAhead + 14; d++) {
    const p = pragueParts(new Date(Date.now() + d * 86_400_000));
    const at = pragueTime(p.year, p.month, p.day, 10, 0);
    if (isWithinSendingWindow(at) && isWithinSendingWindow(new Date(at.getTime() + 60 * minute))) return at;
  }
  throw new Error("no sending morning found");
}

function deps(now: Date, provider: MessagingProvider, extra: Partial<MessagingDeps> = {}): MessagingDeps {
  return {
    db,
    provider,
    now: () => now,
    ratePerSecond: 100,
    maxPerTick: 5000,
    optOutBase: "example.cz/o",
    suppressionPepper: env.SUPPRESSION_PEPPER ?? "",
    whitelist: { realProvider: false, production: false, numbers: [] },
    sleep: async () => {},
    ...extra,
  };
}

async function scheduledCampaign(companyName: string, name: string, rules: object, at: Date) {
  const { data: company } = await service.from("companies").select("id").eq("name", companyName).single();
  const { data: campaign } = await service
    .from("campaigns")
    .insert({
      company_id: company!.id,
      name,
      segment_preset: null,
      segment_rules_snapshot: rules,
      scheduled_at: new Date(at.getTime() - minute).toISOString(),
    })
    .select("id")
    .single();
  await service.from("campaign_steps").insert({
    company_id: company!.id,
    campaign_id: campaign!.id,
    step_number: 0,
    delay_days: 0,
    body_template: "{{osloveni}} rádi vás zase uvidíme v {{servis}}. Volejte {{telefon}}. {{odhlaseni}}",
  });
  await service.from("campaigns").update({ status: "scheduled" }).eq("id", campaign!.id);
  return { companyId: company!.id, campaignId: campaign!.id };
}

async function resetBreaker() {
  await service
    .from("platform_settings")
    .update({ provider_paused_until: null, provider_pause_reason: null, provider_paused_at: null })
    .eq("id", true);
  await service
    .from("alerts")
    .update({ status: "resolved" })
    .like("dedupe_key", "provider_paused:%")
    .neq("status", "resolved");
  await service.from("provider_attempts").delete().eq("provider_id", "mock");
}

test.describe.serial("review fixes", () => {
  test.beforeAll(resetBreaker);
  test.afterAll(async () => {
    await resetBreaker();
    await service.from("campaigns").delete().in("name", Object.values(names));
  });

  test("an operator's password-only session gets nothing from the API", async () => {
    const mail = `aal-probe-${run}@example.cz`;
    const password = `${randomBytes(9).toString("hex")}Aa1`;
    const { data: user } = await service.auth.admin.createUser({ email: mail, password, email_confirm: true });
    try {
      await service.from("platform_admins").insert({ user_id: user.user!.id });
      const anon = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
      });
      await anon.auth.signInWithPassword({ email: mail, password });
      await anon.auth.mfa.enroll({ factorType: "totp" });
      const { data: aal } = await anon.auth.mfa.getAuthenticatorAssuranceLevel();
      expect(aal!.currentLevel).toBe("aal1");
      const { count } = await anon.from("customers").select("id", { count: "exact", head: true });
      expect(count).toBe(0);
      const { data: settings } = await anon.from("platform_settings").select("sending_paused").maybeSingle();
      expect(settings).toBeNull();
      const { data: flipped } = await anon
        .from("platform_settings")
        .update({ sending_paused: true })
        .eq("id", true)
        .select();
      expect(flipped ?? []).toEqual([]);
    } finally {
      await service.auth.admin.deleteUser(user.user!.id);
    }
  });

  test("a campaign with more than 1,000 recipients snapshots all of them", async () => {
    test.setTimeout(240_000);
    const at = sendingMorning(7);
    const rules = { all: [{ field: "vehicle.last_visit_at", op: "older_than_months", value: 9 }] };
    const { companyId, campaignId } = await scheduledCampaign("Pneu & Servis Horák", names.large, rules, at);
    const { data: preview } = await db.rpc("segment_preview", {
      p_company_id: companyId,
      p_rules: rules,
      p_today: toDateOnly(at),
    });
    const eligible = (preview as { eligible: number }).eligible;
    expect(eligible).toBeGreaterThan(1000);

    // maxPerTick 0: only the snapshot, no sending.
    const tick = await runMessagingTick(deps(at, createMockSmsProvider({ latencyMs: 0 }), { maxPerTick: 0 }));
    expect(tick.started).toEqual([campaignId]);
    const { count: enrolled } = await service
      .from("campaign_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId);
    expect(enrolled).toBe(eligible);
    const { count: holdout } = await service
      .from("campaign_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("is_holdout", true);
    const { count: queued } = await service
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId);
    expect(holdout).toBe(Math.round(eligible * 0.1));
    expect(queued).toBe(eligible - holdout!);
  });

  test("sending stops at the time budget and leaves nothing half-sent", async () => {
    test.setTimeout(240_000);
    const at = sendingMorning(8);
    const rules = { all: [{ field: "vehicle.last_visit_at", op: "between_months_ago", value: [12, 18] }] };
    const { campaignId } = await scheduledCampaign("Garáž U Nádraží", names.budget, rules, at);
    await runMessagingTick(deps(at, createMockSmsProvider({ latencyMs: 0 }), { maxPerTick: 0 }));

    // A fake clock that advances 1 s per check: two batches of 5 fit into 2.5 s.
    let ms = 0;
    const tick = await runMessagingTick(
      deps(at, createMockSmsProvider({ latencyMs: 0 }), {
        sendBudgetMs: 2_500,
        claimBatch: 5,
        elapsedMs: () => (ms += 1_000),
      }),
    );
    expect(tick.sent + tick.failedMessages).toBe(10);
    const { count: sending } = await service
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "sending");
    expect(sending).toBe(0);
  });

  test("circuit breaker: gateway failures pause sending, alert, probe, recover, never duplicate", async () => {
    test.setTimeout(300_000);
    const at = sendingMorning(9);
    const rules = { all: [{ field: "vehicle.last_visit_at", op: "between_months_ago", value: [12, 18] }] };
    const { campaignId } = await scheduledCampaign("Autoservis Dvořák s.r.o.", names.breaker, rules, at);
    await runMessagingTick(deps(at, createMockSmsProvider({ latencyMs: 0 }), { maxPerTick: 0 }));

    // Messages the gateway accepted, per idempotency key: must never exceed 1.
    const accepted = new Map<string, number>();
    const gateway = (failEvery: number | null): MessagingProvider => {
      const inner = createMockSmsProvider({ latencyMs: 0 });
      let calls = 0;
      return {
        ...inner,
        async send(msg) {
          calls++;
          if (failEvery && calls % failEvery === 0) {
            return { ok: false, retryable: true, code: "bulkgate_unknown", detail: "HTTP 503" };
          }
          const result = await inner.send(msg);
          if (result.ok) accepted.set(msg.idempotencyKey, (accepted.get(msg.idempotencyKey) ?? 0) + 1);
          return result;
        },
      };
    };

    // 1. Every second send fails at the gateway: the breaker trips.
    const tripped = await runMessagingTick(deps(at, gateway(2), { claimBatch: 10, maxPerTick: 200 }));
    expect(tripped.breakerTripped).toBe(true);
    const { data: paused } = await service
      .from("platform_settings")
      .select("provider_paused_until, provider_pause_reason")
      .single();
    expect(new Date(paused!.provider_paused_until!).getTime()).toBe(at.getTime() + 15 * minute);
    expect(paused!.provider_pause_reason).toMatch(/failed in 5 min/);
    const { data: alert } = await service
      .from("alerts")
      .select("severity, status")
      .eq("dedupe_key", "provider_paused:mock")
      .neq("status", "resolved")
      .single();
    expect(alert!.severity).toBe("critical");
    const queuedBefore = (
      await service
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("status", "queued")
    ).count!;
    expect(queuedBefore).toBeGreaterThan(0);

    // 2. During the pause nothing is sent and no campaign starts; the health check keeps the alert.
    const during = await runMessagingTick(deps(new Date(at.getTime() + 5 * minute), gateway(null)));
    expect([during.breaker, during.sent]).toEqual(["open", 0]);
    await runHealthCheck(db, new Date(at.getTime() + 6 * minute));
    const { count: stillOpen } = await service
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .eq("dedupe_key", "provider_paused:mock")
      .neq("status", "resolved");
    expect(stillOpen).toBe(1);

    // 3. After the pause one probe goes out; the gateway answers, so sending resumes.
    const probeAt = new Date(at.getTime() + 16 * minute);
    const resumed = await runMessagingTick(deps(probeAt, gateway(null), { maxPerTick: 50 }));
    expect(resumed.breaker).toBe("closed");
    expect(resumed.sent).toBeGreaterThan(1);
    const { data: closed } = await service.from("platform_settings").select("provider_paused_until").single();
    expect(closed!.provider_paused_until).toBeNull();
    const { count: openAfter } = await service
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .eq("dedupe_key", "provider_paused:mock")
      .neq("status", "resolved");
    expect(openAfter).toBe(0);

    // 4. A failing probe pauses again.
    await service
      .from("platform_settings")
      .update({
        provider_paused_until: new Date(probeAt.getTime() + minute).toISOString(),
        provider_pause_reason: "test",
      })
      .eq("id", true);
    const probeFails = await runMessagingTick(deps(new Date(probeAt.getTime() + 2 * minute), gateway(1)));
    expect(probeFails.breaker).toBe("open");
    const { data: again } = await service
      .from("platform_settings")
      .select("provider_paused_until, provider_pause_reason")
      .single();
    expect(again!.provider_pause_reason).toBe("probe_failed");

    // No message was ever accepted twice, and rejected ones went back to the queue.
    expect([...accepted.values()].filter((n) => n > 1)).toEqual([]);
    const { count: sending } = await service
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "sending");
    expect(sending).toBe(0);
  });
});
