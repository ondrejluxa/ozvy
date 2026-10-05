import type { CompanySettings, LifecycleStatus } from "../db/types";
import { monthsBetween } from "./dates";

/**
 * Lifecycle status (spec §12). Computed per vehicle from its last visit and
 * rolled up to the customer: active beats at risk beats inactive; reactivated
 * overrides those three; opted out overrides everything.
 */

export type VisitStatus = Extract<LifecycleStatus, "active" | "at_risk" | "inactive">;

export function statusFromLastVisit(
  lastVisitAt: Date | null,
  now: Date,
  thresholds: CompanySettings["lifecycle"],
): VisitStatus {
  if (!lastVisitAt) return "inactive";
  const months = monthsBetween(lastVisitAt, now);
  if (months <= thresholds.active_max_months) return "active";
  if (months <= thresholds.at_risk_max_months) return "at_risk";
  return "inactive";
}

const RANK: Record<VisitStatus, number> = { active: 3, at_risk: 2, inactive: 1 };

export function bestStatus(statuses: VisitStatus[]): VisitStatus {
  return statuses.reduce<VisitStatus>((best, s) => (RANK[s] > RANK[best] ? s : best), "inactive");
}

export function customerStatus(input: {
  visitStatuses: VisitStatus[];
  suppressed: boolean;
  /** Completed, non-holdout conversion within the last 12 months. */
  reactivated: boolean;
}): LifecycleStatus {
  if (input.suppressed) return "opted_out";
  if (input.reactivated) return "reactivated";
  return bestStatus(input.visitStatuses);
}
