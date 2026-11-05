import "server-only";
import type { EnrollmentStage, EnrollmentView } from "../../domain/attribution/conversions";
import { holdoutComparison, type HoldoutComparison } from "../../domain/attribution/kpis";
import { createSupabaseServerClient } from "./server-client";

/** Enrollments with their conversion for the customer and campaign pages (spec §8, §14). */

export interface EnrollmentRow extends EnrollmentView {
  campaignId: string;
  campaignName: string;
  customerId: string;
  customerName: string;
  vehicle: string | null;
  revenueMinor: number | null;
  completedAt: string | null;
  bookedAt: string | null;
  source: string | null;
}

const SELECT = `id, stage, is_holdout, first_sent_at, window_ends_at, campaign_id, customer_id,
  campaigns(name, started_at),
  customers(first_name, last_name),
  vehicles(brand, model, license_plate_display),
  conversions(revenue_minor, completed_at, booked_at, source)`;

type Raw = {
  id: string;
  stage: string;
  is_holdout: boolean;
  first_sent_at: string | null;
  window_ends_at: string | null;
  campaign_id: string;
  customer_id: string;
  campaigns: { name: string; started_at: string | null } | null;
  customers: { first_name: string | null; last_name: string | null } | null;
  vehicles: { brand: string | null; model: string | null; license_plate_display: string | null } | null;
  conversions:
    | { revenue_minor: number | null; completed_at: string | null; booked_at: string | null; source: string }[]
    | { revenue_minor: number | null; completed_at: string | null; booked_at: string | null; source: string }
    | null;
};

function toRow(r: Raw): EnrollmentRow {
  const conv = Array.isArray(r.conversions) ? (r.conversions[0] ?? null) : r.conversions;
  const v = r.vehicles;
  return {
    id: r.id,
    stage: r.stage as EnrollmentStage,
    isHoldout: r.is_holdout,
    firstSentAt: r.first_sent_at,
    campaignStartedAt: r.campaigns?.started_at ?? null,
    windowEndsAt: r.window_ends_at,
    campaignId: r.campaign_id,
    campaignName: r.campaigns?.name ?? "",
    customerId: r.customer_id,
    customerName: [r.customers?.first_name, r.customers?.last_name].filter(Boolean).join(" "),
    vehicle: v?.brand ? [v.brand, v.model, v.license_plate_display].filter(Boolean).join(" ") : null,
    revenueMinor: conv?.revenue_minor ?? null,
    completedAt: conv?.completed_at ?? null,
    bookedAt: conv?.booked_at ?? null,
    source: conv?.source ?? null,
  };
}

export async function customerEnrollments(companyId: string, customerId: string): Promise<EnrollmentRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("campaign_enrollments")
    .select(SELECT)
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`customer enrollments failed: ${error.code}`);
  return ((data ?? []) as unknown as Raw[]).map(toRow);
}

export const RECIPIENT_FILTERS = ["all", "contacted", "booked", "completed", "lost", "holdout"] as const;
export type RecipientFilter = (typeof RECIPIENT_FILTERS)[number];
export const RECIPIENTS_PAGE_SIZE = 50;

export async function campaignRecipients(
  companyId: string,
  campaignId: string,
  opts: { filter: RecipientFilter; page: number },
): Promise<{ rows: EnrollmentRow[]; total: number }> {
  const supabase = await createSupabaseServerClient();
  let q = supabase
    .from("campaign_enrollments")
    .select(SELECT, { count: "exact" })
    .eq("company_id", companyId)
    .eq("campaign_id", campaignId);
  if (opts.filter === "holdout") q = q.eq("is_holdout", true);
  else if (opts.filter !== "all") q = q.eq("stage", opts.filter).eq("is_holdout", false);
  const from = (Math.max(1, opts.page) - 1) * RECIPIENTS_PAGE_SIZE;
  const { data, count, error } = await q
    .order("stage", { ascending: false })
    .order("id")
    .range(from, from + RECIPIENTS_PAGE_SIZE - 1);
  if (error) throw new Error(`campaign recipients failed: ${error.code}`);
  return { rows: ((data ?? []) as unknown as Raw[]).map(toRow), total: count ?? 0 };
}

export interface CampaignResults {
  treated: number;
  holdout: number;
  booked: number;
  completed: number;
  holdoutCompleted: number;
  revenueMinor: number;
  comparison: HoldoutComparison;
}

/** Results of one campaign; holdout returns are shown next to, never inside, recovered revenue. */
export async function campaignResults(companyId: string, campaignId: string): Promise<CampaignResults> {
  const supabase = await createSupabaseServerClient();
  const count = (holdout: boolean) =>
    supabase
      .from("campaign_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("campaign_id", campaignId)
      .eq("is_holdout", holdout)
      .then((r) => r.count ?? 0);
  const [treated, holdout, conversions] = await Promise.all([
    count(false),
    count(true),
    supabase
      .from("conversions")
      .select("stage, is_holdout, revenue_minor")
      .eq("company_id", companyId)
      .eq("campaign_id", campaignId)
      .limit(10_000),
  ]);
  const rows = conversions.data ?? [];
  const completed = rows.filter((c) => c.stage === "completed" && !c.is_holdout);
  const holdoutCompleted = rows.filter((c) => c.stage === "completed" && c.is_holdout).length;
  const revenueMinor = completed.reduce((sum, c) => sum + Number(c.revenue_minor ?? 0), 0);
  return {
    treated,
    holdout,
    booked: rows.filter((c) => c.stage === "booked" && !c.is_holdout).length,
    completed: completed.length,
    holdoutCompleted,
    revenueMinor,
    comparison: holdoutComparison({
      treatedCount: treated,
      treatedCompleted: completed.length,
      treatedRevenueMinor: revenueMinor,
      holdoutCount: holdout,
      holdoutCompleted,
    }),
  };
}
