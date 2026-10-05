import type { LifecycleStatus, ServiceCategory } from "../../db/types";

/**
 * Segment rule DSL (spec §12). Stored as JSON on segments.rules and on
 * campaigns.segment_rules_snapshot. Phase 0 evaluates it in TypeScript;
 * Phase 1 compiles the same JSON to parameterised SQL (compileSegment).
 */

export type RuleField =
  | "vehicle.last_visit_at"
  | "vehicle.visits_since"
  | "vehicle.max_visits_24m"
  | "customer.lifetime_value"
  | "customer.lifecycle_status";

export type RuleOp =
  | "eq"
  | "in"
  | "gte"
  | "lte"
  | "between"
  | "between_months_ago"
  | "older_than_months"
  | "season_last_year_not_this"
  | "percentile_gte";

export interface RuleCondition {
  field: RuleField;
  op: RuleOp;
  value?: number | [number, number] | string[];
  category?: ServiceCategory[];
}

export type RuleGroup = { all: RuleNode[] } | { any: RuleNode[] };
export type RuleNode = RuleCondition | RuleGroup;

/** Everything a rule can look at for one targetable unit (a vehicle, or a customer without one). */
export interface UnitFacts {
  customerId: string;
  vehicleId: string | null;
  /** Visits strictly before `now`, oldest first. */
  visits: { date: Date; category: ServiceCategory }[];
  lastVisitAt: Date | null;
  customerLtvPercentile: number;
  customerStatus: LifecycleStatus;
}
