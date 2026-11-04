import { createHash, randomInt } from "node:crypto";
import { isWithinSendingWindow } from "./sending-window";

/**
 * Dispatch rules (spec §12 pre-send checks, §16 dispatch flow and message
 * lifecycle). Pure functions; the job in lib/jobs/messaging-core.ts applies
 * them to the database.
 */

/** sha256(enrollment_id + step_id): the unique key that makes re-renders idempotent. */
export function messageIdempotencyKey(enrollmentId: string, stepId: string): string {
  return createHash("sha256").update(`${enrollmentId}:${stepId}`).digest("hex");
}

const TOKEN_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Random 8-character opt-out token (spec §16), unique per message. */
export function randomOptOutToken(): string {
  return Array.from({ length: 8 }, () => TOKEN_ALPHABET[randomInt(TOKEN_ALPHABET.length)]).join("");
}

// ---------- retries ----------

/** Backoff after a retryable provider error: 1, 5, 15, 60 minutes; failed after 5 attempts. */
export const RETRY_DELAYS_MINUTES = [1, 5, 15, 60] as const;
export const MAX_ATTEMPTS = 5;

export type FailureOutcome = { status: "queued"; nextAttemptAt: Date } | { status: "failed" };

export function afterSendFailure(attempts: number, retryable: boolean, now: Date): FailureOutcome {
  if (!retryable || attempts >= MAX_ATTEMPTS) return { status: "failed" };
  const minutes = RETRY_DELAYS_MINUTES[Math.min(attempts, RETRY_DELAYS_MINUTES.length) - 1] ?? 1;
  return { status: "queued", nextAttemptAt: new Date(now.getTime() + minutes * 60_000) };
}

// ---------- pre-send checks (spec §12) ----------

export const MAX_RECIPIENT_DRIFT = 0.2;
export const CREDIT_MARGIN = 1.2;

export interface PreSendInput {
  now: Date;
  globalPaused: boolean;
}

export type PreSendGate = { action: "wait"; reason: "global_kill_switch" | "outside_window" } | { action: "go" };

/** Checks that only delay the start: the campaign stays scheduled and tries again. */
export function preSendGate(input: PreSendInput): PreSendGate {
  if (input.globalPaused) return { action: "wait", reason: "global_kill_switch" };
  if (!isWithinSendingWindow(input.now)) return { action: "wait", reason: "outside_window" };
  return { action: "go" };
}

export interface SnapshotCheckInput {
  company: { status: string; sendingEnabled: boolean };
  recipients: number;
  approvedRecipients: number | null;
  renderProblems: number;
  estimatedSegments: number;
  /** Provider credit in segments, when the provider reports a balance. */
  creditSegments: number | null;
}

export type SnapshotCheck = { action: "fail"; reason: string } | { action: "send"; pauseReason: string | null };

/**
 * Checks on the send-time snapshot. A failed campaign goes back to the
 * operator (failed → draft); a recipient drift above 20 % still creates the
 * snapshot but pauses the campaign for review.
 */
export function checkSnapshot(input: SnapshotCheckInput): SnapshotCheck {
  if (input.company.status === "paused") return { action: "fail", reason: "company_paused" };
  if (["offboarding", "closed"].includes(input.company.status)) return { action: "fail", reason: "company_closed" };
  if (!input.company.sendingEnabled) return { action: "fail", reason: "company_sending_disabled" };
  if (input.recipients === 0) return { action: "fail", reason: "no_recipients" };
  if (input.renderProblems > 0) return { action: "fail", reason: "render_failed" };
  if (input.creditSegments !== null && input.creditSegments < input.estimatedSegments * CREDIT_MARGIN) {
    return { action: "fail", reason: "provider_credit" };
  }
  const drift = recipientDrift(input.recipients, input.approvedRecipients);
  return { action: "send", pauseReason: drift > MAX_RECIPIENT_DRIFT ? "recipient_drift" : null };
}

/** Relative difference between send-time and approved recipient counts (0 when unknown). */
export function recipientDrift(recipients: number, approved: number | null): number {
  if (!approved) return 0;
  return Math.abs(recipients - approved) / approved;
}

// ---------- whitelist outside production (spec §42 rule 5) ----------

export function addressAllowed(to: string, opts: { realProvider: boolean; production: boolean; whitelist: string[] }) {
  if (!opts.realProvider || opts.production) return true;
  return opts.whitelist.includes(to);
}

// ---------- campaign progress ----------

export interface CampaignProgress {
  status: "sending" | "active";
  /** Step-0 messages still queued or sending. */
  initialPending: number;
  /** Any message still queued or sending. */
  pending: number;
  /** Latest first send of any enrollment, and the largest follow-up delay. */
  lastFirstSentAt: Date | null;
  maxDelayDays: number;
  /** Latest attribution window end. */
  windowEndsAt: Date | null;
  now: Date;
}

/**
 * sending → active once the initial step is dispatched; active → completed
 * when no message is pending, every follow-up was due and the attribution
 * window closed, so results are final (spec §12).
 */
export function nextCampaignStatus(p: CampaignProgress): "active" | "completed" | null {
  if (p.status === "sending") return p.initialPending === 0 ? "active" : null;
  if (p.pending > 0 || !p.lastFirstSentAt) return null;
  const followupsDone = p.lastFirstSentAt.getTime() + p.maxDelayDays * 86_400_000 <= p.now.getTime();
  const windowClosed = !p.windowEndsAt || p.windowEndsAt.getTime() <= p.now.getTime();
  return followupsDone && windowClosed ? "completed" : null;
}

export function attributionWindowEnd(firstSentAt: Date, days: number): Date {
  return new Date(firstSentAt.getTime() + days * 86_400_000);
}
