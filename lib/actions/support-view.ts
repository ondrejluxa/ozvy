"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "../auth/context";
import { SUPPORT_VIEW_COOKIE, SUPPORT_VIEW_MAX_AGE } from "../auth/support-view";
import { audit } from "../audit";
import { SUPPORT_REASONS } from "../domain/support-view";
import { env } from "../env";

/** Start / end the read-only support view of a shop (spec §10), with a logged reason. */

export async function startSupportViewAction(form: FormData): Promise<void> {
  const data = z
    .object({
      companyId: z.string().uuid(),
      reason: z.enum(SUPPORT_REASONS),
      note: z.string().trim().max(300).optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!data.success || env.DATA_SOURCE !== "supabase") redirect("/admin/companies");
  const ctx = await requireContext(
    { permission: "admin.access", companyId: data.data.companyId },
    { allowInSupportView: true },
  );
  await audit({
    action: "admin.support_view_started",
    actorType: "admin",
    actorUserId: ctx.userId,
    companyId: data.data.companyId,
    entityType: "company",
    entityId: data.data.companyId,
    metadata: { reason: data.data.reason, note: data.data.note ?? null },
  });
  (await cookies()).set(SUPPORT_VIEW_COOKIE, data.data.companyId, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.APP_ENV === "production",
    path: "/",
    maxAge: SUPPORT_VIEW_MAX_AGE,
  });
  redirect("/app");
}

export async function endSupportViewAction(): Promise<void> {
  const ctx = await requireContext({ permission: "admin.access" }, { allowInSupportView: true });
  const store = await cookies();
  const companyId = store.get(SUPPORT_VIEW_COOKIE)?.value;
  store.delete(SUPPORT_VIEW_COOKIE);
  if (companyId) {
    await audit({
      action: "admin.support_view_ended",
      actorType: "admin",
      actorUserId: ctx.userId,
      companyId,
      entityType: "company",
      entityId: companyId,
    });
  }
  redirect(companyId ? `/admin/companies/${companyId}` : "/admin");
}
