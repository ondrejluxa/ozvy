import type { SupabaseClient } from "@supabase/supabase-js";
import { lookupGreetings } from "../db/greetings";
import type { Database, Json } from "../db/types.gen";
import { selectHoldout } from "../domain/campaigns/estimates";
import { resolveCompanySettings } from "../domain/company-settings";
import { toDateOnly } from "../domain/dates";
import {
  addressAllowed,
  afterSendFailure,
  attributionWindowEnd,
  checkSnapshot,
  messageIdempotencyKey,
  nextCampaignStatus,
  preSendGate,
  randomOptOutToken,
} from "../domain/messaging/dispatch";
import { renderTemplate, type RecipientRenderData, type ShopRenderData } from "../domain/messaging/render";
import { isWithinSendingWindow } from "../domain/messaging/sending-window";
import { suppressionHash } from "../domain/messaging/opt-out";
import { countSmsSegments } from "../domain/messaging/sms-segments";
import { PRESET_BY_KEY, WORKSHOP, isPresetKey } from "../domain/segments/presets";
import type { MessagingProvider } from "../providers/sms/types";
import { expireMessages, processEvents, storeEvents } from "./opt-out-core";

/**
 * The messaging tick (spec §12, §16, §40.12), run every minute by Inngest
 * and by hand locally (`pnpm jobs:tick`). It takes all dependencies,
 * including the clock, so tests drive it directly:
 *
 * 1. flag messages stuck in 'sending' for manual review;
 * 2. stop here while the global kill switch is on;
 * 3. start due campaigns: pre-send checks, enrollment snapshot with holdout,
 *    step-0 messages (idempotent);
 * 4. queue due follow-ups (stop conditions applied at render);
 * 5. dispatch inside the sending window: claim with SKIP LOCKED, re-check
 *    stop conditions, send at the provider rate, retry with backoff;
 * 6. move campaigns sending → active → completed.
 */

type Db = SupabaseClient<Database>;

export interface MessagingDeps {
  db: Db;
  provider: MessagingProvider;
  now: () => Date;
  /** Provider rate limit (messages per second) and the most messages one tick sends. */
  ratePerSecond: number;
  maxPerTick: number;
  optOutBase: string;
  /** SUPPRESSION_PEPPER: suppression entries are HMAC hashes of the number. */
  suppressionPepper: string;
  whitelist: { realProvider: boolean; production: boolean; numbers: string[] };
  sleep?: (ms: number) => Promise<void>;
}

export interface TickResult {
  killSwitch: boolean;
  flagged: number;
  started: string[];
  failed: { campaignId: string; reason: string }[];
  paused: { campaignId: string; reason: string }[];
  followups: number;
  sent: number;
  cancelled: number;
  retried: number;
  failedMessages: number;
  review: number;
  advanced: { campaignId: string; status: string }[];
  delivered: number;
  undelivered: number;
  optOuts: number;
  expired: number;
}

// ---------- suppression ----------

async function suppressedHashes(
  db: Db,
  items: { companyId: string; address: string }[],
  pepper: string,
): Promise<Set<string>> {
  const byCompany = new Map<string, Set<string>>();
  for (const i of items) {
    const set = byCompany.get(i.companyId) ?? new Set<string>();
    set.add(suppressionHash(i.address, pepper));
    byCompany.set(i.companyId, set);
  }
  const found = new Set<string>();
  for (const [companyId, hashes] of byCompany) {
    // 64-character hashes travel in the URL: keep each request well under URL limits.
    for (const part of chunks([...hashes], 50)) {
      const { data, error } = await db
        .from("suppression_list")
        .select("address_hash")
        .eq("company_id", companyId)
        .eq("channel", "sms")
        .in("address_hash", part);
      if (error) throw new Error(`suppression check failed: ${error.code ?? error.message}`);
      for (const row of data ?? []) found.add(`${companyId}:${row.address_hash}`);
    }
  }
  return found;
}

