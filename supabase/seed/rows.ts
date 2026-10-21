import { seedDemoDatabase } from "../../lib/db/demo/seed";
import { SERVICE_TYPES_RAW } from "../../lib/db/demo/fixtures";
import type { DemoDatabase } from "../../lib/db/schema";
import type { ServiceCategory } from "../../lib/db/types";
import type { TablesInsert } from "../../lib/db/types.gen";
import { fromDateOnly } from "../../lib/domain/dates";
import { customerStatus, statusFromLastVisit, type VisitStatus } from "../../lib/domain/lifecycle";
import { normalizeServiceLabel } from "../../lib/domain/service-labels";

/**
 * Rows for the Supabase seed (spec §31), built from the same deterministic
 * world as the Phase 0 demo, so the operator sees the same three shops in
 * both modes. Only tables of the current schema are filled; data for tables
 * added by later slices (suppression list, campaigns, messages, conversions,
 * imports) is loaded in the slice that creates them (ADR-004).
 *
 * Pure: no I/O, so it is unit-tested in tests/unit/seed-rows.test.ts.
 */

export type CompanyRole = "shop_owner" | "shop_manager";

export interface SeedAccount {
  email: string;
  fullName: string;
  platformAdmin: boolean;
  /** Index into SeedWorld.companies. */
  company: number | null;
  role: CompanyRole | null;
}

/** Fixed seeded accounts (all on example.cz). Passwords come from SEED_USER_PASSWORD. */
export const SEED_ACCOUNTS: SeedAccount[] = [
  { email: "operator@navrat.example.cz", fullName: "Operátor Návrat", platformAdmin: true, company: null, role: null },
  {
    email: "majitel@dvorak.example.cz",
    fullName: "Pavel Dvořák",
    platformAdmin: false,
    company: 0,
    role: "shop_owner",
  },
  {
    email: "vedouci@dvorak.example.cz",
    fullName: "Lucie Benešová",
    platformAdmin: false,
    company: 0,
    role: "shop_manager",
  },
  { email: "majitel@horak.example.cz", fullName: "Martin Horák", platformAdmin: false, company: 1, role: "shop_owner" },
  { email: "vedouci@horak.example.cz", fullName: "Tomáš Kříž", platformAdmin: false, company: 1, role: "shop_manager" },
  { email: "majitel@nadrazi.example.cz", fullName: "Jiří Málek", platformAdmin: false, company: 2, role: "shop_owner" },
  {
    email: "vedouci@nadrazi.example.cz",
    fullName: "Petra Svobodová",
    platformAdmin: false,
    company: 2,
    role: "shop_manager",
  },
];

export interface SeedWorld {
  companies: (TablesInsert<"companies"> & { id: string })[];
  customers: (TablesInsert<"customers"> & { id: string; company_id: string })[];
  vehicles: (TablesInsert<"vehicles"> & { id: string; company_id: string })[];
  visits: (TablesInsert<"visits"> & { id: string; company_id: string })[];
  serviceCategoryMappings: TablesInsert<"service_category_mappings">[];
  accounts: SeedAccount[];
}

