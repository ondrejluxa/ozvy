import { createHash } from "node:crypto";
import { fakerCS_CZ as faker } from "@faker-js/faker";
import { TEMPLATE_LIBRARY, type TemplateTone } from "../../ai/templates-library";
import { selectHoldout } from "../../domain/campaigns/estimates";
import {
  DAY_MS,
  addDays,
  monthEnd,
  monthKey,
  monthStart,
  pragueParts,
  pragueTime,
  shiftMonthKey,
  toDateOnly,
} from "../../domain/dates";
import { renderTemplate, optOutToken } from "../../domain/messaging/render";
import { countSmsSegments } from "../../domain/messaging/sms-segments";
import { PRESET_BY_KEY, type PresetKey } from "../../domain/segments/presets";
import { PRICE_PER_SEGMENT_MINOR, mockOutcome } from "../../providers/sms/mock";
import { recomputeCustomer } from "../aggregates";
import { buildIndex, buildUnits, hashAddress } from "../company-index";
import { contactHistory, presetAudience } from "../derived";
import { emptyDatabase, type DemoDatabase } from "../schema";
import type {
  Campaign,
  CampaignEnrollment,
  Company,
  CompanySettings,
  Conversion,
  Customer,
  LegalBasis,
  Message,
  ServiceCategory,
  Vehicle,
  Visit,
} from "../types";
import {
  BRANDS,
  CAMPAIGN_NAME_PREFIX,
  CUSTOMER_NOTES,
  FIRST_NAMES_FEMALE,
  FIRST_NAMES_MALE,
  JOB_VALUE_CZK,
  MOBILE_PREFIXES,
  MONTH_NOMINATIVE,
  PLATE_LETTERS,
  PLATE_REGIONS,
  SERVICE_TYPES_RAW,
  SURNAMES,
  VIN_CHARS,
} from "./fixtures";

/**
 * Deterministic demo world (spec §31). Dates are relative to the moment of
 * seeding, so "this month" always carries the presentation numbers:
 * Autoservis Dvořák shows 218 messages, 14 bookings, 11 completed jobs and
 * 52 300 Kč recovered against a 4 990 Kč subscription (10,5×).
 *
 * Historical campaigns are replayed in date order with the real audience
 * rules, so every enrolled customer genuinely matched the segment at send
 * time, and every conversion has a matching return visit.
 */

const SEED = 20_260_925;
const MONTH_DAYS = 30.4375;

// ---------- random helpers (all via the seeded faker instance) ----------
const rand = () => faker.number.float({ min: 0, max: 1 });
const randInt = (min: number, max: number) => faker.number.int({ min, max });
const pick = <T>(items: readonly T[]) => faker.helpers.arrayElement(items as T[]);
const weighted = <T>(items: { weight: number; value: T }[]) => faker.helpers.weightedArrayElement(items);
const uuid = () => faker.string.uuid();
const digits = (n: number) => Array.from({ length: n }, () => randInt(0, 9)).join("");

function poisson(mean: number): number {
  const limit = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > limit);
  return k - 1;
}

const deaccent = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// ---------- company specifications ----------

interface CampaignSpec {
  monthOffset: number;
  day: number;
  preset: PresetKey;
  size: number;
  tone: TemplateTone;
  strip: boolean;
  weight?: number;
  /** Exact message outcomes for the presentation campaign. */
  outcomes?: { failed: number; undelivered: number };
  /** Not yet sent: shown in the approval queue. */
  waitingForApproval?: boolean;
}

interface CompanySpec {
  name: string;
  city: string;
  postalCode: string;
  street: string;
  ico: string;
  phone: string;
  email: string;
  website: string;
  contactPerson: string;
  senderName: string;
  messageShopName: string;
  regionLetter: string;
  fixedPrefixes: string[];
  customers: number;
  vehicles: number;
  mobileShare: number;
  missingVehicleShare: number;
  jobValues: boolean;
  tyreHeavy: boolean;
  averageJobValueCzk: number;
  planKey: "basic" | "growth" | "pro";
  /** Months since cooperation started (subscription start = first day of that month). */
  cooperationMonths: number;
  /** Days since the company record was created, if different from cooperation start. */
  createdDaysAgo?: number;
  requiresClientApproval: boolean;
  campaigns: CampaignSpec[];
  /** Recovered revenue per month offset (CZK). Offset 0 may list exact job values. */
  revenueByMonth: Record<number, number | number[]>;
  /** Bookings this month that are not completed yet. */
  bookedOnlyThisMonth: number;
}

