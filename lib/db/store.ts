import "server-only";
import { env } from "../env";
import { seedDemoDatabase } from "./demo/seed";
import type { DemoDatabase } from "./schema";

/**
 * Phase 0 data store: one in-memory database per server process, seeded
 * deterministically on first use. Demo edits (new campaigns, conversions)
 * live until "Resetovat demo" or a server restart.
 *
 * Phase 1 replaces this module with Supabase clients (lib/db/server-client.ts,
 * lib/db/for-company.ts); queries.ts and mutations.ts keep their signatures.
 */

const KEY = Symbol.for("navrat.demo-db");
type GlobalWithDb = typeof globalThis & { [KEY]?: DemoDatabase };
const g = globalThis as GlobalWithDb;

export function getDb(): DemoDatabase {
  // Demo data must never appear in the real app, labelled or not.
  if (env.DATA_SOURCE !== "demo") throw new Error("The in-memory demo store is only available with DATA_SOURCE=demo.");
  g[KEY] ??= seedDemoDatabase(new Date());
  return g[KEY];
}

export function resetDb(): DemoDatabase {
  if (env.DATA_SOURCE !== "demo") throw new Error("The in-memory demo store is only available with DATA_SOURCE=demo.");
  g[KEY] = seedDemoDatabase(new Date());
  return g[KEY];
}

/** Bumps the version so derived per-company indexes are rebuilt. */
export function markChanged(db: DemoDatabase) {
  db.version++;
}