export function buildSeedWorld(now: Date): SeedWorld {
  const db = seedDemoDatabase(now);
  const companies = db.companies.map((c) => ({
    id: c.id,
    name: c.name,
    ico: c.ico,
    dic: c.dic,
    address_line: c.address_line,
    city: c.city,
    postal_code: c.postal_code,
    country: c.country,
    phone: c.phone,
    email: c.email,
    website: c.website,
    contact_person: c.contact_person,
    timezone: c.timezone,
    average_job_value_minor: c.average_job_value_minor,
    default_sender_name: c.default_sender_name,
    service_mode: c.service_mode,
    requires_client_approval: c.requires_client_approval,
    settings: { ...c.settings },
    sending_enabled: c.sending_enabled,
    dpa_signed_at: c.dpa_signed_at,
    status: c.status,
    created_at: c.created_at,
    updated_at: c.updated_at,
  }));

  const lifecycle = visitOnlyLifecycle(db, now);

  const customers = db.customers.map((c) => ({
    id: c.id,
    company_id: c.company_id,
    external_id: c.external_id,
    first_name: c.first_name,
    last_name: c.last_name,
    phone_e164: c.phone_e164,
    phone_type: c.phone_type,
    email: c.email,
    legal_basis: c.legal_basis,
    legal_basis_source: c.legal_basis === "unknown" ? null : "seed",
    legal_basis_recorded_at: c.legal_basis === "unknown" ? null : c.created_at,
    lifecycle_status: lifecycle.customers.get(c.id)!.status,
    last_visit_at: lifecycle.customers.get(c.id)!.lastVisitAt,
    visit_count: lifecycle.customers.get(c.id)!.visitCount,
    lifetime_value_minor: lifecycle.customers.get(c.id)!.lifetimeValueMinor,
    notes: c.notes,
    created_at: c.created_at,
    updated_at: c.updated_at,
  }));

  const vehicles = db.vehicles.map((v) => ({
    id: v.id,
    company_id: v.company_id,
    customer_id: v.customer_id,
    brand: v.brand,
    model: v.model,
    model_year: v.model_year,
    license_plate_display: v.license_plate_display,
    license_plate_norm: v.license_plate_norm,
    vin: v.vin,
    last_visit_at: lifecycle.vehicles.get(v.id)!.lastVisitAt,
    lifecycle_status: lifecycle.vehicles.get(v.id)!.status,
    created_at: v.created_at,
    updated_at: v.updated_at,
  }));

  const visits = db.visits.map((v) => ({
    id: v.id,
    company_id: v.company_id,
    customer_id: v.customer_id,
    vehicle_id: v.vehicle_id,
    visited_at: v.visited_at,
    service_type_raw: v.service_type_raw,
    service_category: v.service_category,
    job_value_minor: v.job_value_minor,
    created_at: v.created_at,
  }));

  const serviceCategoryMappings = companies.flatMap((company) => {
    const seen = new Set<string>();
    return (Object.entries(SERVICE_TYPES_RAW) as [ServiceCategory, string[]][]).flatMap(([category, labels]) =>
      labels
        .map(normalizeServiceLabel)
        .filter((norm) => !seen.has(norm) && seen.add(norm))
        .map((raw_value_norm) => ({ company_id: company.id, raw_value_norm, category })),
    );
  });

  return { companies, customers, vehicles, visits, serviceCategoryMappings, accounts: SEED_ACCOUNTS };
}

/**
 * Lifecycle columns from visits alone (spec §12). "Reactivated" and "opted
 * out" need conversions and the suppression list, which arrive in later
 * slices; the lifecycle job (slice 8) recomputes everything from then on.
 */
function visitOnlyLifecycle(db: DemoDatabase, now: Date) {
  const thresholds = new Map(db.companies.map((c) => [c.id, c.settings.lifecycle]));
  const lastByVehicle = new Map<string, string>();
  const byCustomer = new Map<string, { last: string | null; count: number; value: number }>();
  for (const v of db.visits) {
    if (v.vehicle_id && (lastByVehicle.get(v.vehicle_id) ?? "") < v.visited_at) {
      lastByVehicle.set(v.vehicle_id, v.visited_at);
    }
    const agg = byCustomer.get(v.customer_id) ?? { last: null, count: 0, value: 0 };
    agg.count++;
    agg.value += v.job_value_minor ?? 0;
    if (!agg.last || agg.last < v.visited_at) agg.last = v.visited_at;
    byCustomer.set(v.customer_id, agg);
  }

  const status = (last: string | null, companyId: string): VisitStatus =>
    statusFromLastVisit(last ? fromDateOnly(last) : null, now, thresholds.get(companyId)!);

  const vehicles = new Map<string, { lastVisitAt: string | null; status: VisitStatus }>();
  const statusesByCustomer = new Map<string, VisitStatus[]>();
  for (const v of db.vehicles) {
    const lastVisitAt = lastByVehicle.get(v.id) ?? null;
    const s = status(lastVisitAt, v.company_id);
    vehicles.set(v.id, { lastVisitAt, status: s });
    statusesByCustomer.set(v.customer_id, [...(statusesByCustomer.get(v.customer_id) ?? []), s]);
  }

  const customers = new Map<
    string,
    { lastVisitAt: string | null; visitCount: number; lifetimeValueMinor: number; status: VisitStatus }
  >();
  for (const c of db.customers) {
    const agg = byCustomer.get(c.id) ?? { last: null, count: 0, value: 0 };
    const visitStatuses = statusesByCustomer.get(c.id) ?? [status(agg.last, c.company_id)];
    customers.set(c.id, {
      lastVisitAt: agg.last,
      visitCount: agg.count,
      lifetimeValueMinor: agg.value,
      status: customerStatus({ visitStatuses, suppressed: false, reactivated: false }) as VisitStatus,
    });
  }
  return { vehicles, customers };
}
