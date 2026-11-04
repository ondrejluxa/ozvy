import "server-only";
import { cache } from "react";
import { isUuid } from "../../real-data-routes";
import type { CampaignStatus, ServiceCategory } from "../types";
import type { Json, Tables } from "../types.gen";
import { resolveCompanySettings } from "../../domain/company-settings";
import { toDateOnly } from "../../domain/dates";
import { greetingFor, isVocativeApproved, type Gender } from "../../domain/messaging/vocative";
import { PRESET_BY_KEY, isPresetKey, WORKSHOP, type PresetKey } from "../../domain/segments/presets";
import type { RuleGroup, RuleNode } from "../../domain/segments/types";
import { PRICE_PER_SEGMENT_MINOR } from "../../providers/sms/mock";
import { getCompanyRecord } from "./companies";
import { hasStkVisits, listSegments, presetsOverview, previewRules, type SegmentCounts } from "./segments";
import { createSupabaseServerClient } from "./server-client";

/** Campaign reads for DATA_SOURCE=supabase (spec §12, §40.10), through the user's session. */

export interface CampaignSource {
  presetKey: PresetKey | null;
  segmentId: string | null;
  /** Saved segment name; presets are named from messages/cs.json. */
  segmentName: string | null;
  rules: RuleGroup;
  /** Categories whose median job value estimates the revenue (spec §12). */
  valueCategories: ServiceCategory[];
  unavailableReason: "out_of_season" | "no_stk_data" | null;
}

function categoriesIn(node: RuleNode): ServiceCategory[] {
  if ("all" in node) return node.all.flatMap(categoriesIn);
  if ("any" in node) return node.any.flatMap(categoriesIn);
  return node.category ?? [];
}

/** The segment a campaign is built from: a preset (?preset=) or a saved segment (?segment=). */
export async function resolveSource(
  companyId: string,
  params: { preset?: string; segment?: string },
): Promise<CampaignSource | null> {
  if (params.segment && isUuid(params.segment)) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("segments")
      .select("id, name, rules")
      .eq("company_id", companyId)
      .eq("id", params.segment)
      .is("archived_at", null)
      .maybeSingle();
    if (!data) return null;
    const rules = data.rules as unknown as RuleGroup;
    const cats = [...new Set(categoriesIn(rules))];
    return {
      presetKey: null,
      segmentId: data.id,
      segmentName: data.name,
      rules,
      valueCategories: cats.length ? cats : WORKSHOP,
      unavailableReason: null,
    };
  }
  const key: PresetKey = isPresetKey(params.preset) ? params.preset : "no_visit_12m";
  const preset = PRESET_BY_KEY[key];
  return {
    presetKey: key,
    segmentId: null,
    segmentName: null,
    rules: preset.rules,
    valueCategories: preset.valueCategories,
    unavailableReason: preset.unavailableReason(new Date(), { hasStkVisits: await hasStkVisits(companyId) }),
  };
}

export interface RealRecipient {
  enrollmentKey: string;
  firstName: string | null;
  lastName: string | null;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  plate: string | null;
  lastVisitAt: string | null;
  /** Approved personal greeting, only when the shop turned greetings on. */
  greeting: string | null;
}

export async function segmentRecipients(companyId: string, source: CampaignSource): Promise<RealRecipient[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("segment_recipients", {
    p_company_id: companyId,
    p_rules: source.rules as unknown as Json,
    p_preset_key: source.presetKey ?? undefined,
    p_today: toDateOnly(new Date()),
  });
  if (error) throw new Error(`segment_recipients failed: ${error.code}`);
  return (data ?? []).map((r) => ({
    enrollmentKey: `${r.customer_id}:${r.vehicle_id ?? "-"}`,
    firstName: r.first_name,
    lastName: r.last_name,
    vehicleBrand: r.vehicle_brand,
    vehicleModel: r.vehicle_model,
    plate: r.plate,
    lastVisitAt: r.last_visit_at,
    greeting: null,
  }));
}

/**
 * Adds "Dobrý den, pane Nováku," for surnames with an approved vocative when
 * the shop turned personalised greetings on (spec §0.5, §15). Everyone else
 * keeps the safe "Dobrý den,".
 */
export async function withGreetings(
  companyId: string,
  recipients: RealRecipient[],
  enabled: boolean,
): Promise<RealRecipient[]> {
  if (!enabled || recipients.length === 0) return recipients;
  const surnames = [...new Set(recipients.map((r) => r.lastName?.trim()).filter((s): s is string => Boolean(s)))];
  const supabase = await createSupabaseServerClient();
  const chunks = Array.from({ length: Math.ceil(surnames.length / 150) }, (_, i) =>
    surnames.slice(i * 150, i * 150 + 150),
  );
  const results = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from("name_vocatives")
        .select("surname, vocative, gender, confidence, reviewed_at")
        .eq("company_id", companyId)
        .in("surname", chunk),
    ),
  );
  const greetings = new Map<string, string>();
  for (const { data } of results) {
    for (const v of data ?? []) {
      const stored = {
        vocative: v.vocative,
        gender: v.gender as Gender,
        confidence: Number(v.confidence),
        reviewedAt: v.reviewed_at,
      };
      if (isVocativeApproved(stored)) greetings.set(v.surname, greetingFor(stored));
    }
  }
  return recipients.map((r) => ({ ...r, greeting: (r.lastName && greetings.get(r.lastName.trim())) || null }));
}

