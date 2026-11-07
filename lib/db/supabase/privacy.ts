import "server-only";
import { env } from "../../env";
import { isUuid } from "../../real-data-routes";
import { suppressionHash } from "../../domain/messaging/opt-out";
import type { DsrStatus, DsrType, ExportSource } from "../../domain/privacy";
import { getCompanyRecord } from "./companies";
import { getCustomerDetail } from "./customers";
import { createSupabaseServerClient } from "./server-client";

/**
 * Data subject requests and retention flags (spec §21), read through the
 * signed-in user's session: RLS lets owners and the operator see them.
 */

export interface DsrRow {
  id: string;
  type: DsrType;
  status: DsrStatus;
  source: "operator" | "shop";
  customerId: string | null;
  customerName: string | null;
  subjectReference: string;
  dueAt: string;
  createdAt: string;
  completedAt: string | null;
}

export async function listDataSubjectRequests(
  companyId: string,
  opts: { customerId?: string } = {},
): Promise<DsrRow[]> {
  if (!isUuid(companyId)) return [];
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("data_subject_requests")
    .select(
      "id, type, status, source, customer_id, subject_reference, due_at, created_at, completed_at, customers(first_name, last_name)",
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (opts.customerId) query = query.eq("subject_reference", opts.customerId);
  const { data, error } = await query;
  if (error) throw new Error(`data subject requests query failed: ${error.code}`);
  const rows = (data ?? []).map((r) => ({
    id: r.id,
    type: r.type as DsrType,
    status: r.status as DsrStatus,
    source: r.source as "operator" | "shop",
    customerId: r.customer_id,
    customerName: r.customers
      ? [r.customers.first_name, r.customers.last_name].filter(Boolean).join(" ") || null
      : null,
    subjectReference: r.subject_reference,
    dueAt: r.due_at,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  }));
  // Open requests first, then the newest.
  return rows.sort((a, b) => Number(b.status === "open") - Number(a.status === "open"));
}

export async function getDataSubjectRequest(companyId: string, requestId: string) {
  if (!isUuid(companyId) || !isUuid(requestId)) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("data_subject_requests")
    .select("id, type, status, customer_id, subject_reference")
    .eq("company_id", companyId)
    .eq("id", requestId)
    .maybeSingle();
  return data;
}

export interface RetentionSummary {
  flagged: number;
  /** Earliest flag; deletion follows 30 days after it. */
  firstFlaggedAt: string | null;
  sample: { id: string; name: string; lastVisitAt: string | null }[];
}

/** Customers flagged for deletion by the nightly retention run (no visit in 5 years, no contact in 2). */
export async function getRetentionSummary(companyId: string): Promise<RetentionSummary> {
  if (!isUuid(companyId)) return { flagged: 0, firstFlaggedAt: null, sample: [] };
  const supabase = await createSupabaseServerClient();
  const { data, count, error } = await supabase
    .from("customers")
    .select("id, first_name, last_name, last_visit_at, retention_flagged_at", { count: "exact" })
    .eq("company_id", companyId)
    .not("retention_flagged_at", "is", null)
    .order("retention_flagged_at")
    .limit(20);
  if (error) throw new Error(`retention query failed: ${error.code}`);
  const rows = data ?? [];
  return {
    flagged: count ?? rows.length,
    firstFlaggedAt: rows[0]?.retention_flagged_at ?? null,
    sample: rows.map((r) => ({
      id: r.id,
      name: [r.first_name, r.last_name].filter(Boolean).join(" ") || "—",
      lastVisitAt: r.last_visit_at,
    })),
  };
}

/** Everything held about one customer, for an access request. */
export async function getCustomerExportSource(companyId: string, customerId: string): Promise<ExportSource | null> {
  const [detail, company] = await Promise.all([getCustomerDetail(companyId, customerId), getCompanyRecord(companyId)]);
  if (!detail || !company) return null;
  const supabase = await createSupabaseServerClient();
  const [customerRow, messages, conversions, suppression] = await Promise.all([
    supabase.from("customers").select("created_at").eq("company_id", companyId).eq("id", customerId).single(),
    supabase
      .from("messages")
      .select("sent_at, status, body_rendered, opted_out_at")
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .order("queued_at", { ascending: false })
      .limit(500),
    supabase
      .from("conversions")
      .select("stage, booked_at, completed_at, revenue_minor")
      .eq("company_id", companyId)
      .eq("customer_id", customerId),
    detail.customer.phone && env.SUPPRESSION_PEPPER
      ? supabase
          .from("suppression_list")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("address_hash", suppressionHash(detail.customer.phone, env.SUPPRESSION_PEPPER))
      : Promise.resolve({ count: 0, error: null }),
  ]);
  if (messages.error || conversions.error || customerRow.error) throw new Error("customer export query failed");
  const c = detail.customer;
  const visits = [...detail.vehicles.flatMap((v) => v.visits), ...detail.looseVisits];
  return {
    company: { name: company.name },
    customer: {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone,
      email: c.email,
      notes: c.notes,
      legalBasis: c.legalBasis,
      legalBasisSource: c.legalBasisSource,
      lifecycleStatus: c.status,
      lastVisitAt: c.lastVisitAt,
      createdAt: customerRow.data.created_at,
    },
    vehicles: detail.vehicles.map((v) => ({ brand: v.brand, model: v.model, plate: v.plate, year: v.modelYear })),
    visits: visits.map((v) => ({
      visitedAt: v.visited_at,
      service: v.service_type_raw ?? v.service_category,
      jobValueMinor: v.job_value_minor,
    })),
    messages: (messages.data ?? []).map((m) => ({
      sentAt: m.sent_at,
      status: m.status,
      body: m.body_rendered,
      optedOutAt: m.opted_out_at,
    })),
    conversions: (conversions.data ?? []).map((x) => ({
      stage: x.stage,
      bookedAt: x.booked_at,
      completedAt: x.completed_at,
      revenueMinor: x.revenue_minor,
    })),
    suppressed: c.status === "opted_out" || (suppression.count ?? 0) > 0,
  };
}
