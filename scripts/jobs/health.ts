/**
 * `pnpm jobs:health`: runs the Attention Required health check once against
 * the LOCAL Supabase stack and prints the operator digest it would e-mail
 * (in production Inngest runs the check every 15 minutes and the digest at
 * 06:00 Prague, lib/jobs/inngest.ts). Same code path: lib/jobs/alerts-core.ts.
 */
import { createClient } from "@supabase/supabase-js";
import messages from "../../messages/cs.json";
import type { Database } from "../../lib/db/types.gen";
import { buildDigest, runHealthCheck } from "../../lib/jobs/alerts-core";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url) || !serviceKey) {
  console.error("Refusing: this script runs against the local Supabase stack only. Run `pnpm env:local` first.");
  process.exit(1);
}

const titles = Object.fromEntries(
  Object.entries(messages.alerts as Record<string, unknown>)
    .filter(([, v]) => typeof v === "object" && v !== null && "digest" in v)
    .map(([k, v]) => [k, (v as { digest: string }).digest]),
);

const db = createClient<Database>(url, serviceKey, { auth: { persistSession: false } });
const now = new Date();
runHealthCheck(db, now)
  .then(async (r) => {
    console.log(`Open alerts: ${r.open} (new ${r.opened}, resolved ${r.resolved}).`);
    const digest = await buildDigest(db, now, { titles, appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "" });
    console.log(`\n${digest.text}`);
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
