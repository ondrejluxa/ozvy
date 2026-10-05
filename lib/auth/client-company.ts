import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { MembershipInfo, SessionInfo } from "./access";
import { requirePageContext } from "./context";
import { getSessionInfo } from "./session";

/**
 * Which company the client app (/app) shows for the signed-in shop user
 * (DATA_SOURCE=supabase). The company always comes from the user's own
 * memberships, never from the URL (spec §20: companyId is verified against
 * membership). A preference cookie picks one when the user has several.
 */
export const COMPANY_COOKIE = "navrat_company";

export async function requireClientCompany(
  currentPath: string,
): Promise<{ session: SessionInfo; membership: MembershipInfo }> {
  const session = await getSessionInfo();
  if (!session) redirect(`/login?next=${encodeURIComponent(currentPath)}`);
  const preferred = (await cookies()).get(COMPANY_COOKIE)?.value;
  const membership = session.memberships.find((m) => m.companyId === preferred) ?? session.memberships[0] ?? null;
  if (!membership) redirect(session.isPlatformAdmin ? "/admin" : "/forbidden");

  await requirePageContext({ permission: "dashboard.view", companyId: membership.companyId }, currentPath);
  return { session, membership };
}