const DVORAK: CompanySpec = {
  name: "Autoservis Dvořák s.r.o.",
  city: "Kolín",
  postalCode: "280 02",
  street: "Havlíčkova 1187",
  ico: "28451327",
  phone: "+420321724118",
  email: "servis@dvorak-demo.example.cz",
  website: "dvorak-demo.example.cz",
  contactPerson: "Pavel Dvořák",
  senderName: "AutoDvorak",
  messageShopName: "Autoservis Dvořák",
  regionLetter: "S",
  fixedPrefixes: ["321"],
  customers: 1_800,
  vehicles: 2_300,
  mobileShare: 0.9,
  missingVehicleShare: 0,
  jobValues: true,
  tyreHeavy: false,
  averageJobValueCzk: 4_200,
  planKey: "growth",
  cooperationMonths: 9,
  requiresClientApproval: false,
  campaigns: [
    { monthOffset: -9, day: 6, preset: "regular_service_10_14", size: 40, tone: "standard", strip: false },
    { monthOffset: -8, day: 9, preset: "no_visit_12m", size: 45, tone: "friendly", strip: false },
    { monthOffset: -7, day: 7, preset: "valuable_lost", size: 55, tone: "standard", strip: true },
    { monthOffset: -6, day: 8, preset: "regular_service_10_14", size: 60, tone: "friendly", strip: true },
    { monthOffset: -5, day: 6, preset: "no_visit_18m", size: 75, tone: "standard", strip: true },
    { monthOffset: -4, day: 9, preset: "valuable_lost", size: 90, tone: "friendly", strip: true },
    { monthOffset: -3, day: 7, preset: "regular_service_10_14", size: 110, tone: "friendly", strip: true },
    { monthOffset: -2, day: 8, preset: "no_visit_18m", size: 150, tone: "standard", strip: true },
    { monthOffset: -1, day: 8, preset: "regulars_stopped", size: 170, tone: "friendly", strip: true },
    {
      monthOffset: 0,
      day: 1,
      preset: "no_visit_6m",
      size: 247,
      tone: "standard",
      strip: true,
      outcomes: { failed: 4, undelivered: 5 },
    },
  ],
  revenueByMonth: {
    [-9]: 6_400,
    [-8]: 8_900,
    [-7]: 11_200,
    [-6]: 12_600,
    [-5]: 14_100,
    [-4]: 16_800,
    [-3]: 21_000,
    [-2]: 27_300,
    [-1]: 44_300,
    // 11 completed jobs this month, 52 300 Kč in total.
    0: [7_450, 3_200, 5_900, 2_450, 8_700, 4_100, 6_250, 1_950, 3_800, 5_300, 3_200],
  },
  bookedOnlyThisMonth: 3,
};

const HORAK: CompanySpec = {
  name: "Pneu & Servis Horák",
  city: "Brno",
  postalCode: "612 00",
  street: "Purkyňova 2214/64",
  ico: "07315842",
  phone: "+420541217930",
  email: "info@horak-demo.example.cz",
  website: "horak-demo.example.cz",
  contactPerson: "Martin Horák",
  senderName: "PneuHorak",
  messageShopName: "Pneu & Servis Horák",
  regionLetter: "B",
  fixedPrefixes: ["541", "543", "545", "547"],
  customers: 3_200,
  vehicles: 3_850,
  mobileShare: 0.74,
  missingVehicleShare: 0,
  jobValues: true,
  tyreHeavy: true,
  averageJobValueCzk: 2_900,
  planKey: "pro",
  cooperationMonths: 4,
  requiresClientApproval: true,
  campaigns: [
    { monthOffset: -4, day: 8, preset: "no_visit_12m", size: 120, tone: "standard", strip: true },
    { monthOffset: -2, day: 10, preset: "regulars_stopped", size: 160, tone: "formal", strip: true, weight: 0.02 },
    { monthOffset: -1, day: 9, preset: "no_visit_6m", size: 190, tone: "friendly", strip: true },
    {
      monthOffset: 0,
      day: 1,
      preset: "regular_service_10_14",
      size: 0,
      tone: "standard",
      strip: true,
      waitingForApproval: true,
    },
  ],
  revenueByMonth: { [-4]: 9_800, [-3]: 15_400, [-2]: 7_300, [-1]: 21_600, 0: 18_700 },
  bookedOnlyThisMonth: 2,
};

const NADRAZI: CompanySpec = {
  name: "Garáž U Nádraží",
  city: "Jihlava",
  postalCode: "586 01",
  street: "Nádražní 48",
  ico: "19284460",
  phone: "+420567301442",
  email: "garaz@nadrazi-demo.example.cz",
  website: "nadrazi-demo.example.cz",
  contactPerson: "Jiří Málek",
  senderName: "GarazJI",
  messageShopName: "Garáž U Nádraží",
  regionLetter: "J",
  fixedPrefixes: ["567"],
  customers: 600,
  vehicles: 470,
  mobileShare: 0.86,
  missingVehicleShare: 0.3,
  jobValues: false,
  tyreHeavy: false,
  averageJobValueCzk: 3_500,
  planKey: "basic",
  cooperationMonths: 1,
  createdDaysAgo: 52,
  requiresClientApproval: false,
  campaigns: [],
  revenueByMonth: {},
  bookedOnlyThisMonth: 0,
};

