import { evaluateAlerts, type Alert } from "../domain/alerts/rules";
import { SENT_OR_LATER, monthlyKpis, recoveredRevenue, roi, type MonthlyKpis } from "../domain/attribution/kpis";
import { addDays, daysBetween, lastMonthKeys, monthKey, shiftMonthKey } from "../domain/dates";
import { PRESETS, type PresetKey } from "../domain/segments/presets";
import { buildUnits, type CompanyIndex } from "./company-index";
import { contactHistory, presetAudience, type PresetAudience } from "./derived";
import type { Campaign } from "./types";

/**
 * Aggregations shared by pages, alerts and tests. Phase 1 serves the
 * monthly figures from company_monthly_stats; the formulas stay here.
 */

export interface CampaignStats {
  enrolled: number;
  holdout: number;
  treated: number;
  queued: number;
  sent: number;
  delivered: number;
  failed: number;
  booked: number;
  completed: number;
  revenueMinor: number;
  holdoutCompleted: number;
  segments: number;
  costMinor: number;
  sentAt: Date | null;
}

export function campaignStats(index: CompanyIndex, campaignId: string): CampaignStats {
  const enrollments = index.enrollmentsByCampaign.get(campaignId) ?? [];
  const messages = index.messagesByCampaign.get(campaignId) ?? [];
  const conversions = enrollments.map((e) => index.conversionByEnrollment.get(e.id)).filter((c) => c !== undefined);
  const treatedConversions = conversions.filter((c) => !c.is_holdout);
  const sentMessages = messages.filter((m) => SENT_OR_LATER.includes(m.status));
  const firstSent = sentMessages.reduce<string | null>(
    (min, m) => (m.sent_at && (!min || m.sent_at < min) ? m.sent_at : min),
    null,
  );
  return {
    enrolled: enrollments.length,
    holdout: enrollments.filter((e) => e.is_holdout).length,
    treated: enrollments.filter((e) => !e.is_holdout).length,
    queued: messages.filter((m) => m.status === "queued" || m.status === "sending").length,
    sent: sentMessages.length,
    delivered: messages.filter((m) => m.status === "delivered").length,
    failed: messages.filter((m) => m.status === "failed").length,
    booked: treatedConversions.filter((c) => c.stage === "booked" || c.stage === "completed").length,
    completed: treatedConversions.filter((c) => c.stage === "completed").length,
    revenueMinor: recoveredRevenue(treatedConversions),
    holdoutCompleted: conversions.filter((c) => c.is_holdout && c.stage === "completed").length,
    segments: sentMessages.reduce((sum, m) => sum + m.segments, 0),
    costMinor: messages.reduce((sum, m) => sum + (m.cost_minor ?? 0), 0),
    sentAt: firstSent ? new Date(firstSent) : null,
  };
}

export function companyKpis(index: CompanyIndex, month: string): MonthlyKpis {
  return monthlyKpis(index.conversions, index.messages, month, subscriptionForMonth(index, month));
}

/** Subscription price for a month, or 0 before the subscription started. */
export function subscriptionForMonth(index: CompanyIndex, month: string): number {
  if (!index.subscriptionStart) return 0;
  return monthKey(index.subscriptionStart + "T12:00:00Z") <= month ? index.subscriptionPriceMinor : 0;
}

export interface MonthPoint {
  month: string;
  revenueMinor: number;
  subscriptionMinor: number;
  completed: number;
  bookings: number;
  messagesSent: number;
  roi: number | null;
}

export function monthlySeries(index: CompanyIndex, now: Date, months = 12): MonthPoint[] {
  return lastMonthKeys(now, months).map((month) => {
    const k = companyKpis(index, month);
    return {
      month,
      revenueMinor: k.recoveredRevenueMinor,
      subscriptionMinor: k.subscriptionMinor,
      completed: k.reactivatedCustomers,
      bookings: k.bookings,
      messagesSent: k.messagesSent,
      roi: k.roi,
    };
  });
}

// ---------- opportunities ----------

