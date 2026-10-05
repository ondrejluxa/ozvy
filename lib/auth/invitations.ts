import "server-only";
import { audit } from "../audit";
import { createServiceClient } from "../db/supabase/service-client";
import { hashInvitationToken, invitationState, isWellFormedToken } from "../domain/invitations";

/**
 * Token-scoped invitation access. The visitor has no session yet, so these
 * use the service role, always keyed by the token hash or invitation id.
 * Not a "use server" module: none of this is callable from the browser.
 */

export interface InvitationView {
  id: string;
  email: string;
  role: "shop_owner" | "shop_manager";
  companyId: string;
  companyName: string;
  state: "valid" | "expired" | "accepted";
}

export async function loadInvitation(token: string | null | undefined): Promise<InvitationView | null> {
  if (!isWellFormedToken(token)) return null;
  const { data } = await createServiceClient()
    .from("invitations")
    .select("id, email, role, company_id, expires_at, accepted_at, companies(name)")
    .eq("token_hash", await hashInvitationToken(token))
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    email: data.email,
    role: data.role,
    companyId: data.company_id,
    companyName: data.companies?.name ?? "",
    state: invitationState(data, new Date()),
  };
}

/** Atomically marks the invitation used; false if already used or expired (single use). */
export async function claimInvitation(id: string): Promise<boolean> {
  const now = new Date().toISOString();
  const { data } = await createServiceClient()
    .from("invitations")
    .update({ accepted_at: now })
    .eq("id", id)
    .is("accepted_at", null)
    .gt("expires_at", now)
    .select("id");
  return (data?.length ?? 0) === 1;
}

/** Undo a claim when account creation failed, so the link can be retried. */
export async function releaseInvitation(id: string): Promise<void> {
  await createServiceClient().from("invitations").update({ accepted_at: null }).eq("id", id);
}

export async function addMembershipFromInvitation(invitation: InvitationView, userId: string): Promise<void> {
  const { error } = await createServiceClient()
    .from("memberships")
    .upsert(
      { user_id: userId, company_id: invitation.companyId, role: invitation.role },
      { onConflict: "user_id,company_id" },
    );
  if (error) throw new Error(`membership insert failed: ${error.code}`);
  await audit({
    action: "user.invitation_accepted",
    actorType: "user",
    actorUserId: userId,
    companyId: invitation.companyId,
    entityType: "invitation",
    entityId: invitation.id,
    metadata: { role: invitation.role },
  });
}
