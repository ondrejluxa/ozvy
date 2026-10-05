import "server-only";
import { healthFromAlerts, sortAlerts, type Alert, type Health } from "../domain/alerts/rules";
import {
  SENT_OR_LATER,
  delta,
  holdoutComparison,
  recoveredRevenue,
  type MonthlyKpis,
} from "../domain/attribution/kpis";
import { eligibilityReason, type ExclusionReason } from "../domain/contact-rules/audience";
import { daysBetween, fromDateOnly, monthKey, monthsBetween, shiftMonthKey, toDateOnly } from "../domain/dates";
import { formatPhone, normalizeSearch } from "../domain/phone";
import { PRESET_BY_KEY, isPresetKey, type PresetKey } from "../domain/segments/presets";
import { PRICE_PER_SEGMENT_MINOR } from "../providers/sms/mock";
import { companyIndex, type CompanyIndex } from "./company-index";
import { presetAudience } from "./derived";
import {
  campaignStats,
  companyAlerts,
  companyKpis,
  monthlySeries,
  opportunities,
  recentFailures,
  recommendedPreset,
  topOpportunities,
  type CampaignStats,
  type MonthPoint,
  type Opportunity,
} from "./stats";
import { getDb } from "./store";
import type {
  Campaign,
  CampaignStatus,
  Company,
  ConversionStage,
  LifecycleStatus,
  MessageStatus,
  ServiceCategory,
  Visit,
} from "./types";

/**
 * Read API used by server components. Every function takes the companyId
 * explicitly and resolves data through that company's index only.
 * Phase 1 keeps these signatures and reads from Supabase under RLS.
 */

function indexFor(companyId: string): CompanyIndex | null {
  return companyIndex(getDb(), companyId);
}

const customerName = (c: { first_name: string | null; last_name: string | null }) =>
  [c.first_name, c.last_name].filter(Boolean).join(" ") || "—";

// ---------- demo context ----------

export function getDemoContext() {
  const db = getDb();
  const now = new Date();
  const primaryId = db.primary_company_id;
  const index = primaryId ? indexFor(primaryId) : null;
  return {
    primaryCompanyId: primaryId,
    primaryCompanyName: index?.company.name ?? null,
    recommendedPreset: index ? recommendedPreset(index, now) : null,
    seededAt: db.seeded_at,
  };
}

export function getCompanyBasics(companyId: string) {
  const index = indexFor(companyId);
  if (!index) return null;
  return {
    company: index.company,
    planName: index.planName,
    subscriptionMinor: index.subscriptionPriceMinor,
    customers: index.customers.length,
    vehicles: index.vehicles.length,
  };
}

// ---------- admin overview & clients ----------

export interface ClientRow {
  company: Company;
  planName: string | null;
  mrrMinor: number;
  revenueThisMonthMinor: number;
  roi: number | null;
  lastCampaignAt: Date | null;
  openAlerts: number;
  health: Health;
  customers: number;
}

export interface AlertRow extends Alert {
  companyName: string;
  campaignName: string | null;
}

