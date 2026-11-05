import "server-only";
import {
  healthFromAlerts,
  sortAlerts,
  type AlertSeverity,
  type AlertType,
  type Health,
} from "../../domain/alerts/rules";
import { delta, holdoutComparison, roi, type HoldoutComparison } from "../../domain/attribution/kpis";
import { estimateCampaign } from "../../domain/campaigns/estimates";
import { resolveCompanySettings } from "../../domain/company-settings";
import { pragueParts, pragueTime } from "../../domain/dates";
import { PRESET_BY_KEY, type PresetKey } from "../../domain/segments/presets";
import type { AlertRow, OpportunityView } from "../queries";
import { segmentJobValue } from "./campaigns";
import { presetsOverview } from "./segments";
import { createSupabaseServerClient } from "./server-client";

/**
 * Dashboards on real data (spec §9, §10). Monthly figures come from
 * company_monthly_stats (rebuilt from raw rows); lists come straight from
 * conversions and campaign_summaries. Holdout returns never count.
 */

/** "2026-11" for the month of `now` shifted by `offset`, Prague calendar. */
export function monthKeyOf(now: Date, offset = 0): string {
  const p = pragueParts(now);
  const q = pragueParts(pragueTime(p.year, p.month + offset, 1, 12));
  return `${q.year}-${String(q.month).padStart(2, "0")}`;
}

export interface MonthPoint {
  month: string;
  revenueMinor: number;
  completed: number;
  bookings: number;
  messagesSent: number;
  smsCostMinor: number;
  subscriptionMinor: number;
  roi: number | null;
}

type StatsRow = {
  month: string;
  recovered_revenue_minor: number;
  completed_count: number;
  booked_count: number;
  messages_sent: number;
  sms_cost_minor: number;
  holdout_stats: unknown;
};

/** The last 12 months, oldest first, zero-filled. */
function series(rows: StatsRow[], now: Date, subscriptionMinor: number, months = 12): MonthPoint[] {
  const byMonth = new Map(rows.map((r) => [r.month.slice(0, 7), r]));
  return Array.from({ length: months }, (_, i) => {
    const month = monthKeyOf(now, i - months + 1);
    const r = byMonth.get(month);
    const revenue = Number(r?.recovered_revenue_minor ?? 0);
    return {
      month,
      revenueMinor: revenue,
      completed: r?.completed_count ?? 0,
      bookings: r?.booked_count ?? 0,
      messagesSent: r?.messages_sent ?? 0,
      smsCostMinor: Number(r?.sms_cost_minor ?? 0),
      subscriptionMinor,
      roi: roi(revenue, subscriptionMinor),
    };
  });
}

async function loadStats(companyId: string): Promise<StatsRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("company_monthly_stats")
    .select(
      "month, recovered_revenue_minor, completed_count, booked_count, messages_sent, sms_cost_minor, holdout_stats",
    )
    .eq("company_id", companyId)
    .order("month");
  if (error) throw new Error(`monthly stats failed: ${error.code}`);
  return (data ?? []) as StatsRow[];
}

export interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  segmentPreset: string | null;
  startedAt: string | null;
  scheduledAt: string | null;
  windowDays: number;
  contacted: number;
  holdout: number;
  booked: number;
  completed: number;
  holdoutCompleted: number;
  revenueMinor: number;
  smsCostMinor: number;
}

export async function campaignSummaries(companyId: string): Promise<CampaignSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("campaign_summaries", { p_company_id: companyId });
  if (error) throw new Error(`campaign summaries failed: ${error.code}`);
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    segmentPreset: c.segment_preset,
    startedAt: c.started_at,
    scheduledAt: c.scheduled_at,
    windowDays: c.attribution_window_days,
    contacted: c.contacted,
    holdout: c.holdout,
    booked: c.booked,
    completed: c.completed,
    holdoutCompleted: c.holdout_completed,
    revenueMinor: Number(c.revenue_minor),
    smsCostMinor: Number(c.sms_cost_minor),
  }));
}

// ---------- client Přehled ----------

