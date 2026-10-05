import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../env";
import type { Database } from "../types.gen";

/**
 * Service-role client: bypasses RLS. Server-only (never import from client
 * components) and used only where no user session can carry the request:
 * jobs, audit writes and token-scoped flows such as invitation acceptance
 * (spec §17 layer 3, §42 rule 2). Company-scoped job code must add the
 * company filter itself (db.forCompany in later slices).
 */
let client: SupabaseClient<Database> | null = null;

export function createServiceClient(): SupabaseClient<Database> {
  client ??= createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