export function getAdminOverview() {
  const db = getDb();
  const now = new Date();
  const month = monthKey(now);
  const clients: ClientRow[] = [];
  const alerts: AlertRow[] = [];
  let messagesThisMonth = 0;
  let revenueThisMonth = 0;
  let activeCampaigns = 0;
  let failures7d = 0;

  for (const company of db.companies) {
    const index = indexFor(company.id)!;
    const kpis = companyKpis(index, month);
    const companyAlertList = companyAlerts(index, now);
    const lastCampaign = index.campaigns
      .map((c) => campaignStats(index, c.id).sentAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    clients.push({
      company,
      planName: index.planName,
      mrrMinor: index.subscriptionPriceMinor,
      revenueThisMonthMinor: kpis.recoveredRevenueMinor,
      roi: kpis.roi,
      lastCampaignAt: lastCampaign ?? null,
      openAlerts: companyAlertList.filter((a) => a.severity !== "info").length,
      health: healthFromAlerts(companyAlertList),
      customers: index.customers.length,
    });
    for (const a of companyAlertList) {
      alerts.push({
        ...a,
        companyName: company.name,
        campaignName: a.campaignId ? (index.campaignById.get(a.campaignId)?.name ?? null) : null,
      });
    }
    messagesThisMonth += kpis.messagesSent;
    revenueThisMonth += kpis.recoveredRevenueMinor;
    activeCampaigns += index.campaigns.filter((c) => ["scheduled", "sending", "active"].includes(c.status)).length;
    failures7d += recentFailures(index, now);
  }

  const healthOrder: Record<Health, number> = { red: 0, amber: 1, green: 2 };
  clients.sort((a, b) => healthOrder[a.health] - healthOrder[b.health] || b.mrrMinor - a.mrrMinor);

  return {
    now,
    kpis: {
      activeClients: db.companies.filter((c) => c.status === "active").length,
      mrrMinor: clients.reduce((s, c) => s + c.mrrMinor, 0),
      messagesThisMonth,
      revenueThisMonthMinor: revenueThisMonth,
      activeCampaigns,
      failures7d,
    },
    alerts: sortAlerts(alerts),
    clients,
  };
}

// ---------- company overview ----------

export interface OpportunityView {
  presetKey: PresetKey;
  eligible: number;
  matched: number;
  expectedRevenueMinor: number;
  maxPotentialMinor: number;
  avgJobValueMinor: number;
  unavailableReason: Opportunity["unavailableReason"];
  recentlyUsed: boolean;
  excludedTotal: number;
}

function toOpportunityView(o: Opportunity): OpportunityView {
  return {
    presetKey: o.presetKey,
    eligible: o.audience.eligible.length,
    matched: o.audience.matchedCustomers,
    expectedRevenueMinor: o.estimate.expectedRevenueMinor,
    maxPotentialMinor: o.estimate.maxPotentialMinor,
    avgJobValueMinor: o.avgJobValueMinor,
    unavailableReason: o.unavailableReason,
    recentlyUsed: o.recentlyUsed,
    excludedTotal: Object.values(o.audience.excluded).reduce((a, b) => a + b, 0),
  };
}

export function getCompanyOverview(companyId: string) {
  const index = indexFor(companyId);
  if (!index) return null;
  const now = new Date();
  const month = monthKey(now);
  const statusCounts = lifecycleCounts(index);
  return {
    now,
    company: index.company,
    planName: index.planName,
    subscriptionMinor: index.subscriptionPriceMinor,
    customers: index.customers.length,
    vehicles: index.vehicles.length,
    visits: index.visits.length,
    statusCounts,
    kpis: companyKpis(index, month),
    opportunities: topOpportunities(index, now).map(toOpportunityView),
    campaigns: campaignRows(index).slice(0, 5),
    alerts: sortAlerts(companyAlerts(index, now)),
  };
}

function lifecycleCounts(index: CompanyIndex): Record<LifecycleStatus, number> {
  const counts: Record<LifecycleStatus, number> = { active: 0, at_risk: 0, inactive: 0, reactivated: 0, opted_out: 0 };
  for (const c of index.customers) counts[c.lifecycle_status]++;
  return counts;
}

export function getSegmentsOverview(companyId: string) {
  const index = indexFor(companyId);
  if (!index) return null;
  const now = new Date();
  return {
    now,
    company: index.company,
    statusCounts: lifecycleCounts(index),
    totalCustomers: index.customers.length,
    presets: opportunities(index, now).map((o) => ({ ...toOpportunityView(o), excluded: o.audience.excluded })),
    recommended: recommendedPreset(index, now),
  };
}

// ---------- customers ----------

export type LastVisitBucket = "0-6" | "6-12" | "12-18" | "18+" | "none";

export interface CustomerFilters {
  q?: string;
  status?: LifecycleStatus;
  lastVisit?: LastVisitBucket;
  eligibility?: "eligible" | "ineligible";
  category?: ServiceCategory;
  page?: number;
}

export interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  vehicle: string | null;
  plate: string | null;
  extraVehicles: number;
  lastVisitAt: string | null;
  status: LifecycleStatus;
  lastContactedAt: string | null;
  eligible: boolean;
}

export const CUSTOMERS_PAGE_SIZE = 50;

