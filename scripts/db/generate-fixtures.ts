/**
 * `pnpm db:fixtures`: (re)writes the import fixtures in supabase/seed/fixtures
 * from supabase/seed/fixture-files.ts. Output is deterministic and committed;
 * tests/unit/fixtures.test.ts fails if the files drift from the generator.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildFixtures } from "../../supabase/seed/fixture-files";

const dir = join(import.meta.dirname, "..", "..", "supabase", "seed", "fixtures");
mkdirSync(dir, { recursive: true });
const { files, manifest } = buildFixtures();
for (const file of files) {
  writeFileSync(join(dir, file.name), file.bytes);
  console.log(`${file.name.padEnd(30)} ${file.bytes.length.toLocaleString("cs-CZ")} B`);
}
writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("manifest.json");
