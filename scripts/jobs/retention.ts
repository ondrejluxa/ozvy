/**
 * `pnpm jobs:retention`: runs the nightly retention once against the LOCAL
 * Supabase stack (in production Inngest runs it at 04:00 Prague). Same code
 * path: lib/jobs/retention-core.ts.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/db/types.gen";
import { runRetention } from "../../lib/jobs/retention-core";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url) || !serviceKey) {
  console.error("Refusing: this script runs against the local Supabase stack only. Run `pnpm env:local` first.");
  process.exit(1);
}

runRetention(createClient<Database>(url, serviceKey, { auth: { persistSession: false } }), new Date())
  .then((counts) => console.log(JSON.stringify(counts, null, 2)))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