async function withoutSuppressed<T extends { phone_e164: string | null }>(
  db: Db,
  companyId: string,
  rows: T[],
  pepper: string,
): Promise<T[]> {
  const withPhone = rows.filter((r) => r.phone_e164);
  const found = await suppressedHashes(
    db,
    withPhone.map((r) => ({ companyId, address: r.phone_e164! })),
    pepper,
  );
  if (found.size === 0) return rows;
  return rows.filter((r) => !r.phone_e164 || !found.has(`${companyId}:${suppressionHash(r.phone_e164, pepper)}`));
}

// ---------- delivery reports and inbound ----------

async function applyProviderEvents(deps: MessagingDeps, out: TickResult) {
  const { db, provider } = deps;
  const now = deps.now();
  // The mock has no callbacks: poll it for sent messages and store its reports like webhooks.
  if (provider.pollDeliveryReports) {
    const { data: sent } = await db
      .from("messages")
      .select("provider_message_id")
      .eq("provider_id", provider.id)
      .eq("status", "sent")
      .not("provider_message_id", "is", null)
      .limit(2000);
    const ids = (sent ?? []).map((m) => m.provider_message_id!);
    if (ids.length) {
      const reports = await provider.pollDeliveryReports(ids);
      await storeEvents(
        db,
        provider.id,
        reports.map((r) => ({
          kind: "delivery" as const,
          providerEventId: `${r.providerMessageId}:${r.status}`,
          providerMessageId: r.providerMessageId,
          status: r.status,
          payload: { source: "poll" },
        })),
      );
    }
  }
  const events = await processEvents(db, { pepper: deps.suppressionPepper, now });
  out.delivered += events.delivered;
  out.undelivered += events.undelivered;
  out.optOuts += events.optOuts;
  if (provider.capabilities.deliveryReports) out.expired += await expireMessages(db, provider.id, now);
}

const CHUNK = 500;
const PAGE = 1000;

function chunks<T>(list: T[], size = CHUNK): T[][] {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));
}

async function systemAudit(db: Db, companyId: string, action: string, campaignId: string, metadata: object = {}) {
  await db.from("audit_logs").insert({
    company_id: companyId,
    actor_type: "system",
    action,
    entity_type: "campaign",
    entity_id: campaignId,
    metadata: metadata as NonNullable<Json>,
  });
}

async function setCampaignStatus(
  db: Db,
  companyId: string,
  campaignId: string,
  from: Database["public"]["Enums"]["campaign_status"],
  patch: Database["public"]["Tables"]["campaigns"]["Update"],
) {
  const { data, error } = await db
    .from("campaigns")
    .update(patch)
    .eq("company_id", companyId)
    .eq("id", campaignId)
    .eq("status", from)
    .select("id");
  if (error) throw new Error(`campaign update failed: ${error.code}`);
  return (data ?? []).length > 0;
}

// ---------- company and rendering ----------

interface CompanyContext {
  status: string;
  sendingEnabled: boolean;
  shop: ShopRenderData;
  senderId: string | null;
  personalGreetings: boolean;
  averageJobValueMinor: number;
}

async function loadCompany(db: Db, companyId: string): Promise<CompanyContext> {
  const { data, error } = await db
    .from("companies")
    .select("name, phone, status, sending_enabled, settings, default_sender_name, average_job_value_minor")
    .eq("id", companyId)
    .single();
  if (error || !data) throw new Error(`company load failed: ${error?.code}`);
  const settings = resolveCompanySettings(data.settings);
  return {
    status: data.status,
    sendingEnabled: data.sending_enabled,
    shop: { shopName: settings.message_shop_name ?? data.name, phone: data.phone },
    senderId: data.default_sender_name,
    personalGreetings: settings.personalized_greeting,
    averageJobValueMinor: data.average_job_value_minor,
  };
}

interface AudienceRow {
  customer_id: string;
  first_name: string | null;
  last_name: string | null;
  phone_e164: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  last_visit_at: string | null;
}

