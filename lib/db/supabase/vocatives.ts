import "server-only";
import { REVIEW_THRESHOLD, type Gender } from "../../domain/messaging/vocative";
import { createSupabaseServerClient } from "./server-client";
import { createServiceClient } from "./service-client";

/** Vocative review screen data (spec §15). Operator pages only. */

export interface VocativeRow {
  id: string;
  surname: string;
  vocative: string;
  gender: Gender;
  confidence: number;
  source: "rule" | "ai" | "operator";
  reviewedAt: string | null;
}

export interface VocativeOverview {
  total: number;
  approved: number;
  needsReview: number;
  /** Customer surnames without any vocative yet. */
  missing: number;
  review: VocativeRow[];
  reviewed: VocativeRow[];
}

const COLUMNS = "id, surname, vocative, gender, confidence, source, reviewed_at";
const NEEDS_REVIEW = `confidence.lt.${REVIEW_THRESHOLD},gender.eq.unknown`;

function toRow(v: {
  id: string;
  surname: string;
  vocative: string;
  gender: string;
  confidence: number;
  source: string;
  reviewed_at: string | null;
}): VocativeRow {
  return {
    id: v.id,
    surname: v.surname,
    vocative: v.vocative,
    gender: v.gender as Gender,
    confidence: Number(v.confidence),
    source: v.source as VocativeRow["source"],
    reviewedAt: v.reviewed_at,
  };
}

export async function getVocativeOverview(companyId: string): Promise<VocativeOverview> {
  const supabase = await createSupabaseServerClient();
  const base = () =>
    supabase.from("name_vocatives").select("id", { count: "exact", head: true }).eq("company_id", companyId);
  const [total, approved, needsReview, review, reviewed, missing] = await Promise.all([
    base(),
    base().neq("gender", "unknown").or(`reviewed_at.not.is.null,confidence.gte.${REVIEW_THRESHOLD}`),
    base().is("reviewed_at", null).or(NEEDS_REVIEW),
    supabase
      .from("name_vocatives")
      .select(COLUMNS)
      .eq("company_id", companyId)
      .is("reviewed_at", null)
      .or(NEEDS_REVIEW)
      .order("confidence")
      .order("surname")
      .limit(100),
    supabase
      .from("name_vocatives")
      .select(COLUMNS)
      .eq("company_id", companyId)
      .not("reviewed_at", "is", null)
      .order("reviewed_at", { ascending: false })
      .limit(20),
    // Service role: the candidate function reads the company's customers (page is operator-gated).
    createServiceClient().rpc("vocative_candidates", { p_company_id: companyId }),
  ]);
  return {
    total: total.count ?? 0,
    approved: approved.count ?? 0,
    needsReview: needsReview.count ?? 0,
    missing: missing.data?.length ?? 0,
    review: (review.data ?? []).map(toRow),
    reviewed: (reviewed.data ?? []).map(toRow),
  };
}