export const DEMO_COMPANY_SPECS = [DVORAK, HORAK, NADRAZI];

// ---------- entry point ----------

export function seedDemoDatabase(now: Date): DemoDatabase {
  faker.seed(SEED);
  const db = emptyDatabase(now);
  db.plans = [
    { id: uuid(), key: "basic", name: "Basic", price_minor: 3_990_00 },
    { id: uuid(), key: "growth", name: "Growth", price_minor: 4_990_00 },
    { id: uuid(), key: "pro", name: "Pro", price_minor: 6_990_00 },
  ];
  DEMO_COMPANY_SPECS.forEach((spec, i) => seedCompany(db, spec, now, i));
  db.primary_company_id = db.companies[0].id;
  db.version = 1;
  return db;
}

// ---------- company ----------

const DEFAULT_SETTINGS: Omit<CompanySettings, "message_shop_name"> = {
  lifecycle: { active_max_months: 9, at_risk_max_months: 12 },
  max_lookback_months: 48,
  attribution_window_days: 60,
  holdout_pct: 0.1,
  expected_conversion_rate: 0.06,
};

function seedCompany(db: DemoDatabase, spec: CompanySpec, now: Date, ordinal: number) {
  // Each company and stage gets its own random stream, so the customer base is
  // identical whatever the seeding date and one shop never shifts another.
  faker.seed(SEED + ordinal * 1_000);
  const currentKey = monthKey(now);
  const cooperationStart = monthStart(shiftMonthKey(currentKey, -spec.cooperationMonths));
  const createdAt = spec.createdDaysAgo ? addDays(now, -spec.createdDaysAgo) : addDays(cooperationStart, -12);

  const company: Company = {
    id: uuid(),
    name: spec.name,
    ico: spec.ico,
    dic: `CZ${spec.ico}`,
    address_line: spec.street,
    city: spec.city,
    postal_code: spec.postalCode,
    country: "CZ",
    phone: spec.phone,
    email: spec.email,
    website: spec.website,
    contact_person: spec.contactPerson,
    timezone: "Europe/Prague",
    average_job_value_minor: spec.averageJobValueCzk * 100,
    default_sender_name: spec.senderName,
    service_mode: "managed",
    requires_client_approval: spec.requiresClientApproval,
    settings: { ...DEFAULT_SETTINGS, message_shop_name: spec.messageShopName },
    sending_enabled: true,
    dpa_signed_at: addDays(createdAt, 3).toISOString(),
    status: "active",
    created_at: createdAt.toISOString(),
    updated_at: createdAt.toISOString(),
  };
  db.companies.push(company);

  const plan = db.plans.find((p) => p.key === spec.planKey)!;
  db.subscriptions.push({
    id: uuid(),
    company_id: company.id,
    plan_id: plan.id,
    price_override_minor: null,
    status: "active",
    current_period_start: toDateOnly(spec.createdDaysAgo ? createdAt : cooperationStart),
    created_at: createdAt.toISOString(),
  });

  seedCustomers(db, company, spec, now);
  faker.seed(SEED + ordinal * 1_000 + 500);
  if (spec.campaigns.length) seedCampaigns(db, company, spec, now);

  const index = buildIndex(db, company);
  for (const customer of index.customers) recomputeCustomer(index, customer, now);
}

// ---------- customers, vehicles, visit history ----------

function serviceWeights(spec: CompanySpec): { weight: number; value: ServiceCategory }[] {
  const base: Record<ServiceCategory, number> = {
    regular_service: 30,
    oil_change: 15,
    tyre_change: 18,
    tyre_storage: 4,
    ac_service: 5,
    brakes: 8,
    diagnostics: 6,
    stk: 6,
    repair_other: 8,
  };
  if (spec.tyreHeavy) Object.assign(base, { tyre_change: 38, tyre_storage: 12, regular_service: 22 });
  return Object.entries(base).map(([value, weight]) => ({ weight, value: value as ServiceCategory }));
}

/** Months since the last visit: 48 % active, 15 % at risk, 12 % 12–14 m, 25 % churned 14+ m (spec §31). */
function lastVisitMonthsAgo(): number {
  const r = rand();
  if (r < 0.48) return 0.2 + rand() * 8.8;
  if (r < 0.63) return 9 + rand() * 3;
  if (r < 0.75) return 12 + rand() * 2;
  return rand() < 0.5 ? 14 + rand() * 10 : 24 + rand() * 34;
}

const SEASON_MONTHS: Partial<Record<ServiceCategory, number[]>> = {
  tyre_change: [3, 4, 10, 11],
  ac_service: [4, 5, 6],
};