interface StepRow {
  id: string;
  step_number: number;
  delay_days: number;
  body_template: string;
  strip_diacritics: boolean;
}

function renderFor(
  step: StepRow,
  row: AudienceRow,
  greetings: Map<string, string>,
  company: CompanyContext,
  optOutBase: string,
  now: Date,
) {
  const recipient: RecipientRenderData = {
    firstName: row.first_name,
    lastName: row.last_name,
    vehicleBrand: row.vehicle_brand,
    vehicleModel: row.vehicle_model,
    lastVisitAt: row.last_visit_at,
    greeting: (row.last_name && greetings.get(row.last_name.trim())) || null,
  };
  const token = randomOptOutToken();
  const result = renderTemplate(step.body_template, {
    recipient,
    shop: company.shop,
    optOutUrl: `${optOutBase}/${token}`,
    now,
    stripDiacritics: step.strip_diacritics,
  });
  const problem =
    result.missingRequired.length > 0 ||
    result.unknownPlaceholders.length > 0 ||
    !result.text.trim() ||
    !row.phone_e164 ||
    !company.shop.phone;
  const info = countSmsSegments(result.text);
  return { text: result.text, token, problem, segments: info.segments, encoding: info.encoding };
}

async function loadSteps(db: Db, companyId: string, campaignId: string): Promise<StepRow[]> {
  const { data, error } = await db
    .from("campaign_steps")
    .select("id, step_number, delay_days, body_template, strip_diacritics")
    .eq("company_id", companyId)
    .eq("campaign_id", campaignId)
    .order("step_number");
  if (error) throw new Error(`steps load failed: ${error.code}`);
  return data ?? [];
}

// ---------- 3. start due campaigns ----------