export interface RealClientDashboard {
  companyName: string;
  subscriptionMinor: number;
  conversionRate: number;
  current: MonthPoint;
  reactivatedCustomers: number;
  deltaVsPrevious: number | null;
  totalSinceStartMinor: number;
  series: MonthPoint[];
  campaigns: (CampaignSummary & { windowProgress: number })[];
  recent: {
    id: string;
    customerId: string;
    name: string;
    vehicle: string | null;
    campaignName: string;
    completedAt: string;
    revenueMinor: number;
  }[];
  opportunities: OpportunityView[];
}

export async function getRealClientDashboard(companyId: string, now = new Date()): Promise<RealClientDashboard | null> {
  const supabase = await createSupabaseServerClient();
  const { data: company } = await supabase
    .from("companies")
    .select("name, subscription_price_minor, settings, average_job_value_minor")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) return null;
  const settings = resolveCompanySettings(company.settings);
  const subscription = Number(company.subscription_price_minor);
  const [year, monthNo] = monthKeyOf(now).split("-").map(Number);
  const monthStart = pragueTime(year, monthNo, 1, 0, 0);

  const [stats, summaries, recent, reactivated, opportunities] = await Promise.all([
    loadStats(companyId),
    campaignSummaries(companyId),
    supabase
      .from("conversions")
      .select(
        "id, customer_id, completed_at, revenue_minor, customers(first_name, last_name), vehicles(brand, model), campaigns(name)",
      )
      .eq("company_id", companyId)
      .eq("stage", "completed")
      .eq("is_holdout", false)
      .order("completed_at", { ascending: false })
      .limit(5),
    supabase
      .from("conversions")
      .select("customer_id")
      .eq("company_id", companyId)
      .eq("stage", "completed")
      .eq("is_holdout", false)
      .gte("completed_at", monthStart.toISOString()),
    topOpportunities(companyId, settings, Number(company.average_job_value_minor), now),
  ]);
  const months = series(stats, now, subscription);
  const current = months[months.length - 1];
  const previous = months[months.length - 2];
  const running = summaries.filter((c) => ["scheduled", "sending", "active", "paused"].includes(c.status)).slice(0, 3);

  return {
    companyName: company.name,
    subscriptionMinor: subscription,
    conversionRate: settings.expected_conversion_rate,
    current,
    reactivatedCustomers: new Set((reactivated.data ?? []).map((c) => c.customer_id)).size,
    deltaVsPrevious: delta(current.revenueMinor, previous.revenueMinor),
    totalSinceStartMinor: stats.reduce((sum, r) => sum + Number(r.recovered_revenue_minor), 0),
    series: months,
    campaigns: running.map((c) => ({
      ...c,
      windowProgress: c.startedAt
        ? Math.min(1, (now.getTime() - new Date(c.startedAt).getTime()) / (c.windowDays * 86_400_000))
        : 0,
    })),
    recent: (recent.data ?? []).map((r) => {
      const customer = r.customers as { first_name: string | null; last_name: string | null } | null;
      const vehicle = r.vehicles as { brand: string | null; model: string | null } | null;
      return {
        id: r.id,
        customerId: r.customer_id,
        name: [customer?.first_name, customer?.last_name].filter(Boolean).join(" "),
        vehicle: vehicle?.brand ? [vehicle.brand, vehicle.model].filter(Boolean).join(" ") : null,
        campaignName: (r.campaigns as { name: string } | null)?.name ?? "",
        completedAt: r.completed_at!,
        revenueMinor: Number(r.revenue_minor),
      };
    }),
    opportunities,
  };
}

