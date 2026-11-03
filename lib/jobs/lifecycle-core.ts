import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../db/types.gen";

/**
 * Lifecycle recompute (spec §12): status, aggregates and eligibility per
 * company, in the database (public.recompute_lifecycle). No "server-only"
 * import, so the nightly script can call it with its own service client.
 * Logs carry IDs only.
 */

type Client = SupabaseClient<Database>;

/** Companies the nightly job covers: everyone not closed. */
export const NIGHTLY_STATUSES = ["onboarding", "active", "paused", "offboarding"] as const;

export async function recomputeCompany(client: Client, companyId: string): Promise<number> {
  const { data, error } = await client.rpc("recompute_lifecycle", { p_company_id: companyId });
  if (error) throw new Error(`recompute_lifecycle failed for ${companyId}: ${error.code}`);
  return data ?? 0;
}

export interface NightlyResult {
  companies: number;
  customers: number;
  failed: string[];
}

/** Every open company, one after another; a failing company does not stop the others. */
export async function recomputeAllCompanies(client: Client): Promise<NightlyResult> {
  const { data, error } = await client
    .from("companies")
    .select("id")
    .in("status", [...NIGHTLY_STATUSES])
    .order("id");
  if (error) throw new Error(`companies query failed: ${error.code}`);
  const result: NightlyResult = { companies: 0, customers: 0, failed: [] };
  for (const { id } of data ?? []) {
    try {
      result.customers += await recomputeCompany(client, id);
      result.companies++;
    } catch (err) {
      console.error("[lifecycle.nightly]", err instanceof Error ? err.message : "failed", id);
      result.failed.push(id);
    }
  }
  return result;
}
