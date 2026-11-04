import type { SupabaseClient } from "@supabase/supabase-js";
import { greetingFor, isVocativeApproved, type Gender } from "../domain/messaging/vocative";
import type { Database } from "./types.gen";

/**
 * Approved greetings ("Dobrý den, pane Nováku,") per surname for one company
 * (spec §15). Shared by previews (user session) and the send job (service
 * role); surnames without an approved vocative are absent from the map.
 */
export async function lookupGreetings(
  db: SupabaseClient<Database>,
  companyId: string,
  surnames: (string | null)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(surnames.map((s) => s?.trim()).filter((s): s is string => Boolean(s)))];
  const chunks = Array.from({ length: Math.ceil(unique.length / 150) }, (_, i) => unique.slice(i * 150, i * 150 + 150));
  const results = await Promise.all(
    chunks.map((chunk) =>
      db
        .from("name_vocatives")
        .select("surname, vocative, gender, confidence, reviewed_at")
        .eq("company_id", companyId)
        .in("surname", chunk),
    ),
  );
  const greetings = new Map<string, string>();
  for (const { data, error } of results) {
    if (error) throw new Error(`vocative lookup failed: ${error.code}`);
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
  return greetings;
}
