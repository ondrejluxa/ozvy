import { z } from "zod";

/**
 * Validation of the shop profile the operator enters (spec §6 F1 step 1).
 * Input is form text; output is normalised column values. Errors are codes
 * per field, translated in the UI (messages/cs.json → companyForm.errors).
 */

export const COMPANY_STATUSES = ["onboarding", "active", "paused", "offboarding", "closed"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

/** Czech IČO: 8 digits, mod-11 check digit. */
export function isValidIco(ico: string): boolean {
  if (!/^\d{8}$/.test(ico)) return false;
  const sum = [...ico.slice(0, 7)].reduce((s, d, i) => s + Number(d) * (8 - i), 0);
  const r = sum % 11;
  const check = r === 0 ? 1 : r === 1 ? 0 : 11 - r;
  return check === Number(ico[7]);
}

/** Czech phone (mobile or fixed line) to E.164, or null when it is not one. */
export function normalizeCzechPhone(raw: string): string | null {
  const compact = raw.replace(/[\s\-/().]/g, "");
  const m = /^(?:\+420|00420)?([2-9]\d{8})$/.exec(compact);
  return m ? `+420${m[1]}` : null;
}

/**
 * Alphanumeric SMS sender ID: 3–11 characters, ASCII letters and digits,
 * at least one letter (all-digit senders are treated as phone numbers).
 */
export function isValidSenderName(name: string): boolean {
  return /^[A-Za-z0-9]{3,11}$/.test(name) && /[A-Za-z]/.test(name);
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "too_long")
    .transform((s) => s || null);

const profileSchema = z.object({
  name: z.string().trim().min(2, "required").max(120, "too_long"),
  ico: optionalText(20)
    .transform((s) => s?.replace(/\s/g, "") ?? null)
    .refine((s) => s === null || isValidIco(s), "invalid_ico"),
  dic: optionalText(20)
    .transform((s) => s?.replace(/\s/g, "").toUpperCase() ?? null)
    .refine((s) => s === null || /^CZ\d{8,10}$/.test(s), "invalid_dic"),
  address_line: optionalText(200),
  city: optionalText(100),
  postal_code: optionalText(10)
    .refine((s) => s === null || /^\d{3} ?\d{2}$/.test(s), "invalid_postal_code")
    .transform((s) => (s ? `${s.replace(" ", "").slice(0, 3)} ${s.replace(" ", "").slice(3)}` : null)),
  contact_person: optionalText(120),
  phone: optionalText(30)
    .refine((s) => s === null || normalizeCzechPhone(s) !== null, "invalid_phone")
    .transform((s) => (s ? normalizeCzechPhone(s) : null)),
  email: optionalText(254).refine((s) => s === null || z.email().safeParse(s).success, "invalid_email"),
  website: optionalText(200).refine(
    (s) => s === null || /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(s),
    "invalid_website",
  ),
  average_job_value_czk: z
    .string()
    .trim()
    .transform((s) => Number(s.replace(/\s/g, "").replace(",", ".")))
    .refine((n) => Number.isInteger(n) && n >= 100 && n <= 200_000, "invalid_job_value"),
  // Manual plan price (spec §20), for ROI; empty = not set yet.
  subscription_czk: z
    .string()
    .trim()
    .optional()
    .transform((s) => (s ? Number(s.replace(/\s/g, "").replace(",", ".")) : 0))
    .refine((n) => Number.isInteger(n) && n >= 0 && n <= 100_000, "invalid_subscription"),
  default_sender_name: optionalText(20).refine((s) => s === null || isValidSenderName(s), "invalid_sender"),
  opening_hours: optionalText(200),
  requires_client_approval: z.boolean(),
  status: z.enum(COMPANY_STATUSES, "invalid_status"),
});

/** Form input; `status` arrives as free text and is checked against COMPANY_STATUSES. */
export type CompanyProfileInput = Omit<z.input<typeof profileSchema>, "status"> & { status: string };

/** Column values for public.companies. */
export interface CompanyProfileValues {
  name: string;
  ico: string | null;
  dic: string | null;
  address_line: string | null;
  city: string | null;
  postal_code: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  average_job_value_minor: number;
  subscription_price_minor: number;
  default_sender_name: string | null;
  opening_hours: { note: string } | Record<string, never>;
  requires_client_approval: boolean;
  status: CompanyStatus;
}

export type ProfileResult =
  { success: true; values: CompanyProfileValues } | { success: false; fieldErrors: Record<string, string> };

export function parseCompanyProfile(input: CompanyProfileInput): ProfileResult {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "form");
      fieldErrors[field] ??= issue.code === "invalid_type" ? "required" : issue.message;
    }
    return { success: false, fieldErrors };
  }
  const { average_job_value_czk, subscription_czk, opening_hours, ...rest } = parsed.data;
  return {
    success: true,
    values: {
      ...rest,
      average_job_value_minor: average_job_value_czk * 100,
      subscription_price_minor: subscription_czk * 100,
      opening_hours: opening_hours ? { note: opening_hours } : {},
    },
  };
}

/** Column names whose values differ (audit metadata: names only, never values). */
export function changedFields<T extends object>(before: T, after: T): (keyof T)[] {
  return (Object.keys(after) as (keyof T)[]).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}