async function startCampaign(deps: MessagingDeps, companyId: string, campaignId: string, out: TickResult) {
  const { db } = deps;
  const now = deps.now();
  // Taking the campaign from 'scheduled' is the lock: a second tick finds nothing.
  const { data: campaign } = await db
    .from("campaigns")
    .update({ status: "sending", started_at: now.toISOString(), status_reason: null })
    .eq("company_id", companyId)
    .eq("id", campaignId)
    .eq("status", "scheduled")
    .select("id, segment_preset, holdout_pct, approved_recipient_count, attribution_window_days")
    .maybeSingle();
  if (!campaign) return;

  const fail = async (reason: string) => {
    await setCampaignStatus(db, companyId, campaignId, "sending", { status: "failed", status_reason: reason });
    await systemAudit(db, companyId, "campaign.failed", campaignId, { reason });
    out.failed.push({ campaignId, reason });
  };

  const [company, steps] = await Promise.all([loadCompany(db, companyId), loadSteps(db, companyId, campaignId)]);
  const { data: audience, error } = await db
    .rpc("campaign_audience", { p_company_id: companyId, p_campaign_id: campaignId, p_today: toDateOnly(now) })
    .range(0, 49_999);
  if (error) throw new Error(`campaign audience failed: ${error.code}`);
  // Numbers on the shop's suppression list never enter the snapshot (spec §16).
  const all = await withoutSuppressed(
    db,
    companyId,
    (audience ?? []) as (AudienceRow & { vehicle_id: string | null })[],
    deps.suppressionPepper,
  );
  if (steps.length === 0 || steps[0].step_number !== 0) return fail("render_failed");

  const holdout = selectHoldout(
    all.map((a) => a.customer_id),
    Number(campaign.holdout_pct),
    campaignId,
  );
  const sendTo = all.filter((a) => !holdout.has(a.customer_id));
  const greetings = company.personalGreetings
    ? await lookupGreetings(
        db,
        companyId,
        sendTo.map((a) => a.last_name),
      )
    : new Map<string, string>();

  // Pre-send check 2: every step renders for every recipient.
  let problems = 0;
  let segments = 0;
  const initial = new Map<string, ReturnType<typeof renderFor>>();
  for (const a of sendTo) {
    for (const step of steps) {
      const r = renderFor(step, a, greetings, company, deps.optOutBase, now);
      if (r.problem) problems++;
      segments += r.segments;
      if (step.step_number === 0) initial.set(a.customer_id, r);
    }
  }
  const check = checkSnapshot({
    company: { status: company.status, sendingEnabled: company.sendingEnabled },
    recipients: all.length,
    approvedRecipients: campaign.approved_recipient_count,
    renderProblems: problems,
    estimatedSegments: segments,
    creditSegments: deps.provider.getBalanceSegments ? await deps.provider.getBalanceSegments() : null,
  });
  if (check.action === "fail") return fail(check.reason);

  // Snapshot: enrollments (holdout included, never messaged) and step-0 messages.
  const windowFromStart = attributionWindowEnd(now, campaign.attribution_window_days).toISOString();
  for (const part of chunks(all)) {
    const { error: e } = await db.from("campaign_enrollments").upsert(
      part.map((a) => ({
        company_id: companyId,
        campaign_id: campaignId,
        customer_id: a.customer_id,
        vehicle_id: a.vehicle_id,
        is_holdout: holdout.has(a.customer_id),
        // Holdout windows start with the campaign; contacted ones at their first send.
        window_ends_at: holdout.has(a.customer_id) ? windowFromStart : null,
      })),
      { onConflict: "campaign_id,customer_id", ignoreDuplicates: true },
    );
    if (e) throw new Error(`enrollment insert failed: ${e.code}`);
  }
  const enrollmentIds = new Map<string, string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error: e } = await db
      .from("campaign_enrollments")
      .select("id, customer_id")
      .eq("company_id", companyId)
      .eq("campaign_id", campaignId)
      .eq("is_holdout", false)
      .order("id")
      .range(from, from + PAGE - 1);
    if (e) throw new Error(`enrollment read failed: ${e.code}`);
    for (const row of data ?? []) enrollmentIds.set(row.customer_id, row.id);
    if ((data ?? []).length < PAGE) break;
  }
  const step0 = steps[0];
  const messages = sendTo.flatMap((a) => {
    const enrollmentId = enrollmentIds.get(a.customer_id);
    const r = initial.get(a.customer_id);
    if (!enrollmentId || !r || !a.phone_e164) return [];
    return [
      {
        company_id: companyId,
        campaign_id: campaignId,
        enrollment_id: enrollmentId,
        step_id: step0.id,
        step_number: 0,
        customer_id: a.customer_id,
        to_address: a.phone_e164,
        body_rendered: r.text,
        encoding: r.encoding,
        segments: r.segments,
        idempotency_key: messageIdempotencyKey(enrollmentId, step0.id),
        opt_out_token: r.token,
        queued_at: now.toISOString(),
      },
    ];
  });
  for (const part of chunks(messages)) {
    const { error: e } = await db
      .from("messages")
      .upsert(part, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (e) throw new Error(`message insert failed: ${e.code}`);
  }

  // Average job value snapshot for expected and recovered revenue (spec §12).
  const categories =
    campaign.segment_preset && isPresetKey(campaign.segment_preset)
      ? PRESET_BY_KEY[campaign.segment_preset].valueCategories
      : WORKSHOP;
  const { data: median } = await db.rpc("job_value_median", { p_company_id: companyId, p_categories: categories });
  const m = median?.[0];
  const avg = m && m.visits >= 20 && m.median_minor !== null ? m.median_minor : company.averageJobValueMinor;
  await db
    .from("campaigns")
    .update({ avg_job_value_minor_snapshot: avg })
    .eq("company_id", companyId)
    .eq("id", campaignId);

  await systemAudit(db, companyId, "campaign.started", campaignId, {
    recipients: all.length,
    holdout: holdout.size,
    messages: messages.length,
  });
  out.started.push(campaignId);
  if (check.pauseReason) {
    await setCampaignStatus(db, companyId, campaignId, "sending", {
      status: "paused",
      status_reason: check.pauseReason,
    });
    await systemAudit(db, companyId, "campaign.paused", campaignId, { reason: check.pauseReason });
    out.paused.push({ campaignId, reason: check.pauseReason });
  }
}

