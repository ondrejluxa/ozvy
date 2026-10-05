/**
 * Invitation tokens (spec §20): random, single use, 7-day expiry. Only the
 * SHA-256 hash is stored; the raw token travels once, in the email link.
 * Uses Web Crypto so the module stays framework-free.
 */

export const INVITATION_TTL_DAYS = 7;

export type InvitationState = "valid" | "expired" | "accepted";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 32 random bytes, URL-safe (43 characters). */
export function generateInvitationToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashInvitationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function invitationExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITATION_TTL_DAYS * 86_400_000);
}

export function invitationState(
  invitation: { expires_at: string; accepted_at: string | null },
  now: Date,
): InvitationState {
  if (invitation.accepted_at) return "accepted";
  if (new Date(invitation.expires_at).getTime() <= now.getTime()) return "expired";
  return "valid";
}

/** Plausible shape check before any database lookup. */
export function isWellFormedToken(token: string | null | undefined): token is string {
  return !!token && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
