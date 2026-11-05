/**
 * `pnpm db:restore-drill`: the backup restore drill (spec §30) on the LOCAL
 * Supabase stack. It makes the same logical dump as the nightly backup
 * (pg_dump, custom format), restores it into a fresh database in the local
 * container, then compares row counts of every public table and checks that
 * RLS is still enabled and forced everywhere. The restored database is
 * dropped at the end and the result is appended to
 * docs/runbooks/restore-drill-log.md. Never touches anything but Docker.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_navrat";
const DRILL_DB = "restore_drill";
const LOG = join(process.cwd(), "docs", "runbooks", "restore-drill-log.md");

function docker(args: string[], input?: string): string {
  return execFileSync("docker", args, { encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024 });
}
function psql(db: string, sql: string): string {
  return docker([
    "exec",
    "-i",
    CONTAINER,
    "psql",
    "-U",
    "postgres",
    "-d",
    db,
    "-At",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]).trim();
}

const COUNTS_SQL = `select string_agg(format('%s=%s', c.relname,
    (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text),
  ',' order by c.relname)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'`;
const UNPROTECTED_SQL = `select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and (not c.relrowsecurity or not c.relforcerowsecurity)`;

const started = new Date();
let result = "FAILED";
let detail = "";
try {
  const source = Object.fromEntries(
    psql("postgres", COUNTS_SQL)
      .split(",")
      .map((kv) => kv.split("=")),
  );
  console.log(`Dumping ${Object.keys(source).length} public tables …`);
  docker(["exec", CONTAINER, "pg_dump", "-U", "postgres", "-d", "postgres", "-Fc", "-f", "/tmp/drill.dump"]);

  psql("postgres", `drop database if exists ${DRILL_DB}`);
  psql("postgres", `create database ${DRILL_DB}`);
  console.log("Restoring into a fresh database …");
  try {
    docker(["exec", CONTAINER, "pg_restore", "-U", "postgres", "-d", DRILL_DB, "--no-owner", "/tmp/drill.dump"]);
  } catch {
    // pg_restore exits non-zero on harmless warnings (platform extensions that
    // already exist); the counts and RLS checks below decide the result.
  }
  const restored = Object.fromEntries(
    psql(DRILL_DB, COUNTS_SQL)
      .split(",")
      .map((kv) => kv.split("=")),
  );
  const mismatches = Object.keys(source).filter((t) => source[t] !== restored[t]);
  const unprotected = Number(psql(DRILL_DB, UNPROTECTED_SQL));
  detail = `${Object.keys(source).length} tables, ${Object.values(source).reduce((a: number, n) => a + Number(n), 0)} rows`;
  if (mismatches.length)
    detail += `; count mismatch: ${mismatches.map((t) => `${t} ${source[t]}→${restored[t]}`).join(", ")}`;
  if (unprotected) detail += `; ${unprotected} tables without enabled + forced RLS`;
  result = mismatches.length === 0 && unprotected === 0 ? "PASS" : "FAILED";
  console.log(`${result}: ${detail}`);
} catch (err) {
  detail = err instanceof Error ? err.message.split("\n")[0] : String(err);
  console.error(`FAILED: ${detail}`);
} finally {
  try {
    psql("postgres", `drop database if exists ${DRILL_DB}`);
    docker(["exec", CONTAINER, "rm", "-f", "/tmp/drill.dump"]);
  } catch {
    // Cleanup is best effort.
  }
  const seconds = ((Date.now() - started.getTime()) / 1000).toFixed(0);
  appendFileSync(
    LOG,
    `| ${started.toISOString()} | local stack (${CONTAINER}) | ${result} | ${detail} | ${seconds} s |\n`,
  );
}
process.exit(result === "PASS" ? 0 : 1);
