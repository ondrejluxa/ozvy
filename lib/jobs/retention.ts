import "server-only";
import { createServiceClient } from "../db/supabase/service-client";
import { runRetention } from "./retention-core";

export async function runRetentionJob(): Promise<Record<string, number>> {
  return runRetention(createServiceClient(), new Date());
}