async function startDueCampaigns(deps: MessagingDeps, out: TickResult) {
  const now = deps.now();
  if (preSendGate({ now, globalPaused: false }).action === "wait") return;
  const { data } = await deps.db
    .from("campaigns")
    .select("id, company_id")
    .eq("status", "scheduled")
    .lte("scheduled_at", now.toISOString())
    .order("scheduled_at")
    .limit(20);
  for (const c of data ?? []) {
    try {
      await startCampaign(deps, c.company_id, c.id, out);
    } catch (err) {
      console.error("[messaging] campaign start failed", c.id, err instanceof Error ? err.message : "");
      // Nothing written yet: hand the campaign back to the operator now instead of after 15 minutes.
      const { count } = await deps.db
        .from("campaign_enrollments")
        .select("id", { count: "exact", head: true })
        .eq("company_id", c.company_id)
        .eq("campaign_id", c.id);
      if (!count) {
        const failed = await setCampaignStatus(deps.db, c.company_id, c.id, "sending", {
          status: "failed",
          status_reason: "start_interrupted",
        });
        if (failed) out.failed.push({ campaignId: c.id, reason: "start_interrupted" });
      }
    }
  }
}

// ---------- 4. follow-ups ----------

async function queueFollowups(deps: MessagingDeps, out: TickResult) {
  const { db } = deps;
  const now = deps.now();
  const { data: campaigns } = await db.from("campaigns").select("id, company_id").in("status", ["sending", "active"]);
  for (const c of campaigns ?? []) {
    const steps = (await loadSteps(db, c.company_id, c.id)).filter((s) => s.step_number > 0);
    if (steps.length === 0) continue;
    const company = await loadCompany(db, c.company_id);
    for (const step of steps) {
      // Rows are excluded once queued, so each page is new work.
      for (let round = 0; round < 50; round++) {
        const { data: due, error } = await db
          .rpc("due_followups", {
            p_company_id: c.company_id,
            p_campaign_id: c.id,
            p_step_number: step.step_number,
            p_delay_days: step.delay_days,
            p_now: now.toISOString(),
          })
          .range(0, PAGE - 1);
        if (error) throw new Error(`due follow-ups failed: ${error.code}`);
        const rows = (due ?? []) as (AudienceRow & { enrollment_id: string })[];
        if (rows.length === 0) break;
        const greetings = company.personalGreetings
          ? await lookupGreetings(
              db,
              c.company_id,
              rows.map((r) => r.last_name),
            )
          : new Map<string, string>();
        const messages = rows.flatMap((row) => {
          const r = renderFor(step, row, greetings, company, deps.optOutBase, now);
          if (r.problem) return [];
          return [
            {
              company_id: c.company_id,
              campaign_id: c.id,
              enrollment_id: row.enrollment_id,
              step_id: step.id,
              step_number: step.step_number,
              customer_id: row.customer_id,
              to_address: row.phone_e164!,
              body_rendered: r.text,
              encoding: r.encoding,
              segments: r.segments,
              idempotency_key: messageIdempotencyKey(row.enrollment_id, step.id),
              opt_out_token: r.token,
              queued_at: now.toISOString(),
            },
          ];
        });
        for (const part of chunks(messages)) {
          const { error: e } = await db
            .from("messages")
            .upsert(part, { onConflict: "idempotency_key", ignoreDuplicates: true });
          if (e) throw new Error(`follow-up insert failed: ${e.code}`);
        }
        out.followups += messages.length;
        if (messages.length === 0 || rows.length < PAGE) break;
      }
    }
  }
}

// ---------- 5. dispatch ----------

