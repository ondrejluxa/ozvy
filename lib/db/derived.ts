import { buildAudience, type Audience, type ContactEvent } from "../domain/contact-rules/audience";
import { averageJobValue, estimateCampaign, type CampaignEstimate } from "../domain/campaigns/estimates";
import { fromDateOnly } from "../domain/dates";
import { PRESET_BY_KEY, type PresetKey } from "../domain/segments/presets";
import type { UnitFacts } from "../domain/segments/types";
import { buildUnits, type CompanyIndex } from "./company-index";

/** Sent message threads per customer, used by the contact rules. */
export function contactHistory(index: CompanyIndex): Map<string, ContactEvent[]> {
  const map = new Map<string, ContactEvent[]>();
  for (const e of index.enrollments) {
    if (e.is_holdout || !e.first_sent_at) continue;
    const campaign = index.campaignById.get(e.campaign_id);
    const list = map.get(e.customer_id) ?? [];
    list.push({
      sentAt: new Date(e.first_sent_at),
      presetKey: campaign?.segment_preset ?? null,
      vehicleId: e.vehicle_id,
    });
    map.set(e.customer_id, list);
  }
  return map;
}

/** Historical job values for the preset's categories, visible as of `asOf`. */
export function presetAverageJobValue(index: CompanyIndex, presetKey: PresetKey, asOf: Date): number {
  const categories = PRESET_BY_KEY[presetKey].valueCategories;
  const t = asOf.getTime();
  const values = index.visits
    .filter(
      (v) =>
        v.job_value_minor !== null &&
        v.job_value_minor > 0 &&
        categories.includes(v.service_category) &&
        fromDateOnly(v.visited_at).getTime() < t,
    )
    .map((v) => v.job_value_minor as number);
  return averageJobValue(values, index.company.average_job_value_minor);
}

export interface PresetAudience {
  presetKey: PresetKey;
  unavailableReason: "out_of_season" | "no_stk_data" | null;
  audience: Audience;
  avgJobValueMinor: number;
  estimate: CampaignEstimate;
}

export function presetAudience(
  index: CompanyIndex,
  presetKey: PresetKey,
  now: Date,
  opts: { units?: UnitFacts[]; history?: Map<string, ContactEvent[]>; holdoutPct?: number } = {},
): PresetAudience {
  const preset = PRESET_BY_KEY[presetKey];
  const hasStkVisits = index.visits.some((v) => v.service_category === "stk");
  const unavailableReason = preset.unavailableReason(now, { hasStkVisits });
  const audience = unavailableReason
    ? { matchedCustomers: 0, eligible: [], excluded: emptyExcluded() }
    : buildAudience({
        units: opts.units ?? buildUnits(index, now),
        rules: preset.rules,
        presetKey,
        now,
        customers: index.customerById,
        suppressedCustomerIds: index.suppressedCustomerIds,
        contactHistory: opts.history ?? contactHistory(index),
        settings: index.company.settings,
      });
  const avgJobValueMinor = presetAverageJobValue(index, presetKey, now);
  return {
    presetKey,
    unavailableReason,
    audience,
    avgJobValueMinor,
    estimate: estimateCampaign({
      eligible: audience.eligible.length,
      holdoutPct: opts.holdoutPct ?? index.company.settings.holdout_pct,
      conversionRate: index.company.settings.expected_conversion_rate,
      avgJobValueMinor,
    }),
  };
}

function emptyExcluded(): Audience["excluded"] {
  return {
    opted_out: 0,
    no_legal_basis: 0,
    no_mobile: 0,
    too_old: 0,
    recently_contacted: 0,
    yearly_cap: 0,
    same_preset_90d: 0,
  };
}