/** Up to three presets with the highest expected revenue now (spec §9 "Příležitosti"). */
async function topOpportunities(
  companyId: string,
  settings: ReturnType<typeof resolveCompanySettings>,
  averageJobValueMinor: number,
  now: Date,
): Promise<OpportunityView[]> {
  const presets = (await presetsOverview(companyId, now)).filter((p) => p.counts && p.counts.eligible > 0);
  const views = await Promise.all(
    presets.map(async (p) => {
      const avg = await segmentJobValue(companyId, PRESET_BY_KEY[p.key].valueCategories, averageJobValueMinor);
      const est = estimateCampaign({
        eligible: p.counts!.eligible,
        holdoutPct: settings.holdout_pct,
        conversionRate: settings.expected_conversion_rate,
        avgJobValueMinor: avg,
      });
      return {
        presetKey: p.key as PresetKey,
        eligible: p.counts!.eligible,
        matched: p.counts!.matched,
        expectedRevenueMinor: est.expectedRevenueMinor,
        maxPotentialMinor: est.maxPotentialMinor,
        avgJobValueMinor: avg,
        unavailableReason: null,
        recentlyUsed: false,
        excludedTotal: Object.values(p.counts!.excluded).reduce((a, b) => a + (b ?? 0), 0),
      } satisfies OpportunityView;
    }),
  );
  return views.sort((a, b) => b.expectedRevenueMinor - a.expectedRevenueMinor).slice(0, 3);
}

// ---------- client Výsledky ----------

export interface RealResults {
  series: MonthPoint[];
  campaigns: CampaignSummary[];
  segments: { presetKey: string; campaigns: number; sent: number; completed: number; revenueMinor: number }[];
  holdout: HoldoutComparison & { holdoutCount: number; treatedCount: number };
  totalSinceStartMinor: number;
  smsCostMinor: number;
}

export async function getRealResults(companyId: string, now = new Date()): Promise<RealResults | null> {
  const supabase = await createSupabaseServerClient();
  const { data: company } = await supabase
    .from("companies")
    .select("subscription_price_minor")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) return null;
  const [stats, summaries] = await Promise.all([loadStats(companyId), campaignSummaries(companyId)]);
  const started = summaries.filter((c) => c.startedAt);
  const bySegment = new Map<string, RealResults["segments"][number]>();
  for (const c of started) {
    const key = c.segmentPreset ?? "custom";
    const agg = bySegment.get(key) ?? { presetKey: key, campaigns: 0, sent: 0, completed: 0, revenueMinor: 0 };
    agg.campaigns++;
    agg.sent += c.contacted;
    agg.completed += c.completed;
    agg.revenueMinor += c.revenueMinor;
    bySegment.set(key, agg);
  }
  // Pooled holdout comparison across the shop's campaigns (spec §14).
  const pooled = started.reduce(
    (acc, c) => ({
      treatedCount: acc.treatedCount + c.contacted,
      treatedCompleted: acc.treatedCompleted + c.completed,
      treatedRevenueMinor: acc.treatedRevenueMinor + c.revenueMinor,
      holdoutCount: acc.holdoutCount + c.holdout,
      holdoutCompleted: acc.holdoutCompleted + c.holdoutCompleted,
    }),
    { treatedCount: 0, treatedCompleted: 0, treatedRevenueMinor: 0, holdoutCount: 0, holdoutCompleted: 0 },
  );
  return {
    series: series(stats, now, Number(company.subscription_price_minor)).reverse(),
    campaigns: started,
    segments: [...bySegment.values()].sort((a, b) => b.revenueMinor - a.revenueMinor),
    holdout: { ...holdoutComparison(pooled), holdoutCount: pooled.holdoutCount, treatedCount: pooled.treatedCount },
    totalSinceStartMinor: stats.reduce((sum, r) => sum + Number(r.recovered_revenue_minor), 0),
    smsCostMinor: started.reduce((sum, c) => sum + c.smsCostMinor, 0),
  };
}

// ---------- admin overview ----------

export interface RealClientRow {
  id: string;
  name: string;
  city: string | null;
  status: string;
  mrrMinor: number;
  revenueThisMonthMinor: number;
  roi: number | null;
  lastCampaignAt: string | null;
  openAlerts: number;
  health: Health;
}

export interface RealAdminOverview {
  kpis: {
    activeClients: number;
    mrrMinor: number;
    messagesThisMonth: number;
    revenueThisMonthMinor: number;
    activeCampaigns: number;
    failures7d: number;
  };
  alerts: AlertRow[];
  lastCheckAt: string | null;
  clients: RealClientRow[];
}

