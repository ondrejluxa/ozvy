import { createServiceClient } from "@/lib/db/supabase/service-client";
import { env } from "@/lib/env";

/**
 * Uptime probe (spec §25): pinged every minute by the monitor. Public, so it
 * answers with status words only, never data. 503 when the database does
 * not answer.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (env.DATA_SOURCE !== "supabase") {
    return Response.json({ status: "ok", mode: "demo" }, { headers });
  }
  const started = Date.now();
  const { error } = await createServiceClient().from("platform_settings").select("id").limit(1);
  const ms = Date.now() - started;
  if (error) return Response.json({ status: "error", db: "unreachable" }, { status: 503, headers });
  return Response.json({ status: "ok", db: "ok", dbMs: ms }, { headers });
}