export function listCustomers(companyId: string, filters: CustomerFilters) {
  const index = indexFor(companyId);
  if (!index) return null;
  const now = new Date();
  const q = filters.q ? normalizeSearch(filters.q) : "";

  const rows: (CustomerRow & { sortKey: string })[] = [];
  for (const c of index.customers) {
    const vehicles = index.vehiclesByCustomer.get(c.id) ?? [];
    if (filters.status && c.lifecycle_status !== filters.status) continue;
    if (filters.lastVisit) {
      const months = c.last_visit_at ? monthsBetween(fromDateOnly(c.last_visit_at), now) : null;
      const b = filters.lastVisit;
      const ok =
        b === "none"
          ? months === null
          : months !== null &&
            (b === "0-6"
              ? months < 6
              : b === "6-12"
                ? months >= 6 && months < 12
                : b === "12-18"
                  ? months >= 12 && months < 18
                  : months >= 18);
      if (!ok) continue;
    }
    if (
      filters.category &&
      !(index.visitsByCustomer.get(c.id) ?? []).some((v) => v.service_category === filters.category)
    ) {
      continue;
    }
    const eligible =
      eligibilityReason(
        c,
        index.suppressedCustomerIds.has(c.id),
        c.last_visit_at ? fromDateOnly(c.last_visit_at) : null,
        now,
        index.company.settings,
      ) === null;
    if (filters.eligibility === "eligible" && !eligible) continue;
    if (filters.eligibility === "ineligible" && eligible) continue;
    if (q) {
      const haystack = normalizeSearch(
        [customerName(c), c.phone_e164 ?? "", c.email ?? "", ...vehicles.map((v) => v.license_plate_norm ?? "")].join(
          " ",
        ),
      );
      if (!haystack.includes(q)) continue;
    }
    const enrollments = index.enrollmentsByCustomer.get(c.id) ?? [];
    const lastContacted = enrollments
      .map((e) => e.first_sent_at)
      .filter((d): d is string => !!d)
      .sort()
      .at(-1);
    const primary = vehicles[0];
    rows.push({
      id: c.id,
      name: customerName(c),
      phone: formatPhone(c.phone_e164),
      vehicle: primary ? [primary.brand, primary.model].filter(Boolean).join(" ") : null,
      plate: primary?.license_plate_display ?? null,
      extraVehicles: Math.max(0, vehicles.length - 1),
      lastVisitAt: c.last_visit_at,
      status: c.lifecycle_status,
      lastContactedAt: lastContacted ?? null,
      eligible,
      sortKey: `${c.last_name ?? ""} ${c.first_name ?? ""}`,
    });
  }
  rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey, "cs"));
  const page = Math.max(1, filters.page ?? 1);
  const pages = Math.max(1, Math.ceil(rows.length / CUSTOMERS_PAGE_SIZE));
  const slice: CustomerRow[] = rows.slice((page - 1) * CUSTOMERS_PAGE_SIZE, page * CUSTOMERS_PAGE_SIZE).map((r) => {
    const { sortKey, ...row } = r;
    void sortKey;
    return row;
  });
  return { company: index.company, total: rows.length, page: Math.min(page, pages), pages, rows: slice };
}

export interface EnrollmentView {
  id: string;
  campaignId: string;
  campaignName: string;
  campaignStatus: CampaignStatus;
  isHoldout: boolean;
  stage: ConversionStage;
  firstSentAt: string | null;
  windowEndsAt: string | null;
  windowOpen: boolean;
  messageStatus: MessageStatus | null;
  messageBody: string | null;
  revenueMinor: number | null;
  bookedAt: string | null;
  completedAt: string | null;
}

function enrollmentView(index: CompanyIndex, enrollmentId: string, now: Date): EnrollmentView | null {
  const e = index.enrollmentById.get(enrollmentId);
  if (!e) return null;
  const campaign = index.campaignById.get(e.campaign_id);
  const message = index.messageByEnrollment.get(e.id);
  const conversion = index.conversionByEnrollment.get(e.id);
  return {
    id: e.id,
    campaignId: e.campaign_id,
    campaignName: campaign?.name ?? "—",
    campaignStatus: campaign?.status ?? "draft",
    isHoldout: e.is_holdout,
    stage: e.stage,
    firstSentAt: e.first_sent_at,
    windowEndsAt: e.window_ends_at,
    windowOpen: !!e.window_ends_at && new Date(e.window_ends_at).getTime() > now.getTime(),
    messageStatus: message?.status ?? null,
    messageBody: message?.body_rendered ?? null,
    revenueMinor: conversion?.revenue_minor ?? null,
    bookedAt: conversion?.booked_at ?? null,
    completedAt: conversion?.completed_at ?? null,
  };
}

