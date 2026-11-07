import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { validateTemplate } from "../ai/validate";
import { selectHoldout } from "../domain/campaigns/estimates";
import { addDays, toDateOnly } from "../domain/dates";
import { optOutToken, renderTemplate } from "../domain/messaging/render";
import { countSmsSegments } from "../domain/messaging/sms-segments";
import { PRESET_BY_KEY, type PresetKey } from "../domain/segments/presets";
import { env } from "../env";
import { getSmsProvider } from "../providers/sms";
import { recomputeCustomer } from "./aggregates";
import { companyIndex, type CompanyIndex } from "./company-index";
import { presetAudience } from "./derived";
import { getDb, markChanged, resetDb } from "./store";
import type { Campaign, CampaignEnrollment, CampaignStep, Conversion, Message, ServiceCategory, Visit } from "./types";
import { SERVICE_TYPES_RAW } from "./demo/fixtures";

/**
 * Write operations. Each one resolves the company index first, so a
 * mismatched companyId / entity id simply finds nothing (the in-memory
 * stand-in for RLS + composite foreign keys).
 */

export class DomainError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

function mustIndex(companyId: string): CompanyIndex {
  const index = companyIndex(getDb(), companyId);
  if (!index) throw new DomainError("not_found");
  return index;
}

function commit(): void {
  markChanged(getDb());
}

// ---------- campaigns ----------

export function createCampaign(input: {
  companyId: string;
  presetKey: PresetKey;
  name: string;
  holdoutPct: number;
  template: string;
  stripDiacritics: boolean;
  scheduledAt: Date;
}): { campaignId: string } {
  const db = getDb();
  const index = mustIndex(input.companyId);
  const now = new Date();
  if (!index.company.sending_enabled) throw new DomainError("sending_disabled");

  const issues = validateTemplate(input.template, { now });
  if (issues.some((i) => i.code === "missing_required" || i.code === "unknown_placeholder")) {
    throw new DomainError("template_invalid");
  }

  // Recipients are re-evaluated on the server; the client's numbers are only a preview.
  const result = presetAudience(index, input.presetKey, now, { holdoutPct: input.holdoutPct });
  if (result.audience.eligible.length === 0) throw new DomainError("no_recipients");

  const id = randomUUID();
  const iso = now.toISOString();
  const campaign: Campaign = {
    id,
    company_id: index.company.id,
    name: input.name,
    segment_preset: input.presetKey,
    segment_rules_snapshot: PRESET_BY_KEY[input.presetKey].rules,
    channel: "sms",
    status: "scheduled",
    scheduled_at: input.scheduledAt.toISOString(),
    holdout_pct: input.holdoutPct,
    offer_text: null,
    automation_rule_id: null,
    expected_conversion_rate: index.company.settings.expected_conversion_rate,
    avg_job_value_minor_snapshot: result.avgJobValueMinor,
    attribution_window_days: index.company.settings.attribution_window_days,
    approved_at: iso,
    created_at: iso,
    updated_at: iso,
    completed_at: null,
  };
  const step: CampaignStep = {
    id: randomUUID(),
    company_id: index.company.id,
    campaign_id: id,
    step_number: 0,
    delay_days: 0,
    body_template: input.template,
    strip_diacritics: input.stripDiacritics,
    created_at: iso,
  };
  const holdout = selectHoldout(
    result.audience.eligible.map((m) => m.customerId),
    input.holdoutPct,
    id,
  );
  const enrollments: CampaignEnrollment[] = result.audience.eligible.map((m) => ({
    id: randomUUID(),
    company_id: index.company.id,
    campaign_id: id,
    customer_id: m.customerId,
    vehicle_id: m.vehicleId,
    is_holdout: holdout.has(m.customerId),
    stage: "contacted",
    stopped_reason: null,
    first_sent_at: null,
    window_ends_at: null,
    created_at: iso,
    updated_at: iso,
  }));

  db.campaigns.push(campaign);
  db.campaign_steps.push(step);
  db.campaign_enrollments.push(...enrollments);
  commit();
  return { campaignId: id };
}

export interface SendProgress {
  status: Campaign["status"];
  total: number;
  sent: number;
  delivered: number;
  failed: number;
  queued: number;
  processed: number;
  done: boolean;
}

const BATCH_SIZE = 32;

function progressOf(index: CompanyIndex, campaign: Campaign): SendProgress {
  const messages = index.messagesByCampaign.get(campaign.id) ?? [];
  const treated = (index.enrollmentsByCampaign.get(campaign.id) ?? []).filter((e) => !e.is_holdout).length;
  return {
    status: campaign.status,
    total: treated,
    sent: messages.filter((m) => ["sent", "delivered", "undelivered"].includes(m.status)).length,
    delivered: messages.filter((m) => m.status === "delivered").length,
    failed: messages.filter((m) => m.status === "failed" || m.status === "undelivered").length,
    queued: messages.filter((m) => m.status === "queued" || m.status === "sending").length,
    processed: messages.filter((m) => m.status !== "queued" && m.status !== "sending").length,
    done: !["scheduled", "sending"].includes(campaign.status),
  };
}

