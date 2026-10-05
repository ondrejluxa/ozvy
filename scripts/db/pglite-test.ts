/**
 * Local database test runner without Docker: applies supabase/migrations to
 * an in-process PGlite (real PostgreSQL compiled to WebAssembly) on top of a
 * minimal Supabase stub, then runs supabase/tests/database/*.test.sql with a
 * pgTAP shim. The authoritative run is `pnpm db:test` (Supabase CLI + real
 * pgTAP) locally with Docker and in CI.
 *
 * Usage: pnpm db:test:local
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = join(import.meta.dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

async function main() {
  const db = new PGlite();
  const notices: string[] = [];

  await db.exec(read("scripts", "db", "supabase-stub.sql"));
  await db.exec(read("scripts", "db", "pgtap-shim.sql"));

  const migrations = readdirSync(join(root, "supabase", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of migrations) {
    try {
      await db.exec(read("supabase", "migrations", file));
      console.log(`migrated ${file}`);
    } catch (err) {
      console.error(`\nMigration failed: ${file}\n${(err as Error).message}`);
      process.exit(1);
    }
  }

  const testDir = join("supabase", "tests", "database");
  const tests = readdirSync(join(root, testDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let failures = 0;

  for (const file of tests) {
    console.log(`\n# ${file}`);
    // The real pgTAP extension is replaced by the shim.
    const sql = read(testDir, file).replace(/create extension if not exists pgtap[^;]*;/gi, "");
    notices.length = 0;
    try {
      const results = await db.exec(sql, { onNotice: (n) => notices.push(n.message ?? "") });
      for (const result of results) {
        for (const row of result.rows) {
          for (const value of Object.values(row)) {
            if (typeof value !== "string" || !/^(not ok|ok|1\.\.|#)/.test(value)) continue;
            console.log(value);
            if (value.startsWith("not ok") || value.startsWith("# Looks like you failed")) failures++;
          }
        }
      }
    } catch (err) {
      failures++;
      console.error(`not ok - ${file} aborted: ${(err as Error).message}`);
      await db.exec("rollback").catch(() => undefined);
    }
    for (const n of notices) console.log(`#${n}`);
  }

  await db.close();
  if (failures > 0) {
    console.error(`\nDatabase tests FAILED (${failures} failing line(s)).`);
    process.exit(1);
  }
  console.log("\nAll database tests passed.");
}

void main();
