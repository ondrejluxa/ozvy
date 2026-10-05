import type { ServiceCategory } from "../../db/types";
import { pragueParts } from "../dates";
import { tyreSeason } from "./evaluate";
import type { RuleGroup } from "./types";

/**
 * The 9 preset segments from spec §12. Names and descriptions live in
 * messages/cs.json under presets.<key>.
 */

export type PresetKey =
  | "no_visit_6m"
  | "no_visit_12m"
  | "no_visit_18m"
  | "regular_service_10_14"
  | "tyre_last_season"
  | "ac_18_24"
  | "valuable_lost"
  | "regulars_stopped"
  | "stk_approaching";

export interface SegmentPreset {
  key: PresetKey;
  rules: RuleGroup;
  /** Categories used for the average job value and for the return visit. */
  valueCategories: ServiceCategory[];
  /** Why a preset is currently unavailable, or null. */
  unavailableReason: (now: Date, ctx: { hasStkVisits: boolean }) => "out_of_season" | "no_stk_data" | null;
}

/** Typical "come back" jobs; tyre and AC jobs are small and seasonal. */
const WORKSHOP: ServiceCategory[] = ["regular_service", "oil_change", "brakes", "diagnostics", "stk", "repair_other"];
const always = () => null;

export const PRESETS: SegmentPreset[] = [
  {
    key: "no_visit_12m",
    rules: { all: [{ field: "vehicle.last_visit_at", op: "between_months_ago", value: [12, 18] }] },
    valueCategories: WORKSHOP,
    unavailableReason: always,
  },
  {
    key: "regular_service_10_14",
    rules: {
      all: [
        {
          field: "vehicle.last_visit_at",
          op: "between_months_ago",
          value: [10, 14],
          category: ["regular_service", "oil_change"],
        },
        { field: "vehicle.visits_since", op: "eq", value: 0, category: ["regular_service", "oil_change"] },
      ],
    },
    valueCategories: ["regular_service", "oil_change"],
    unavailableReason: always,
  },
  {
    key: "valuable_lost",
    rules: {
      all: [
        { field: "customer.lifetime_value", op: "percentile_gte", value: 0.8 },
        { field: "vehicle.last_visit_at", op: "older_than_months", value: 9 },
      ],
    },
    valueCategories: WORKSHOP,
    unavailableReason: always,
  },
  {
    key: "regulars_stopped",
    rules: {
      all: [
        { field: "vehicle.max_visits_24m", op: "gte", value: 3 },
        { field: "vehicle.last_visit_at", op: "older_than_months", value: 12 },
      ],
    },
    valueCategories: WORKSHOP,
    unavailableReason: always,
  },
  {
    key: "no_visit_6m",
    rules: { all: [{ field: "vehicle.last_visit_at", op: "between_months_ago", value: [6, 12] }] },
    valueCategories: WORKSHOP,
    unavailableReason: always,
  },
  {
    key: "no_visit_18m",
    rules: { all: [{ field: "vehicle.last_visit_at", op: "between_months_ago", value: [18, 48] }] },
    valueCategories: WORKSHOP,
    unavailableReason: always,
  },
  {
    key: "tyre_last_season",
    rules: {
      all: [{ field: "vehicle.last_visit_at", op: "season_last_year_not_this", category: ["tyre_change"] }],
    },
    valueCategories: ["tyre_change"],
    unavailableReason: (now) => (tyreSeason(now) ? null : "out_of_season"),
  },
  {
    key: "ac_18_24",
    rules: {
      all: [{ field: "vehicle.last_visit_at", op: "between_months_ago", value: [18, 24], category: ["ac_service"] }],
    },
    valueCategories: ["ac_service"],
    unavailableReason: (now) => {
      const m = pragueParts(now).month;
      return m >= 4 && m <= 6 ? null : "out_of_season";
    },
  },
  {
    key: "stk_approaching",
    rules: {
      all: [{ field: "vehicle.last_visit_at", op: "between_months_ago", value: [22, 24], category: ["stk"] }],
    },
    valueCategories: ["stk"],
    unavailableReason: (_now, ctx) => (ctx.hasStkVisits ? null : "no_stk_data"),
  },
];

export const PRESET_BY_KEY = Object.fromEntries(PRESETS.map((p) => [p.key, p])) as Record<PresetKey, SegmentPreset>;

export function isPresetKey(key: string | null | undefined): key is PresetKey {
  return !!key && key in PRESET_BY_KEY;
}