/**
 * Runs one dispatcher tick for a campaign: on the first call it performs the
 * pre-send checks and renders the outbox (idempotency key per enrollment and
 * step), then each call sends one batch through the mock provider and
 * processes delivery reports for the previous batch.
 */
export async function simulateSendBatch(input: { companyId: string; campaignId: string }): Promise<SendProgress> {
  const db = getDb();
  if (env.SMS_PROVIDER !== "mock") throw new DomainError("provider_not_allowed");
  let index = mustIndex(input.companyId);
  const campaign = index.campaignById.get(input.campaignId);
  if (!campaign) throw new DomainError("not_found");
  if (!["scheduled", "sending"].includes(campaign.status)) return progressOf(index, campaign);

  const provider = getSmsProvider();
  const now = new Date();

  if (campaign.status === "scheduled") {
    if (!index.company.sending_enabled) throw new DomainError("sending_disabled");
    const step = (index.stepsByCampaign.get(campaign.id) ?? [])[0];
    if (!step || !step.body_template.includes("{{odhlaseni}}")) throw new DomainError("template_invalid");
    const shop = {
      shopName: index.company.settings.message_shop_name ?? index.company.name,
      phone: index.company.phone,
    };
    const existingKeys = new Set(db.messages.map((m) => m.idempotency_key));

    for (const e of index.enrollmentsByCampaign.get(campaign.id) ?? []) {
      if (e.is_holdout) continue;
      const key = createHash("sha256").update(`${e.id}:${step.id}`).digest("hex");
      if (existingKeys.has(key)) continue;
      const customer = index.customerById.get(e.customer_id)!;
      const vehicle = e.vehicle_id ? index.vehicleById.get(e.vehicle_id) : undefined;
      const rendered = renderTemplate(step.body_template, {
        recipient: {
          firstName: customer.first_name,
          lastName: customer.last_name,
          vehicleBrand: vehicle?.brand ?? null,
          vehicleModel: vehicle?.model ?? null,
          lastVisitAt: vehicle?.last_visit_at ?? customer.last_visit_at,
        },
        shop,
        optOutUrl: `${env.OPT_OUT_BASE_URL}/${optOutToken(e.id)}`,
        now,
        stripDiacritics: step.strip_diacritics,
      });
      if (rendered.missingRequired.length) throw new DomainError("template_invalid");
      const seg = countSmsSegments(rendered.text);
      const message: Message = {
        id: randomUUID(),
        company_id: campaign.company_id,
        campaign_id: campaign.id,
        enrollment_id: e.id,
        step_id: step.id,
        customer_id: customer.id,
        channel: "sms",
        to_address: customer.phone_e164 ?? "",
        body_rendered: rendered.text,
        encoding: seg.encoding,
        segments: seg.segments,
        status: "queued",
        provider_id: provider.id,
        provider_message_id: null,
        idempotency_key: key,
        cost_minor: null,
        error_code: null,
        attempts: 0,
        queued_at: now.toISOString(),
        sent_at: null,
        delivered_at: null,
        failed_at: null,
      };
      db.messages.push(message);
    }
    campaign.status = "sending";
    campaign.updated_at = now.toISOString();
    commit();
    index = mustIndex(input.companyId);
  }

  const messages = index.messagesByCampaign.get(campaign.id) ?? [];

  // Delivery reports for everything already accepted by the provider.
  const awaitingDlr = messages.filter((m) => m.status === "sent" && m.provider_message_id);
  if (awaitingDlr.length && provider.pollDeliveryReports) {
    const events = await provider.pollDeliveryReports(awaitingDlr.map((m) => m.provider_message_id!));
    const byId = new Map(events.map((e) => [e.providerMessageId, e]));
    for (const m of awaitingDlr) {
      const ev = byId.get(m.provider_message_id!);
      if (!ev) continue;
      m.status = ev.status;
      if (ev.status === "delivered") m.delivered_at = ev.at.toISOString();
      else m.error_code = "DLR_UNDELIVERED";
    }
  }

  // Claim and send the next batch.
  const batch = messages.filter((m) => m.status === "queued").slice(0, BATCH_SIZE);
  for (const m of batch) m.status = "sending";
  for (const m of batch) {
    const enrollment = index.enrollmentById.get(m.enrollment_id)!;
    const customer = index.customerById.get(m.customer_id);
    // Re-check suppression right before sending.
    if (!customer?.phone_e164 || index.suppressedCustomerIds.has(customer.id)) {
      m.status = "cancelled";
      enrollment.stopped_reason = "suppressed";
      continue;
    }
    m.attempts++;
    const result = await provider.send({
      to: m.to_address,
      body: m.body_rendered,
      senderId: index.company.default_sender_name,
      idempotencyKey: m.idempotency_key,
    });
    const at = new Date().toISOString();
    if (result.ok) {
      m.status = "sent";
      m.provider_message_id = result.providerMessageId;
      m.segments = result.segments;
      m.cost_minor = result.cost?.amountMinor ?? null;
      m.sent_at = at;
      enrollment.first_sent_at = at;
      enrollment.window_ends_at = addDays(at, campaign.attribution_window_days).toISOString();
    } else {
      m.status = "failed";
      m.error_code = result.code;
      m.failed_at = at;
      enrollment.stopped_reason = "initial_failed";
    }
    enrollment.updated_at = at;
  }

  const remaining = messages.some((m) => m.status === "queued" || m.status === "sending");
  const pendingDlr = messages.some((m) => m.status === "sent");
  if (!remaining && !pendingDlr) {
    campaign.status = "active";
    campaign.updated_at = new Date().toISOString();
    // Holdout rows share the campaign's attribution window from the send time.
    const windowEnd = addDays(new Date(), campaign.attribution_window_days).toISOString();
    for (const e of index.enrollmentsByCampaign.get(campaign.id) ?? []) {
      if (e.is_holdout) e.window_ends_at = windowEnd;
    }
  }
  commit();
  return progressOf(mustIndex(input.companyId), campaign);
}

