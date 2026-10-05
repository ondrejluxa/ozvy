import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "../db/supabase/server-client";
import { env } from "../env";
import type { MembershipInfo, SessionInfo } from "./access";

/**
 * Resolves the signed-in user once per request: identity (validated with the
 * Auth server), platform-admin flag, MFA assurance level and memberships.
 * All reads go through the user's own session, so RLS applies.
 */
export const getSessionInfo = cache(async (): Promise<SessionInfo | null> => {
  if (env.DATA_SOURCE !== "supabase") return null;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [admin, memberships, profile, aal, factors] = await Promise.all([
    supabase.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("memberships")
      .select("company_id, role, companies(name, service_mode, requires_client_approval)")
      .eq("user_id", user.id),
    supabase.from("profiles").select("full_name").eq("user_id", user.id).maybeSingle(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);

  const list: MembershipInfo[] = (memberships.data ?? [])
    .filter((m) => m.companies)
    .map((m) => ({
      companyId: m.company_id,
      companyName: m.companies!.name,
      role: m.role,
      serviceMode: m.companies!.service_mode,
      requiresClientApproval: m.companies!.requires_client_approval,
    }))
    .sort((a, b) => a.companyName.localeCompare(b.companyName, "cs"));

  return {
    userId: user.id,
    email: user.email ?? null,
    fullName: profile.data?.full_name ?? null,
    isPlatformAdmin: !!admin.data,
    aal: aal.data?.currentLevel === "aal2" ? "aal2" : "aal1",
    hasVerifiedTotp: (factors.data?.totp ?? []).some((f) => f.status === "verified"),
    memberships: list,
  };
});
