import "server-only";
import { suggestVocatives } from "../ai/client";
import { logGeneration } from "../ai/log";
import { getTextModel } from "../ai/provider";
import { VOCATIVES_BATCH_SIZE } from "../ai/prompts/vocatives.v1";
import { createServiceClient } from "../db/supabase/service-client";
import { normalizeSurname, ruleVocative } from "../domain/messaging/vocative";

/**
 * Fills name_vocatives for a company's surnames (spec §15): rules first,
 * an AI batch for the rest (surnames only), and a review-only placeholder
 * for anything the model could not answer, so it is not asked again.
 * Existing rows, reviewed or not, are never overwritten.
 */

export interface VocativeRefreshResult {
  rule: number;
  ai: number;
  unresolved: number;
}

interface Row {
  company_id: string;
  surname: string;
  vocative: string;
  gender: "m" | "f" | "unknown";
  confidence: number;
  source: "rule" | "ai";
}

export async function runVocativeRefresh(input: {
  companyId: string;
  userId?: string | null;
}): Promise<VocativeRefreshResult> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("vocative_candidates", { p_company_id: input.companyId });
  if (error) throw new Error(`vocative candidates failed: ${error.code}`);
  const surnames = (data ?? []).map((r) => r.surname);

  const rows: Row[] = [];
  const forAi: string[] = [];
  for (const surname of surnames) {
    const g = ruleVocative(surname);
    if (g) rows.push({ company_id: input.companyId, surname, ...g, source: "rule" });
    else forAi.push(surname);
  }
  const result: VocativeRefreshResult = { rule: rows.length, ai: 0, unresolved: 0 };

  const model = forAi.length ? await getTextModel() : null;
  for (let i = 0; model && i < forAi.length; i += VOCATIVES_BATCH_SIZE) {
    const batch = forAi.slice(i, i + VOCATIVES_BATCH_SIZE);
    let suggested: Awaited<ReturnType<typeof suggestVocatives>> | null = null;
    try {
      suggested = await suggestVocatives({ surnames: batch, model });
      await logGeneration({
        companyId: input.companyId,
        kind: "vocatives",
        promptVersion: suggested.promptVersion,
        model: suggested.model,
        input: { surnames: batch },
        output: { suggested: suggested.suggestions.size, dropped: suggested.dropped.length },
        chosenIndex: null,
        tokensIn: suggested.tokensIn,
        tokensOut: suggested.tokensOut,
        createdBy: input.userId ?? null,
      });
    } catch (err) {
      console.error("[ai] vocative batch failed", err instanceof Error ? err.name : "");
    }
    for (const surname of batch) {
      const s = suggested?.suggestions.get(normalizeSurname(surname));
      if (s) {
        rows.push({ company_id: input.companyId, surname, ...s, source: "ai" });
        result.ai++;
      } else {
        // Shown on the review screen; the greeting stays "Dobrý den," until then.
        rows.push({
          company_id: input.companyId,
          surname,
          vocative: normalizeSurname(surname),
          gender: "unknown",
          confidence: 0,
          source: "ai",
        });
        result.unresolved++;
      }
    }
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error: upsertError } = await db
      .from("name_vocatives")
      .upsert(rows.slice(i, i + 500), { onConflict: "company_id,surname", ignoreDuplicates: true });
    if (upsertError) throw new Error(`vocative upsert failed: ${upsertError.code}`);
  }
  return result;
}