/** Moves a seasonal job into its season, keeping it before `limit`; returns null if impossible. */
function intoSeason(date: Date, months: number[], limit: number): Date | null {
  for (let k = 0; k <= 16; k++) {
    for (const sign of [-1, 1]) {
      const candidate = new Date(date.getTime() + sign * k * 7 * DAY_MS);
      if (months.includes(candidate.getUTCMonth() + 1) && candidate.getTime() < limit) return candidate;
    }
  }
  return null;
}

function jobValueMinor(category: ServiceCategory): number {
  const [min, max] = JOB_VALUE_CZK[category];
  const skewed = category === "repair_other" ? Math.pow(rand(), 2.2) : rand();
  return Math.round((min + skewed * (max - min)) / 50) * 50 * 100;
}

function makePhone(spec: CompanySpec, used: Set<string>): { phone: string; type: "mobile" | "fixed" } {
  for (;;) {
    const mobile = rand() < spec.mobileShare;
    const phone = `+420${mobile ? pick(MOBILE_PREFIXES) : pick(spec.fixedPrefixes)}${digits(6)}`;
    if (!used.has(phone)) {
      used.add(phone);
      return { phone, type: mobile ? "mobile" : "fixed" };
    }
  }
}

function makePlate(spec: CompanySpec): string {
  const region = rand() < 0.82 ? spec.regionLetter : pick(PLATE_REGIONS);
  const third = rand() < 0.7 ? String(randInt(0, 9)) : pick(PLATE_LETTERS.split(""));
  return `${randInt(1, 9)}${region}${third} ${digits(4)}`;
}

function makeVin(wmi: string): string {
  return wmi + Array.from({ length: 14 }, () => pick(VIN_CHARS.split(""))).join("");
}