export function getCustomerDetail(companyId: string, customerId: string) {
  const index = indexFor(companyId);
  const customer = index?.customerById.get(customerId);
  if (!index || !customer) return null;
  const now = new Date();
  const suppressed = index.suppressedCustomerIds.has(customer.id);
  const reason: ExclusionReason | null = eligibilityReason(
    customer,
    suppressed,
    customer.last_visit_at ? fromDateOnly(customer.last_visit_at) : null,
    now,
    index.company.settings,
  );
  const visits = [...(index.visitsByCustomer.get(customer.id) ?? [])].reverse();
  const vehicles = (index.vehiclesByCustomer.get(customer.id) ?? []).map((v) => ({
    vehicle: v,
    visits: visits.filter((visit) => visit.vehicle_id === v.id),
  }));
  const looseVisits: Visit[] = visits.filter((v) => !v.vehicle_id);
  const enrollments = (index.enrollmentsByCustomer.get(customer.id) ?? [])
    .map((e) => enrollmentView(index, e.id, now)!)
    .sort((a, b) => (b.firstSentAt ?? b.windowEndsAt ?? "").localeCompare(a.firstSentAt ?? a.windowEndsAt ?? ""));
  return {
    now,
    company: index.company,
    customer,
    name: customerName(customer),
    phone: formatPhone(customer.phone_e164),
    suppressed,
    eligibilityReason: reason,
    vehicles,
    looseVisits,
    enrollments,
  };
}

// ---------- campaigns ----------

export interface CampaignRow {
  campaign: Campaign;
  companyName: string;
  stats: CampaignStats;
  windowProgress: number;
}

function campaignRows(index: CompanyIndex): CampaignRow[] {
  const now = new Date();
  return index.campaigns
    .map((campaign) => {
      const stats = campaignStats(index, campaign.id);
      const progress = stats.sentAt
        ? Math.min(1, Math.max(0, daysBetween(stats.sentAt, now) / campaign.attribution_window_days))
        : 0;
      return { campaign, companyName: index.company.name, stats, windowProgress: progress };
    })
    .sort((a, b) =>
      (b.campaign.scheduled_at ?? b.campaign.created_at).localeCompare(
        a.campaign.scheduled_at ?? a.campaign.created_at,
      ),
    );
}

export function listCampaigns(companyId: string) {
  const index = indexFor(companyId);
  if (!index) return null;
  return { company: index.company, rows: campaignRows(index) };
}

export function listAllCampaigns() {
  const db = getDb();
  return db.companies
    .flatMap((c) => campaignRows(indexFor(c.id)!))
    .sort((a, b) =>
      (b.campaign.scheduled_at ?? b.campaign.created_at).localeCompare(
        a.campaign.scheduled_at ?? a.campaign.created_at,
      ),
    );
}

export type RecipientFilter = "all" | "booked" | "completed" | "holdout" | "failed";
export const RECIPIENTS_PAGE_SIZE = 25;