async function dispatch(deps: MessagingDeps, out: TickResult) {
  const { db, provider } = deps;
  if (!isWithinSendingWindow(deps.now())) return;
  const { data: claimed, error } = await db.rpc("claim_messages", {
    p_limit: deps.maxPerTick,
    p_now: deps.now().toISOString(),
  });
  if (error) throw new Error(`claim failed: ${error.code}`);
  const rows = claimed ?? [];
  if (rows.length === 0) return;

  const campaignIds = [...new Set(rows.map((r) => r.campaign_id).filter((id): id is string => Boolean(id)))];
  const companyIds = [...new Set(rows.map((r) => r.company_id))];
  const [{ data: campaigns }, { data: companies }] = await Promise.all([
    db.from("campaigns").select("id, attribution_window_days").in("id", campaignIds),
    db.from("companies").select("id, default_sender_name").in("id", companyIds),
  ]);
  const windowDays = new Map((campaigns ?? []).map((c) => [c.id, c.attribution_window_days]));
  const senders = new Map((companies ?? []).map((c) => [c.id, c.default_sender_name]));
  const pause = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const gap = Math.ceil(1000 / Math.max(1, deps.ratePerSecond));

  const update = async (id: string, patch: Database["public"]["Tables"]["messages"]["Update"]) => {
    const { error: e } = await db.from("messages").update(patch).eq("id", id);
    if (e) console.error("[messaging] message update failed", id, e.code);
  };

  // Suppression re-checked right before sending (spec §42 rule 4).
  const suppressed = await suppressedHashes(
    db,
    rows.map((r) => ({ companyId: r.company_id, address: r.to_address })),
    deps.suppressionPepper,
  );

  for (const m of rows) {
    const stop =
      m.stop_reason ??
      (suppressed.has(`${m.company_id}:${suppressionHash(m.to_address, deps.suppressionPepper)}`)
        ? "suppressed"
        : null);
    if (stop) {
      await update(m.id, { status: "cancelled", error_code: stop });
      out.cancelled++;
      continue;
    }
    if (!addressAllowed(m.to_address, { ...deps.whitelist, whitelist: deps.whitelist.numbers })) {
      await update(m.id, { status: "cancelled", error_code: "not_whitelisted" });
      out.cancelled++;
      continue;
    }
    let result: Awaited<ReturnType<MessagingProvider["send"]>>;
    try {
      result = await provider.send({
        to: m.to_address,
        body: m.body_rendered,
        senderId: senders.get(m.company_id) ?? null,
        idempotencyKey: m.idempotency_key,
      });
    } catch {
      // Unknown outcome: maybe sent. Never retry automatically (spec §16).
      await update(m.id, { status: "needs_review", error_code: "provider_exception" });
      out.review++;
      continue;
    }
    const at = deps.now();
    if (result.ok) {
      await update(m.id, {
        status: "sent",
        provider_id: provider.id,
        provider_message_id: result.providerMessageId,
        segments: result.segments,
        cost_minor: result.cost?.amountMinor ?? null,
        sent_at: at.toISOString(),
        error_code: null,
        error_detail: null,
      });
      if (m.step_number === 0 && m.enrollment_id && m.campaign_id) {
        await db
          .from("campaign_enrollments")
          .update({
            first_sent_at: at.toISOString(),
            window_ends_at: attributionWindowEnd(at, windowDays.get(m.campaign_id) ?? 60).toISOString(),
          })
          .eq("id", m.enrollment_id)
          .is("first_sent_at", null);
      }
      out.sent++;
    } else {
      const next = afterSendFailure(m.attempts, result.retryable, at);
      if (next.status === "queued") {
        await update(m.id, {
          status: "queued",
          next_attempt_at: next.nextAttemptAt.toISOString(),
          error_code: result.code,
          error_detail: result.detail.slice(0, 500),
        });
        out.retried++;
      } else {
        await update(m.id, {
          status: "failed",
          failed_at: at.toISOString(),
          error_code: result.code,
          error_detail: result.detail.slice(0, 500),
        });
        out.failedMessages++;
      }
    }
    if (gap > 0) await pause(gap);
  }
}

