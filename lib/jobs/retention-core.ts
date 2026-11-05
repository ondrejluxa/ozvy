import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../db/types.gen";

/**
 * Nightly retention (spec §21), with its own audit entry:
 *
 * | Data | Kept |
 * | --- | --- |
 * | uploaded import files | 30 days (Storage) |
 * | import_rows staging | 90 days |
 * | message bodies | 24 months, then "[redacted]" |
 * | customers, no visit in 5 y and no contact in 2 y | flagged, deleted 30 days later |
 * | audit logs | 24 months |
 * | offboarded shops | 30 days after the contract ended |
 */

type Db = SupabaseClient<Database>;

const IMPORT_BUCKET = "imports";

export async function runRetention(db: Db, now: Date): Promise<Record<string, number>> {
  // 1. Import files in Storage (the database function cannot reach Storage).
  const cutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  let files = 0;
  for (let round = 0; round < 20; round++) {
    const { data: old, error } = await db
      .from("imports")
      .select("id, company_id, file_path")
      .not("file_path", "is", null)
      .lt("created_at", cutoff)
      .limit(100);
    if (error) throw new Error(`retention imports failed: ${error.code}`);
    if (!old?.length) break;
    const { error: removeError } = await db.storage.from(IMPORT_BUCKET).remove(old.map((i) => i.file_path!));
    if (removeError) throw new Error(`retention storage failed: ${removeError.message}`);
    await db
      .from("imports")
      .update({ file_path: null })
      .in(
        "id",
        old.map((i) => i.id),
      );
    files += old.length;
    if (old.length < 100) break;
  }

  // 2. Everything else in one transaction.
  const { data, error } = await db.rpc("run_retention", { p_now: now.toISOString() });
  if (error) throw new Error(`run_retention failed: ${error.code}`);
  const counts = { import_files: files, ...((data ?? {}) as Record<string, number>) };

  await db.from("audit_logs").insert({
    actor_type: "system",
    action: "system.retention_run",
    entity_type: "platform",
    metadata: counts as NonNullable<Json>,
  });
  return counts;
}
