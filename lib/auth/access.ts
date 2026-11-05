import type { CompanyRole, ServiceMode } from "../db/types";
import { can, type Permission } from "./permissions";

/**
 * Pure access resolution behind requireContext (spec §20). Given what the
 * session resolved (user, admin flag, assurance level, memberships) decide
 * whether the request may proceed. Kept framework-free so it is unit-tested.
 */

export interface MembershipInfo {
  companyId: string;
  companyName: string;
  role: CompanyRole;
  serviceMode: ServiceMode;
  requiresClientApproval: boolean;
  /** The operator's read-only support view of this shop (spec §10), not a real membership. */
  supportView?: boolean;
}

export interface SessionInfo {
  userId: string;
  email: string | null;
  fullName: string | null;
  isPlatformAdmin: boolean;
  /** Authenticator assurance level of the current session. */
  aal: "aal1" | "aal2";
  /** Whether the user has a verified TOTP factor. */
  hasVerifiedTotp: boolean;
  memberships: MembershipInfo[];
}

export type AccessDenial =
  "unauthenticated" | "mfa_required" | "mfa_enrollment_required" | "forbidden" | "support_view_read_only";

/**
 * While the operator's support view is open (spec §10), every write is
 * refused at the server, not only hidden in the UI. Reads (pages, downloads)
 * pass, and so do the actions that start or end the support view itself.
 */
export function supportViewBlocks(
  session: Pick<SessionInfo, "isPlatformAdmin"> | null,
  supportViewActive: boolean,
  opts: { read?: boolean; allowInSupportView?: boolean },
): boolean {
  return Boolean(session?.isPlatformAdmin) && supportViewActive && !opts.read && !opts.allowInSupportView;
}

export type AccessResult =
  { ok: true; membership: MembershipInfo | null; isPlatformAdmin: boolean } | { ok: false; reason: AccessDenial };

export interface AccessRequest {
  permission: Permission;
  /** Required for company-scoped permissions; never trusted without a membership check. */
  companyId?: string | null;
}

export function resolveAccess(session: SessionInfo | null, request: AccessRequest): AccessResult {
  if (!session) return { ok: false, reason: "unauthenticated" };

  // Super admins must use TOTP MFA (spec §20): every admin request needs aal2.
  if (session.isPlatformAdmin && session.aal !== "aal2") {
    return { ok: false, reason: session.hasVerifiedTotp ? "mfa_required" : "mfa_enrollment_required" };
  }

  if (request.permission === "admin.access") {
    return session.isPlatformAdmin
      ? { ok: true, membership: null, isPlatformAdmin: true }
      : { ok: false, reason: "forbidden" };
  }

  const membership = request.companyId
    ? (session.memberships.find((m) => m.companyId === request.companyId) ?? null)
    : null;

  if (session.isPlatformAdmin) {
    return { ok: true, membership, isPlatformAdmin: true };
  }
  if (!request.companyId || !membership) return { ok: false, reason: "forbidden" };

  const allowed = can(
    {
      isPlatformAdmin: false,
      role: membership.role,
      serviceMode: membership.serviceMode,
      requiresClientApproval: membership.requiresClientApproval,
    },
    request.permission,
  );
  return allowed ? { ok: true, membership, isPlatformAdmin: false } : { ok: false, reason: "forbidden" };
}

/** Where to send a user who just signed in (or hit a page without context). */
export function homePath(session: SessionInfo): string {
  if (session.isPlatformAdmin) return session.aal === "aal2" ? "/admin" : "/mfa";
  return session.memberships.length > 0 ? "/app" : "/forbidden";
}

/** Only same-origin relative paths are accepted as post-login redirects. */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
