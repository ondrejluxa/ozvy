import "server-only";
import type { Database } from "../types.gen";
import { createSupabaseServerClient } from "./server-client";

/** Delivery progress and queue health (spec §8 campaign detail, §20 System page). */

export type MessageStatus = Database["public"]["Enums"]["message_status"];

export interface StepDelivery {
  stepNumber: number;
  byStatus: Partial<Record<MessageStatus, number>>;
  total: number;
  segments: number;
  costMinor: number;
}

export interface CampaignDelivery {
  enrolled: number;
  holdout: number;
  contacted: number;
  steps: StepDelivery[];
  costMinor: number;
}

export async function getCampaignDelivery(companyId: string, campaignId: string): Promise<CampaignDelivery> {
  const supabase = await createSupabaseServerClient();
  const count = (holdout: boolean | null, contacted = false) => {
    let q = supabase
      .from("campaign_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("campaign_id", campaignId);
    if (holdout !== null) q = q.eq("is_holdout", holdout);
    if (contacted) q = q.not("first_sent_at", "is", null);
    return q;
  };
  const [enrolled, holdout, contacted, stats] = await Promise.all([
    count(null),
    count(true),
    count(false, true),
    supabase.rpc("campaign_delivery_stats", { p_company_id: companyId, p_campaign_id: campaignId }),
  ]);
  if (stats.error) throw new Error(`delivery stats failed: ${stats.error.code}`);
  const steps = new Map<number, StepDelivery>();
  for (const row of stats.data ?? []) {
    const step = steps.get(row.step_number) ?? {
      stepNumber: row.step_number,
      byStatus: {},
      total: 0,
      segments: 0,
      costMinor: 0,
    };
    step.byStatus[row.status] = row.messages;
    step.total += row.messages;
    step.segments += row.segments;
    step.costMinor += Number(row.cost_minor);
    steps.set(row.step_number, step);
  }
  const list = [...steps.values()].sort((a, b) => a.stepNumber - b.stepNumber);
  return {
    enrolled: enrolled.count ?? 0,
    holdout: holdout.count ?? 0,
    contacted: contacted.count ?? 0,
    steps: list,
    costMinor: list.reduce((sum, s) => sum + s.costMinor, 0),
  };
}

export interface SystemOverview {
  killSwitch: { paused: boolean; reason: string | null; at: string | null };
  /** SMS gateway circuit breaker (spec §24): paused until, and why. */
  breaker: { pausedUntil: string | null; reason: string | null };
  queue: {
    queued: number;
    sending: number;
    needsReview: number;
    sent24h: number;
    failed24h: number;
    oldestQueuedAt: string | null;
  };
  review: {
    id: string;
    companyName: string;
    campaignName: string | null;
    errorCode: string | null;
    at: string | null;
  }[];
}

export async function getSystemOverview(): Promise<SystemOverview> {
  const supabase = await createSupabaseServerClient();
  const [settings, health, review] = await Promise.all([
    supabase
      .from("platform_settings")
      .select("sending_paused, sending_paused_reason, sending_paused_at, provider_paused_until, provider_pause_reason")
      .maybeSingle(),
    supabase.rpc("messaging_queue_health", {}),
    supabase
      .from("messages")
      .select("id, company_id, campaign_id, error_code, sending_started_at")
      .eq("status", "needs_review")
      .order("sending_started_at")
      .limit(50),
  ]);
  const rows = review.data ?? [];
  const companyIds = [...new Set(rows.map((r) => r.company_id))];
  const campaignIds = [...new Set(rows.map((r) => r.campaign_id).filter((id): id is string => Boolean(id)))];
  const [companies, campaigns] = await Promise.all([
    companyIds.length
      ? supabase.from("companies").select("id, name").in("id", companyIds)
      : Promise.resolve({ data: [] }),
    campaignIds.length
      ? supabase.from("campaigns").select("id, name").in("id", campaignIds)
      : Promise.resolve({ data: [] }),
  ]);
  const companyName = new Map((companies.data ?? []).map((c) => [c.id, c.name]));
  const campaignName = new Map((campaigns.data ?? []).map((c) => [c.id, c.name]));
  const h = health.data?.[0];
  return {
    killSwitch: {
      paused: settings.data?.sending_paused ?? false,
      reason: settings.data?.sending_paused_reason ?? null,
      at: settings.data?.sending_paused_at ?? null,
    },
    breaker: {
      pausedUntil: settings.data?.provider_paused_until ?? null,
      reason: settings.data?.provider_pause_reason ?? null,
    },
    queue: {
      queued: h?.queued ?? 0,
      sending: h?.sending ?? 0,
      needsReview: h?.needs_review ?? 0,
      sent24h: h?.sent_24h ?? 0,
      failed24h: h?.failed_24h ?? 0,
      oldestQueuedAt: h?.oldest_queued_at ?? null,
    },
    review: rows.map((r) => ({
      id: r.id,
      companyName: companyName.get(r.company_id) ?? "",
      campaignName: r.campaign_id ? (campaignName.get(r.campaign_id) ?? null) : null,
      errorCode: r.error_code,
      at: r.sending_started_at,
    })),
  };
}
