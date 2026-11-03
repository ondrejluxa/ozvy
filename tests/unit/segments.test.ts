import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { builderSchema, builderToRules, parseRules } from "@/lib/domain/segments/schema";
import { PRESETS } from "@/lib/domain/segments/presets";

describe("segment rule DSL validation", () => {
  it("accepts all nine presets", () => {
    for (const p of PRESETS) expect(parseRules(p.rules), p.key).toEqual({ ok: true, rules: p.rules });
  });

  it("refuses unknown fields, operators and malformed values", () => {
    const bad = (rules: unknown) => (parseRules(rules) as { ok: false; issues: { code: string }[] }).issues;
    expect(bad({ all: [{ field: "customer.phone", op: "eq", value: 1 }] })[0].code).toBe("invalid_condition");
    expect(bad({ all: [{ field: "vehicle.visits_since", op: "like", value: 1 }] })[0].code).toBe("invalid_condition");
    expect(bad({ all: [{ field: "vehicle.last_visit_at", op: "between_months_ago", value: 6 }] })[0].code).toBe(
      "range_required",
    );
    expect(bad({ all: [{ field: "vehicle.last_visit_at", op: "between_months_ago", value: [12, 6] }] })[0].code).toBe(
      "range_reversed",
    );
    expect(bad({ all: [{ field: "customer.lifetime_value", op: "percentile_gte", value: 80 }] })[0].code).toBe(
      "percentile_range",
    );
    expect(bad({ all: [{ field: "vehicle.last_visit_at", op: "older_than_months", value: "1; drop" }] })[0].code).toBe(
      "invalid_condition",
    );
    expect(bad([{ field: "x" }])[0].code).toBe("root_must_be_group");
  });

  it("caps depth and size", () => {
    const deep = { all: [{ any: [{ all: [{ any: [] }] }] }] };
    expect(parseRules(deep)).toMatchObject({ ok: false, issues: [{ code: "too_deep" }] });
    const condition = { field: "customer.lifecycle_status", op: "in", value: ["active"] };
    expect(parseRules({ all: Array(21).fill(condition) })).toMatchObject({ ok: false });
    expect(parseRules({ all: Array(20).fill(condition) }).ok).toBe(true);
  });
});

describe("segment builder", () => {
  const empty = {
    lastVisitFromMonths: null,
    lastVisitToMonths: null,
    categories: [],
    nothingSince: false,
    statuses: [],
    topSpendPercent: null,
    minVisits24m: null,
  };

  it("turns the form into DSL rules the validator accepts", () => {
    const rules = builderToRules({
      ...empty,
      lastVisitFromMonths: 10,
      lastVisitToMonths: 14,
      categories: ["regular_service", "oil_change"],
      nothingSince: true,
      statuses: ["at_risk", "inactive"],
      topSpendPercent: 20,
      minVisits24m: 3,
    });
    expect(rules).toEqual({
      all: [
        {
          field: "vehicle.last_visit_at",
          op: "between_months_ago",
          value: [10, 14],
          category: ["regular_service", "oil_change"],
        },
        { field: "vehicle.visits_since", op: "eq", value: 0, category: ["regular_service", "oil_change"] },
        { field: "customer.lifecycle_status", op: "in", value: ["at_risk", "inactive"] },
        { field: "customer.lifetime_value", op: "percentile_gte", value: 0.8 },
        { field: "vehicle.max_visits_24m", op: "gte", value: 3 },
      ],
    });
    expect(parseRules(rules).ok).toBe(true);
    // The builder reproduces the regular-service preset exactly.
    expect(
      builderToRules({
        ...empty,
        lastVisitFromMonths: 10,
        lastVisitToMonths: 14,
        categories: ["regular_service", "oil_change"],
        nothingSince: true,
      }),
    ).toEqual(PRESETS.find((p) => p.key === "regular_service_10_14")!.rules);
  });

  it("uses an open-ended range when only 'from' is given", () => {
    expect(builderToRules({ ...empty, lastVisitFromMonths: 24 })).toEqual({
      all: [{ field: "vehicle.last_visit_at", op: "older_than_months", value: 24 }],
    });
  });

  it("validates the form", () => {
    const issues = (input: object) => {
      const r = builderSchema.safeParse({ ...empty, ...input });
      return r.success ? [] : r.error.issues.map((i) => i.message);
    };
    expect(issues({})).toContain("empty_segment");
    expect(issues({ lastVisitFromMonths: 14, lastVisitToMonths: 10 })).toContain("range_reversed");
    expect(issues({ lastVisitToMonths: 10 })).toContain("from_required");
    expect(issues({ lastVisitFromMonths: 6, nothingSince: true })).toContain("categories_required");
    expect(issues({ statuses: ["inactive"] })).toEqual([]);
  });
});

describe("SQL fixture parity", () => {
  it("08_segments.test.sql evaluates exactly the TypeScript presets", () => {
    const sql = readFileSync(join(process.cwd(), "supabase", "tests", "database", "08_segments.test.sql"), "utf8");
    const rows = new Map(
      [...sql.matchAll(/^ {2}\('([a-z0-9_]+)', '(\{.*\})'\)[,;]?$/gm)].map((m) => [m[1], JSON.parse(m[2])]),
    );
    expect([...rows.keys()].sort()).toEqual(PRESETS.map((p) => p.key).sort());
    for (const p of PRESETS) expect(rows.get(p.key), p.key).toEqual(p.rules);
  });
});
