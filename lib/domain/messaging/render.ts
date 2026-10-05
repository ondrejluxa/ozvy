import { describeLastVisit } from "../dates";
import { stripDiacritics } from "./diacritics";

/**
 * Deterministic template renderer (spec §15 "Template placeholders").
 * AI writes one template; this code fills in every recipient. The renderer
 * refuses (missingRequired) when the opt-out or shop placeholder is absent.
 */

export const PLACEHOLDERS = ["osloveni", "vozidlo", "posledni_navsteva", "servis", "telefon", "odhlaseni"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];
export const REQUIRED_PLACEHOLDERS: Placeholder[] = ["servis", "odhlaseni"];

export interface RecipientRenderData {
  firstName: string | null;
  lastName: string | null;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  lastVisitAt: string | null;
}

export interface ShopRenderData {
  shopName: string;
  phone: string | null;
}

export interface RenderOptions {
  recipient: RecipientRenderData;
  shop: ShopRenderData;
  optOutUrl: string;
  now: Date;
  stripDiacritics?: boolean;
}

export interface RenderResult {
  text: string;
  missingRequired: Placeholder[];
  unknownPlaceholders: string[];
  /** Placeholders that used their fallback, so previews can flag them. */
  fallbacks: Placeholder[];
}

/** Possessive + accusative form per brand: "vaši Škodu Octavia", "váš Ford Focus". */
const BRAND_ACCUSATIVE: Record<string, { possessive: string; brand: string }> = {
  Škoda: { possessive: "vaši", brand: "Škodu" },
  Toyota: { possessive: "vaši", brand: "Toyotu" },
  Dacia: { possessive: "vaši", brand: "Dacii" },
  Kia: { possessive: "vaši", brand: "Kiu" },
  Mazda: { possessive: "vaši", brand: "Mazdu" },
  Honda: { possessive: "vaši", brand: "Hondu" },
  Tesla: { possessive: "vaši", brand: "Teslu" },
  Volvo: { possessive: "vaše", brand: "Volvo" },
  BMW: { possessive: "vaše", brand: "BMW" },
  Audi: { possessive: "vaše", brand: "Audi" },
  Seat: { possessive: "váš", brand: "Seat" },
  Cupra: { possessive: "vaši", brand: "Cupru" },
};

export function vehiclePhrase(brand: string | null, model: string | null): string | null {
  if (!brand) return null;
  const form = BRAND_ACCUSATIVE[brand] ?? { possessive: "váš", brand };
  return [form.possessive, form.brand, model].filter(Boolean).join(" ");
}

/** "+420777123456" → "777 123 456". */
export function formatNationalPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "").replace(/^420/, "");
  if (digits.length !== 9) return phone;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

const TOKEN = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function findPlaceholders(template: string): string[] {
  return [...template.matchAll(TOKEN)].map((m) => m[1]);
}

/**
 * Removes the sentence that contains a placeholder whose value is missing
 * ("omitted sentence variant"). The greeting survives, and the sentence that
 * now follows the greeting comma starts lowercase.
 */
function dropSentenceWith(template: string, placeholder: string): string {
  const token = `{{${placeholder}}}`;
  const kept = template
    .split(/(?<=[.!?])\s+/)
    .map((s) => (!s.includes(token) ? s : s.startsWith("{{osloveni}}") ? "{{osloveni}}" : null))
    .filter((s): s is string => s !== null);
  return kept.join(" ").replace(/^\{\{osloveni\}\}\s+(\p{Lu})/u, (_m, c: string) => `{{osloveni}} ${c.toLowerCase()}`);
}

export function renderTemplate(template: string, opts: RenderOptions): RenderResult {
  const found = findPlaceholders(template);
  const unknownPlaceholders = [...new Set(found.filter((p) => !(PLACEHOLDERS as readonly string[]).includes(p)))];
  const missingRequired = REQUIRED_PLACEHOLDERS.filter((p) => !found.includes(p));
  const fallbacks: Placeholder[] = [];

  const vehicle = vehiclePhrase(opts.recipient.vehicleBrand, opts.recipient.vehicleModel);
  const lastVisit = opts.recipient.lastVisitAt ? describeLastVisit(opts.recipient.lastVisitAt, opts.now) : null;

  let working = template;
  if (!lastVisit && found.includes("posledni_navsteva")) {
    working = dropSentenceWith(working, "posledni_navsteva");
    fallbacks.push("posledni_navsteva");
  }

  const values: Record<Placeholder, string> = {
    // Personalised vocatives are opt-in (spec §0.5); the safe default is used.
    osloveni: "Dobrý den,",
    vozidlo: vehicle ?? "vaše auto",
    posledni_navsteva: lastVisit ?? "",
    servis: opts.shop.shopName,
    telefon: formatNationalPhone(opts.shop.phone) ?? "",
    odhlaseni: `Odhlásit: ${opts.optOutUrl}`,
  };
  if (!vehicle && found.includes("vozidlo")) fallbacks.push("vozidlo");

  let text = working.replace(TOKEN, (match, name: string) =>
    (PLACEHOLDERS as readonly string[]).includes(name) ? values[name as Placeholder] : match,
  );
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([.,])/g, "$1")
    .trim();

  // A sentence that starts after the greeting comma keeps a lowercase start;
  // a missing-greeting template gets its first letter capitalised.
  if (text.length > 0) text = text[0].toUpperCase() + text.slice(1);

  if (opts.stripDiacritics) text = stripDiacritics(text);
  return { text, missingRequired, unknownPlaceholders, fallbacks };
}

/** Deterministic 8-char base62 opt-out token derived from a seed string. */
export function optOutToken(seed: string): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let h = 2166136261;
  let out = "";
  for (let round = 0; out.length < 8; round++) {
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i) + round;
      h = Math.imul(h, 16777619);
    }
    out += alphabet[(h >>> 0) % alphabet.length];
  }
  return out;
}
