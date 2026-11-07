import "server-only";
import { headers } from "next/headers";
import { createServiceClient } from "./db/supabase/service-client";
import { env } from "./env";

/**
 * The one writer of the append-only audit log (spec §23). Metadata holds IDs
 * and changed field names only, never personal data (no emails, no phones).
 * Writes use the service role; failures are logged, never shown to users.
 * DATA_SOURCE=demo keeps no audit log.
 */

export type AuditAction =
  | "auth.login"
  | "auth.login_failed"
  | "auth.mfa_enrolled"
  | "auth.password_reset_requested"
  | "auth.password_changed"
  | "user.invited"
  | "user.invitation_accepted"
  | "user.role_changed"
  | "user.removed"
  | "user.invitation_revoked"
  | "company.created"
  | "company.settings_changed"
  | "company.dpa_confirmed"
  | "company.sending_enabled"
  | "company.document_downloaded"
  | "customer.updated"
  | "customer.deleted"
  | "customer.exported"
  | "customer.retention_kept"
  | "dsr.created"
  | "dsr.completed"
  | "import.uploaded"
  | "import.committed"
  | "import.failed"
  | "campaign.created"
  | "campaign.updated"
  | "campaign.deleted"
  | "campaign.submitted"
  | "campaign.approved"
  | "campaign.rejected"
  | "campaign.scheduled"
  | "campaign.cancelled"
  | "vocatives.refreshed"
  | "vocative.reviewed"
  | "campaign.paused"
  | "campaign.resumed"
  | "campaign.returned_to_draft"
  | "system.kill_switch_changed"
  | "message.review_resolved"
  | "conversion.marked"
  | "conversion.revenue_changed"
  | "conversion.reverted"
  | "admin.support_view_started"
  | "admin.support_view_ended"
  | "admin.company_viewed"
  | "system.provider_breaker_reset";

export interface AuditEntry {
  action: AuditAction;
  actorType: "user" | "admin" | "system";
  actorUserId?: string | null;
  companyId?: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export async function audit(entry: AuditEntry): Promise<void> {
  if (env.DATA_SOURCE !== "supabase") return;
  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
    userAgent = h.get("user-agent")?.slice(0, 300) ?? null;
  } catch {
    // Outside a request (jobs): no IP / user agent.
  }
  const { error } = await createServiceClient()
    .from("audit_logs")
    .insert({
      action: entry.action,
      actor_type: entry.actorType,
      actor_user_id: entry.actorUserId ?? null,
      company_id: entry.companyId ?? null,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
      ip: ip && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null,
      user_agent: userAgent,
    });
  if (error) console.error("[audit] write failed", entry.action, error.code);
}

/**
 * admin.company_viewed once per sign-in and company (spec §20): written the
 * first time the operator opens a shop's pages after their latest sign-in.
 */
export async function auditCompanyViewed(actorUserId: string, companyId: string): Promise<void> {
  if (env.DATA_SOURCE !== "supabase") return;
  const db = createServiceClient();
  const { data: login } = await db
    .from("audit_logs")
    .select("created_at")
    .eq("action", "auth.login")
    .eq("actor_user_id", actorUserId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const since = login?.created_at ?? new Date(Date.now() - 12 * 3_600_000).toISOString();
  const { count, error } = await db
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("action", "admin.company_viewed")
    .eq("actor_user_id", actorUserId)
    .eq("company_id", companyId)
    .gte("created_at", since);
  if (error || (count ?? 0) > 0) return;
  await audit({
    action: "admin.company_viewed",
    actorType: "admin",
    actorUserId,
    companyId,
    entityType: "company",
    entityId: companyId,
  });
}
