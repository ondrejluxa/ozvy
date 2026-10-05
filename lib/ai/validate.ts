import { PLACEHOLDERS, findPlaceholders, renderTemplate } from "../domain/messaging/render";
import { stripDiacritics } from "../domain/messaging/diacritics";

/**
 * Output validation for AI-written templates (spec §15). Every generated
 * variant must pass before it is shown; the same checks run on manual edits
 * so the editor can show issues inline.
 */

export type TemplateIssue =
  | { code: "unknown_placeholder"; value: string }
  | { code: "missing_required"; value: string }
  | { code: "missing_greeting" }
  | { code: "denylist"; value: string }
  | { code: "url" }
  | { code: "emoji" }
  | { code: "exclamations" }
  | { code: "price_not_in_offer"; value: string }
  | { code: "too_long"; value: number };

const DENYLIST = ["potřebuje", "nutně", "hrozí", "poškozen", "nebezpeč", "zdarma"];

/** Typical values used for the length check: long brand + model, real phone. */
const TYPICAL = {
  recipient: {
    firstName: "Jana",
    lastName: "Procházková",
    vehicleBrand: "Volkswagen",
    vehicleModel: "Passat Variant",
    lastVisitAt: "2025-09-12",
  },
  shop: { shopName: "Autoservis Dvořák", phone: "+420321724118" },
  optOutUrl: "example.cz/o/Xk3P9aQ2",
};

export function validateTemplate(template: string, opts: { offer?: string | null; now: Date }): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const found = findPlaceholders(template);
  for (const p of new Set(found)) {
    if (!(PLACEHOLDERS as readonly string[]).includes(p)) issues.push({ code: "unknown_placeholder", value: p });
  }
  for (const required of ["servis", "odhlaseni"]) {
    if (!found.includes(required)) issues.push({ code: "missing_required", value: required });
  }
  if (!template.trim().startsWith("{{osloveni}}")) issues.push({ code: "missing_greeting" });

  const lower = template.toLowerCase();
  const offer = (opts.offer ?? "").toLowerCase();
  for (const word of DENYLIST) {
    if (lower.includes(word) && !offer.includes(word)) issues.push({ code: "denylist", value: word });
  }
  if (/https?:\/\/|www\./i.test(template)) issues.push({ code: "url" });
  if (/\p{Extended_Pictographic}/u.test(template)) issues.push({ code: "emoji" });
  if ((template.match(/!/g) ?? []).length > 1) issues.push({ code: "exclamations" });
  for (const m of template.matchAll(/\d[\d\s]*(?:Kč|%|,-)/g)) {
    if (!offer.includes(m[0].toLowerCase())) issues.push({ code: "price_not_in_offer", value: m[0].trim() });
  }

  const rendered = renderTemplate(template, { ...TYPICAL, now: opts.now }).text;
  const limit = stripDiacritics(rendered) === rendered ? 459 : 320;
  if (rendered.length > limit) issues.push({ code: "too_long", value: rendered.length });
  return issues;
}
