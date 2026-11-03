import { z } from "zod";
import type { LifecycleStatus, ServiceCategory } from "../../db/types";
import { SERVICE_CATEGORIES } from "../service-labels";
import type { RuleCondition, RuleGroup, RuleNode } from "./types";

/**
 * Validation of the segment rule DSL (spec §12) before it is stored or sent
 * to the database compiler (public.segment_audience). The SQL side refuses
 * unknown fields and operators too; this gives clear errors first and caps
 * the size of a rule tree.
 */

const LIFECYCLE: LifecycleStatus[] = ["active", "at_risk", "inactive", "reactivated", "opted_out"];
const MAX_CONDITIONS = 20;
const MAX_DEPTH = 3;

const months = z.number().int().min(0).max(240);
const category = z.array(z.enum(SERVICE_CATEGORIES)).max(9).optional();
const count = z.number().int().min(0).max(1000);

const condition = z.discriminatedUnion("field", [
  z.object({
    field: z.literal("vehicle.last_visit_at"),
    op: z.enum(["between_months_ago", "older_than_months", "season_last_year_not_this"]),
    value: z.union([months, z.tuple([months, months])]).optional(),
    category,
  }),
  z.object({
    field: z.literal("vehicle.visits_since"),
    op: z.enum(["eq", "gte", "lte", "between"]),
    value: z.union([count, z.tuple([count, count])]),
    category,
  }),
  z.object({
    field: z.literal("vehicle.max_visits_24m"),
    op: z.enum(["eq", "gte", "lte", "between"]),
    value: z.union([count, z.tuple([count, count])]),
  }),
  z.object({
    field: z.literal("customer.lifetime_value"),
    op: z.enum(["percentile_gte", "gte", "lte", "between"]),
    value: z.union([z.number().min(0), z.tuple([z.number().min(0), z.number().min(0)])]),
  }),
  z.object({
    field: z.literal("customer.lifecycle_status"),
    op: z.enum(["in", "eq"]),
    value: z.union([z.enum(LIFECYCLE), z.array(z.enum(LIFECYCLE)).min(1)]),
  }),
]);

/** Operator / value shape checks the discriminated union cannot express. */
function conditionIssue(c: z.infer<typeof condition>): string | null {
  const range = Array.isArray(c.value);
  if (c.op === "between_months_ago" || c.op === "between") {
    if (!range) return "range_required";
    const [a, b] = c.value as [number, number];
    if (a > b) return "range_reversed";
  } else if (c.op === "season_last_year_not_this") {
    if (c.value !== undefined) return "no_value_expected";
  } else if (c.op === "in") {
    if (!range) return "list_required";
  } else if (range) {
    return "single_value_required";
  } else if (c.value === undefined) {
    return "value_required";
  }
  if (c.op === "percentile_gte" && ((c.value as number) < 0 || (c.value as number) > 1)) return "percentile_range";
  return null;
}

export type RulesIssue = { code: string; path: string };

/** Parses and checks a rule tree; returns the typed rules or the first problems. */
export function parseRules(input: unknown): { ok: true; rules: RuleGroup } | { ok: false; issues: RulesIssue[] } {
  const issues: RulesIssue[] = [];
  let conditions = 0;

  const visit = (node: unknown, path: string, depth: number): RuleNode | null => {
    if (node && typeof node === "object" && ("all" in node || "any" in node)) {
      if (depth >= MAX_DEPTH) {
        issues.push({ code: "too_deep", path });
        return null;
      }
      const key = "all" in node ? "all" : "any";
      const children = (node as Record<string, unknown>)[key];
      if (!Array.isArray(children)) {
        issues.push({ code: "group_not_array", path });
        return null;
      }
      const parsed = children.map((c, i) => visit(c, `${path}.${key}[${i}]`, depth + 1));
      return { [key]: parsed.filter((n): n is RuleNode => n !== null) } as RuleGroup;
    }
    conditions++;
    const result = condition.safeParse(node);
    if (!result.success) {
      issues.push({ code: "invalid_condition", path });
      return null;
    }
    const issue = conditionIssue(result.data);
    if (issue) {
      issues.push({ code: issue, path });
      return null;
    }
    return result.data as RuleCondition;
  };

  if (!input || typeof input !== "object" || !("all" in input || "any" in input)) {
    return { ok: false, issues: [{ code: "root_must_be_group", path: "$" }] };
  }
  const rules = visit(input, "$", 0) as RuleGroup | null;
  if (conditions > MAX_CONDITIONS) issues.push({ code: "too_many_conditions", path: "$" });
  return issues.length || !rules ? { ok: false, issues } : { ok: true, rules };
}

