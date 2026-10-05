"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { SUPPORT_VIEW_COOKIE } from "../auth/context";
import { getCompanyBasics } from "../db/queries";
import { resetDemoData } from "../db/mutations";
import { env } from "../env";

// Demo-only actions: the presenter switches views and resets data. In
// DATA_SOURCE=supabase they do nothing but send the user home.
function demoOnly() {
  if (env.DATA_SOURCE !== "demo") redirect("/login");
}

/** Opens the read-only client view of one shop (Phase 1: audited support view with a reason). */
export async function openClientViewAction(companyId: string) {
  demoOnly();
  const parsed = z.string().uuid().parse(companyId);
  if (!getCompanyBasics(parsed)) redirect("/admin/companies");
  const store = await cookies();
  store.set(SUPPORT_VIEW_COOKIE, parsed, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/app");
}

export async function exitClientViewAction() {
  demoOnly();
  const store = await cookies();
  const companyId = store.get(SUPPORT_VIEW_COOKIE)?.value;
  store.delete(SUPPORT_VIEW_COOKIE);
  redirect(companyId ? `/admin/companies/${companyId}` : "/admin");
}

export async function resetDemoAction() {
  demoOnly();
  resetDemoData();
  const store = await cookies();
  store.delete(SUPPORT_VIEW_COOKIE);
  redirect("/admin");
}
