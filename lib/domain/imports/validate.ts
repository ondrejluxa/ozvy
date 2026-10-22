import type { ColumnMapping, ImportType, TargetField } from "./mapping";
import {
  nameKey,
  normalizeBrand,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  normalizePlate,
  normalizeVin,
  parseConsent,
  parseMoney,
  parseVisitDate,
  splitFullName,
  splitFullNameLastFirst,
  splitVehicle,
} from "./normalize";

/**
 * Row validation (spec §11 step 5 and "Validation rules"). Pure: the job
 * passes the staged rows, the mapping and a snapshot of the company's
 * existing customers and vehicles for matching.
 */

export const INVALID_ISSUES = [
  "column_count",
  "name_missing",
  "no_contact",
  "phone_unparseable",
  "visit_date_missing",
  "visit_date_invalid",
  "visit_date_future",
] as const;
export const WARNING_ISSUES = [
  "fixed_line",
  "foreign_phone",
  "email_suspicious",
  "vin_malformed",
  "vin_on_other_customer",
  "job_value_out_of_range",
  "job_value_invalid",
  "visit_too_old",
  "ambiguous_match",
] as const;
export type IssueCode = (typeof INVALID_ISSUES)[number] | (typeof WARNING_ISSUES)[number] | "duplicate_in_file";
export type RowStatus = "valid" | "warning" | "invalid" | "duplicate" | "excluded";

export interface NormalizedRecord {
  customerKey: string;
  customer: {
    external_id: string | null;
    first_name: string | null;
    last_name: string | null;
    phone_e164: string | null;
    phone_type: "mobile" | "fixed" | "unknown";
    email: string | null;
    notes: string | null;
    consent: boolean | null;
  };
  vehicle: {
    brand: string | null;
    model: string | null;
    plate_display: string | null;
    plate_norm: string | null;
    vin: string | null;
  } | null;
  visit: { visited_at: string; service_type_raw: string | null; job_value_minor: number | null } | null;
}

export interface RowResult {
  rowNumber: number;
  status: RowStatus;
  issues: IssueCode[];
  normalized: NormalizedRecord | null;
  matchCustomerId: string | null;
  /** Two or more existing customers match: never auto-merged, skipped at commit. */
  ambiguous: boolean;
}

export interface ExistingData {
  customers: {
    id: string;
    externalId: string | null;
    phone: string | null;
    lastName: string | null;
    email: string | null;
  }[];
  vehicles: { id: string; customerId: string; plateNorm: string | null; vin: string | null }[];
}

export interface ValidationInput {
  type: ImportType;
  rows: { rowNumber: number; cells: string[]; excluded?: boolean; ragged?: boolean }[];
  mapping: ColumnMapping;
  /** ISO date of "today" in Europe/Prague. */
  today: string;
  existing: ExistingData;
}

