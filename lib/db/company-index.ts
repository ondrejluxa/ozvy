import { createHash } from "node:crypto";
import { fromDateOnly } from "../domain/dates";
import type { UnitFacts } from "../domain/segments/types";
import type { DemoDatabase } from "./schema";
import type {
  Campaign,
  CampaignEnrollment,
  CampaignStep,
  Company,
  Conversion,
  Customer,
  Message,
  Vehicle,
  Visit,
} from "./types";

/**
 * Per-company lookup structures over the in-memory tables, rebuilt lazily
 * whenever the database version changes. Every query goes through a company
 * index, which mirrors the Phase 1 rule "always filter by company_id first".
 */

export interface CompanyIndex {
  company: Company;
  customers: Customer[];
  customerById: Map<string, Customer>;
  vehicles: Vehicle[];
  vehicleById: Map<string, Vehicle>;
  vehiclesByCustomer: Map<string, Vehicle[]>;
  visits: Visit[];
  visitsByCustomer: Map<string, Visit[]>;
  visitsByVehicle: Map<string, Visit[]>;
  suppressedCustomerIds: Set<string>;
  campaigns: Campaign[];
  campaignById: Map<string, Campaign>;
  stepsByCampaign: Map<string, CampaignStep[]>;
  enrollments: CampaignEnrollment[];
  enrollmentById: Map<string, CampaignEnrollment>;
  enrollmentsByCampaign: Map<string, CampaignEnrollment[]>;
  enrollmentsByCustomer: Map<string, CampaignEnrollment[]>;
  messages: Message[];
  messagesByCampaign: Map<string, Message[]>;
  messageByEnrollment: Map<string, Message>;
  conversions: Conversion[];
  conversionByEnrollment: Map<string, Conversion>;
  subscriptionPriceMinor: number;
  planName: string | null;
  subscriptionStart: string | null;
}

export function hashAddress(address: string): string {
  return createHash("sha256").update(address.trim().toLowerCase()).digest("hex");
}

function group<T>(rows: T[], key: (row: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (k === null) continue;
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

const cache = new WeakMap<DemoDatabase, Map<string, { version: number; index: CompanyIndex }>>();

export function companyIndex(db: DemoDatabase, companyId: string): CompanyIndex | null {
  let perDb = cache.get(db);
  if (!perDb) {
    perDb = new Map();
    cache.set(db, perDb);
  }
  const hit = perDb.get(companyId);
  if (hit && hit.version === db.version) return hit.index;

  const company = db.companies.find((c) => c.id === companyId);
  if (!company) return null;
  const index = buildIndex(db, company);
  perDb.set(companyId, { version: db.version, index });
  return index;
}

/** Index builder used directly by the seed, which mutates tables as it goes. */
export function buildIndex(db: DemoDatabase, company: Company): CompanyIndex {
  const id = company.id;
  const customers = db.customers.filter((c) => c.company_id === id);
  const vehicles = db.vehicles.filter((v) => v.company_id === id);
  const visits = db.visits.filter((v) => v.company_id === id).sort((a, b) => a.visited_at.localeCompare(b.visited_at));
  const campaigns = db.campaigns.filter((c) => c.company_id === id);
  const enrollments = db.campaign_enrollments.filter((e) => e.company_id === id);
  const messages = db.messages.filter((m) => m.company_id === id);
  const conversions = db.conversions.filter((c) => c.company_id === id);

  const suppressedHashes = new Set(
    db.suppression_list.filter((s) => s.company_id === id && s.channel === "sms").map((s) => s.address_hash),
  );
  const suppressedCustomerIds = new Set(
    customers.filter((c) => c.phone_e164 && suppressedHashes.has(hashAddress(c.phone_e164))).map((c) => c.id),
  );

  const subscription = db.subscriptions.find((s) => s.company_id === id && s.status !== "cancelled");
  const plan = subscription ? db.plans.find((p) => p.id === subscription.plan_id) : undefined;

  return {
    company,
    customers,
    customerById: new Map(customers.map((c) => [c.id, c])),
    vehicles,
    vehicleById: new Map(vehicles.map((v) => [v.id, v])),
    vehiclesByCustomer: group(vehicles, (v) => v.customer_id),
    visits,
    visitsByCustomer: group(visits, (v) => v.customer_id),
    visitsByVehicle: group(visits, (v) => v.vehicle_id),
    suppressedCustomerIds,
    campaigns,
    campaignById: new Map(campaigns.map((c) => [c.id, c])),
    stepsByCampaign: group(
      db.campaign_steps.filter((s) => s.company_id === id),
      (s) => s.campaign_id,
    ),
    enrollments,
    enrollmentById: new Map(enrollments.map((e) => [e.id, e])),
    enrollmentsByCampaign: group(enrollments, (e) => e.campaign_id),
    enrollmentsByCustomer: group(enrollments, (e) => e.customer_id),
    messages,
    messagesByCampaign: group(messages, (m) => m.campaign_id),
    messageByEnrollment: new Map(messages.map((m) => [m.enrollment_id, m])),
    conversions,
    conversionByEnrollment: new Map(conversions.map((c) => [c.enrollment_id, c])),
    subscriptionPriceMinor: subscription ? (subscription.price_override_minor ?? plan?.price_minor ?? 0) : 0,
    planName: plan?.name ?? null,
    subscriptionStart: subscription?.current_period_start ?? null,
  };
}

/**
 * Targetable units as of a point in time: every vehicle, plus customers
 * without a vehicle. Only visits strictly before `asOf` are visible.
 */
export function buildUnits(index: CompanyIndex, asOf: Date): UnitFacts[] {
  const asOfDay = asOf.getTime();
  const ltvByCustomer = new Map<string, number>();
  for (const customer of index.customers) {
    const ltv = (index.visitsByCustomer.get(customer.id) ?? [])
      .filter((v) => fromDateOnly(v.visited_at).getTime() < asOfDay)
      .reduce((sum, v) => sum + (v.job_value_minor ?? 0), 0);
    ltvByCustomer.set(customer.id, ltv);
  }
  const sortedLtv = [...ltvByCustomer.values()].sort((a, b) => a - b);
  const percentile = (value: number) => {
    if (value <= 0 || sortedLtv.length === 0) return 0;
    let lo = 0;
    let hi = sortedLtv.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedLtv[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    return lo / sortedLtv.length;
  };

  const units: UnitFacts[] = [];
  const toFacts = (customer: Customer, vehicleId: string | null, visits: Visit[]): UnitFacts => {
    const visible = visits
      .map((v) => ({ date: fromDateOnly(v.visited_at), category: v.service_category }))
      .filter((v) => v.date.getTime() < asOfDay);
    return {
      customerId: customer.id,
      vehicleId,
      visits: visible,
      lastVisitAt: visible.length ? visible[visible.length - 1].date : null,
      customerLtvPercentile: percentile(ltvByCustomer.get(customer.id) ?? 0),
      customerStatus: customer.lifecycle_status,
    };
  };

  for (const customer of index.customers) {
    const vehicles = index.vehiclesByCustomer.get(customer.id) ?? [];
    if (vehicles.length === 0) {
      units.push(toFacts(customer, null, index.visitsByCustomer.get(customer.id) ?? []));
      continue;
    }
    for (const vehicle of vehicles) {
      units.push(toFacts(customer, vehicle.id, index.visitsByVehicle.get(vehicle.id) ?? []));
    }
  }
  return units;
}
