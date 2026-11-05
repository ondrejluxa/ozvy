import "server-only";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "../db/supabase/server-client";
import type { MembershipInfo } from "./access";

/**
 * Operator support view on real data (spec §10): instead of impersonation,
 * the operator opens a shop's client UI read-only after giving a reason
 * (logged as admin.support_view_started). The cookie only names the company;
 * every request still requires a platform admin with MFA.
 */
export const SUPPORT_VIEW_COOKIE = "navrat_support_view";
export const SUPPORT_VIEW_MAX_AGE = 2 * 60 * 60;

export async function supportViewCompany(): Promise<MembershipInfo | null> {
  const companyId = (await cookies()).get(SUPPORT_VIEW_COOKIE)?.value;
  if (!companyId || !/^[0-9a-f-]{36}$/i.test(companyId)) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("companies")
    .select("id, name, service_mode, requires_client_approval")
    .eq("id", companyId)
    .maybeSingle();
  if (!data) return null;
  return {
    companyId: data.id,
    companyName: data.name,
    role: "shop_owner",
    serviceMode: data.service_mode,
    requiresClientApproval: data.requires_client_approval,
    supportView: true,
  };
}