export function getCampaignDetail(
  companyId: string,
  campaignId: string,
  opts: { filter?: RecipientFilter; q?: string; page?: number } = {},
) {
  const index = indexFor(companyId);
  const campaign = index?.campaignById.get(campaignId);
  if (!index || !campaign) return null;
  const now = new Date();
  const stats = campaignStats(index, campaign.id);
  const step = (index.stepsByCampaign.get(campaign.id) ?? []).find((s) => s.step_number === 0) ?? null;
  const filter = opts.filter ?? "all";
  const q = opts.q ? normalizeSearch(opts.q) : "";

  const all = (index.enrollmentsByCampaign.get(campaign.id) ?? []).map((e) => {
    const customer = index.customerById.get(e.customer_id)!;
    const vehicle = e.vehicle_id ? index.vehicleById.get(e.vehicle_id) : undefined;
    return {
      ...enrollmentView(index, e.id, now)!,
      customerId: customer.id,
      customerName: customerName(customer),
      phone: formatPhone(customer.phone_e164),
      vehicle: vehicle ? [vehicle.brand, vehicle.model].filter(Boolean).join(" ") : null,
      plate: vehicle?.license_plate_display ?? null,
    };
  });
  const stageOrder: Record<ConversionStage, number> = {
    completed: 0,
    booked: 1,
    replied: 2,
    contacted: 3,
    lost: 4,
    opted_out: 5,
  };
  const filtered = all
    .filter((r) => {
      if (filter === "booked") return !r.isHoldout && r.stage === "booked";
      if (filter === "completed") return !r.isHoldout && r.stage === "completed";
      if (filter === "holdout") return r.isHoldout;
      if (filter === "failed") return r.messageStatus === "failed" || r.messageStatus === "undelivered";
      return true;
    })
    .filter((r) => !q || normalizeSearch(`${r.customerName} ${r.plate ?? ""} ${r.phone}`).includes(q))
    .sort(
      (a, b) =>
        Number(a.isHoldout) - Number(b.isHoldout) ||
        stageOrder[a.stage] - stageOrder[b.stage] ||
        a.customerName.localeCompare(b.customerName, "cs"),
    );
  const page = Math.max(1, opts.page ?? 1);
  const pages = Math.max(1, Math.ceil(filtered.length / RECIPIENTS_PAGE_SIZE));

  const counts = {
    all: all.length,
    booked: all.filter((r) => !r.isHoldout && r.stage === "booked").length,
    completed: all.filter((r) => !r.isHoldout && r.stage === "completed").length,
    holdout: all.filter((r) => r.isHoldout).length,
    failed: all.filter((r) => r.messageStatus === "failed" || r.messageStatus === "undelivered").length,
  };

  return {
    now,
    company: index.company,
    campaign,
    step,
    stats,
    sampleMessage:
      (index.messagesByCampaign.get(campaign.id) ?? []).find((m) => m.status === "delivered")?.body_rendered ?? null,
    holdout: holdoutComparison({
      treatedCount: stats.sent,
      treatedCompleted: stats.completed,
      treatedRevenueMinor: stats.revenueMinor,
      holdoutCount: stats.holdout,
      holdoutCompleted: stats.holdoutCompleted,
    }),
    expectedRevenueMinor: Math.round(
      stats.treated *
        campaign.expected_conversion_rate *
        (campaign.avg_job_value_minor_snapshot ?? index.company.average_job_value_minor),
    ),
    recipients: filtered.slice((page - 1) * RECIPIENTS_PAGE_SIZE, page * RECIPIENTS_PAGE_SIZE),
    recipientTotal: filtered.length,
    page: Math.min(page, pages),
    pages,
    filter,
    counts,
  };
}

// ---------- campaign builder ----------

export interface BuilderRecipient {
  enrollmentKey: string;
  firstName: string | null;
  lastName: string | null;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  lastVisitAt: string | null;
  plate: string | null;
}

export function getBuilderData(companyId: string, presetParam: string | undefined) {
  const index = indexFor(companyId);
  if (!index) return null;
  const now = new Date();
  const all = opportunities(index, now);
  const recommended = recommendedPreset(index, now);
  const presetKey: PresetKey = isPresetKey(presetParam) ? presetParam : (recommended ?? "no_visit_12m");
  const selected = all.find((o) => o.presetKey === presetKey) ?? presetAudience(index, presetKey, now);

  const recipients: BuilderRecipient[] = selected.audience.eligible.map((m) => {
    const c = index.customerById.get(m.customerId)!;
    const v = m.vehicleId ? index.vehicleById.get(m.vehicleId) : undefined;
    return {
      enrollmentKey: `${m.customerId}:${m.vehicleId ?? "-"}`,
      firstName: c.first_name,
      lastName: c.last_name,
      vehicleBrand: v?.brand ?? null,
      vehicleModel: v?.model ?? null,
      lastVisitAt: m.lastVisitAt ? toDateOnly(m.lastVisitAt) : null,
      plate: v?.license_plate_display ?? null,
    };
  });

  return {
    now,
    company: index.company,
    shop: { shopName: index.company.settings.message_shop_name ?? index.company.name, phone: index.company.phone },
    presets: all.map(toOpportunityView),
    recommended,
    presetKey,
    selected: {
      ...toOpportunityView({
        ...selected,
        recentlyUsed: all.find((o) => o.presetKey === presetKey)?.recentlyUsed ?? false,
      }),
      excluded: selected.audience.excluded,
    },
    recipients,
    holdoutPct: index.company.settings.holdout_pct,
    conversionRate: index.company.settings.expected_conversion_rate,
    pricePerSegmentMinor: PRICE_PER_SEGMENT_MINOR,
  };
}

