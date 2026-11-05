"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "../auth/context";
import { getSessionInfo } from "../auth/session";
import { audit } from "../audit";
import { createServiceClient } from "../db/supabase/service-client";
import { addMembershipFromInvitation, claimInvitation, loadInvitation, releaseInvitation } from "../auth/invitations";
import { createSupabaseServerClient } from "../db/supabase/server-client";
import { generateInvitationToken, hashInvitationToken, invitationExpiry, normalizeEmail } from "../domain/invitations";
import { passwordIssues } from "../domain/passwords";
import { env } from "../env";
import { invitationEmail } from "../emails/invitation";
import { getEmailProvider } from "../providers/email";
import type { FormState } from "./auth";
import { allowRate, requestIp } from "../rate-limit";
import { run, type ActionResult } from "./result";

/**
 * Invite-only access (spec §20): a random token is emailed once; only its
 * hash is stored; it expires after 7 days and works once. Possession of the
 * link proves the email address, so accepted accounts are created verified.
 */

const createSchema = z.object({
  companyId: z.string().uuid(),
  email: z.string().trim().email().max(254),
  role: z.enum(["shop_owner", "shop_manager"]),
});

export async function createInvitationAction(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<{ invitationId: string }>> {
  return run(async () => {
    const data = createSchema.parse(input);
    const ctx = await requireContext({ permission: "users.invite", companyId: data.companyId });
    const token = generateInvitationToken();

    // Inserted with the inviter's session: RLS allows only the company's owner or the platform admin.
    const supabase = await createSupabaseServerClient();
    const { data: invitation, error } = await supabase
      .from("invitations")
      .insert({
        company_id: data.companyId,
        email: normalizeEmail(data.email),
        role: data.role,
        token_hash: await hashInvitationToken(token),
        expires_at: invitationExpiry(new Date()).toISOString(),
        invited_by: ctx.userId,
      })
      .select("id, companies(name)")
      .single();
    if (error || !invitation) throw new Error(`invitation insert failed: ${error?.code}`);

    try {
      await getEmailProvider().send(
        await invitationEmail({
          to: normalizeEmail(data.email),
          companyName: invitation.companies?.name ?? "",
          role: data.role,
          link: `${env.NEXT_PUBLIC_APP_URL}/accept-invite?token=${token}`,
        }),
      );
    } catch (err) {
      // No email, no invitation: never leave a live token nobody received.
      await supabase.from("invitations").delete().eq("id", invitation.id);
      throw err;
    }

    await audit({
      action: "user.invited",
      actorType: ctx.isPlatformAdmin ? "admin" : "user",
      actorUserId: ctx.userId,
      companyId: data.companyId,
      entityType: "invitation",
      entityId: invitation.id,
      metadata: { role: data.role },
    });
    refresh();
    return { invitationId: invitation.id };
  });
}

// ---------- acceptance ----------

/** New user: create a verified account with a password, then sign in. */
export async function acceptInvitationAction(_prev: FormState, form: FormData): Promise<FormState> {
  const token = String(form.get("token") ?? "");
  const fullName = String(form.get("fullName") ?? "")
    .trim()
    .slice(0, 120);
  const password = String(form.get("password") ?? "");
  const issues = passwordIssues(password, String(form.get("confirm") ?? ""));
  const values = { fullName };
  if (!(await allowRate("invitation", { ip: await requestIp() }))) return { error: "rate_limited", values };
  if (!fullName) return { error: "name_required", values };
  if (issues.length) return { issues, values };

  const invitation = await loadInvitation(token);
  if (!invitation || invitation.state !== "valid") return { error: "invitation_invalid", values };
  if (!(await claimInvitation(invitation.id))) return { error: "invitation_invalid", values };

  const admin = createServiceClient().auth.admin;
  const { data: created, error } = await admin.createUser({
    email: invitation.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !created.user) {
    await releaseInvitation(invitation.id);
    return { error: error?.code === "email_exists" ? "account_exists" : "generic", values };
  }
  await addMembershipFromInvitation(invitation, created.user.id);

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signInWithPassword({ email: invitation.email, password });
  redirect("/app");
}

/** Existing user who is signed in with the invited address. */
export async function acceptInvitationAsCurrentUserAction(_prev: FormState, form: FormData): Promise<FormState> {
  if (!(await allowRate("invitation", { ip: await requestIp() }))) return { error: "rate_limited" };
  const invitation = await loadInvitation(String(form.get("token") ?? ""));
  const session = await getSessionInfo();
  if (!invitation || invitation.state !== "valid") return { error: "invitation_invalid" };
  if (!session || normalizeEmail(session.email ?? "") !== normalizeEmail(invitation.email)) {
    return { error: "wrong_account" };
  }
  if (!(await claimInvitation(invitation.id))) return { error: "invitation_invalid" };
  await addMembershipFromInvitation(invitation, session.userId);
  redirect(session.isPlatformAdmin ? "/admin" : "/app");
}