// ---------- conversions ----------

function enrollmentFor(index: CompanyIndex, enrollmentId: string): CampaignEnrollment {
  const e = index.enrollmentById.get(enrollmentId);
  if (!e) throw new DomainError("not_found");
  return e;
}

export function markBooked(input: { companyId: string; enrollmentId: string }) {
  const db = getDb();
  const index = mustIndex(input.companyId);
  const e = enrollmentFor(index, input.enrollmentId);
  if (e.stage === "completed") throw new DomainError("already_completed");
  const now = new Date().toISOString();
  const existing = index.conversionByEnrollment.get(e.id);
  if (existing) {
    existing.stage = "booked";
    existing.booked_at ??= now;
    existing.updated_at = now;
  } else {
    db.conversions.push(newConversion(e, "booked", now));
  }
  e.stage = "booked";
  e.updated_at = now;
  commit();
}

export function markCompleted(input: { companyId: string; enrollmentId: string; revenueMinor: number }) {
  const db = getDb();
  let index = mustIndex(input.companyId);
  const e = enrollmentFor(index, input.enrollmentId);
  const campaign = index.campaignById.get(e.campaign_id)!;
  const nowDate = new Date();
  const now = nowDate.toISOString();

  let conversion: Conversion | undefined = index.conversionByEnrollment.get(e.id);
  if (!conversion) {
    conversion = newConversion(e, "completed", now);
    db.conversions.push(conversion);
  }
  // One return visit per conversion; editing the value updates it.
  const categories: ServiceCategory[] =
    campaign.segment_preset && campaign.segment_preset in PRESET_BY_KEY
      ? PRESET_BY_KEY[campaign.segment_preset as PresetKey].valueCategories
      : ["regular_service"];
  const category = categories.includes("regular_service") ? "regular_service" : categories[0];
  let visit = conversion.visit_id ? db.visits.find((v) => v.id === conversion!.visit_id) : undefined;
  if (!visit) {
    visit = {
      id: randomUUID(),
      company_id: e.company_id,
      customer_id: e.customer_id,
      vehicle_id: e.vehicle_id,
      visited_at: toDateOnly(nowDate),
      service_type_raw: SERVICE_TYPES_RAW[category][0],
      service_category: category,
      job_value_minor: input.revenueMinor,
      created_at: now,
    } satisfies Visit;
    db.visits.push(visit);
  } else {
    visit.job_value_minor = input.revenueMinor;
  }

  conversion.stage = "completed";
  conversion.booked_at ??= now;
  conversion.completed_at ??= now;
  conversion.revenue_minor = input.revenueMinor;
  conversion.visit_id = visit.id;
  conversion.source = "manual_confirmed";
  conversion.confirmed_at = now;
  conversion.updated_at = now;
  e.stage = "completed";
  e.updated_at = now;

  commit();
  index = mustIndex(input.companyId);
  const customer = index.customerById.get(e.customer_id);
  if (customer) recomputeCustomer(index, customer, nowDate);
  commit();
}

function newConversion(e: CampaignEnrollment, stage: "booked" | "completed", now: string): Conversion {
  return {
    id: randomUUID(),
    company_id: e.company_id,
    enrollment_id: e.id,
    campaign_id: e.campaign_id,
    customer_id: e.customer_id,
    vehicle_id: e.vehicle_id,
    stage,
    source: "manual_confirmed",
    is_holdout: e.is_holdout,
    booked_at: now,
    completed_at: stage === "completed" ? now : null,
    revenue_minor: null,
    visit_id: null,
    confirmed_at: now,
    notes: null,
    created_at: now,
    updated_at: now,
  };
}

// ---------- demo ----------

export function resetDemoData() {
  resetDb();
}
