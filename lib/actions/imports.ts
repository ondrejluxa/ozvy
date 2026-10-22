"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { z } from "zod";
import { requireContext } from "../auth/context";
import { audit } from "../audit";
import { DomainError } from "../db/mutations";
import { createSupabaseServerClient } from "../db/supabase/server-client";
import { IMPORT_MAX_BYTES, TEXT_ENCODINGS } from "../domain/imports/detect";
import { mappingProblems, TARGET_FIELDS, type ColumnMapping } from "../domain/imports/mapping";
import { statusFromIssues } from "../domain/imports/review";
import { enqueue } from "../jobs/runner";
import { run, type ActionResult } from "./result";

/**
 * Import wizard actions (spec §11, §20 imports.run). Writes use the
 * operator's session (RLS: platform admin); heavy work runs in jobs.
 */

const ids = z.object({ companyId: z.string().uuid(), importId: z.string().uuid() });

async function loadImport(companyId: string, importId: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("imports")
    .select("id, status, type, header, progress")
    .eq("id", importId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!data) throw new DomainError("not_found");
  return { supabase, imp: data };
}

// ---------- 1. upload ----------

export async function startImportAction(input: {
  companyId: string;
  type: "customers" | "visits";
  fileName: string;
  fileSize: number;
}): Promise<ActionResult<{ importId: string; path: string; token: string }>> {
  return run(async () => {
    const data = z
      .object({
        companyId: z.string().uuid(),
        type: z.enum(["customers", "visits"]),
        fileName: z.string().trim().min(1).max(200),
        fileSize: z.number().int().positive(),
      })
      .parse(input);
    const ctx = await requireContext({ permission: "imports.run", companyId: data.companyId });
    const ext = /\.(csv|txt|xlsx)$/i.exec(data.fileName)?.[1]?.toLowerCase();
    if (!ext) throw new DomainError("import_unsupported_type");
    if (data.fileSize > IMPORT_MAX_BYTES) throw new DomainError("import_too_large");

    const supabase = await createSupabaseServerClient();
    // A signed processing agreement is required before any import (spec §0.4, F1).
    const { data: company } = await supabase
      .from("companies")
      .select("dpa_signed_at")
      .eq("id", data.companyId)
      .single();
    if (!company?.dpa_signed_at) throw new DomainError("import_dpa_missing");

    const importId = randomUUID();
    const path = `${data.companyId}/${importId}/source.${ext}`;
    const { error } = await supabase.from("imports").insert({
      id: importId,
      company_id: data.companyId,
      type: data.type,
      file_path: path,
      file_name: data.fileName,
      file_size_bytes: data.fileSize,
      created_by: ctx.userId,
    });
    if (error) throw new Error(`import insert failed: ${error.code}`);
    const signed = await supabase.storage.from("imports").createSignedUploadUrl(path);
    if (signed.error || !signed.data) throw new Error("signed upload url failed");
    return { importId, path, token: signed.data.token };
  });
}

/** The browser finished uploading: record it and start parsing. */
export async function uploadFinishedAction(input: {
  companyId: string;
  importId: string;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const data = ids.parse(input);
    const ctx = await requireContext({ permission: "imports.run", companyId: data.companyId });
    const { imp } = await loadImport(data.companyId, data.importId);
    if (imp.status !== "uploaded") throw new DomainError("import_wrong_state");
    await audit({
      action: "import.uploaded",
      actorType: "admin",
      actorUserId: ctx.userId,
      companyId: data.companyId,
      entityType: "import",
      entityId: data.importId,
      metadata: { type: imp.type },
    });
    await enqueue({ name: "import/parse.requested", data });
    return null;
  });
}

// ---------- 2. re-parse with another encoding or sheet ----------

export async function reparseImportAction(input: {
  companyId: string;
  importId: string;
  encoding?: string;
  sheet?: string;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const data = ids
      .extend({ encoding: z.enum(TEXT_ENCODINGS).optional(), sheet: z.string().max(100).optional() })
      .parse(input);
    await requireContext({ permission: "imports.run", companyId: data.companyId });
    const { supabase, imp } = await loadImport(data.companyId, data.importId);
    if (!["mapping", "needs_review", "failed"].includes(imp.status)) throw new DomainError("import_wrong_state");
    await supabase
      .from("imports")
      .update({ status: "parsing" })
      .eq("id", data.importId)
      .eq("company_id", data.companyId);
    await enqueue({ name: "import/parse.requested", data });
    refresh();
    return null;
  });
}

// ---------- 3–4. mapping and legal basis ----------

export interface MappingFormState {
  problems?: string[];
  error?: string;
}

