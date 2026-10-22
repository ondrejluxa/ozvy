import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import type { ServiceCategory } from "../../db/types";
import { normalizeServiceLabel } from "../service-labels";

/**
 * Field normalisation for imports (spec §11 "Target fields"). Each function
 * returns the stored value or null, plus an issue code where the spec asks
 * for an invalid / warning result.
 */

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
const deaccent = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// ---------- names ----------

/** Trim, collapse spaces; title case only when the value is all caps ("NOVÁK" → "Novák"). */
export function normalizeName(raw: string): string | null {
  const s = collapse(raw);
  if (!s) return null;
  if (s === s.toLocaleUpperCase("cs") && s !== s.toLocaleLowerCase("cs")) {
    return s
      .toLocaleLowerCase("cs")
      .replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase("cs"));
  }
  return s;
}

/** "Jana Nováková" → first + last, split on the last space. */
export function splitFullName(raw: string): { first: string | null; last: string | null } {
  const s = normalizeName(raw);
  if (!s) return { first: null, last: null };
  const i = s.lastIndexOf(" ");
  return i < 0 ? { first: null, last: s } : { first: s.slice(0, i), last: s.slice(i + 1) };
}

/** "Nováková Jana" (surname first, common in garage software) → first + last. */
export function splitFullNameLastFirst(raw: string): { first: string | null; last: string | null } {
  const s = normalizeName(raw);
  if (!s) return { first: null, last: null };
  const i = s.indexOf(" ");
  return i < 0 ? { first: null, last: s } : { first: s.slice(i + 1), last: s.slice(0, i) };
}

/** Key for matching surnames: lower case, no diacritics. */
export const nameKey = (s: string | null) => (s ? deaccent(s).toLowerCase().replace(/\s+/g, " ").trim() : "");

// ---------- phone ----------

export type PhoneResult =
  | { e164: null; type: "unknown"; issue: null } // empty
  | { e164: null; type: "unknown"; issue: "phone_unparseable" }
  | { e164: string; type: "mobile" | "fixed" | "unknown"; issue: "fixed_line" | "foreign_phone" | null };

/** E.164 via libphonenumber-js with default region CZ; mobile vs fixed line. */
export function normalizePhone(raw: string): PhoneResult {
  const s = raw.trim();
  if (!s) return { e164: null, type: "unknown", issue: null };
  const parsed = parsePhoneNumberFromString(s.replace(/^00/, "+"), "CZ");
  if (!parsed || !parsed.isValid()) return { e164: null, type: "unknown", issue: "phone_unparseable" };
  const kind = parsed.getType();
  const type = kind === "MOBILE" ? "mobile" : kind === "FIXED_LINE" ? "fixed" : "unknown";
  const issue = type === "fixed" ? "fixed_line" : parsed.country !== "CZ" ? "foreign_phone" : null;
  return { e164: parsed.number, type, issue };
}

// ---------- e-mail ----------

const ROLE_ADDRESS = /^(info|servis|service|office|kancelar|admin|kontakt|objednavky|recepce|noreply|no-reply)@/;

export function normalizeEmail(raw: string): { email: string | null; issue: "email_suspicious" | null } {
  const s = raw.trim().toLowerCase();
  if (!s) return { email: null, issue: null };
  const valid = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(s);
  if (!valid) return { email: null, issue: "email_suspicious" };
  return { email: s, issue: ROLE_ADDRESS.test(s) ? "email_suspicious" : null };
}

// ---------- dates ----------

const pad = (n: number) => String(n).padStart(2, "0");

function isoDate(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Accepts 25.9.2026, 25. 9. 2026, 25.09.2026, 2026-09-25 and Excel serial
 * numbers (days since 30. 12. 1899). Returns an ISO date or an issue.
 */
export function parseVisitDate(
  raw: string,
  today: string,
): { date: string | null; issue: "visit_date_invalid" | "visit_date_future" | "visit_too_old" | null } {
  const s = raw.trim();
  if (!s) return { date: null, issue: null };
  let date: string | null = null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})(\s+\d{1,2}:\d{2}(:\d{2})?)?$/.exec(s))) {
    date = isoDate(Number(m[3]), Number(m[2]), Number(m[1]));
  } else if ((m = /^(\d{4})-(\d{2})-(\d{2})([T\s].*)?$/.exec(s))) {
    date = isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  } else if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial > 0 && serial < 80_000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      date = isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
  }
  if (!date) return { date: null, issue: "visit_date_invalid" };
  if (date > today) return { date: null, issue: "visit_date_future" };
  const tenYearsAgo = `${Number(today.slice(0, 4)) - 10}${today.slice(4)}`;
  return { date, issue: date < tenYearsAgo ? "visit_too_old" : null };
}

