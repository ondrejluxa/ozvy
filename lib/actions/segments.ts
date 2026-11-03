"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireContext } from "../auth/context";
import { DomainError } from "../db/mutations";
import type { Json } from "../db/types.gen";
import { previewRules, sampleEligible, type SegmentCounts } from "../db/supabase/segments";
import { createSupabaseServerClient } from "../db/supabase/server-client";
import { builderSchema, builderToRules, parseRules, type SegmentBuilderInput } from "../domain/segments/schema";
import { run, type ActionResult } from "./result";

/**
 * Segment builder actions (spec §12, §20 segments.manage: the operator in the
 * managed service). Rules are built from the form, validated, and only then
 * compiled by the database.
 */

const companyId = z.string().uuid();

function rulesFrom(builder: SegmentBuilderInput) {
  const parsed = builderSchema.safeParse(builder);
  if (!parsed.success) throw new DomainError(`segment_${parsed.error.issues[0].message}`);
  const rules = parseRules(builderToRules(parsed.data));
  if (!rules.ok) throw new DomainError("segment_invalid");
  return rules.rules;
}

export async function previewSegmentAction(input: {
  companyId: string;
  builder: SegmentBuilderInput;
}): Promise<ActionResult<SegmentCounts & { sample: { id: string; name: string; lastVisitAt: string | null }[] }>> {
  return run(async () => {
    const id = companyId.parse(input.companyId);
    await requireContext({ permission: "segments.manage", companyId: id });
    const rules = rulesFrom(input.builder);
    const [counts, sample] = await Promise.all([previewRules(id, rules), sampleEligible(id, rules)]);
    return { ...counts, sample };
  });
}

export async function createSegmentAction(input: {
  companyId: string;
  name: string;
  builder: SegmentBuilderInput;
}): Promise<ActionResult<{ segmentId: string }>> {
  return run(async () => {
    const id = companyId.parse(input.companyId);
    const ctx = await requireContext({ permission: "segments.manage", companyId: id });
    const name = z.string().trim().min(1).max(120).safeParse(input.name);
    if (!name.success) throw new DomainError("segment_name_required");
    const rules = rulesFrom(input.builder);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("segments")
      .insert({ company_id: id, name: name.data, rules: rules as unknown as NonNullable<Json>, created_by: ctx.userId })
      .select("id")
      .single();
    if (error || !data) throw new Error(`segment insert failed: ${error?.code}`);
    refresh();
    return { segmentId: data.id };
  });
}

export async function archiveSegmentAction(input: {
  companyId: string;
  segmentId: string;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const data = z.object({ companyId, segmentId: z.string().uuid() }).parse(input);
    await requireContext({ permission: "segments.manage", companyId: data.companyId });
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("segments")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", data.segmentId)
      .eq("company_id", data.companyId);
    if (error) throw new Error(`segment archive failed: ${error.code}`);
    refresh();
    return null;
  });
}
