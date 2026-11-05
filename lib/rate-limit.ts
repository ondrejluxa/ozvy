import "server-only";
import { headers } from "next/headers";
import { createServiceClient } from "./db/supabase/service-client";
import { clientIp, RATE_LIMITS, rateLimitKey, type RateLimitScope } from "./domain/rate-limit";
import { env } from "./env";

/**
 * Counts one attempt per subject and says whether all of them are within
 * the scope's limit (spec §22). Fails open on a database error: a broken
 * counter must not lock everyone out; the error is logged without the subject.
 * On the local stack every request comes from one machine, so per-IP limits
 * apply only in staging and production; per-user and per-e-mail limits
 * apply everywhere.
 */
export async function allowRate(
  scope: RateLimitScope,
  subjects: Record<string, string>,
  opts: { increment?: boolean } = {},
): Promise<boolean> {
  if (env.DATA_SOURCE !== "supabase") return true;
  const { limit, windowSeconds } = RATE_LIMITS[scope];
  const db = createServiceClient();
  const counted = Object.entries(subjects).filter(
    ([kind, subject]) => kind !== "ip" || (env.APP_ENV !== "local" && subject !== "unknown"),
  );
  const results = await Promise.all(
    counted.map(async ([kind, subject]) => {
      const { data, error } = await db.rpc("hit_rate_limit", {
        p_key: rateLimitKey(scope, kind, subject),
        p_limit: limit,
        p_window_seconds: windowSeconds,
        p_increment: opts.increment ?? true,
      });
      if (error) {
        console.error("[rate-limit] counter failed", scope, error.code);
        return true;
      }
      return data !== false;
    }),
  );
  return results.every(Boolean);
}

/** The caller's IP for per-IP limits. */
export async function requestIp(): Promise<string> {
  return clientIp(await headers());
}
