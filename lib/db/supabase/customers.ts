import "server-only";
import type { LifecycleStatus } from "../types";
import { createSupabaseServerClient } from "./server-client";

/**
 * Customer reads for DATA_SOURCE=supabase through the signed-in user's
 * session. The company filter is explicit and RLS enforces it again: a shop
 * user asking for another company's customers gets zero rows (spec §38.5).
 * Search, filters and the detail page follow in the customers slice (§40.6).
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

export async function listCustomerPage(companyId: string, requestedPage: number): Promise<RealCustomerPage> {
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, Math.floor(requestedPage) || 1);
  const from = (page - 1) * CUSTOMER_PAGE_SIZE;
  const { data, count, error } = await supabase
    .from("customers")
    .select(
      "id, first_name, last_name, phone_e164, lifecycle_status, last_visit_at, visit_count, vehicles(brand, model, license_plate_display)",
      { count: "exact" },
    )
    .eq("company_id", companyId)
    .order("last_name")
    .order("first_name")
    .order("id")
    .range(from, from + CUSTOMER_PAGE_SIZE - 1);
  // Past the last page PostgREST answers 416; show an empty page instead.
  if (error && error.code !== "PGRST103") throw new Error(`customers query failed: ${error.code}`);
  const total = count ?? 0;
  return {
    rows: (data ?? []).map((c) => {
      const [first, ...rest] = c.vehicles;
      return {
        id: c.id,
        name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "—",
        phone: c.phone_e164,
        vehicle: first ? [first.brand, first.model].filter(Boolean).join(" ") || null : null,
        plate: first?.license_plate_display ?? null,
        extraVehicles: rest.length,
        lastVisitAt: c.last_visit_at,
        visitCount: c.visit_count,
        status: c.lifecycle_status,
      };
    }),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE)),
  };
}
