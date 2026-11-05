import "server-only";
import { createServiceClient } from "../db/supabase/service-client";
import { recomputeAllCompanies, recomputeCompany, type NightlyResult } from "./lifecycle-core";
import { runNightlyStats, type NightlyStatsResult } from "./stats-core";

/** Lifecycle jobs with the service role (spec §12, §40.8). */

export async function runLifecycleRecompute(input: { companyId: string }): Promise<void> {
  await recomputeCompany(createServiceClient(), input.companyId);
}

export async function runNightlyLifecycle(): Promise<NightlyResult> {
  return recomputeAllCompanies(createServiceClient());
}

/** Closes attribution windows and rebuilds monthly stats for every open company (spec §14). */
export async function runNightlyStatsJob(): Promise<NightlyStatsResult> {
  return runNightlyStats(createServiceClient(), new Date());
}