/** Median job value of the segment's categories if at least 20 visits exist, else the company average (spec §12). */
export async function segmentJobValue(companyId: string, categories: ServiceCategory[], fallbackMinor: number) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("job_value_median", { p_company_id: companyId, p_categories: categories });
  const row = data?.[0];
  return row && row.visits >= 20 && row.median_minor !== null ? row.median_minor : fallbackMinor;
}

export interface RealBuilderData {
  now: string;
  companyId: string;
  companyName: string;
  senderName: string;
  requiresClientApproval: boolean;
  shop: { shopName: string; phone: string | null };
  source: CampaignSource;
  counts: SegmentCounts;
  recipients: RealRecipient[];
  avgJobValueMinor: number;
  holdoutPct: number;
  conversionRate: number;
  pricePerSegmentMinor: number;
  options: {
    presets: { key: PresetKey; eligible: number | null; unavailableReason: string | null }[];
    segments: { id: string; name: string; eligible: number }[];
  };
}

export async function getRealBuilderData(
  companyId: string,
  params: { preset?: string; segment?: string },
): Promise<RealBuilderData | null> {
  const [company, source] = await Promise.all([getCompanyRecord(companyId), resolveSource(companyId, params)]);
  if (!company || !source) return null;
  const settings = resolveCompanySettings(company.settings);
  const [counts, recipients, avgJobValueMinor, presets, segments] = await Promise.all([
    source.unavailableReason
      ? Promise.resolve({ matched: 0, eligible: 0, excluded: {} } as SegmentCounts)
      : previewRules(companyId, source.rules, source.presetKey),
    source.unavailableReason
      ? Promise.resolve([])
      : segmentRecipients(companyId, source).then((r) => withGreetings(companyId, r, settings.personalized_greeting)),
    segmentJobValue(companyId, source.valueCategories, company.average_job_value_minor),
    presetsOverview(companyId),
    listSegments(companyId),
  ]);
  return {
    now: new Date().toISOString(),
    companyId,
    companyName: company.name,
    senderName: company.default_sender_name ?? company.name,
    requiresClientApproval: company.requires_client_approval,
    shop: { shopName: settings.message_shop_name ?? company.name, phone: company.phone },
    source,
    counts,
    recipients,
    avgJobValueMinor,
    holdoutPct: Math.min(0.2, settings.holdout_pct),
    conversionRate: settings.expected_conversion_rate,
    pricePerSegmentMinor: PRICE_PER_SEGMENT_MINOR,
    options: {
      presets: presets.map((p) => ({
        key: p.key,
        eligible: p.counts?.eligible ?? null,
        unavailableReason: p.unavailableReason,
      })),
      segments: segments.map((s) => ({ id: s.id, name: s.name, eligible: s.counts.eligible })),
    },
  };
}

// ---------- campaigns ----------

export type CampaignRecord = Tables<"campaigns">;
export type CampaignStepRecord = Tables<"campaign_steps">;

export async function listCampaigns(companyId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select(
      "id, name, status, segment_preset, segment_id, segments(name), scheduled_at, approved_recipient_count, created_at",
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`campaigns query failed: ${error.code}`);
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status as CampaignStatus,
    presetKey: c.segment_preset as PresetKey | null,
    segmentName: c.segments?.name ?? null,
    scheduledAt: c.scheduled_at,
    recipients: c.approved_recipient_count,
    createdAt: c.created_at,
  }));
}

export const getCampaign = cache(
  async (
    companyId: string,
    campaignId: string,
  ): Promise<{ campaign: CampaignRecord; steps: CampaignStepRecord[]; segmentName: string | null } | null> => {
    if (!isUuid(companyId) || !isUuid(campaignId)) return null;
    const supabase = await createSupabaseServerClient();
    const [campaign, steps] = await Promise.all([
      supabase
        .from("campaigns")
        .select("*, segments(name)")
        .eq("company_id", companyId)
        .eq("id", campaignId)
        .maybeSingle(),
      supabase
        .from("campaign_steps")
        .select("*")
        .eq("company_id", companyId)
        .eq("campaign_id", campaignId)
        .order("step_number"),
    ]);
    if (campaign.error || steps.error) throw new Error("campaign query failed");
    if (!campaign.data) return null;
    const { segments, ...record } = campaign.data;
    return { campaign: record, steps: steps.data ?? [], segmentName: segments?.name ?? null };
  },
);

/** Sample recipients for previews on the detail and approval pages (renderer input, no contact data). */
export async function previewRecipients(
  companyId: string,
  campaign: CampaignRecord,
  limit = 5,
  personalizedGreeting = false,
) {
  const source: CampaignSource = {
    presetKey: (campaign.segment_preset as PresetKey | null) ?? null,
    segmentId: campaign.segment_id,
    segmentName: null,
    rules: campaign.segment_rules_snapshot as unknown as RuleGroup,
    valueCategories: [],
    unavailableReason: null,
  };
  const all = await segmentRecipients(companyId, source);
  if (all.length <= limit) return withGreetings(companyId, all, personalizedGreeting);
  // Spread across the list and include one without a vehicle, so fallbacks are visible (spec §15).
  const picked = Array.from({ length: limit }, (_, i) => all[Math.floor((i * all.length) / limit)]);
  const missing = all.find((r) => !r.vehicleBrand);
  if (missing && !picked.includes(missing)) picked[limit - 1] = missing;
  return withGreetings(companyId, picked, personalizedGreeting);
}
