import "server-only";
import { createHash } from "node:crypto";
import { audit } from "../audit";
import type { Json, TablesUpdate } from "../db/types.gen";
import { createServiceClient } from "../db/supabase/service-client";
import type { LegalBasis, ServiceCategory } from "../db/types";
import { toDateOnly } from "../domain/dates";
import { planCommit } from "../domain/imports/commit";
import { checkImportFile, type TextEncodingName } from "../domain/imports/detect";
import { initialMapping, type ColumnMapping, type ImportType } from "../domain/imports/mapping";
import { ImportParseError, parseImportFile } from "../domain/imports/parse";
import {
  countStatuses,
  looksLikeRealData,
  validateRows,
  type ExistingData,
  type IssueCode,
  type NormalizedRecord,
  type RowResult,
  type RowStatus,
} from "../domain/imports/validate";
import { env } from "../env";

/**
 * Import jobs (spec §11 steps 2, 5, 7; §24). They run in the background
 * (Inngest, or inline after the response locally) with the service role and
 * always filter by company_id themselves. Payloads carry IDs only; logs never
 * contain row contents (spec §22).
 */

const IMPORT_BUCKET = "imports";
const PAGE = 1_000;
const STAGE_CHUNK = 2_000;

const db = () => createServiceClient();

async function setImport(companyId: string, importId: string, patch: TablesUpdate<"imports">) {
  const { error } = await db().from("imports").update(patch).eq("id", importId).eq("company_id", companyId);
  if (error) throw new Error(`import update failed: ${error.code}`);
}

async function fail(companyId: string, importId: string, code: string) {
  await setImport(companyId, importId, { status: "failed", error: code });
  await audit({
    action: "import.failed",
    actorType: "system",
    companyId,
    entityType: "import",
    entityId: importId,
    metadata: { error: code },
  });
}

async function loadImport(companyId: string, importId: string) {
  const { data, error } = await db()
    .from("imports")
    .select("*")
    .eq("id", importId)
    .eq("company_id", companyId)
    .single();
  if (error || !data) throw new Error("import not found");
  return data;
}

/** All rows of a query, page by page (PostgREST caps responses). */
async function pages<T>(
  fetch: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetch(from, from + PAGE - 1);
    if (error) throw new Error("paged query failed");
    all.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return all;
  }
}

// ---------- parse ----------

export async function runParseImport(input: {
  companyId: string;
  importId: string;
  encoding?: TextEncodingName;
  sheet?: string;
}): Promise<void> {
  const { companyId, importId } = input;
  const imp = await loadImport(companyId, importId);
  await setImport(companyId, importId, { status: "parsing", error: null });
  try {
    const { data: blob, error } = await db().storage.from(IMPORT_BUCKET).download(imp.file_path!);
    if (error || !blob) return await fail(companyId, importId, "file_missing");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const check = checkImportFile({ name: imp.file_name ?? "", size: bytes.length, bytes });
    if (!check.ok) return await fail(companyId, importId, check.issue);

    const parsed = parseImportFile(check.kind, bytes, { encoding: input.encoding, sheet: input.sheet });

    // Re-parse (other encoding or sheet) replaces the staged rows.
    await db().from("import_rows").delete().eq("import_id", importId).eq("company_id", companyId);
    const ragged = new Set(parsed.raggedRows);
    for (let i = 0; i < parsed.rows.length; i += STAGE_CHUNK) {
      const { error: insertError } = await db()
        .from("import_rows")
        .insert(
          parsed.rows.slice(i, i + STAGE_CHUNK).map((r) => ({
            import_id: importId,
            company_id: companyId,
            row_number: r.sourceRow,
            raw: r.cells,
            status: "pending",
            issues: ragged.has(r.sourceRow) ? ["column_count"] : [],
          })),
        );
      if (insertError) throw new Error(`staging failed: ${insertError.code}`);
    }

    const { data: template } = await db()
      .from("import_mapping_templates")
      .select("mapping")
      .eq("company_id", companyId)
      .eq("type", imp.type)
      .maybeSingle();
    const saved = template?.mapping as { mapping: ColumnMapping; header: string[] } | null;
    const { mapping, templateApplied } = initialMapping(saved, parsed.header);

    await setImport(companyId, importId, {
      status: "mapping",
      encoding: parsed.encoding,
      delimiter: parsed.delimiter,
      sheet: parsed.sheet,
      sheet_names: parsed.sheetNames,
      header: parsed.header,
      preview: parsed.rows.slice(0, 5).map((r) => r.cells),
      row_count: parsed.rows.length,
      mapping: mapping as Json,
      counts: {
        total: parsed.rows.length,
        ragged: parsed.raggedRows.length,
        template_applied: templateApplied,
      },
    });
  } catch (err) {
    if (err instanceof ImportParseError) return await fail(companyId, importId, err.code);
    console.error("[import.parse] failed", importId, err instanceof Error ? err.message : "");
    await fail(companyId, importId, "parse_failed");
  }
}

