import "server-only";
import { cookies } from "next/headers";
import { getCompanyBasics } from "../db/queries";

/**
 * Phase 0 demo context. There is no login: the presenter is always the
 * operator, and the client view is a read-only "support view" of one shop,
 * selected by a cookie.
 *
 * Phase 1 replaces this with requireContext({ permission, companyId }) on
 * top of Supabase Auth, memberships and admin_access_sessions (spec §20).
 */

export const SUPPORT_VIEW_COOKIE = "navrat_support_view";

export interface SupportView {
  companyId: string;
  companyName: string;
  readOnly: true;
}

export async function getSupportView(): Promise<SupportView | null> {
  const store = await cookies();
  const companyId = store.get(SUPPORT_VIEW_COOKIE)?.value;
  if (!companyId) return null;
  const basics = getCompanyBasics(companyId);
  if (!basics) return null;
  return { companyId, companyName: basics.company.name, readOnly: true };
}
