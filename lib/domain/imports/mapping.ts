/**
 * Column mapping (spec §11 step 3): which source column feeds which target
 * field. Suggested from header keywords; saved per company and type as a
 * template and applied automatically next time.
 */

export type ImportType = "customers" | "visits";

export const TARGET_FIELDS = [
  "external_customer_id",
  "first_name",
  "last_name",
  "full_name",
  "full_name_last_first",
  "phone",
  "email",
  "vehicle_brand",
  "vehicle_model",
  "vehicle_full",
  "license_plate",
  "vin",
  "visit_date",
  "service_type",
  "job_value",
  "total_lifetime_value",
  "marketing_consent",
  "notes",
] as const;
export type TargetField = (typeof TARGET_FIELDS)[number];

/** Target field → source column index (header position). */
export type ColumnMapping = Partial<Record<TargetField, number>>;

const deaccent = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Header keywords per field, checked in this order (more specific first). */
const KEYWORDS: [TargetField, RegExp][] = [
  ["external_customer_id", /^(id|cislo zakaznika|zakaznik c|c zakaznika|cislo klienta|kod zakaznika|customer id)\b/],
  ["full_name_last_first", /^prijmeni a jmeno|^prijmeni jmeno/],
  ["full_name", /^(jmeno a prijmeni|cele jmeno|zakaznik|klient|jmeno prijmeni|name)$/],
  ["first_name", /^(jmeno|krestni jmeno|first name)$/],
  ["last_name", /^(prijmeni|last name|surname)$/],
  ["phone", /(telefon|mobil|tel\b|phone|gsm)/],
  ["email", /(e ?mail|email)/],
  ["vin", /^vin\b|vin kod|cislo karoserie/],
  ["license_plate", /^(spz|rz|rzv|registracni znacka|znacka vozidla|plate)$/],
  ["vehicle_brand", /^(znacka|vyrobce|brand|make)$/],
  ["vehicle_model", /^(model|typ vozidla|typ)$/],
  ["vehicle_full", /^(vozidlo|auto|vuz|vehicle)$/],
  ["visit_date", /(datum|date)/],
  ["service_type", /(popis prace|druh prace|prace|sluzba|ukon|zakazka|service)/],
  ["job_value", /(cena|castka|celkem|trzba|price|hodnota)/],
  ["total_lifetime_value", /(utrata celkem|obrat celkem|lifetime)/],
  ["marketing_consent", /(souhlas|gdpr|consent|marketing)/],
  ["notes", /(poznamka|pozn|notes|note)/],
];

export function suggestMapping(header: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  header.forEach((raw, index) => {
    const h = deaccent(raw);
    if (!h) return;
    for (const [field, pattern] of KEYWORDS) {
      if (mapping[field] === undefined && pattern.test(h)) {
        mapping[field] = index;
        return;
      }
    }
  });
  return mapping;
}

/** A saved template applies only where its columns still exist and carry the same header. */
export function applyTemplate(
  template: { mapping: ColumnMapping; header: string[] } | null,
  header: string[],
): ColumnMapping | null {
  if (!template) return null;
  const mapping: ColumnMapping = {};
  for (const [field, index] of Object.entries(template.mapping) as [TargetField, number][]) {
    const name = template.header[index];
    const now = header.findIndex((h) => deaccent(h) === deaccent(name ?? ""));
    if (now >= 0) mapping[field] = now;
  }
  return Object.keys(mapping).length ? mapping : null;
}

/**
 * The mapping offered to the operator: the saved template where it still
 * applies, completed by header suggestions for fields it does not cover
 * (never reusing a column the template already took).
 */
export function initialMapping(
  template: { mapping: ColumnMapping; header: string[] } | null,
  header: string[],
): { mapping: ColumnMapping; templateApplied: boolean } {
  const fromTemplate = applyTemplate(template, header);
  const mapping: ColumnMapping = { ...(fromTemplate ?? {}) };
  const used = new Set(Object.values(mapping));
  for (const [field, index] of Object.entries(suggestMapping(header)) as [TargetField, number][]) {
    if (mapping[field] === undefined && !used.has(index)) {
      mapping[field] = index;
      used.add(index);
    }
  }
  return { mapping, templateApplied: fromTemplate !== null };
}

export type MappingProblem = "name_required" | "contact_required" | "visit_date_required" | "duplicate_column";

export function mappingProblems(mapping: ColumnMapping, type: ImportType): MappingProblem[] {
  const problems: MappingProblem[] = [];
  const has = (f: TargetField) => mapping[f] !== undefined;
  if (!has("first_name") && !has("last_name") && !has("full_name") && !has("full_name_last_first")) {
    problems.push("name_required");
  }
  if (!has("phone") && !has("email")) problems.push("contact_required");
  if (type === "visits" && !has("visit_date")) problems.push("visit_date_required");
  const columns = Object.values(mapping);
  if (new Set(columns).size !== columns.length) problems.push("duplicate_column");
  return problems;
}

/**
 * Sample values for an AI mapping hint, masked first (spec §15: AI never
 * receives personal data): letters become x/X, digits 9, so the format stays
 * visible ("Jana" → "Xxxx", "777 123 456" → "999 999 999").
 */
export function maskSample(value: string): string {
  return value
    .slice(0, 40)
    .replace(/\p{Lu}/gu, "X")
    .replace(/\p{Ll}/gu, "x")
    .replace(/\d/g, "9");
}