function index<T>(items: T[], key: (t: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return map;
}

export function validateRows(input: ValidationInput): RowResult[] {
  const { mapping, type, today } = input;
  const cell = (cells: string[], field: TargetField) => {
    const i = mapping[field];
    return i === undefined ? "" : (cells[i] ?? "").trim();
  };

  const byExternal = index(input.existing.customers, (c) => c.externalId);
  const byPhoneName = index(input.existing.customers, (c) =>
    c.phone && c.lastName ? `${c.phone}|${nameKey(c.lastName)}` : null,
  );
  const byEmail = index(input.existing.customers, (c) => c.email?.toLowerCase() ?? null);
  const vehicleByVin = new Map(input.existing.vehicles.filter((v) => v.vin).map((v) => [v.vin!, v]));

  const seen = new Map<string, number>();
  const results: RowResult[] = [];

  for (const row of input.rows) {
    const issues: IssueCode[] = [];
    if (row.ragged) issues.push("column_count");
    const c = row.cells;

    // names
    let first = normalizeName(cell(c, "first_name"));
    let last = normalizeName(cell(c, "last_name"));
    if (!first && !last && cell(c, "full_name")) ({ first, last } = splitFullName(cell(c, "full_name")));
    if (!first && !last && cell(c, "full_name_last_first")) {
      ({ first, last } = splitFullNameLastFirst(cell(c, "full_name_last_first")));
    }
    if (!first && !last) issues.push("name_missing");

    // contact
    const phone = normalizePhone(cell(c, "phone"));
    if (phone.issue) issues.push(phone.issue);
    const email = normalizeEmail(cell(c, "email"));
    if (email.issue) issues.push(email.issue);
    if (!phone.e164 && !email.email && phone.issue !== "phone_unparseable") issues.push("no_contact");

    // vehicle
    const plate = normalizePlate(cell(c, "license_plate"));
    const vin = normalizeVin(cell(c, "vin"));
    if (vin.issue) issues.push(vin.issue);
    let brand = normalizeBrand(cell(c, "vehicle_brand"));
    let model = cell(c, "vehicle_model") || null;
    if (!brand && !model && cell(c, "vehicle_full")) ({ brand, model } = splitVehicle(cell(c, "vehicle_full")));
    const hasVehicle = Boolean(plate.norm || vin.vin || brand || model);

    // visit
    const rawDate = cell(c, "visit_date");
    const date = parseVisitDate(rawDate, today);
    const service = cell(c, "service_type") || null;
    const money = parseMoney(cell(c, "job_value"));
    if (money.issue) issues.push(money.issue);
    if (type === "visits") {
      if (!rawDate) issues.push("visit_date_missing");
      else if (date.issue) issues.push(date.issue);
    } else if (date.issue === "visit_date_future") {
      issues.push(date.issue);
    } else if (date.issue === "visit_too_old") {
      issues.push(date.issue);
    }
    const visit =
      date.date && (type === "visits" || service)
        ? {
            visited_at: date.date,
            service_type_raw: service,
            job_value_minor: money.issue === "job_value_invalid" ? null : money.minor,
          }
        : null;

    // customer key and matching
    const externalId = cell(c, "external_customer_id") || null;
    const lastKey = nameKey(last);
    const customerKey = externalId
      ? `ext:${externalId}`
      : phone.e164
        ? `pl:${phone.e164}|${lastKey}`
        : email.email
          ? `em:${email.email}`
          : `row:${row.rowNumber}`;

    let match: string | null = null;
    let ambiguous = false;
    const candidates =
      (externalId && byExternal.get(externalId)) ||
      (phone.e164 && lastKey && byPhoneName.get(`${phone.e164}|${lastKey}`)) ||
      (email.email && byEmail.get(email.email)) ||
      [];
    if (candidates.length === 1) match = candidates[0].id;
    else if (candidates.length > 1) {
      ambiguous = true;
      issues.push("ambiguous_match");
    }

    let vinValue = vin.vin;
    if (vinValue) {
      const owner = vehicleByVin.get(vinValue);
      if (owner && owner.customerId !== match) {
        issues.push("vin_on_other_customer");
        vinValue = null;
      }
    }

    // duplicates within the file
    const keys =
      type === "customers"
        ? [
            externalId ? `ext:${externalId}` : null,
            phone.e164 && lastKey ? `pl:${phone.e164}|${lastKey}` : null,
            email.email ? `em:${email.email}` : null,
          ]
        : [[customerKey, plate.norm ?? vinValue ?? "", date.date ?? "", service ?? "", money.minor ?? ""].join("|")];
    const duplicateOf = keys.map((k) => (k ? seen.get(k) : undefined)).find((v) => v !== undefined);
    const invalid = issues.some((i) => (INVALID_ISSUES as readonly string[]).includes(i));
    if (!invalid && duplicateOf === undefined) for (const k of keys) if (k) seen.set(k, row.rowNumber);

    const status: RowStatus = row.excluded
      ? "excluded"
      : invalid
        ? "invalid"
        : duplicateOf !== undefined
          ? "duplicate"
          : issues.length
            ? "warning"
            : "valid";
    if (status === "duplicate") issues.push("duplicate_in_file");

    results.push({
      rowNumber: row.rowNumber,
      status,
      issues,
      ambiguous,
      matchCustomerId: match,
      normalized: invalid
        ? null
        : {
            customerKey,
            customer: {
              external_id: externalId,
              first_name: first,
              last_name: last,
              phone_e164: phone.e164,
              phone_type: phone.type,
              email: email.email,
              notes: cell(c, "notes").slice(0, 2000) || null,
              consent: mapping.marketing_consent === undefined ? null : parseConsent(cell(c, "marketing_consent")),
            },
            vehicle: hasVehicle
              ? { brand, model, plate_display: plate.display, plate_norm: plate.norm, vin: vinValue }
              : null,
            visit,
          },
    });
  }
  return results;
}

export type StatusCounts = Record<RowStatus, number> & { total: number };

export function countStatuses(results: { status: RowStatus }[]): StatusCounts {
  const counts: StatusCounts = { total: 0, valid: 0, warning: 0, invalid: 0, duplicate: 0, excluded: 0 };
  for (const r of results) {
    counts[r.status]++;
    counts.total++;
  }
  return counts;
}

/** Non-production guard (spec §22): refuse files with e-mails outside the example domains. */
export function looksLikeRealData(emails: (string | null)[]): boolean {
  return emails.some((e) => e !== null && !/@example\.(cz|com)$/.test(e));
}
