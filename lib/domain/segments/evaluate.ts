import type { ServiceCategory } from "../../db/types";
import { monthsBetween } from "../dates";
import type { RuleCondition, RuleNode, UnitFacts } from "./types";

// Season checks run per visit in hot loops, so they use the UTC calendar.
// Visit dates are stored at midday, so this only differs from Prague time
// for `now` within two hours of a month boundary.
const month = (d: Date) => d.getUTCMonth() + 1;
const year = (d: Date) => d.getUTCFullYear();

/** Tyre seasons (spec §12): spring = Mar–May, autumn = Oct–Nov. */
export function tyreSeason(d: Date): "spring" | "autumn" | null {
  const m = month(d);
  if (m >= 3 && m <= 5) return "spring";
  if (m >= 10 && m <= 11) return "autumn";
  return null;
}

function lastOf(facts: UnitFacts, categories?: ServiceCategory[]): Date | null {
  if (!categories?.length) return facts.lastVisitAt;
  for (let i = facts.visits.length - 1; i >= 0; i--) {
    if (categories.includes(facts.visits[i].category)) return facts.visits[i].date;
  }
  return null;
}

function maxVisitsInWindow(facts: UnitFacts, windowMonths: number): number {
  let best = 0;
  let start = 0;
  const dates = facts.visits.map((v) => v.date);
  for (let end = 0; end < dates.length; end++) {
    while (monthsBetween(dates[start], dates[end]) > windowMonths) start++;
    best = Math.max(best, end - start + 1);
  }
  return best;
}

function compare(op: RuleCondition["op"], actual: number, value: RuleCondition["value"]): boolean {
  switch (op) {
    case "eq":
      return actual === value;
    case "gte":
      return typeof value === "number" && actual >= value;
    case "lte":
      return typeof value === "number" && actual <= value;
    case "between":
      return Array.isArray(value) && actual >= Number(value[0]) && actual <= Number(value[1]);
    default:
      return false;
  }
}

function evaluateCondition(c: RuleCondition, facts: UnitFacts, now: Date): boolean {
  switch (c.field) {
    case "vehicle.last_visit_at": {
      if (c.op === "season_last_year_not_this") {
        const season = tyreSeason(now);
        if (!season) return false;
        const thisYear = year(now);
        const inSeason = (d: Date, y: number) => tyreSeason(d) === season && year(d) === y;
        const relevant = facts.visits.filter((v) => !c.category?.length || c.category.includes(v.category));
        return (
          relevant.some((v) => inSeason(v.date, thisYear - 1)) && !relevant.some((v) => inSeason(v.date, thisYear))
        );
      }
      const ref = lastOf(facts, c.category);
      if (!ref) return false;
      const months = monthsBetween(ref, now);
      if (c.op === "between_months_ago" && Array.isArray(c.value)) {
        return months >= Number(c.value[0]) && months < Number(c.value[1]);
      }
      if (c.op === "older_than_months" && typeof c.value === "number") return months >= c.value;
      return false;
    }
    case "vehicle.visits_since": {
      const ref = lastOf(facts, c.category);
      if (!ref) return false;
      const since = facts.visits.filter((v) => v.date.getTime() > ref.getTime()).length;
      return compare(c.op, since, c.value);
    }
    case "vehicle.max_visits_24m":
      return compare(c.op, maxVisitsInWindow(facts, 24), c.value);
    case "customer.lifetime_value":
      return c.op === "percentile_gte" && typeof c.value === "number" && facts.customerLtvPercentile >= c.value;
    case "customer.lifecycle_status":
      return c.op === "in" && Array.isArray(c.value) && (c.value as string[]).includes(facts.customerStatus);
  }
}

export function evaluateRule(node: RuleNode, facts: UnitFacts, now: Date): boolean {
  if ("all" in node) return node.all.every((n) => evaluateRule(n, facts, now));
  if ("any" in node) return node.any.some((n) => evaluateRule(n, facts, now));
  return evaluateCondition(node, facts, now);
}