// ---------- client dashboard & results ----------

export interface RecentReturn {
  conversionId: string;
  customerId: string;
  name: string;
  vehicle: string | null;
  revenueMinor: number;
  campaignName: string;
  completedAt: string;
}

export function getClientDashboard(companyId: string) {
  const index = indexFor(companyId);
  if (!index) return null;
  const now = new Date();
  const month = monthKey(now);
  const kpis: MonthlyKpis = companyKpis(index, month);
  const previous = companyKpis(index, shiftMonthKey(month, -1));
  const series: MonthPoint[] = monthlySeries(index, now);

  const recent: RecentReturn[] = index.conversions
    .filter((c) => c.stage === "completed" && !c.is_holdout && c.completed_at && c.revenue_minor !== null)
    .sort((a, b) => b.completed_at!.localeCompare(a.completed_at!))
    .slice(0, 5)
    .map((c) => {
      const customer = index.customerById.get(c.customer_id)!;
      const vehicle = c.vehicle_id ? index.vehicleById.get(c.vehicle_id) : undefined;
      return {
        conversionId: c.id,
        customerId: customer.id,
        name: customerName(customer),
        vehicle: vehicle ? [vehicle.brand, vehicle.model].filter(Boolean).join(" ") : null,
        revenueMinor: c.revenue_minor!,
        campaignName: index.campaignById.get(c.campaign_id)?.name ?? "—",
        completedAt: c.completed_at!,
      };
    });

  const current = campaignRows(index)
    .filter((r) => ["waiting_for_approval", "scheduled", "sending", "active"].includes(r.campaign.status))
    .slice(0, 3);

  return {
    now,
    company: index.company,
    kpis,
    deltaVsPrevious: delta(kpis.recoveredRevenueMinor, previous.recoveredRevenueMinor),
    totalSinceStartMinor: recoveredRevenue(index.conversions),
    series,
    currentCampaigns: current,
    recent,
    opportunities: topOpportunities(index, now).map(toOpportunityView),
  };
}

export function getResults(companyId: string) {
  const index = indexFor(companyId);
  if (!index) return null;
  const now = new Date();
  const rows = campaignRows(index).filter((r) => r.stats.sentAt);
  const bySegment = new Map<
    string,
    { presetKey: string; campaigns: number; sent: number; completed: number; revenueMinor: number }
  >();
  for (const r of rows) {
    const key = r.campaign.segment_preset ?? "custom";
    const agg = bySegment.get(key) ?? { presetKey: key, campaigns: 0, sent: 0, completed: 0, revenueMinor: 0 };
    agg.campaigns++;
    agg.sent += r.stats.sent;
    agg.completed += r.stats.completed;
    agg.revenueMinor += r.stats.revenueMinor;
    bySegment.set(key, agg);
  }
  const pooled = rows.reduce(
    (acc, r) => ({
      treatedCount: acc.treatedCount + r.stats.sent,
      treatedCompleted: acc.treatedCompleted + r.stats.completed,
      treatedRevenueMinor: acc.treatedRevenueMinor + r.stats.revenueMinor,
      holdoutCount: acc.holdoutCount + r.stats.holdout,
      holdoutCompleted: acc.holdoutCompleted + r.stats.holdoutCompleted,
    }),
    { treatedCount: 0, treatedCompleted: 0, treatedRevenueMinor: 0, holdoutCount: 0, holdoutCompleted: 0 },
  );
  return {
    now,
    company: index.company,
    series: monthlySeries(index, now).reverse(),
    campaigns: rows,
    segments: [...bySegment.values()].sort((a, b) => b.revenueMinor - a.revenueMinor),
    holdout: { ...holdoutComparison(pooled), ...pooled },
    totalSinceStartMinor: recoveredRevenue(index.conversions),
    smsCostMinor: index.messages
      .filter((m) => SENT_OR_LATER.includes(m.status))
      .reduce((s, m) => s + (m.cost_minor ?? 0), 0),
  };
}

export function presetValueCategories(key: string): ServiceCategory[] {
  return isPresetKey(key) ? PRESET_BY_KEY[key].valueCategories : ["regular_service"];
}