function seedCustomers(db: DemoDatabase, company: Company, spec: CompanySpec, now: Date) {
  const usedPhones = new Set<string>();
  const weights = serviceWeights(spec);
  const brandWeights = BRANDS.map((b) => ({ weight: b.weight, value: b }));
  const customers: Customer[] = [];

  for (let i = 0; i < spec.customers; i++) {
    const female = rand() < 0.48;
    const [maleSurname, femaleSurname] = pick(SURNAMES);
    const firstName = pick(female ? FIRST_NAMES_FEMALE : FIRST_NAMES_MALE);
    const lastName = female ? femaleSurname : maleSurname;
    const hasPhone = rand() < 0.97;
    const { phone, type } = hasPhone ? makePhone(spec, usedPhones) : { phone: null, type: "unknown" as const };
    const hasEmail = rand() < 0.55 || !hasPhone;
    const legalRoll = rand();
    const legal: LegalBasis = legalRoll < 0.05 ? "unknown" : legalRoll < 0.65 ? "existing_customer" : "consent";

    const customer: Customer = {
      id: uuid(),
      company_id: company.id,
      external_id: `Z${String(10_000 + i * 3 + randInt(0, 2))}`,
      first_name: firstName,
      last_name: lastName,
      phone_e164: phone,
      phone_type: phone ? type : "unknown",
      email: hasEmail
        ? `${deaccent(firstName).toLowerCase()}.${deaccent(lastName).toLowerCase()}${rand() < 0.3 ? randInt(2, 99) : ""}@${pick(["example.cz", "example.com"])}`
        : null,
      legal_basis: legal,
      lifecycle_status: "inactive",
      last_visit_at: null,
      visit_count: 0,
      lifetime_value_minor: 0,
      notes: rand() < 0.03 ? pick(CUSTOMER_NOTES) : null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
    customers.push(customer);
    db.customers.push(customer);

    if (phone && rand() < 0.03) {
      db.suppression_list.push({
        id: uuid(),
        company_id: company.id,
        channel: "sms",
        address_hash: hashAddress(phone),
        reason: pick(["opt_out_link", "manual"] as const),
        created_at: addDays(now, -randInt(20, 400)).toISOString(),
      });
    }
  }

  // Vehicles: one per customer, extra cars spread until the target count (max 3 per customer).
  const withVehicles = customers.filter(() => rand() >= spec.missingVehicleShare);
  const vehicleCount = new Map(withVehicles.map((c) => [c.id, 1]));
  let extras = Math.max(0, spec.vehicles - withVehicles.length);
  while (extras > 0 && withVehicles.length) {
    const c = pick(withVehicles);
    const n = vehicleCount.get(c.id)!;
    if (n < 3) {
      vehicleCount.set(c.id, n + 1);
      extras--;
    }
  }

  const visitHistory = (customer: Customer, vehicleId: string | null) => {
    const last = addDays(now, -lastVisitMonthsAgo() * MONTH_DAYS);
    const count = Math.max(1, poisson(4));
    const dates: Date[] = [last];
    for (let k = 1; k < count; k++) {
      const next = addDays(dates[dates.length - 1], -(5 + rand() * 9) * MONTH_DAYS);
      if (now.getTime() - next.getTime() > 60 * MONTH_DAYS * DAY_MS) break;
      dates.push(next);
    }
    let newerLimit = now.getTime() - DAY_MS;
    dates.forEach((date, idx) => {
      let category = weighted(weights);
      let when = date;
      // Drawn unconditionally so the random stream does not depend on the calendar.
      const fallbackRoll = rand();
      const season = SEASON_MONTHS[category];
      if (season && !season.includes(date.getUTCMonth() + 1)) {
        const moved = idx === 0 ? null : intoSeason(date, season, newerLimit);
        if (moved) when = moved;
        else category = fallbackRoll < 0.6 ? "regular_service" : "oil_change";
      }
      newerLimit = when.getTime() - 14 * DAY_MS;
      const visit: Visit = {
        id: uuid(),
        company_id: company.id,
        customer_id: customer.id,
        vehicle_id: vehicleId,
        visited_at: toDateOnly(when),
        service_type_raw: pick(SERVICE_TYPES_RAW[category]),
        service_category: category,
        job_value_minor: spec.jobValues ? jobValueMinor(category) : null,
        created_at: when.toISOString(),
      };
      db.visits.push(visit);
    });
  };

  for (const customer of customers) {
    const n = vehicleCount.get(customer.id) ?? 0;
    if (n === 0) {
      visitHistory(customer, null);
      continue;
    }
    for (let k = 0; k < n; k++) {
      const brand = weighted(brandWeights);
      const plate = makePlate(spec);
      const vehicle: Vehicle = {
        id: uuid(),
        company_id: company.id,
        customer_id: customer.id,
        brand: brand.brand,
        model: pick(brand.models),
        model_year: randInt(2006, 2023),
        license_plate_display: plate,
        license_plate_norm: plate.replace(/\s|-/g, ""),
        vin: rand() < 0.6 ? makeVin(pick(brand.wmi)) : null,
        last_visit_at: null,
        lifecycle_status: "inactive",
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      };
      db.vehicles.push(vehicle);
      visitHistory(customer, vehicle.id);
    }
  }
}

// ---------- campaigns, messages, conversions ----------

interface PlannedCampaign {
  spec: CampaignSpec;
  campaign: Campaign;
  sendAt: Date;
  windowEnd: Date;
  allocations: { month: string; revenueMinor: number | null }[];
}

function sendTimeFor(spec: CampaignSpec, now: Date): Date {
  const key = shiftMonthKey(monthKey(now), spec.monthOffset);
  const [y, m] = key.split("-").map(Number);
  if (spec.monthOffset < 0) {
    let t = pragueTime(y, m, spec.day, 10, 0);
    while (![2, 3, 4].includes(pragueParts(t).weekday)) t = addDays(t, 1);
    return t;
  }
  // Presentation campaign: first working morning of this month, if it has already passed.
  let t = pragueTime(y, m, 1, 9, 30);
  while ([0, 6].includes(pragueParts(t).weekday)) t = addDays(t, 1);
  if (t.getTime() > now.getTime() - 3 * 3_600_000) {
    const start = monthStart(key).getTime();
    t = new Date(start + (now.getTime() - start) * 0.15);
  }
  return t;
}

function campaignName(preset: PresetKey, sendAt: Date): string {
  const p = pragueParts(sendAt);
  return `${CAMPAIGN_NAME_PREFIX[preset]} – ${MONTH_NOMINATIVE[p.month - 1]} ${p.year}`;
}

/** Splits `total` into `count` believable job values (rounded to 50 Kč) that sum exactly. */
function splitRevenue(totalCzk: number, count: number): number[] {
  const raw = Array.from({ length: count }, () => 0.5 + rand());
  const sum = raw.reduce((a, b) => a + b, 0);
  const values = raw.map((r) => Math.max(800, Math.round(((r / sum) * totalCzk) / 50) * 50));
  values[values.length - 1] += totalCzk - values.reduce((a, b) => a + b, 0);
  return values;
}

/** Largest-remainder allocation of `count` items across weights. */
function allocate(count: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w / total) * count);
  const result = exact.map(Math.floor);
  let left = count - result.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k++, left--) result[order[k % order.length][1]]++;
  return result;
}