// ---------- 6. campaign progress ----------

const PENDING: Database["public"]["Enums"]["message_status"][] = ["queued", "sending"];

async function advanceCampaigns(deps: MessagingDeps, out: TickResult) {
  const { db } = deps;
  const now = deps.now();
  const { data: campaigns } = await db
    .from("campaigns")
    .select("id, company_id, status, started_at")
    .in("status", ["sending", "active"]);
  for (const c of campaigns ?? []) {
    const count = async (step0: boolean) => {
      let q = db
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("company_id", c.company_id)
        .eq("campaign_id", c.id)
        .in("status", PENDING);
      if (step0) q = q.eq("step_number", 0);
      return (await q).count ?? 0;
    };
    const latest = async (column: "first_sent_at" | "window_ends_at") => {
      const { data } = await db
        .from("campaign_enrollments")
        .select(column)
        .eq("company_id", c.company_id)
        .eq("campaign_id", c.id)
        .not(column, "is", null)
        .order(column, { ascending: false })
        .limit(1);
      const value = (data?.[0] as Record<string, string | null> | undefined)?.[column];
      return value ? new Date(value) : null;
    };
    const { count: enrollments } = await db
      .from("campaign_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("company_id", c.company_id)
      .eq("campaign_id", c.id);
    if (c.status === "sending" && !enrollments) {
      // A start that died before the snapshot: back to the operator.
      const started = c.started_at ? new Date(c.started_at).getTime() : 0;
      if (now.getTime() - started > 15 * 60_000) {
        await setCampaignStatus(db, c.company_id, c.id, "sending", {
          status: "failed",
          status_reason: "start_interrupted",
        });
        out.failed.push({ campaignId: c.id, reason: "start_interrupted" });
      }
      continue;
    }
    const steps = await loadSteps(db, c.company_id, c.id);
    const next = nextCampaignStatus({
      status: c.status as "sending" | "active",
      initialPending: await count(true),
      pending: await count(false),
      lastFirstSentAt: await latest("first_sent_at"),
      maxDelayDays: Math.max(0, ...steps.map((s) => s.delay_days)),
      windowEndsAt: await latest("window_ends_at"),
      now,
    });
    if (!next) continue;
    const ok = await setCampaignStatus(db, c.company_id, c.id, c.status as "sending" | "active", {
      status: next,
      ...(next === "completed" ? { completed_at: now.toISOString() } : {}),
    });
    if (ok) {
      if (next === "completed") await systemAudit(db, c.company_id, "campaign.completed", c.id);
      out.advanced.push({ campaignId: c.id, status: next });
    }
  }
}

// ---------- tick ----------

export async function runMessagingTick(deps: MessagingDeps): Promise<TickResult> {
  const out: TickResult = {
    killSwitch: false,
    flagged: 0,
    started: [],
    failed: [],
    paused: [],
    followups: 0,
    sent: 0,
    cancelled: 0,
    retried: 0,
    failedMessages: 0,
    review: 0,
    advanced: [],
    delivered: 0,
    undelivered: 0,
    optOuts: 0,
    expired: 0,
  };
  const { data: flagged } = await deps.db.rpc("flag_stuck_messages", { p_now: deps.now().toISOString() });
  out.flagged = flagged ?? 0;
  // Delivery reports and STOP replies are applied even while sending is stopped.
  await applyProviderEvents(deps, out);
  const { data: platform } = await deps.db.from("platform_settings").select("sending_paused").maybeSingle();
  if (platform?.sending_paused) {
    out.killSwitch = true;
    return out;
  }
  await startDueCampaigns(deps, out);
  await queueFollowups(deps, out);
  await dispatch(deps, out);
  await advanceCampaigns(deps, out);
  return out;
}