export interface Opportunity extends PresetAudience {
  /** A campaign with this preset ran (or is planned) in the last 90 days. */
  recentlyUsed: boolean;
}

const opportunityCache = new WeakMap<CompanyIndex, { at: number; value: Opportunity[] }>();

/** All presets with their audiences; ranked so the first available one is the recommendation. */
export function opportunities(index: CompanyIndex, now: Date): Opportunity[] {
  const hit = opportunityCache.get(index);
  if (hit && now.getTime() - hit.at < 60_000) return hit.value;

  const units = buildUnits(index, now);
  const history = contactHistory(index);
  const recentPresets = new Set(
    index.campaigns
      .filter((c) => c.status !== "cancelled" && daysBetween(campaignAnchor(c), now) < 90)
      .map((c) => c.segment_preset),
  );
  const list: Opportunity[] = PRESETS.map((p) => ({
    ...presetAudience(index, p.key, now, { units, history }),
    recentlyUsed: recentPresets.has(p.key),
  }));
  list.sort((a, b) => rank(b) - rank(a) || b.estimate.expectedRevenueMinor - a.estimate.expectedRevenueMinor);
  opportunityCache.set(index, { at: now.getTime(), value: list });
  return list;
}

function campaignAnchor(c: Campaign): Date {
  return new Date(c.scheduled_at ?? c.created_at);
}

function rank(o: Opportunity): number {
  if (o.unavailableReason || o.audience.eligible.length < 20) return 0;
  return o.recentlyUsed ? 1 : 2;
}

export function isRecommendable(o: Opportunity): boolean {
  return rank(o) === 2;
}

export function topOpportunities(index: CompanyIndex, now: Date, count = 3): Opportunity[] {
  return opportunities(index, now).filter(isRecommendable).slice(0, count);
}

export function recommendedPreset(index: CompanyIndex, now: Date): PresetKey | null {
  return topOpportunities(index, now, 1)[0]?.presetKey ?? null;
}

// ---------- alerts ----------

export function companyAlerts(index: CompanyIndex, now: Date): Alert[] {
  const finished = index.messages
    .filter((m) => m.status === "delivered" || m.status === "undelivered")
    .sort((a, b) => (b.sent_at ?? "").localeCompare(a.sent_at ?? ""))
    .slice(0, 200);
  const lastSent = index.messages.reduce<string | null>(
    (max, m) => (m.sent_at && (!max || m.sent_at > max) ? m.sent_at : max),
    null,
  );
  const current = monthKey(now);
  const roiFor = (month: string) => {
    const sub = subscriptionForMonth(index, month);
    return sub > 0 ? roi(recoveredRevenue(index.conversions, month), sub) : null;
  };
  const top = topOpportunities(index, now, 1)[0];

  return evaluateAlerts({
    companyId: index.company.id,
    companyStatus: index.company.status,
    companyCreatedAt: new Date(index.company.created_at),
    campaigns: index.campaigns.map((c) => {
      const s = campaignStats(index, c.id);
      return {
        id: c.id,
        status: c.status,
        createdAt: new Date(c.created_at),
        sentAt: s.sentAt,
        sentCount: s.sent,
        failedCount: s.failed,
        completedConversions: s.completed,
      };
    }),
    lastSendAt: lastSent ? new Date(lastSent) : null,
    recentDeliveryRate:
      finished.length >= 50 ? finished.filter((m) => m.status === "delivered").length / finished.length : null,
    roiPreviousMonths: [roiFor(shiftMonthKey(current, -1)), roiFor(shiftMonthKey(current, -2))],
    topOpportunity: top
      ? {
          presetKey: top.presetKey,
          expectedRevenueMinor: top.estimate.expectedRevenueMinor,
          eligible: top.audience.eligible.length,
        }
      : null,
    now,
  });
}

/** Messages that failed in the last 7 days (admin KPI "Selhání"). */
export function recentFailures(index: CompanyIndex, now: Date): number {
  const from = addDays(now, -7).getTime();
  return index.messages.filter((m) => m.status === "failed" && m.failed_at && new Date(m.failed_at).getTime() >= from)
    .length;
}
