import { z } from "zod";
import { normalizeCzechPhone } from "./company-profile";

/**
 * Customer search and contact editing (spec §8, §20 customers.edit_contact).
 * Pure: the SQL function public.list_customers receives the normalised terms.
 */

export interface SearchTerms {
  /** Lower-case name without diacritics, matched against customers.search_name. */
  name: string | null;
  /** Phone digits, matched inside phone_e164. */
  digits: string | null;
  /** Plate without spaces, upper case, matched inside license_plate_norm. */
  plate: string | null;
}

const deaccent = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** One free-text box searches name, phone and plate at once (OR). */
export function parseSearch(raw: string | undefined): SearchTerms {
  const q = (raw ?? "").trim().slice(0, 80);
  const name = deaccent(q)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const compact = q.replace(/[\s\-/().+]/g, "");
  const digits = /^\d{3,}$/.test(compact) ? compact.replace(/^00420/, "420") : null;
  const plate = deaccent(q).toUpperCase().replace(/[\s-]/g, "");
  return {
    name: name.length >= 2 && !/^\d+$/.test(name.replace(/ /g, "")) ? name : null,
    digits,
    plate: /^[A-Z0-9]{3,8}$/.test(plate) && /\d/.test(plate) ? plate : null,
  };
}

/** Czech numbering plan: 601–608, 702–705 and 72x–79x are mobile; 2xx–5xx are fixed lines. */
export function czechPhoneType(e164: string | null): "mobile" | "fixed" | "unknown" {
  const m = /^\+420(\d{9})$/.exec(e164 ?? "");
  if (!m) return "unknown";
  const n = m[1];
  if (/^60[1-8]/.test(n) || /^70[2-5]/.test(n) || /^7[2-9]/.test(n)) return "mobile";
  if (/^[2-5]/.test(n)) return "fixed";
  return "unknown";
}

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "too_long")
    .transform((s) => s || null);

const contactSchema = z.object({
  first_name: optional(80),
  last_name: optional(80),
  phone: optional(30).refine((s) => s === null || normalizeCzechPhone(s) !== null, "invalid_phone"),
  email: optional(254).refine((s) => s === null || z.email().safeParse(s).success, "invalid_email"),
  notes: optional(2000),
});

export type ContactInput = z.input<typeof contactSchema>;

export interface ContactValues {
  first_name: string | null;
  last_name: string | null;
  phone_e164: string | null;
  phone_type: "mobile" | "fixed" | "unknown";
  email: string | null;
  notes: string | null;
}

export function parseCustomerContact(
  input: ContactInput,
): { success: true; values: ContactValues } | { success: false; fieldErrors: Record<string, string> } {
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { success: false, fieldErrors };
  }
  const { phone, ...rest } = parsed.data;
  if (!rest.first_name && !rest.last_name) return { success: false, fieldErrors: { last_name: "name_required" } };
  const phoneE164 = phone ? normalizeCzechPhone(phone) : null;
  return {
    success: true,
    values: {
      ...rest,
      phone_e164: phoneE164,
      phone_type: czechPhoneType(phoneE164),
      email: rest.email?.toLowerCase() ?? null,
    },
  };
}
