/**
 * `pnpm jobs:nightly`: runs the nightly lifecycle recompute once, by hand,
 * against the LOCAL Supabase stack (in production Inngest runs it at 03:00
 * Europe/Prague, lib/jobs/inngest.ts). Same code path: lib/jobs/lifecycle-core.ts.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/db/types.gen";
import { recomputeAllCompanies } from "../../lib/jobs/lifecycle-core";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url) || !serviceKey) {
  console.error("Refusing: this script runs against the local Supabase stack only. Run `pnpm env:local` first.");
  process.exit(1);
}

const started = Date.now();
recomputeAllCompanies(createClient<Database>(url, serviceKey, { auth: { persistSession: false } }))
  .then((r) => {
    console.log(
      `Recomputed ${r.companies} companies, ${r.customers} customers in ${((Date.now() - started) / 1000).toFixed(1)} s.`,
    );
    if (r.failed.length) {
      console.error(`Failed: ${r.failed.join(", ")}`);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
