"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireContext, type AuthContext } from "../auth/context";
import { audit, type AuditAction } from "../audit";
import { DomainError } from "../db/mutations";
import { getCampaign } from "../db/supabase/campaigns";
import { createSupabaseServerClient } from "../db/supabase/server-client";
import { createServiceClient } from "../db/supabase/service-client";
import { CampaignTransitionError, nextStatus, type CampaignEvent } from "../domain/campaigns/status";
import { enqueue } from "../jobs/runner";
import { run, type ActionResult } from "./result";

/**
 * Sending controls (spec §12, §16, §20): pause / resume / return a failed
 * campaign, the global kill switch, a manual queue run and the manual review
 * of messages stuck in 'sending'. The shop owner may always pause; the rest
 * is operator only.
 */

const uuid = z.string().uuid();
const ids = z.object({ companyId: uuid, campaignId: uuid });

async function changeStatus(
  ctx: AuthContext,
  companyId: string,
  campaignId: string,
  event: CampaignEvent,
  action: AuditAction,
) {
  const loaded = await getCampaign(companyId, campaignId);
  if (!loaded) throw new DomainError("not_found");
  const from = loaded.campaign.status;
  let to;
  try {
    to = nextStatus(from, event);
  } catch (err) {
    if (err instanceof CampaignTransitionError) throw new DomainError("campaign_wrong_state");
    throw err;
  }
  // Service role after the permission check: owners have no general update right
  // on campaigns, and the status filter makes a concurrent tick lose cleanly.
  const { data, error } = await createServiceClient()
    .from("campaigns")
    .update({ status: to, ...(event === "pause" ? {} : { status_reason: null }) })
    .eq("company_id", companyId)
    .eq("id", campaignId)
    .eq("status", from)
    .select("id");
  if (error) throw new Error(`campaign ${event} failed: ${error.code}`);
  if (!data?.length) throw new DomainError("campaign_wrong_state");
  await audit({
    action,
    actorType: ctx.isPlatformAdmin ? "admin" : "user",
    actorUserId: ctx.userId,
    companyId,
    entityType: "campaign",
    entityId: campaignId,
    metadata: { from, to },
  });
}

export async function pauseCampaignAction(input: {
  companyId: string;
  campaignId: string;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const data = ids.parse(input);
    const ctx = await requireContext({ permission: "campaigns.pause", companyId: data.companyId });
    await changeStatus(ctx, data.companyId, data.campaignId, "pause", "campaign.paused");
    refresh();
    return null;
  });
}

export async function resumeCampaignAction(input: {
  companyId: string;
  campaignId: string;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const data = ids.parse(input);
    const ctx = await requireContext({ permission: "admin.access", companyId: data.companyId });
    await changeStatus(ctx, data.companyId, data.campaignId, "resume", "campaign.resumed");
    refresh();
    return null;
  });
}

/** failed → draft: the operator fixes the cause and submits again (spec §12). */
export async function returnFailedToDraftAction(input: {
  companyId: string;
  campaignId: string;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const data = ids.parse(input);
    const ctx = await requireContext({ permission: "admin.access", companyId: data.companyId });
    await changeStatus(ctx, data.companyId, data.campaignId, "fix", "campaign.returned_to_draft");
    refresh();
    return null;
  });
}

// ---------- system ----------

export async function setKillSwitchAction(input: { paused: boolean; reason?: string }): Promise<ActionResult<null>> {
  return run(async () => {
    const data = z.object({ paused: z.boolean(), reason: z.string().trim().max(200).optional() }).parse(input);
    if (data.paused && !data.reason) throw new DomainError("validation");
    const ctx = await requireContext({ permission: "admin.access" });
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("platform_settings")
      .update({
        sending_paused: data.paused,
        sending_paused_reason: data.paused ? data.reason! : null,
        sending_paused_at: data.paused ? new Date().toISOString() : null,
        sending_paused_by: data.paused ? ctx.userId : null,
      })
      .eq("id", true);
    if (error) throw new Error(`kill switch failed: ${error.code}`);
    await audit({
      action: "system.kill_switch_changed",
      actorType: "admin",
      actorUserId: ctx.userId,
      entityType: "platform",
      metadata: { paused: data.paused },
    });
    refresh();
    return null;
  });
}

/**
 * Ends the circuit breaker's pause early (spec §24): the next tick sends one
 * probe message; success resumes sending, failure pauses again.
 */
export async function resetBreakerAction(): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireContext({ permission: "admin.access" });
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("platform_settings")
      .update({ provider_paused_until: new Date().toISOString() })
      .eq("id", true)
      .not("provider_paused_until", "is", null);
    if (error) throw new Error(`breaker reset failed: ${error.code}`);
    await audit({
      action: "system.provider_breaker_reset",
      actorType: "admin",
      actorUserId: ctx.userId,
      entityType: "platform",
    });
    refresh();
    return null;
  });
}

/** Runs one messaging tick now (locally the tick has no cron; Inngest also accepts the event). */
export async function runQueueNowAction(): Promise<ActionResult<null>> {
  return run(async () => {
    await requireContext({ permission: "admin.access" });
    await enqueue({ name: "messaging/tick.requested", data: {} });
    return null;
  });
}

/**
 * A message stuck in 'sending' may or may not have reached the phone. The
 * operator checks the provider's log and records the outcome; it is never
 * sent again automatically (spec §16).
 */
export async function resolveStuckMessageAction(input: {
  messageId: string;
  outcome: "sent" | "failed";
}): Promise<ActionResult<null>> {
  return run(async () => {
    const data = z.object({ messageId: uuid, outcome: z.enum(["sent", "failed"]) }).parse(input);
    const ctx = await requireContext({ permission: "admin.access" });
    const supabase = await createSupabaseServerClient();
    const now = new Date().toISOString();
    const { data: updated, error } = await supabase
      .from("messages")
      .update(
        data.outcome === "sent"
          ? { status: "sent", sent_at: now, error_code: "manual_review_sent" }
          : { status: "failed", failed_at: now, error_code: "manual_review_failed" },
      )
      .eq("id", data.messageId)
      .eq("status", "needs_review")
      .select("company_id");
    if (error) throw new Error(`message review failed: ${error.code}`);
    if (!updated?.length) throw new DomainError("not_found");
    await audit({
      action: "message.review_resolved",
      actorType: "admin",
      actorUserId: ctx.userId,
      companyId: updated[0].company_id,
      entityType: "message",
      entityId: data.messageId,
      metadata: { outcome: data.outcome },
    });
    refresh();
    return null;
  });
}