function seedCampaigns(db: DemoDatabase, company: Company, spec: CompanySpec, now: Date) {
  const currentKey = monthKey(now);
  const windowDays = company.settings.attribution_window_days;

  const planned: PlannedCampaign[] = spec.campaigns
    .filter((c) => !c.waitingForApproval)
    .map((c) => {
      const sendAt = sendTimeFor(c, now);
      const campaign: Campaign = {
        id: uuid(),
        company_id: company.id,
        name: campaignName(c.preset, sendAt),
        segment_preset: c.preset,
        segment_rules_snapshot: PRESET_BY_KEY[c.preset].rules,
        channel: "sms",
        status: "active",
        scheduled_at: sendAt.toISOString(),
        holdout_pct: company.settings.holdout_pct,
        offer_text: null,
        automation_rule_id: null,
        expected_conversion_rate: company.settings.expected_conversion_rate,
        avg_job_value_minor_snapshot: null,
        attribution_window_days: windowDays,
        approved_at: addDays(sendAt, -1).toISOString(),
        created_at: addDays(sendAt, -2).toISOString(),
        updated_at: sendAt.toISOString(),
        completed_at: null,
      };
      return { spec: c, campaign, sendAt, windowEnd: addDays(sendAt, windowDays), allocations: [] };
    });

  // Plan conversions per month across the campaigns whose window overlaps it.
  for (const [offsetText, target] of Object.entries(spec.revenueByMonth)) {
    const key = shiftMonthKey(currentKey, Number(offsetText));
    const start = monthStart(key).getTime();
    const end = Math.min(monthEnd(key).getTime(), now.getTime());
    const values = Array.isArray(target) ? target : splitRevenue(target, Math.max(1, Math.round(target / 4_600)));
    const weights = planned.map((p) => {
      const lo = Math.max(start, p.sendAt.getTime() + DAY_MS * 0.8);
      const hi = Math.min(end, p.windowEnd.getTime());
      const overlap = p.sendAt.getTime() < end ? Math.max(0, hi - lo) / DAY_MS : 0;
      // A campaign sent this month can win returns even on its first day.
      const sentThisMonth = p.sendAt.getTime() >= start && p.sendAt.getTime() < end;
      const fallback = key === currentKey && sentThisMonth ? 0.5 : 0;
      return Math.max(overlap, fallback) * (p.spec.weight ?? 1);
    });
    const counts = allocate(values.length, weights);
    let cursor = 0;
    counts.forEach((n, i) => {
      for (let k = 0; k < n; k++) planned[i].allocations.push({ month: key, revenueMinor: values[cursor++] * 100 });
    });
  }
  const newest = planned.filter((p) => p.sendAt.getTime() < now.getTime()).at(-1);
  for (let k = 0; k < spec.bookedOnlyThisMonth && newest; k++) {
    newest.allocations.push({ month: currentKey, revenueMinor: null });
  }

  for (const p of planned) {
    seedOneCampaign(db, company, p, now);
  }

  for (const c of spec.campaigns.filter((c) => c.waitingForApproval)) {
    const createdAt = addDays(now, -3.1);
    let scheduled = addDays(now, 2);
    const sp = pragueParts(scheduled);
    scheduled = pragueTime(sp.year, sp.month, sp.day, 10, 0);
    while ([0, 6].includes(pragueParts(scheduled).weekday)) scheduled = addDays(scheduled, 1);
    const campaign: Campaign = {
      id: uuid(),
      company_id: company.id,
      name: campaignName(c.preset, scheduled),
      segment_preset: c.preset,
      segment_rules_snapshot: PRESET_BY_KEY[c.preset].rules,
      channel: "sms",
      status: "waiting_for_approval",
      scheduled_at: scheduled.toISOString(),
      holdout_pct: company.settings.holdout_pct,
      offer_text: null,
      automation_rule_id: null,
      expected_conversion_rate: company.settings.expected_conversion_rate,
      avg_job_value_minor_snapshot: company.average_job_value_minor,
      attribution_window_days: windowDays,
      approved_at: null,
      created_at: createdAt.toISOString(),
      updated_at: createdAt.toISOString(),
      completed_at: null,
    };
    db.campaigns.push(campaign);
    db.campaign_steps.push({
      id: uuid(),
      company_id: company.id,
      campaign_id: campaign.id,
      step_number: 0,
      delay_days: 0,
      body_template: TEMPLATE_LIBRARY[c.preset][c.tone],
      strip_diacritics: c.strip,
      created_at: createdAt.toISOString(),
    });
  }
}

