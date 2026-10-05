import "server-only";
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
  g[KEY] ??= seedDemoDatabase(new Date());
  return g[KEY];
}

export function resetDb(): DemoDatabase {
  g[KEY] = seedDemoDatabase(new Date());
  return g[KEY];
}

/** Bumps the version so derived per-company indexes are rebuilt. */
export function markChanged(db: DemoDatabase) {
  db.version++;
}