// ---------- the "Nový segment" builder ----------

export interface SegmentBuilderInput {
  /** Last visit at least this many months ago. */
  lastVisitFromMonths: number | null;
  /** …and less than this many months ago (open-ended when null). */
  lastVisitToMonths: number | null;
  /** Restricts "last visit" to these categories. */
  categories: ServiceCategory[];
  /** No visit of any kind after that last (category) visit. */
  nothingSince: boolean;
  statuses: LifecycleStatus[];
  /** Only the top N % of customers by lifetime value. */
  topSpendPercent: number | null;
  /** At least this many visits within some 24-month window. */
  minVisits24m: number | null;
}

export function builderToRules(input: SegmentBuilderInput): RuleGroup {
  const all: RuleCondition[] = [];
  const category = input.categories.length ? input.categories : undefined;
  if (input.lastVisitFromMonths !== null && input.lastVisitToMonths !== null) {
    all.push({
      field: "vehicle.last_visit_at",
      op: "between_months_ago",
      value: [input.lastVisitFromMonths, input.lastVisitToMonths],
      ...(category && { category }),
    });
  } else if (input.lastVisitFromMonths !== null) {
    all.push({
      field: "vehicle.last_visit_at",
      op: "older_than_months",
      value: input.lastVisitFromMonths,
      ...(category && { category }),
    });
  }
  if (input.nothingSince) {
    all.push({ field: "vehicle.visits_since", op: "eq", value: 0, ...(category && { category }) });
  }
  if (input.statuses.length) {
    all.push({ field: "customer.lifecycle_status", op: "in", value: input.statuses });
  }
  if (input.topSpendPercent !== null) {
    all.push({
      field: "customer.lifetime_value",
      op: "percentile_gte",
      value: Math.round((1 - input.topSpendPercent / 100) * 100) / 100,
    });
  }
  if (input.minVisits24m !== null) {
    all.push({ field: "vehicle.max_visits_24m", op: "gte", value: input.minVisits24m });
  }
  return { all };
}

export const builderSchema = z
  .object({
    lastVisitFromMonths: months.nullable(),
    lastVisitToMonths: months.nullable(),
    categories: z.array(z.enum(SERVICE_CATEGORIES)).max(9),
    nothingSince: z.boolean(),
    statuses: z.array(z.enum(LIFECYCLE)).max(5),
    topSpendPercent: z.number().int().min(1).max(50).nullable(),
    minVisits24m: z.number().int().min(2).max(20).nullable(),
  })
  .refine((b) => b.lastVisitToMonths === null || b.lastVisitFromMonths !== null, {
    message: "from_required",
    path: ["lastVisitFromMonths"],
  })
  .refine(
    (b) =>
      b.lastVisitFromMonths === null || b.lastVisitToMonths === null || b.lastVisitFromMonths < b.lastVisitToMonths,
    {
      message: "range_reversed",
      path: ["lastVisitToMonths"],
    },
  )
  .refine((b) => !b.nothingSince || b.categories.length > 0, { message: "categories_required", path: ["nothingSince"] })
  .refine(
    (b) =>
      b.lastVisitFromMonths !== null || b.statuses.length > 0 || b.topSpendPercent !== null || b.minVisits24m !== null,
    { message: "empty_segment", path: ["lastVisitFromMonths"] },
  );