// ---------- validate ----------

async function existingData(companyId: string): Promise<ExistingData> {
  const customers = await pages((from, to) =>
    db()
      .from("customers")
      .select("id, external_id, phone_e164, last_name, email")
      .eq("company_id", companyId)
      .order("id")
      .range(from, to),
  );
  const vehicles = await pages((from, to) =>
    db()
      .from("vehicles")
      .select("id, customer_id, license_plate_norm, vin")
      .eq("company_id", companyId)
      .order("id")
      .range(from, to),
  );
  return {
    customers: customers.map((c) => ({
      id: c.id,
      externalId: c.external_id,
      phone: c.phone_e164,
      lastName: c.last_name,
      email: c.email,
    })),
    vehicles: vehicles.map((v) => ({
      id: v.id,
      customerId: v.customer_id,
      plateNorm: v.license_plate_norm,
      vin: v.vin,
    })),
  };
}

export async function runValidateImport(input: { companyId: string; importId: string }): Promise<void> {
  const { companyId, importId } = input;
  const imp = await loadImport(companyId, importId);
  await setImport(companyId, importId, { status: "validating", error: null });
  try {
    const staged = await pages((from, to) =>
      db()
        .from("import_rows")
        .select("row_number, raw, status, issues")
        .eq("import_id", importId)
        .eq("company_id", companyId)
        .order("row_number")
        .range(from, to),
    );
    const results = validateRows({
      type: imp.type as ImportType,
      mapping: (imp.mapping ?? {}) as ColumnMapping,
      today: toDateOnly(new Date()),
      existing: await existingData(companyId),
      rows: staged.map((r) => ({
        rowNumber: r.row_number,
        cells: r.raw as string[],
        excluded: r.status === "excluded",
        ragged: (r.issues as string[]).includes("column_count"),
      })),
    });

    if (
      env.APP_ENV !== "production" &&
      env.DEV_ALLOW_REAL_LOOKING_DATA !== "true" &&
      looksLikeRealData(results.map((r) => r.normalized?.customer.email ?? null))
    ) {
      return await fail(companyId, importId, "real_looking_data");
    }

    for (let i = 0; i < results.length; i += STAGE_CHUNK) {
      const { error } = await db().rpc("set_import_row_results", {
        p_company_id: companyId,
        p_import_id: importId,
        p_rows: results.slice(i, i + STAGE_CHUNK).map((r) => ({
          row_number: r.rowNumber,
          status: r.status,
          issues: r.issues,
          normalized: r.normalized,
          match_customer_id: r.matchCustomerId,
        })) as unknown as Json,
      });
      if (error) throw new Error(`row results failed: ${error.code}`);
    }
    const counts = countStatuses(results);
    await setImport(companyId, importId, {
      status: "needs_review",
      counts: {
        ...counts,
        matched: results.filter((r) => r.matchCustomerId && (r.status === "valid" || r.status === "warning")).length,
        ambiguous: results.filter((r) => r.ambiguous).length,
      },
    });
  } catch (err) {
    console.error("[import.validate] failed", importId, err instanceof Error ? err.message : "");
    await fail(companyId, importId, "validate_failed");
  }
}

