import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCompanyBasics } from "../db/queries";
import { env } from "../env";
import {
  resolveAccess,
  supportViewBlocks,
  type AccessDenial,
  type AccessRequest,
  type MembershipInfo,
  type SessionInfo,
} from "./access";
import { getSessionInfo } from "./session";

/**
 * requireContext({ permission, companyId }) (spec §20, §42 rule 3): every
 * server action and protected layout starts here. It resolves the user,
 * their membership and the admin flag once, and refuses anything the
 * permission map does not allow. RLS is the final guard behind it.
 *
 * DATA_SOURCE=demo has no login: the presenter is always the operator, and
 * the client view is a read-only support view selected by a cookie.
 */

export class AuthError extends Error {
  constructor(public reason: AccessDenial) {
    super(reason);
    this.name = "AuthError";
  }
}

export type AuthContext =
  | { mode: "demo"; isPlatformAdmin: true; userId: null; session: null; membership: null }
  | {
      mode: "supabase";
      isPlatformAdmin: boolean;
      userId: string;
      session: SessionInfo;
      membership: MembershipInfo | null;
    };

const DEMO_CONTEXT: AuthContext = {
  mode: "demo",
  isPlatformAdmin: true,
  userId: null,
  session: null,
  membership: null,
};

/**
 * For server actions: throws AuthError, which actions turn into a typed
 * failure. Writes are refused while the operator's support view is open;
 * pass `read: true` for read-only callers (pages, downloads).
 */
export async function requireContext(
  request: AccessRequest,
  opts: { read?: boolean; allowInSupportView?: boolean } = {},
): Promise<AuthContext> {
  if (env.DATA_SOURCE === "demo") return DEMO_CONTEXT;
  const session = await getSessionInfo();
  const result = resolveAccess(session, request);
  if (!result.ok) throw new AuthError(result.reason);
  const supportViewActive = Boolean((await cookies()).get(SUPPORT_VIEW_COOKIE)?.value);
  if (supportViewBlocks(session, supportViewActive, opts)) throw new AuthError("support_view_read_only");
  return {
    mode: "supabase",
    isPlatformAdmin: result.isPlatformAdmin,
    userId: session!.userId,
    session: session!,
    membership: result.membership,
  };
}

/** For layouts and pages: redirects instead of throwing. */
export async function requirePageContext(request: AccessRequest, currentPath: string): Promise<AuthContext> {
  try {
    return await requireContext(request, { read: true });
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    switch (err.reason) {
      case "unauthenticated":
        redirect(`/login?next=${encodeURIComponent(currentPath)}`);
      case "mfa_required":
      case "mfa_enrollment_required":
        redirect(`/mfa?next=${encodeURIComponent(currentPath)}`);
      default:
        redirect("/forbidden");
    }
  }
}

// ---------- demo support view (DATA_SOURCE=demo only) ----------

export const SUPPORT_VIEW_COOKIE = "navrat_support_view";

export interface SupportView {
  companyId: string;
  companyName: string;
  readOnly: true;
}

export async function getSupportView(): Promise<SupportView | null> {
  if (env.DATA_SOURCE !== "demo") return null;
  const store = await cookies();
  const companyId = store.get(SUPPORT_VIEW_COOKIE)?.value;
  if (!companyId) return null;
  const basics = getCompanyBasics(companyId);
  if (!basics) return null;
  return { companyId, companyName: basics.company.name, readOnly: true };
}
