import type { CampaignStatus } from "../../db/types";

/**
 * Campaign status machine (spec §12 "Campaign statuses"). The database
 * enforces the same table (app.campaign_transition_allowed), so no write path
 * can skip it. "completed" comes when the attribution window closes, not when
 * the last SMS is sent.
 */

export type CampaignEvent =
  | "submit"
  | "approve"
  | "reject"
  | "start_sending"
  | "dispatched"
  | "pause"
  | "resume"
  | "fail"
  | "fix"
  | "cancel"
  | "complete";

export const TRANSITIONS: [CampaignStatus, CampaignStatus][] = [
  ["draft", "waiting_for_approval"],
  ["draft", "scheduled"],
  ["waiting_for_approval", "draft"],
  ["waiting_for_approval", "scheduled"],
  ["scheduled", "sending"],
  ["scheduled", "cancelled"],
  ["sending", "active"],
  ["sending", "paused"],
  ["sending", "failed"],
  ["active", "paused"],
  ["active", "completed"],
  ["paused", "active"],
  ["paused", "cancelled"],
  ["failed", "draft"],
];

export function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  return TRANSITIONS.some(([a, b]) => a === from && b === to);
}

export class CampaignTransitionError extends Error {
  constructor(
    public from: CampaignStatus,
    public event: CampaignEvent,
  ) {
    super(`campaign_${event}_not_allowed_from_${from}`);
  }
}

/** Where each event may start and where it leads (every pair is an edge of TRANSITIONS). */
const EVENTS: Record<CampaignEvent, { from: CampaignStatus[]; to: CampaignStatus | null }> = {
  submit: { from: ["draft"], to: null },
  approve: { from: ["waiting_for_approval"], to: "scheduled" },
  reject: { from: ["waiting_for_approval"], to: "draft" },
  start_sending: { from: ["scheduled"], to: "sending" },
  dispatched: { from: ["sending"], to: "active" },
  pause: { from: ["sending", "active"], to: "paused" },
  resume: { from: ["paused"], to: "active" },
  fail: { from: ["sending"], to: "failed" },
  fix: { from: ["failed"], to: "draft" },
  cancel: { from: ["scheduled", "paused"], to: "cancelled" },
  complete: { from: ["active"], to: "completed" },
};

/** Status after an event; throws when the event does not apply to the current status. */
export function nextStatus(
  from: CampaignStatus,
  event: CampaignEvent,
  ctx: { requiresClientApproval?: boolean } = {},
): CampaignStatus {
  const rule = EVENTS[event];
  // Client-approval shops review first; otherwise the operator's submit schedules it.
  const to = rule.to ?? (ctx.requiresClientApproval ? "waiting_for_approval" : "scheduled");
  if (!rule.from.includes(from) || !canTransition(from, to)) throw new CampaignTransitionError(from, event);
  return to;
}

/** Who may approve or return a waiting campaign (spec §20 campaigns.approve, F4). */
export function canDecideApproval(actor: {
  isPlatformAdmin: boolean;
  role: "shop_owner" | "shop_manager" | null;
  requiresClientApproval: boolean;
}): boolean {
  // In client-approval shops the decision is the owner's; the operator cannot approve on their behalf.
  return actor.requiresClientApproval && !actor.isPlatformAdmin && actor.role === "shop_owner";
}

/** Statuses grouped like the "Kampaně" tabs (spec §8): Aktivní, Připravené, Dokončené. */
export function statusGroup(status: CampaignStatus): "active" | "prepared" | "finished" {
  if (["sending", "active", "paused"].includes(status)) return "active";
  if (["draft", "waiting_for_approval", "scheduled", "failed"].includes(status)) return "prepared";
  return "finished";
}
