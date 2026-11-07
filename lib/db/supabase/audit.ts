import "server-only";
import { isUuid } from "../../real-data-routes";
import { AUDIT_PAGE_SIZE, auditRange, type AuditFilter } from "../../domain/audit-filters";
import { createSupabaseServerClient } from "./server-client";

/**
 * The append-only audit log (spec §23), read through the user's session: the
 * operator reads everything, a shop owner only their own shop's rows.
 */

export interface AuditRow {
  id: number;
  createdAt: string;
  action: string;
  actorType: "user" | "admin" | "system";
  actorName: string | null;
  companyId: string | null;
  companyName: string | null;
  entityType: string | null;
  metadata: unknown;
}

export async function listAuditLogs(
  scope: { companyId: string } | { all: true },
  filter: AuditFilter,
): Promise<{ rows: AuditRow[]; hasMore: boolean }> {
  if ("companyId" in scope && !isUuid(scope.companyId)) return { rows: [], hasMore: false };
  const supabase = await createSupabaseServerClient();
  const offset = (filter.page - 1) * AUDIT_PAGE_SIZE;
  let query = supabase
    .from("audit_logs")
    .select("id, created_at, action, actor_type, actor_user_id, company_id, entity_type, metadata, companies(name)")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    // One extra row tells whether a next page exists, without a count over the whole log.
    .range(offset, offset + AUDIT_PAGE_SIZE);
  if ("companyId" in scope) query = query.eq("company_id", scope.companyId);
  if (filter.group) query = query.like("action", `${filter.group}.%`);
  const { gte, lt } = auditRange(filter);
  if (gte) query = query.gte("created_at", gte);
  if (lt) query = query.lt("created_at", lt);
  const { data, error } = await query;
  if (error) throw new Error(`audit log query failed: ${error.code}`);

  const rows = (data ?? []).slice(0, AUDIT_PAGE_SIZE);
  const actorIds = [...new Set(rows.map((r) => r.actor_user_id).filter((id): id is string => Boolean(id)))];
  const { data: profiles } = actorIds.length
    ? await supabase.from("profiles").select("user_id, full_name").in("user_id", actorIds)
    : { data: [] };
  const names = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));

  return {
    rows: rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      action: r.action,
      actorType: r.actor_type as AuditRow["actorType"],
      actorName: r.actor_user_id ? (names.get(r.actor_user_id) ?? null) : null,
      companyId: r.company_id,
      companyName: r.companies?.name ?? null,
      entityType: r.entity_type,
      metadata: r.metadata,
    })),
    hasMore: (data ?? []).length > AUDIT_PAGE_SIZE,
  };
}
