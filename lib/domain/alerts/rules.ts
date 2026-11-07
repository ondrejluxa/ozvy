import { addDays, daysBetween } from "../dates";

/**
 * Attention Required rules (spec §10). Phase 0 evaluates them on page load
 * from current data; Phase 1 runs the same functions in a scheduled health
 * check that writes the alerts table with a dedupe key per issue.
 */

export type AlertSeverity = "critical" | "high" | "medium" | "low" | "info";
export type AlertType =
  | "campaign_failed"
  | "sms_failure_rate"
  | "import_needs_review"
  | "import_stuck"
  | "dsr_due"
  | "provider_paused"
  | "awaiting_approval"
  | "no_campaign_running"
  | "low_conversion"
  | "roi_below_1"
  | "large_opportunity";

export const SEVERITY_ORDER: AlertSeverity[] = ["critical", "high", "medium", "low", "info"];

export interface AlertCampaignInput {
  id: string;
  status: string;
  createdAt: Date;
  sentAt: Date | null;
  sentCount: number;
  failedCount: number;
  completedConversions: number;
}

export interface AlertImportInput {
  id: string;
  status: string;
  updatedAt: Date;
  rows: number;
  invalid: number;
}

export interface AlertDsrInput {
  id: string;
  type: string;
  createdAt: Date;
  dueAt: string;
}

/** An import still parsing, validating or committing after this long is stuck (its job died). */
export const IMPORT_STUCK_MINUTES = 30;
const IMPORT_IN_PROGRESS = ["parsing", "validating", "committing"];
/** Data subject requests are due in 30 days; the operator is warned from day 20. */
export const DSR_ALERT_DAY = 20;

export interface AlertInput {
  companyId: string;
  companyStatus: string;
  companyCreatedAt: Date;
  campaigns: AlertCampaignInput[];
  lastSendAt: Date | null;
  /** Delivered ÷ (delivered + undelivered) over the last 200 finished messages; null if too few. */
  recentDeliveryRate: number | null;
  /** ROI of the previous two full months, most recent first. */
  roiPreviousMonths: [number | null, number | null];
  topOpportunity: { presetKey: string; expectedRevenueMinor: number; eligible: number } | null;
  /** Imports waiting for review, recently committed, or still being processed. */
  imports?: AlertImportInput[];
  /** Open data subject requests (spec §21: alert at day 20 of 30). */
  dataSubjectRequests?: AlertDsrInput[];
  now: Date;
}

export interface Alert {
  key: string;
  type: AlertType;
  severity: AlertSeverity;
  companyId: string;
  createdAt: Date;
  campaignId?: string;
  presetKey?: string;
  params: Record<string, number | string>;
}

const LARGE_OPPORTUNITY_MINOR = 30_000_00;

