import { createHash } from "node:crypto";

/**
 * Rate limits (spec §22): fixed windows counted in Postgres
 * (public.hit_rate_limit), so no extra service is needed. Subjects that are
 * personal data (IP addresses, e-mails) are hashed before they become keys.
 */

export const RATE_LIMITS = {
  /**
   * Failed sign-ins (spec §22): 5 per e-mail in 15 minutes, then locked for the
   * rest of the window. Per IP a looser 20, so one office behind a shared
   * address is not locked out by a colleague, while password spraying is.
   */
  login: { limit: 5, windowSeconds: 15 * 60, ipLimit: 20 },
  /** Password reset requests per IP and per e-mail. */
  passwordReset: { limit: 5, windowSeconds: 60 * 60 },
  /** Invitation acceptance attempts per IP. */
  invitation: { limit: 10, windowSeconds: 15 * 60 },
  /** AI generations and rewrites per user (spec §22: 30 per hour). */
  ai: { limit: 30, windowSeconds: 60 * 60 },
  /** Opt-out clicks per IP. */
  optOut: { limit: 20, windowSeconds: 10 * 60 },
  /** Gateway callbacks per provider. */
  webhook: { limit: 600, windowSeconds: 60 },
} as const;

export type RateLimitScope = keyof typeof RATE_LIMITS;

/** "login:ip:3f2a…": scope, subject kind and a short hash of the subject. */
export function rateLimitKey(scope: RateLimitScope, kind: string, subject: string): string {
  const hash = createHash("sha256").update(subject.trim().toLowerCase()).digest("hex").slice(0, 32);
  return `${scope}:${kind}:${hash}`;
}

/** First address of x-forwarded-for (the client as seen by the edge), else x-real-ip. */
export function clientIp(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}