const HEALTH_ORDER: Health[] = ["red", "amber", "green"];

export async function getRealAdminOverview(now = new Date()): Promise<RealAdminOverview> {
  const supabase = await createSupabaseServerClient();
  const month = `${monthKeyOf(now)}-01`;
  const [companies, stats, campaigns, failures, alerts, settings] = await Promise.all([
    supabase.from("companies").select("id, name, city, status, subscription_price_minor").order("name"),
    supabase
      .from("company_monthly_stats")
      .select("company_id, recovered_revenue_minor, messages_sent")
      .eq("month", month),
    supabase.from("campaigns").select("id, name, company_id, status, started_at").neq("status", "draft"),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .in("status", ["failed", "undelivered"])
      .gte("updated_at", new Date(now.getTime() - 7 * 86_400_000).toISOString()),
    supabase
      .from("alerts")
      .select("id, company_id, type, severity, dedupe_key, detail, created_at")
      .neq("status", "resolved"),
    supabase.from("platform_settings").select("last_health_check_at").maybeSingle(),
  ]);
  const companyRows = companies.data ?? [];
  const companyName = new Map(companyRows.map((c) => [c.id, c.name]));
  const campaignName = new Map((campaigns.data ?? []).map((c) => [c.id, c.name]));
  const statsBy = new Map((stats.data ?? []).map((s) => [s.company_id, s]));

  const alertRows: AlertRow[] = sortAlerts(
    (alerts.data ?? []).map((a) => {
      const detail = (a.detail ?? {}) as {
        params?: Record<string, number | string>;
        campaignId?: string;
        presetKey?: string;
        since?: string;
      };
      return {
        key: a.dedupe_key,
        type: a.type as AlertType,
        severity: a.severity as AlertSeverity,
        companyId: a.company_id ?? "",
        createdAt: new Date(detail.since ?? a.created_at),
        campaignId: detail.campaignId ?? undefined,
        presetKey: detail.presetKey ?? undefined,
        params: detail.params ?? {},
        companyName: companyName.get(a.company_id ?? "") ?? "",
        campaignName: detail.campaignId ? (campaignName.get(detail.campaignId) ?? null) : null,
      };
    }),
  );

  const active = companyRows.filter((c) => c.status === "active");
  const clients: RealClientRow[] = companyRows
    .filter((c) => c.status !== "closed")
    .map((c) => {
      const own = alertRows.filter((a) => a.companyId === c.id);
      const revenue = Number(statsBy.get(c.id)?.recovered_revenue_minor ?? 0);
      const mrr = c.status === "active" ? Number(c.subscription_price_minor) : 0;
      const last = (campaigns.data ?? [])
        .filter((x) => x.company_id === c.id && x.started_at)
        .map((x) => x.started_at!)
        .sort()
        .pop();
      return {
        id: c.id,
        name: c.name,
        city: c.city,
        status: c.status,
        mrrMinor: mrr,
        revenueThisMonthMinor: revenue,
        roi: roi(revenue, Number(c.subscription_price_minor)),
        lastCampaignAt: last ?? null,
        openAlerts: own.length,
        health: healthFromAlerts(own),
      };
    })
    .sort(
      (a, b) => HEALTH_ORDER.indexOf(a.health) - HEALTH_ORDER.indexOf(b.health) || a.name.localeCompare(b.name, "cs"),
    );

  return {
    kpis: {
      activeClients: active.length,
      mrrMinor: active.reduce((sum, c) => sum + Number(c.subscription_price_minor), 0),
      messagesThisMonth: (stats.data ?? []).reduce((sum, s) => sum + s.messages_sent, 0),
      revenueThisMonthMinor: (stats.data ?? []).reduce((sum, s) => sum + Number(s.recovered_revenue_minor), 0),
      activeCampaigns: (campaigns.data ?? []).filter((c) => ["sending", "active"].includes(c.status)).length,
      failures7d: failures.count ?? 0,
    },
    alerts: alertRows,
    lastCheckAt: settings.data?.last_health_check_at ?? null,
    clients,
  };
}
