import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../db/types.gen";
import { pragueParts, pragueTime } from "../domain/dates";

/**
 * Attribution windows and monthly stats (spec §14 "Storage"): enrollments
 * whose window closed without a completed return become "lost", and
 * company_monthly_stats is rebuilt from raw rows. Conversion edits already
 * recompute their months in the database; this covers messages and windows.
 */

type Db = SupabaseClient<Database>;

/** First day of the month `offset` months from `now`, Prague calendar, as "2026-11-01". */
export function monthStart(now: Date, offset = 0): string {
  const p = pragueParts(now);
  const d = pragueTime(p.year, p.month + offset, 1, 12);
  const q = pragueParts(d);
  return `${q.year}-${String(q.month).padStart(2, "0")}-01`;
}

export async function closeWindows(db: Db, now: Date): Promise<number> {
  const { data, error } = await db.rpc("close_attribution_windows", { p_now: now.toISOString() });
  if (error) throw new Error(`close windows failed: ${error.code}`);
  return data ?? 0;
}

/** Current and previous month for the given companies (late DLRs and edits land in either). */
export async function recomputeStats(db: Db, companyIds: string[], now: Date): Promise<number> {
  let months = 0;
  for (const companyId of companyIds) {
    const { data, error } = await db.rpc("recompute_monthly_stats", {
      p_company_id: companyId,
      p_from: monthStart(now, -1),
      p_to: monthStart(now),
    });
    if (error) throw new Error(`monthly stats failed: ${error.code}`);
    months += data ?? 0;
  }
  return months;
}

export interface NightlyStatsResult {
  closed: number;
  companies: number;
}

export async function runNightlyStats(db: Db, now: Date): Promise<NightlyStatsResult> {
  const closed = await closeWindows(db, now);
  const { data: companies, error } = await db.from("companies").select("id").neq("status", "closed");
  if (error) throw new Error(`companies read failed: ${error.code}`);
  const ids = (companies ?? []).map((c) => c.id);
  await recomputeStats(db, ids, now);
  return { closed, companies: ids.length };
}
