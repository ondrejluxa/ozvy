/**
 * PII scrubbing for error reports and logs (spec §22, §25, §41: no phone
 * numbers or e-mails in Sentry events or logs). Applied to every string in
 * an event before it leaves the process.
 */

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// +420 777 123 456, 777123456, 00420777123456, (+420) 777-123-456 …
const PHONE = /(?<![\w+])(?:(?:\+|00)\(?\d{3}\)?[\s-]?)?\d{3}[\s-]?\d{3}[\s-]?\d{3}\b/g;

export function scrubText(text: string): string {
  return text.replace(EMAIL, "[email]").replace(PHONE, "[phone]");
}

/** Deep copy with every string scrubbed; keys named like contact fields are dropped. */
export function scrubDeep<T>(value: T, depth = 0): T {
  if (depth > 8) return value;
  if (typeof value === "string") return scrubText(value) as T;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/^(phone|phone_e164|email|to_address|to|cookie|authorization)$/i.test(k)) {
        out[k] = "[redacted]";
      } else {
        out[k] = scrubDeep(v, depth + 1);
      }
    }
    return out as T;
  }
  return value;
}
