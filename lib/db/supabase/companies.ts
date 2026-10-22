import "server-only";
import { cache } from "react";
import { isUuid } from "../../real-data-routes";
import type { Tables } from "../types.gen";
import { createSupabaseServerClient } from "./server-client";

/**
 * Company reads for DATA_SOURCE=supabase, through the signed-in user's
 * session: RLS decides which companies are visible (all for the platform
 * admin, own company for shop users).
 */

export interface CompanyListItem {
  id: string;
  name: string;
  city: string | null;
  status: string;
  sendingEnabled: boolean;
  createdAt: string;
  customers: number;
}

export async function listVisibleCompanies(): Promise<CompanyListItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("companies")
    .select("id, name, city, status, sending_enabled, created_at, customers(count)")
    .order("name");
  if (error) throw new Error(`companies query failed: ${error.code}`);
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    city: c.city,
    status: c.status,
    sendingEnabled: c.sending_enabled,
    createdAt: c.created_at,
    customers: c.customers[0]?.count ?? 0,
  }));
}

export interface CompanyDetail {
  id: string;
  name: string;
  ico: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  averageJobValueMinor: number;
  defaultSenderName: string | null;
  requiresClientApproval: boolean;
  sendingEnabled: boolean;
  status: string;
  dpaSignedAt: string | null;
  customers: number;
  vehicles: number;
}

/** One company with its customer and vehicle counts, or null when RLS hides it (or it does not exist). */
export const getCompanyDetail = cache(async (companyId: string): Promise<CompanyDetail | null> => {
  if (!isUuid(companyId)) return null;
  const supabase = await createSupabaseServerClient();
  const { data: c, error } = await supabase
    .from("companies")
    .select(
      "id, name, ico, address_line, postal_code, city, contact_person, phone, email, average_job_value_minor, default_sender_name, requires_client_approval, sending_enabled, status, dpa_signed_at",
    )
    .eq("id", companyId)
    .maybeSingle();
  if (error) throw new Error(`company query failed: ${error.code}`);
  if (!c) return null;
  const [customers, vehicles] = await Promise.all(
    (["customers", "vehicles"] as const).map((table) =>
      supabase.from(table).select("id", { count: "exact", head: true }).eq("company_id", companyId),
    ),
  );
  return {
    id: c.id,
    name: c.name,
    ico: c.ico,
    addressLine: c.address_line,
    postalCode: c.postal_code,
    city: c.city,
    contactPerson: c.contact_person,
    phone: c.phone,
    email: c.email,
    averageJobValueMinor: c.average_job_value_minor,
    defaultSenderName: c.default_sender_name,
    requiresClientApproval: c.requires_client_approval,
    sendingEnabled: c.sending_enabled,
    status: c.status,
    dpaSignedAt: c.dpa_signed_at,
    customers: customers.count ?? 0,
    vehicles: vehicles.count ?? 0,
  };
});

export type CompanyRecord = Tables<"companies">;

/** The full company row for the operator's edit forms, or null when RLS hides it. */
export const getCompanyRecord = cache(async (companyId: string): Promise<CompanyRecord | null> => {
  if (!isUuid(companyId)) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("companies").select("*").eq("id", companyId).maybeSingle();
  if (error) throw new Error(`company query failed: ${error.code}`);
  return data;
});

export interface CompanyUsers {
  members: { userId: string; fullName: string | null; role: "shop_owner" | "shop_manager"; since: string }[];
  pending: { id: string; email: string; role: "shop_owner" | "shop_manager"; expiresAt: string }[];
}

/** Members and still-valid invitations of one company (operator view). */
export async function listCompanyUsers(companyId: string): Promise<CompanyUsers> {
  const supabase = await createSupabaseServerClient();
  const [members, invitations] = await Promise.all([
    supabase.from("memberships").select("user_id, role, created_at").eq("company_id", companyId).order("created_at"),
    supabase
      .from("invitations")
      .select("id, email, role, expires_at")
      .eq("company_id", companyId)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at"),
  ]);
  if (members.error || invitations.error) throw new Error("company users query failed");
  const ids = (members.data ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("user_id, full_name").in("user_id", ids)
    : { data: [] };
  const names = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));
  return {
    members: (members.data ?? []).map((m) => ({
      userId: m.user_id,
      fullName: names.get(m.user_id) ?? null,
      role: m.role,
      since: m.created_at,
    })),
    pending: (invitations.data ?? []).map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expires_at,
    })),
  };
}