export async function saveMappingAction(_prev: MappingFormState, form: FormData): Promise<MappingFormState> {
  const data = ids.parse({ companyId: form.get("companyId"), importId: form.get("importId") });
  const ctx = await requireContext({ permission: "imports.run", companyId: data.companyId });
  const { supabase, imp } = await loadImport(data.companyId, data.importId);
  if (!["mapping", "needs_review"].includes(imp.status)) return { error: "import_wrong_state" };

  const header = (imp.header as string[]) ?? [];
  const mapping: ColumnMapping = {};
  for (const field of TARGET_FIELDS) {
    const value = String(form.get(`map_${field}`) ?? "");
    const index = Number(value);
    if (value !== "" && Number.isInteger(index) && index >= 0 && index < header.length) mapping[field] = index;
  }
  const problems: string[] = mappingProblems(mapping, imp.type as "customers" | "visits");

  // Legal basis (spec §11 step 4): a consent column, or one basis for the batch; always confirmed.
  const basis = String(form.get("legal_basis") ?? "");
  const declared = z.enum(["consent", "existing_customer", "unknown"]).safeParse(basis);
  if (!declared.success && mapping.marketing_consent === undefined) problems.push("legal_basis_required");
  if (form.get("legal_basis_confirmed") !== "on") problems.push("legal_basis_confirmation_required");
  if (problems.length) return { problems };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("imports")
    .update({
      mapping,
      legal_basis_declared: declared.success ? declared.data : null,
      legal_basis_confirmed_by: ctx.userId,
      legal_basis_confirmed_at: now,
      status: "validating",
    })
    .eq("id", data.importId)
    .eq("company_id", data.companyId);
  if (error) return { error: "save_failed" };
  // Saved per company and type, applied automatically next time.
  await supabase
    .from("import_mapping_templates")
    .upsert({ company_id: data.companyId, type: imp.type, mapping: { mapping, header }, updated_at: now });

  await enqueue({ name: "import/validate.requested", data });
  refresh();
  return {};
}

export async function backToMappingAction(input: { companyId: string; importId: string }): Promise<ActionResult<null>> {
  return run(async () => {
    const data = ids.parse(input);
    await requireContext({ permission: "imports.run", companyId: data.companyId });
    const { supabase, imp } = await loadImport(data.companyId, data.importId);
    if (imp.status !== "needs_review") throw new DomainError("import_wrong_state");
    await supabase
      .from("imports")
      .update({ status: "mapping" })
      .eq("id", data.importId)
      .eq("company_id", data.companyId);
    refresh();
    return null;
  });
}

// ---------- 6. review ----------

export async function setRowExcludedAction(input: {
  companyId: string;
  importId: string;
  rowNumber: number;
  excluded: boolean;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const data = ids.extend({ rowNumber: z.number().int().positive(), excluded: z.boolean() }).parse(input);
    await requireContext({ permission: "imports.run", companyId: data.companyId });
    const { supabase, imp } = await loadImport(data.companyId, data.importId);
    if (imp.status !== "needs_review") throw new DomainError("import_wrong_state");
    const { data: row } = await supabase
      .from("import_rows")
      .select("id, issues")
      .eq("import_id", data.importId)
      .eq("company_id", data.companyId)
      .eq("row_number", data.rowNumber)
      .single();
    if (!row) throw new DomainError("not_found");
    const status = data.excluded ? "excluded" : statusFromIssues(row.issues as string[]);
    await supabase.from("import_rows").update({ status }).eq("id", row.id);

    // Keep the summary counts in step with the rows.
    const statuses = ["valid", "warning", "invalid", "duplicate", "excluded"] as const;
    const counts = await Promise.all(
      statuses.map((s) =>
        supabase
          .from("import_rows")
          .select("id", { count: "exact", head: true })
          .eq("import_id", data.importId)
          .eq("status", s),
      ),
    );
    const { data: current } = await supabase.from("imports").select("counts").eq("id", data.importId).single();
    await supabase
      .from("imports")
      .update({
        counts: {
          ...(current?.counts as object),
          ...Object.fromEntries(statuses.map((s, i) => [s, counts[i].count ?? 0])),
        },
      })
      .eq("id", data.importId)
      .eq("company_id", data.companyId);
    refresh();
    return null;
  });
}

// ---------- 7. commit ----------

export async function commitImportAction(input: { companyId: string; importId: string }): Promise<ActionResult<null>> {
  return run(async () => {
    const data = ids.parse(input);
    await requireContext({ permission: "imports.run", companyId: data.companyId });
    const { supabase, imp } = await loadImport(data.companyId, data.importId);
    const resumable = imp.status === "failed" && Boolean((imp.progress as { batches_done?: number })?.batches_done);
    if (imp.status !== "needs_review" && !resumable) throw new DomainError("import_wrong_state");
    await supabase
      .from("imports")
      .update({ status: "committing" })
      .eq("id", data.importId)
      .eq("company_id", data.companyId);
    await enqueue({ name: "import/commit.requested", data });
    refresh();
    return null;
  });
}

export async function cancelImportAction(input: { companyId: string; importId: string }): Promise<ActionResult<null>> {
  return run(async () => {
    const data = ids.parse(input);
    await requireContext({ permission: "imports.run", companyId: data.companyId });
    const { supabase, imp } = await loadImport(data.companyId, data.importId);
    if (["committing", "completed", "cancelled"].includes(imp.status)) throw new DomainError("import_wrong_state");
    await supabase
      .from("imports")
      .update({ status: "cancelled" })
      .eq("id", data.importId)
      .eq("company_id", data.companyId);
    refresh();
    return null;
  });
}
