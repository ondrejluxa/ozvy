import "server-only";
import type { Json } from "../types.gen";
import type { ExclusionReason } from "../../domain/contact-rules/audience";
import { toDateOnly } from "../../domain/dates";
import { PRESETS, type PresetKey } from "../../domain/segments/presets";
import type { RuleGroup } from "../../domain/segments/types";
import { createSupabaseServerClient } from "./server-client";

/**
 * Segment reads for DATA_SOURCE=supabase. Audiences are computed in the
 * database by public.segment_audience (compileSegment, spec §12) with the
 * caller's session, so RLS applies.
 */

export interface SegmentCounts {
  matched: number;
  eligible: number;
  excluded: Partial<Record<ExclusionReason, number>>;
}

export async function previewRules(companyId: string, rules: RuleGroup, presetKey: string | null = null) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("segment_preview", {
    p_company_id: companyId,
    p_rules: rules as unknown as Json,
    p_preset_key: presetKey ?? undefined,
    p_today: toDateOnly(new Date()),
  });
  if (error) throw new Error(`segment_preview failed: ${error.code}`);
  return data as unknown as SegmentCounts;
}

/** A few contactable customers, so the operator can sanity-check a segment. */
export async function sampleEligible(companyId: string, rules: RuleGroup, limit = 5) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("segment_audience", {
    p_company_id: companyId,
    p_rules: rules as unknown as Json,
    p_today: toDateOnly(new Date()),
  });
  if (error) throw new Error(`segment_audience failed: ${error.code}`);
  const picked = (data ?? []).filter((r) => r.reason === null).slice(0, limit);
  if (!picked.length) return [];
  const { data: customers } = await supabase
    .from("customers")
    .select("id, first_name, last_name, last_visit_at")
    .eq("company_id", companyId)
    .in(
      "id",
      picked.map((p) => p.customer_id),
    );
  return (customers ?? []).map((c) => ({
    id: c.id,
    name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "—",
    lastVisitAt: c.last_visit_at,
  }));
}

export async function hasStkVisits(companyId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from("visits")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("service_category", "stk");
  return (count ?? 0) > 0;
}

export interface PresetRow {
  key: PresetKey;
  unavailableReason: "out_of_season" | "no_stk_data" | null;
  counts: SegmentCounts | null;
}

/** All presets with live counts (unavailable ones are not evaluated). */
export async function presetsOverview(companyId: string, now = new Date()): Promise<PresetRow[]> {
  const stk = await hasStkVisits(companyId);
  return Promise.all(
    PRESETS.map(async (p) => {
      const unavailableReason = p.unavailableReason(now, { hasStkVisits: stk });
      return {
        key: p.key,
        unavailableReason,
        counts: unavailableReason ? null : await previewRules(companyId, p.rules, p.key),
      };
    }),
  );
}

export async function listSegments(companyId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("segments")
    .select("id, name, rules, created_at")
    .eq("company_id", companyId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`segments query failed: ${error.code}`);
  return Promise.all(
    (data ?? []).map(async (s) => ({ ...s, counts: await previewRules(companyId, s.rules as unknown as RuleGroup) })),
  );
}