// ---------- commit ----------

/** Deterministic UUID (version-4 layout) from a key: stable across job re-runs. */
export function uuidFromKey(key: string): string {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const shortHash = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 32);

export async function runCommitImport(input: { companyId: string; importId: string }): Promise<void> {
  const { companyId, importId } = input;
  const imp = await loadImport(companyId, importId);
  await setImport(companyId, importId, { status: "committing", error: null });
  try {
    const rows = await pages((from, to) =>
      db()
        .from("import_rows")
        .select("row_number, status, issues, normalized, match_customer_id")
        .eq("import_id", importId)
        .eq("company_id", companyId)
        .in("status", ["valid", "warning"])
        .order("row_number")
        .range(from, to),
    );
    const results: RowResult[] = rows.map((r) => ({
      rowNumber: r.row_number,
      status: r.status as RowStatus,
      issues: r.issues as IssueCode[],
      normalized: r.normalized as unknown as NormalizedRecord | null,
      matchCustomerId: r.match_customer_id,
      ambiguous: (r.issues as string[]).includes("ambiguous_match"),
    }));
    const mappings = await pages((from, to) =>
      db()
        .from("service_category_mappings")
        .select("raw_value_norm, category")
        .eq("company_id", companyId)
        .range(from, to),
    );
    const { batches, customerIds } = planCommit(results, {
      importId,
      declaredBasis: (imp.legal_basis_declared as LegalBasis | null) ?? null,
      recordedAt: imp.legal_basis_confirmed_at ?? new Date().toISOString(),
      existing: await existingData(companyId),
      companyMappings: new Map(mappings.map((m) => [m.raw_value_norm, m.category as ServiceCategory])),
      idFor: uuidFromKey,
      hash: shortHash,
    });

    // Resumable: batches already committed by an earlier attempt are skipped (spec §24).
    const done = Number((imp.progress as { batches_done?: number } | null)?.batches_done ?? 0);
    const totals: Record<string, number> = {
      ...((imp.counts as { committed?: Record<string, number> })?.committed ?? {}),
    };
    for (let b = done; b < batches.length; b++) {
      const batch = batches[b];
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data, error } = await db().rpc("commit_import_batch", {
          p_company_id: companyId,
          p_import_id: importId,
          p_batch: b + 1,
          p_payload: { customers: batch.customers, vehicles: batch.vehicles, visits: batch.visits } as unknown as Json,
        });
        if (!error) {
          for (const [k, v] of Object.entries((data ?? {}) as Record<string, number>)) totals[k] = (totals[k] ?? 0) + v;
          lastError = null;
          break;
        }
        lastError = error;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
      if (lastError) {
        console.error("[import.commit] batch failed", importId, b + 1, (lastError as { code?: string }).code);
        await setImport(companyId, importId, { counts: { ...(imp.counts as object), committed: totals } });
        return await fail(companyId, importId, "commit_failed");
      }
    }

    for (let i = 0; i < customerIds.length; i += 5_000) {
      const { error } = await db().rpc("recompute_lifecycle", {
        p_company_id: companyId,
        p_customer_ids: customerIds.slice(i, i + 5_000),
      });
      if (error) throw new Error(`lifecycle recompute failed: ${error.code}`);
    }

    const skipped = (imp.counts as { total?: number }).total! - results.filter((r) => !r.ambiguous).length;
    await setImport(companyId, importId, {
      status: "completed",
      completed_at: new Date().toISOString(),
      counts: { ...(imp.counts as object), committed: totals, skipped },
    });
    await audit({
      action: "import.committed",
      actorType: "system",
      actorUserId: imp.created_by,
      companyId,
      entityType: "import",
      entityId: importId,
      metadata: {
        customers_created: totals.customers_created ?? 0,
        customers_updated: totals.customers_updated ?? 0,
        visits_created: totals.visits_created ?? 0,
        skipped,
      },
    });
  } catch (err) {
    console.error("[import.commit] failed", importId, err instanceof Error ? err.message : "");
    await fail(companyId, importId, "commit_failed");
  }
}
