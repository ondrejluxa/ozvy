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
  | "company.created"
  | "company.settings_changed"
  | "company.dpa_confirmed"
  | "company.sending_enabled"
  | "company.document_downloaded"
  | "customer.updated"
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
  | "conversion.booked"
  | "conversion.completed"
  | "conversion.updated"
  | "conversion.reverted";

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
