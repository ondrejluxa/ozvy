import "server-only";
import type { Json } from "../db/types.gen";
import { createServiceClient } from "../db/supabase/service-client";

/**
 * ai_generations writes (spec §15, §18). The table has no client write
 * policies, so the server uses the service role and always sets company_id
 * itself. Logging never blocks the operator: a failed insert is reported
 * and the generation is still returned.
 */

export type GenerationKind = "campaign_template" | "campaign_rewrite" | "vocatives";

export async function logGeneration(row: {
  companyId: string;
  kind: GenerationKind;
  promptVersion: string;
  model: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  chosenIndex: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  createdBy: string | null;
  campaignId?: string | null;
}): Promise<string | null> {
  const { data, error } = await createServiceClient()
    .from("ai_generations")
    .insert({
      company_id: row.companyId,
      campaign_id: row.campaignId ?? null,
      kind: row.kind,
      prompt_version: row.promptVersion,
      model: row.model,
      input: row.input as NonNullable<Json>,
      output: row.output as Json,
      chosen_index: row.chosenIndex,
      tokens_in: row.tokensIn,
      tokens_out: row.tokensOut,
      created_by: row.createdBy,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[ai] generation log failed", error?.code);
    return null;
  }
  return data.id;
}

/** The operator picked another variant of a logged generation. */
export async function setChosenVariant(companyId: string, generationId: string, userId: string | null, index: number) {
  if (!userId) return;
  await createServiceClient()
    .from("ai_generations")
    .update({ chosen_index: index })
    .eq("company_id", companyId)
    .eq("id", generationId)
    .eq("created_by", userId);
}

/** Links the session's generations to the campaign they ended up in. */
export async function attachGenerations(companyId: string, campaignId: string, userId: string | null, ids: string[]) {
  if (!userId || ids.length === 0) return;
  await createServiceClient()
    .from("ai_generations")
    .update({ campaign_id: campaignId })
    .eq("company_id", companyId)
    .eq("created_by", userId)
    .is("campaign_id", null)
    .in("id", ids.slice(0, 50));
}