function seedOneCampaign(db: DemoDatabase, company: Company, p: PlannedCampaign, now: Date) {
  const { campaign, sendAt, windowEnd, spec } = p;
  const index = buildIndex(db, company);
  const units = buildUnits(index, sendAt);
  const result = presetAudience(index, spec.preset, sendAt, { units, history: contactHistory(index) });
  campaign.avg_job_value_minor_snapshot = result.avgJobValueMinor;

  // Only customers with no later visit: what happened after the send is decided by this seed.
  const hasLaterVisit = (customerId: string) =>
    (index.visitsByCustomer.get(customerId) ?? []).some((v) => v.visited_at >= toDateOnly(sendAt));
  const pool = faker.helpers.shuffle(result.audience.eligible.filter((m) => !hasLaterVisit(m.customerId)));
  const members = pool.slice(0, Math.min(spec.size, pool.length));

  db.campaigns.push(campaign);
  const step = {
    id: uuid(),
    company_id: company.id,
    campaign_id: campaign.id,
    step_number: 0,
    delay_days: 0,
    body_template: TEMPLATE_LIBRARY[spec.preset][spec.tone],
    strip_diacritics: spec.strip,
    created_at: campaign.created_at,
  };
  db.campaign_steps.push(step);

  const holdout = selectHoldout(
    members.map((m) => m.customerId),
    campaign.holdout_pct,
    campaign.id,
  );
  const windowClosed = windowEnd.getTime() < now.getTime();
  campaign.status = windowClosed ? "completed" : "active";
  campaign.completed_at = windowClosed ? windowEnd.toISOString() : null;

  const enrollments: CampaignEnrollment[] = members.map((m) => ({
    id: uuid(),
    company_id: company.id,
    campaign_id: campaign.id,
    customer_id: m.customerId,
    vehicle_id: m.vehicleId,
    is_holdout: holdout.has(m.customerId),
    stage: "contacted",
    stopped_reason: null,
    first_sent_at: null,
    window_ends_at: windowEnd.toISOString(),
    created_at: sendAt.toISOString(),
    updated_at: sendAt.toISOString(),
  }));
  db.campaign_enrollments.push(...enrollments);

  // Messages for the treated group.
  const treated = enrollments.filter((e) => !e.is_holdout);
  const forced = spec.outcomes ? faker.helpers.shuffle([...treated]) : [];
  const forcedFailed = new Set(forced.slice(0, spec.outcomes?.failed ?? 0).map((e) => e.id));
  const forcedUndelivered = new Set(
    forced
      .slice(spec.outcomes?.failed ?? 0, (spec.outcomes?.failed ?? 0) + (spec.outcomes?.undelivered ?? 0))
      .map((e) => e.id),
  );
  const shop = { shopName: company.settings.message_shop_name ?? company.name, phone: company.phone };
  const lastVisitByCustomer = new Map(members.map((m) => [m.customerId, m.lastVisitAt]));
  const deliveredIds = new Set<string>();

  treated.forEach((e, i) => {
    const customer = index.customerById.get(e.customer_id)!;
    const vehicle = e.vehicle_id ? index.vehicleById.get(e.vehicle_id) : undefined;
    const key = createHash("sha256").update(`${e.id}:${step.id}`).digest("hex");
    const lastVisit = lastVisitByCustomer.get(e.customer_id);
    const rendered = renderTemplate(step.body_template, {
      recipient: {
        firstName: customer.first_name,
        lastName: customer.last_name,
        vehicleBrand: vehicle?.brand ?? null,
        vehicleModel: vehicle?.model ?? null,
        lastVisitAt: lastVisit ? toDateOnly(lastVisit) : null,
      },
      shop,
      optOutUrl: `example.cz/o/${optOutToken(e.id)}`,
      now: sendAt,
      stripDiacritics: step.strip_diacritics,
    });
    const seg = countSmsSegments(rendered.text);
    const failed = spec.outcomes ? forcedFailed.has(e.id) : mockOutcome.sendFails(key);
    const undelivered = !failed && (spec.outcomes ? forcedUndelivered.has(e.id) : mockOutcome.undelivered(key));
    const sentAt = new Date(sendAt.getTime() + i * 350);
    const message: Message = {
      id: uuid(),
      company_id: company.id,
      campaign_id: campaign.id,
      enrollment_id: e.id,
      step_id: step.id,
      customer_id: e.customer_id,
      channel: "sms",
      to_address: customer.phone_e164!,
      body_rendered: rendered.text,
      encoding: seg.encoding,
      segments: seg.segments,
      status: failed ? "failed" : undelivered ? "undelivered" : "delivered",
      provider_id: "mock",
      provider_message_id: failed ? null : `mock_${key.slice(0, 12)}`,
      idempotency_key: key,
      cost_minor: failed ? null : seg.segments * PRICE_PER_SEGMENT_MINOR,
      error_code: failed ? "MOCK_REJECTED" : undelivered ? "DLR_UNDELIVERED" : null,
      attempts: 1,
      queued_at: sendAt.toISOString(),
      sent_at: failed ? null : sentAt.toISOString(),
      delivered_at: failed || undelivered ? null : new Date(sentAt.getTime() + randInt(4, 90) * 1000).toISOString(),
      failed_at: failed ? sentAt.toISOString() : null,
    };
    db.messages.push(message);
    if (failed) e.stopped_reason = "initial_failed";
    else e.first_sent_at = sentAt.toISOString();
    if (!failed && !undelivered) deliveredIds.add(e.id);
  });

  // Conversions planned for this campaign, assigned to delivered recipients.
  const delivered = faker.helpers.shuffle(treated.filter((e) => deliveredIds.has(e.id)));
  const converted = new Set<string>();
  const currentKey = monthKey(now);
  for (const allocation of p.allocations) {
    const enrollment = delivered.find((e) => !converted.has(e.id));
    if (!enrollment) break;
    converted.add(enrollment.id);
    const sentAt = new Date(enrollment.first_sent_at!).getTime();
    const ms = monthStart(allocation.month).getTime();
    const isCurrent = allocation.month === currentKey;

    if (allocation.revenueMinor === null) {
      const lo = Math.max(ms, sentAt + 0.1 * DAY_MS);
      const hi = now.getTime() - 10 * 60_000;
      const booked = new Date(lo + rand() * Math.max(0, hi - lo));
      addConversion(db, company, campaign, enrollment, "booked", booked, null, null, false);
      continue;
    }

    let lo = Math.max(ms, sentAt + 0.8 * DAY_MS);
    let hi = Math.min(monthEnd(allocation.month).getTime(), windowEnd.getTime(), now.getTime() - 0.05 * DAY_MS);
    if (hi <= lo) {
      lo = Math.max(ms, sentAt + 3_600_000);
      hi = now.getTime() - 5 * 60_000;
    }
    const completed = new Date(lo + rand() * (hi - lo));
    const bookedFloor = isCurrent ? Math.max(ms, sentAt + 0.05 * DAY_MS) : sentAt + 0.1 * DAY_MS;
    const booked = new Date(
      Math.max(
        bookedFloor,
        Math.min(completed.getTime() - 3_600_000, completed.getTime() - (0.2 + rand() * 4) * DAY_MS),
      ),
    );
    const visit = addReturnVisit(db, company, enrollment, spec.preset, completed, allocation.revenueMinor);
    addConversion(
      db,
      company,
      campaign,
      enrollment,
      "completed",
      booked,
      completed,
      allocation.revenueMinor,
      false,
      visit.id,
    );
  }

  // A few holdout customers come back on their own: recorded, never counted.
  const holdoutRows = enrollments.filter((e) => e.is_holdout);
  if (holdoutRows.length >= 15 && rand() < holdoutRows.length * 0.025) {
    const e = pick(holdoutRows);
    const hi = Math.min(windowEnd.getTime(), now.getTime() - DAY_MS);
    const lo = sendAt.getTime() + 2 * DAY_MS;
    if (hi > lo) {
      const completed = new Date(lo + rand() * (hi - lo));
      const value = jobValueMinor(pick(PRESET_BY_KEY[spec.preset].valueCategories));
      const visit = addReturnVisit(db, company, e, spec.preset, completed, value);
      addConversion(db, company, campaign, e, "completed", addDays(completed, -1), completed, value, true, visit.id);
    }
  }

  for (const e of enrollments) {
    if (e.stage === "contacted" && windowClosed) e.stage = "lost";
  }
}

