import "server-only";
import { cache } from "react";
import type { CustomerFilters } from "../queries";
import type { LegalBasis, LifecycleStatus, ServiceCategory } from "../types";
import { isUuid } from "../../real-data-routes";
import { toDateOnly } from "../../domain/dates";
import { resolveCompanySettings } from "../../domain/company-settings";
import { parseSearch } from "../../domain/customer-search";
import { eligibilityReason, type ExclusionReason } from "../../domain/contact-rules/audience";
import { fromDateOnly } from "../../domain/dates";
import { getCompanyRecord } from "./companies";
import { createSupabaseServerClient } from "./server-client";

/**
 * Customer reads for DATA_SOURCE=supabase through the signed-in user's
 * session. The company is always explicit and RLS enforces it again: a shop
 * user asking for another company's customer gets zero rows (spec §38.5).
 */

export const CUSTOMER_PAGE_SIZE = 50;

export interface RealCustomerRow {
  id: string;
  name: string;
  phone: string | null;
  vehicle: string | null;
  plate: string | null;
  extraVehicles: number;
  lastVisitAt: string | null;
  visitCount: number;
  status: LifecycleStatus;
}

export interface RealCustomerPage {
  rows: RealCustomerRow[];
  total: number;
  page: number;
  pages: number;
}

const fullName = (c: { first_name: string | null; last_name: string | null }) =>
  [c.first_name, c.last_name].filter(Boolean).join(" ") || "—";

export async function listCustomerPage(companyId: string, filters: CustomerFilters): Promise<RealCustomerPage> {
  const company = await getCompanyRecord(companyId);
  if (!company) return { rows: [], total: 0, page: 1, pages: 1 };
  const settings = resolveCompanySettings(company.settings);
  const page = Math.max(1, Math.floor(filters.page ?? 1) || 1);
  const terms = parseSearch(filters.q);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_customers", {
    p_company_id: companyId,
    p_today: toDateOnly(new Date()),
    p_name: terms.name ?? undefined,
    p_digits: terms.digits ?? undefined,
    p_plate: terms.plate ?? undefined,
    p_status: filters.status,
    p_last_visit: filters.lastVisit,
    p_category: filters.category,
    p_eligibility: filters.eligibility,
    p_lookback_months: settings.max_lookback_months,
    p_limit: CUSTOMER_PAGE_SIZE,
    p_offset: (page - 1) * CUSTOMER_PAGE_SIZE,
  });
  if (error) throw new Error(`customers query failed: ${error.code}`);
  const rows = data ?? [];
  const total = rows[0]?.total_count ?? 0;
  return {
    rows: rows.map((c) => ({
      id: c.id,
      name: fullName(c),
      phone: c.phone_e164,
      vehicle: c.vehicle,
      plate: c.plate,
      extraVehicles: Math.max(0, c.vehicle_count - 1),
      lastVisitAt: c.last_visit_at,
      visitCount: c.visit_count,
      status: c.lifecycle_status,
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE)),
  };
}

// ---------- detail ----------

export interface RealVisit {
  id: string;
  visited_at: string;
  service_type_raw: string | null;
  service_category: ServiceCategory;
  job_value_minor: number | null;
}

export interface RealCustomerDetail {
  customer: {
    id: string;
    companyId: string;
    name: string;
    firstName: string | null;
    lastName: string | null;
    externalId: string | null;
    phone: string | null;
    phoneType: "mobile" | "fixed" | "unknown";
    email: string | null;
    legalBasis: LegalBasis;
    legalBasisSource: string | null;
    legalBasisRecordedAt: string | null;
    status: LifecycleStatus;
    lastVisitAt: string | null;
    visitCount: number;
    lifetimeValueMinor: number;
    notes: string | null;
  };
  eligibility: ExclusionReason | null;
  vehicles: {
    id: string;
    brand: string | null;
    model: string | null;
    modelYear: number | null;
    plate: string | null;
    vin: string | null;
    status: LifecycleStatus;
    visits: RealVisit[];
  }[];
  looseVisits: RealVisit[];
}

/** One customer of one company, or null when it does not exist there (or RLS hides it). */
export const getCustomerDetail = cache(
  async (companyId: string, customerId: string): Promise<RealCustomerDetail | null> => {
    if (!isUuid(companyId) || !isUuid(customerId)) return null;
    const supabase = await createSupabaseServerClient();
    const [customer, vehicles, visits, company] = await Promise.all([
      supabase.from("customers").select("*").eq("company_id", companyId).eq("id", customerId).maybeSingle(),
      supabase
        .from("vehicles")
        .select("id, brand, model, model_year, license_plate_display, vin, lifecycle_status, last_visit_at")
        .eq("company_id", companyId)
        .eq("customer_id", customerId)
        .order("last_visit_at", { ascending: false, nullsFirst: false }),
      supabase
        .from("visits")
        .select("id, vehicle_id, visited_at, service_type_raw, service_category, job_value_minor")
        .eq("company_id", companyId)
        .eq("customer_id", customerId)
        .order("visited_at", { ascending: false }),
      getCompanyRecord(companyId),
    ]);
    if (customer.error || vehicles.error || visits.error) throw new Error("customer detail query failed");
    const c = customer.data;
    if (!c || !company) return null;

    const settings = resolveCompanySettings(company.settings);
    const phoneType = (["mobile", "fixed"].includes(c.phone_type) ? c.phone_type : "unknown") as
      "mobile" | "fixed" | "unknown";
    const allVisits = visits.data ?? [];
    const strip = (v: (typeof allVisits)[number]): RealVisit => ({
      id: v.id,
      visited_at: v.visited_at,
      service_type_raw: v.service_type_raw,
      service_category: v.service_category,
      job_value_minor: v.job_value_minor,
    });

    return {
      customer: {
        id: c.id,
        companyId: c.company_id,
        name: fullName(c),
        firstName: c.first_name,
        lastName: c.last_name,
        externalId: c.external_id,
        phone: c.phone_e164,
        phoneType,
        email: c.email,
        legalBasis: c.legal_basis,
        legalBasisSource: c.legal_basis_source,
        legalBasisRecordedAt: c.legal_basis_recorded_at,
        status: c.lifecycle_status,
        lastVisitAt: c.last_visit_at,
        visitCount: c.visit_count,
        lifetimeValueMinor: c.lifetime_value_minor,
        notes: c.notes,
      },
      // Suppression joins the check with the opt-out slice (§40.13); until then opted_out status stands in.
      eligibility: eligibilityReason(
        { id: c.id, legal_basis: c.legal_basis, phone_type: phoneType, phone_e164: c.phone_e164 },
        c.lifecycle_status === "opted_out",
        c.last_visit_at ? fromDateOnly(c.last_visit_at) : null,
        new Date(),
        settings,
      ),
      vehicles: (vehicles.data ?? []).map((v) => ({
        id: v.id,
        brand: v.brand,
        model: v.model,
        modelYear: v.model_year,
        plate: v.license_plate_display,
        vin: v.vin,
        status: v.lifecycle_status,
        visits: allVisits.filter((x) => x.vehicle_id === v.id).map(strip),
      })),
      looseVisits: allVisits.filter((x) => !x.vehicle_id).map(strip),
    };
  },
);
