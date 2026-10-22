import "server-only";
import { cache } from "react";
import { isUuid } from "../../real-data-routes";
import type { Tables } from "../types.gen";
import { createSupabaseServerClient } from "./server-client";

/** Import reads for the operator (RLS: platform admin only). */

export type ImportRecord = Tables<"imports">;
export const IMPORT_ROWS_PAGE = 50;

export async function listImports(companyId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("imports")
    .select("id, type, file_name, status, counts, error, created_by, created_at, completed_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`imports query failed: ${error.code}`);
  const userIds = [...new Set((data ?? []).map((i) => i.created_by).filter((id): id is string => Boolean(id)))];
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
    : { data: [] };
  const names = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));
  return (data ?? []).map((i) => ({ ...i, createdByName: i.created_by ? (names.get(i.created_by) ?? null) : null }));
}

export const getImport = cache(async (companyId: string, importId: string): Promise<ImportRecord | null> => {
  if (!isUuid(companyId) || !isUuid(importId)) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("imports")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", importId)
    .maybeSingle();
  if (error) throw new Error(`import query failed: ${error.code}`);
  return data;
});

export type ImportRowFilter = "all" | "valid" | "warning" | "invalid" | "duplicate" | "excluded";

export async function listImportRows(companyId: string, importId: string, filter: ImportRowFilter, page: number) {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("import_rows")
    .select("row_number, raw, status, issues, normalized, match_customer_id", { count: "exact" })
    .eq("company_id", companyId)
    .eq("import_id", importId);
  if (filter !== "all") query = query.eq("status", filter);
  const from = (Math.max(1, page) - 1) * IMPORT_ROWS_PAGE;
  const { data, count, error } = await query.order("row_number").range(from, from + IMPORT_ROWS_PAGE - 1);
  if (error && error.code !== "PGRST103") throw new Error(`import rows query failed: ${error.code}`);
  return { rows: data ?? [], total: count ?? 0, pages: Math.max(1, Math.ceil((count ?? 0) / IMPORT_ROWS_PAGE)) };
}

/** Rows with problems for "Stáhnout chyby" (all of them, page by page). */
export async function listProblemRows(companyId: string, importId: string) {
  const supabase = await createSupabaseServerClient();
  const all: { row_number: number; raw: unknown; status: string; issues: unknown }[] = [];
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await supabase
      .from("import_rows")
      .select("row_number, raw, status, issues")
      .eq("company_id", companyId)
      .eq("import_id", importId)
      .in("status", ["invalid", "warning", "duplicate"])
      .order("row_number")
      .range(from, from + 999);
    if (error) throw new Error(`problem rows query failed: ${error.code}`);
    all.push(...(data ?? []));
    if ((data ?? []).length < 1_000) return all;
  }
}
