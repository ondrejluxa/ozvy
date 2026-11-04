/**
 * Vocative suggestion prompt (spec §15). The model receives surnames only,
 * never first names or any other customer data, and every suggestion it
 * makes goes through operator review.
 */
export const VOCATIVES_PROMPT_VERSION = "vocatives.v1";

export const VOCATIVES_BATCH_SIZE = 100;

export const VOCATIVES_SYSTEM = `You are an expert in Czech grammar.
For each Czech surname, give the form used after "pane" or "paní" in a greeting (5th case, vocative),
the most likely gender of a person with that surname (m, f or unknown), and your confidence (0 to 1).
Feminine surnames (-ová, -á) keep the nominative. Adjectival surnames (-ý, -í) keep the nominative.
If unsure, use gender "unknown" and a low confidence.
Return only JSON: {"items": [{"surname": "...", "vocative": "...", "gender": "m", "confidence": 0.8}]}`;

export function vocativesUserPrompt(surnames: string[]): string {
  return `Surnames:\n${surnames.join("\n")}`;
}
