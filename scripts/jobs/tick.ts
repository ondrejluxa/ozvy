/**
 * `pnpm jobs:tick [--now=2026-11-09T10:00:00+01:00]`: runs one messaging tick
 * against the LOCAL Supabase stack with the mock SMS provider (in production
 * Inngest runs it every minute, lib/jobs/inngest.ts). Same code path:
 * lib/jobs/messaging-core.ts. --now overrides the clock, e.g. to test the
 * sending window or follow-up delays in the evening.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/db/types.gen";
import { runMessagingTick } from "../../lib/jobs/messaging-core";
import { createMockSmsProvider } from "../../lib/providers/sms/mock";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url) || !serviceKey) {
  console.error("Refusing: this script runs against the local Supabase stack only. Run `pnpm env:local` first.");
  process.exit(1);
}
const nowArg = process.argv.find((a) => a.startsWith("--now="))?.slice(6);
const fixed = nowArg ? new Date(nowArg) : null;
if (fixed && Number.isNaN(fixed.getTime())) {
  console.error(`Invalid --now: ${nowArg}`);
  process.exit(1);
}

runMessagingTick({
  db: createClient<Database>(url, serviceKey, { auth: { persistSession: false } }),
  provider: createMockSmsProvider({ latencyMs: 0 }),
  now: () => fixed ?? new Date(),
  ratePerSecond: 50,
  maxPerTick: 5000,
  optOutBase: process.env.OPT_OUT_BASE_URL || "example.cz/o",
  whitelist: { realProvider: false, production: false, numbers: [] },
  sleep: async () => {},
})
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
