import { createHmac, timingSafeEqual } from "node:crypto";
import { stripDiacritics } from "./diacritics";

/**
 * Opt-out rules (spec §16 "Opt-out", §17): keywords in replies, the hashed
 * suppression key, and phone numbers as gateways report them.
 */

export const OPT_OUT_KEYWORDS = ["STOP", "ODHLASIT", "NE"] as const;

/** "Odhlásit." / " stop " / "NE!" → true; anything longer is a normal reply (two-way SMS is Phase 2). */
export function isOptOutKeyword(text: string): boolean {
  const word = stripDiacritics(text)
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  return (OPT_OUT_KEYWORDS as readonly string[]).includes(word);
}

/** hex(HMAC-SHA256(E.164 number, pepper)): the suppression list never stores numbers. */
export function suppressionHash(e164: string, pepper: string): string {
  if (!pepper) throw new Error("SUPPRESSION_PEPPER is not set");
  return createHmac("sha256", pepper).update(e164.trim()).digest("hex");
}

/** Gateway number formats ("420777123456", "+420 777 123 456", "00420…") → E.164, or null. */
export function toE164(raw: string): string | null {
  const digits = raw.replace(/[\s()-]/g, "").replace(/^00/, "+");
  const withPlus = digits.startsWith("+") ? digits : `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(withPlus) ? withPlus : null;
}

/** Constant-time comparison for webhook secrets. */
export function secretsEqual(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Fields of a gateway callback that are safe to keep after processing. */
const EVENT_KEEP = new Set(["status", "smsID", "sms_id", "channel", "price", "date", "type", "source", "_messageId"]);

/**
 * After an event is processed, only delivery metadata stays: the sender's
 * number and the text of a reply are removed (spec §21 data minimisation).
 */
export function stripEventPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([k]) => EVENT_KEEP.has(k)));
}