export function evaluateAlerts(input: AlertInput): Alert[] {
  const alerts: Alert[] = [];
  const { companyId, now } = input;

  for (const c of input.campaigns) {
    const attempted = c.sentCount + c.failedCount;
    if (c.status === "failed" || (attempted > 0 && c.failedCount / attempted > 0.05)) {
      alerts.push({
        key: `campaign_failed:${c.id}`,
        type: "campaign_failed",
        severity: "critical",
        companyId,
        campaignId: c.id,
        createdAt: c.sentAt ?? c.createdAt,
        params: { failed: c.failedCount },
      });
    }
    if (c.status === "waiting_for_approval" && daysBetween(c.createdAt, now) > 2) {
      alerts.push({
        key: `awaiting_approval:${c.id}`,
        type: "awaiting_approval",
        severity: "medium",
        companyId,
        campaignId: c.id,
        createdAt: addDays(c.createdAt, 2),
        params: { days: Math.floor(daysBetween(c.createdAt, now)) },
      });
    }
    if (
      c.sentAt &&
      c.sentCount >= 100 &&
      daysBetween(c.sentAt, now) >= 45 &&
      c.completedConversions / c.sentCount < 0.02
    ) {
      alerts.push({
        key: `low_conversion:${c.id}`,
        type: "low_conversion",
        severity: "medium",
        companyId,
        campaignId: c.id,
        createdAt: addDays(c.sentAt, 45),
        params: { rate: c.completedConversions / c.sentCount },
      });
    }
  }

  for (const i of input.imports ?? []) {
    const invalidRate = i.rows > 0 ? i.invalid / i.rows : 0;
    if (IMPORT_IN_PROGRESS.includes(i.status)) {
      if (now.getTime() - i.updatedAt.getTime() > IMPORT_STUCK_MINUTES * 60_000) {
        alerts.push({
          key: `import_stuck:${i.id}`,
          type: "import_stuck",
          severity: "high",
          companyId,
          createdAt: i.updatedAt,
          params: { importId: i.id, minutes: Math.floor((now.getTime() - i.updatedAt.getTime()) / 60_000) },
        });
      }
      continue;
    }
    if (i.status === "needs_review" || invalidRate > 0.1) {
      alerts.push({
        key: `import_needs_review:${i.id}`,
        type: "import_needs_review",
        severity: "high",
        companyId,
        createdAt: i.updatedAt,
        params: { importId: i.id, rate: invalidRate },
      });
    }
  }

  for (const r of input.dataSubjectRequests ?? []) {
    if (daysBetween(r.createdAt, now) < DSR_ALERT_DAY) continue;
    alerts.push({
      key: `dsr_due:${r.id}`,
      type: "dsr_due",
      severity: "high",
      companyId,
      createdAt: addDays(r.createdAt, DSR_ALERT_DAY),
      params: { requestId: r.id, requestType: r.type, dueAt: r.dueAt },
    });
  }

  if (input.recentDeliveryRate !== null && input.recentDeliveryRate < 0.9) {
    alerts.push({
      key: `sms_failure_rate:${companyId}`,
      type: "sms_failure_rate",
      severity: "high",
      companyId,
      createdAt: input.lastSendAt ?? now,
      params: { rate: input.recentDeliveryRate },
    });
  }

  if (input.companyStatus === "active") {
    const since = input.lastSendAt ?? input.companyCreatedAt;
    if (daysBetween(since, now) > 35) {
      alerts.push({
        key: `no_campaign_running:${companyId}`,
        type: "no_campaign_running",
        severity: "medium",
        companyId,
        createdAt: addDays(since, 35),
        params: { days: Math.floor(daysBetween(since, now)) },
      });
    }
  }

  const [prev, prevPrev] = input.roiPreviousMonths;
  if (prev !== null && prevPrev !== null && prev < 1 && prevPrev < 1) {
    alerts.push({
      key: `roi_below_1:${companyId}`,
      type: "roi_below_1",
      severity: "medium",
      companyId,
      createdAt: now,
      params: {},
    });
  }

  if (input.topOpportunity && input.topOpportunity.expectedRevenueMinor > LARGE_OPPORTUNITY_MINOR) {
    alerts.push({
      key: `large_opportunity:${companyId}:${input.topOpportunity.presetKey}`,
      type: "large_opportunity",
      severity: "info",
      companyId,
      presetKey: input.topOpportunity.presetKey,
      createdAt: now,
      params: {
        eligible: input.topOpportunity.eligible,
        expected: input.topOpportunity.expectedRevenueMinor,
      },
    });
  }

  return alerts;
}

export type Health = "green" | "amber" | "red";

export function healthFromAlerts(alerts: Pick<Alert, "severity">[]): Health {
  if (alerts.some((a) => a.severity === "critical" || a.severity === "high")) return "red";
  if (alerts.some((a) => a.severity === "medium" || a.severity === "low")) return "amber";
  return "green";
}

export function sortAlerts<T extends Pick<Alert, "severity" | "createdAt">>(alerts: T[]): T[] {
  return [...alerts].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

/** True when an import has been parsing, validating or committing without progress for 30 minutes. */
export function isImportStuck(status: string, updatedAt: Date, now: Date): boolean {
  return IMPORT_IN_PROGRESS.includes(status) && now.getTime() - updatedAt.getTime() > IMPORT_STUCK_MINUTES * 60_000;
}