// ---------- money ----------

/** "4 700 Kč", "4700,00", "4.700,-", "12 350,00 Kč", 1500 → haléře. */
export function parseMoney(raw: string): {
  minor: number | null;
  issue: "job_value_out_of_range" | "job_value_invalid" | null;
} {
  let s = raw
    .trim()
    .replace(/(kč|czk|,-|\.-)$/i, "")
    .replace(/(kč|czk)/gi, "")
    .replace(/[\s\u00a0\u202f]/g, "");
  if (!s) return { minor: null, issue: null };
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { minor: null, issue: "job_value_invalid" };
  const czk = Number(s);
  const minor = Math.round(czk * 100);
  return { minor, issue: czk <= 0 || czk > 200_000 ? "job_value_out_of_range" : null };
}

// ---------- vehicles ----------

/** Display form kept (upper case, single spaces); matching form without spaces and dashes. */
export function normalizePlate(raw: string): { display: string | null; norm: string | null } {
  const display = collapse(raw).toUpperCase();
  if (!display) return { display: null, norm: null };
  return { display, norm: display.replace(/[\s-]/g, "") };
}

export function normalizeVin(raw: string): { vin: string | null; issue: "vin_malformed" | null } {
  const s = raw.replace(/[\s-]/g, "").toUpperCase();
  if (!s) return { vin: null, issue: null };
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(s) ? { vin: s, issue: null } : { vin: null, issue: "vin_malformed" };
}

const BRAND_ALIASES: Record<string, string> = {
  skoda: "Škoda",
  "skoda auto": "Škoda",
  vw: "Volkswagen",
  volkswagen: "Volkswagen",
  mercedes: "Mercedes-Benz",
  "mercedes benz": "Mercedes-Benz",
  "mercedes-benz": "Mercedes-Benz",
  mb: "Mercedes-Benz",
  bmw: "BMW",
  kia: "Kia",
  hyundai: "Hyundai",
  toyota: "Toyota",
  ford: "Ford",
  renault: "Renault",
  peugeot: "Peugeot",
  dacia: "Dacia",
  citroen: "Citroën",
  opel: "Opel",
  audi: "Audi",
  seat: "Seat",
  cupra: "Cupra",
  fiat: "Fiat",
  mazda: "Mazda",
  nissan: "Nissan",
  volvo: "Volvo",
  suzuki: "Suzuki",
  honda: "Honda",
  mitsubishi: "Mitsubishi",
  "land rover": "Land Rover",
  "alfa romeo": "Alfa Romeo",
};

export function normalizeBrand(raw: string): string | null {
  const s = collapse(raw);
  if (!s) return null;
  return BRAND_ALIASES[deaccent(s).toLowerCase()] ?? normalizeName(s);
}

/** "Škoda Octavia", "VW Golf", "Land Rover Discovery" → brand + model. */
export function splitVehicle(raw: string): { brand: string | null; model: string | null } {
  const s = collapse(raw);
  if (!s) return { brand: null, model: null };
  const words = s.split(" ");
  for (const n of [2, 1]) {
    const head = words.slice(0, n).join(" ");
    const alias = BRAND_ALIASES[deaccent(head).toLowerCase()];
    if (alias) return { brand: alias, model: words.slice(n).join(" ") || null };
  }
  return { brand: normalizeBrand(words[0]), model: words.slice(1).join(" ") || null };
}

// ---------- consent and categories ----------

/** Truthy consent values: ano, a, yes, 1, true, x. */
export function parseConsent(raw: string): boolean {
  return ["ano", "a", "yes", "y", "1", "true", "x"].includes(deaccent(raw.trim()).toLowerCase());
}

/** Keyword rules (spec §11), most specific first. */
const CATEGORY_RULES: [RegExp, ServiceCategory][] = [
  [/usklad/, "tyre_storage"],
  [/klima/, "ac_service"],
  [/brzd/, "brakes"],
  [/\bstk\b|emise|technick/, "stk"],
  [/diagno/, "diagnostics"],
  [/pneu|prezut|vyvaz|\bkol\b/, "tyre_change"],
  [/servis|prohlid|tkm/, "regular_service"],
  [/olej|filtr/, "oil_change"],
];

/** Company mapping first (exact normalised label), then keyword rules, else repair_other. */
export function categorizeService(raw: string | null, companyMappings: Map<string, ServiceCategory>): ServiceCategory {
  if (!raw) return "repair_other";
  const label = normalizeServiceLabel(raw);
  const mapped = companyMappings.get(label);
  if (mapped) return mapped;
  for (const [pattern, category] of CATEGORY_RULES) if (pattern.test(label)) return category;
  return "repair_other";
}
