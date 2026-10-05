/**
 * Runs `next <args>` with variables from an env file layered under the
 * current environment (already-set variables win). Next forwards node flags
 * to its workers, so `node --env-file` cannot be used directly.
 *
 * Usage: node scripts/dev/next-with-env.mjs .env.supabase.local dev -p 3001
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const [file, ...args] = process.argv.slice(2);
const fromFile = {};
for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
  if (match) fromFile[match[1]] = match[2].replace(/^"(.*)"$/, "$1");
}

const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", ...args], {
  stdio: "inherit",
  env: { ...fromFile, ...process.env },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