function addReturnVisit(
  db: DemoDatabase,
  company: Company,
  enrollment: CampaignEnrollment,
  preset: PresetKey,
  at: Date,
  valueMinor: number,
): Visit {
  const categories = PRESET_BY_KEY[preset].valueCategories;
  const category = categories.includes("regular_service") && rand() < 0.6 ? "regular_service" : pick(categories);
  const visit: Visit = {
    id: uuid(),
    company_id: company.id,
    customer_id: enrollment.customer_id,
    vehicle_id: enrollment.vehicle_id,
    visited_at: toDateOnly(at),
    service_type_raw: pick(SERVICE_TYPES_RAW[category]),
    service_category: category,
    job_value_minor: valueMinor,
    created_at: at.toISOString(),
  };
  db.visits.push(visit);
  return visit;
}

function addConversion(
  db: DemoDatabase,
  company: Company,
  campaign: Campaign,
  enrollment: CampaignEnrollment,
  stage: "booked" | "completed",
  bookedAt: Date,
  completedAt: Date | null,
  revenueMinor: number | null,
  isHoldout: boolean,
  visitId: string | null = null,
) {
  const conversion: Conversion = {
    id: uuid(),
    company_id: company.id,
    enrollment_id: enrollment.id,
    campaign_id: campaign.id,
    customer_id: enrollment.customer_id,
    vehicle_id: enrollment.vehicle_id,
    stage,
    source: "manual_confirmed",
    is_holdout: isHoldout,
    booked_at: bookedAt.toISOString(),
    completed_at: completedAt?.toISOString() ?? null,
    revenue_minor: revenueMinor,
    visit_id: visitId,
    confirmed_at: (completedAt ?? bookedAt).toISOString(),
    notes: null,
    created_at: bookedAt.toISOString(),
    updated_at: (completedAt ?? bookedAt).toISOString(),
  };
  db.conversions.push(conversion);
  enrollment.stage = stage;
  enrollment.updated_at = conversion.updated_at;
}
