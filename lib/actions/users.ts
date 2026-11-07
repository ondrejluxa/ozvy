"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireContext } from "../auth/context";
import { audit } from "../audit";
import { DomainError } from "../db/mutations";
import { listCompanyUsers } from "../db/supabase/companies";
import { createSupabaseServerClient } from "../db/supabase/server-client";
import { SHOP_ROLES, memberChangeIssue, type MemberChange } from "../domain/users";
import { run, type ActionResult } from "./result";

/**
 * Role change, removal and invitation revocation (spec §20 users.invite:
 * shop owners and the operator; managers cannot). Thin: Zod → domain rule →
 * RLS-scoped write → audit. The database keeps the last owner as well.
 */

const target = z.object({ companyId: z.string().uuid(), userId: z.string().uuid() });

async function applyChange(companyId: string, change: MemberChange) {
  const ctx = await requireContext({ permission: "users.invite", companyId });
  const { members } = await listCompanyUsers(companyId);
  const issue = memberChangeIssue(members, change);
  if (issue === "unchanged") return { ctx, previous: null };
  if (issue) throw new DomainError(issue);
  const previous = members.find((m) => m.userId === change.userId)!.role;

  const supabase = await createSupabaseServerClient();
  const query =
    "remove" in change
      ? supabase.from("memberships").delete().eq("company_id", companyId).eq("user_id", change.userId).select("id")
      : supabase
          .from("memberships")
          .update({ role: change.role })
          .eq("company_id", companyId)
          .eq("user_id", change.userId)
          .select("id");
  const { data, error } = await query;
  if (error?.code === "23514") throw new DomainError("last_owner");
  if (error || !data?.length) throw new DomainError("save_failed");
  return { ctx, previous };
}

export async function changeMemberRoleAction(input: {
  companyId: string;
  userId: string;
  role: string;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const data = target.extend({ role: z.enum(SHOP_ROLES as [string, ...string[]]) }).parse(input);
    const role = data.role as (typeof SHOP_ROLES)[number];
    const { ctx, previous } = await applyChange(data.companyId, { userId: data.userId, role });
    if (previous) {
      await audit({
        action: "user.role_changed",
        actorType: ctx.isPlatformAdmin ? "admin" : "user",
        actorUserId: ctx.userId,
        companyId: data.companyId,
        entityType: "user",
        entityId: data.userId,
        metadata: { target_user_id: data.userId, old_role: previous, new_role: role },
      });
    }
    refresh();
    return null;
  });
}

export async function removeMemberAction(input: { companyId: string; userId: string }): Promise<ActionResult<null>> {
  return run(async () => {
    const data = target.parse(input);
    const { ctx, previous } = await applyChange(data.companyId, { userId: data.userId, remove: true });
    await audit({
      action: "user.removed",
      actorType: ctx.isPlatformAdmin ? "admin" : "user",
      actorUserId: ctx.userId,
      companyId: data.companyId,
      entityType: "user",
      entityId: data.userId,
      metadata: { target_user_id: data.userId, role: previous },
    });
    refresh();
    return null;
  });
}

/** Withdraws a pending invitation; its link stops working at once. */
export async function revokeInvitationAction(input: {
  companyId: string;
  invitationId: string;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const data = z.object({ companyId: z.string().uuid(), invitationId: z.string().uuid() }).parse(input);
    const ctx = await requireContext({ permission: "users.invite", companyId: data.companyId });
    const supabase = await createSupabaseServerClient();
    const { data: rows, error } = await supabase
      .from("invitations")
      .delete()
      .eq("company_id", data.companyId)
      .eq("id", data.invitationId)
      .is("accepted_at", null)
      .select("id, role");
    if (error || !rows?.length) throw new DomainError("not_found");
    await audit({
      action: "user.invitation_revoked",
      actorType: ctx.isPlatformAdmin ? "admin" : "user",
      actorUserId: ctx.userId,
      companyId: data.companyId,
      entityType: "invitation",
      entityId: data.invitationId,
      metadata: { role: rows[0].role },
    });
    refresh();
    return null;
  });
}
