/**
 * Conversion pipeline rules for the UI (spec §14). The database function
 * public.record_conversion enforces the same rules on every write; these
 * functions decide which buttons to show and prepare valid input.
 */

export type EnrollmentStage = "contacted" | "replied" | "booked" | "completed" | "lost" | "opted_out";
export type ConversionAction = "book" | "complete" | "edit" | "revert";

export interface EnrollmentView {
  id: string;
  stage: EnrollmentStage;
  isHoldout: boolean;
  firstSentAt: string | null;
  campaignStartedAt: string | null;
  windowEndsAt: string | null;
}

/** Window start: the first SMS; for the holdout, the campaign start. */
export function attributionWindow(e: EnrollmentView): { start: Date | null; end: Date | null } {
  const start = e.isHoldout ? e.campaignStartedAt : e.firstSentAt;
  return { start: start ? new Date(start) : null, end: e.windowEndsAt ? new Date(e.windowEndsAt) : null };
}

export function windowOpen(e: EnrollmentView, at: Date): boolean {
  const { start, end } = attributionWindow(e);
  return start !== null && start.getTime() <= at.getTime() && (end === null || at.getTime() <= end.getTime());
}

/** Buttons for one enrollment now. Closed windows allow only corrections of an existing result. */
export function allowedActions(e: EnrollmentView, now: Date): ConversionAction[] {
  const open = windowOpen(e, now);
  switch (e.stage) {
    case "contacted":
      return open ? ["book", "complete"] : [];
    case "booked":
      return open ? ["complete", "revert"] : ["revert"];
    case "completed":
      return ["edit", "revert"];
    default:
      return [];
  }
}

/**
 * Last touch (spec §14): of the customer's enrollments whose window covers
 * `at`, the one with the most recent first SMS wins. Holdout rows only when
 * no contacted one applies.
 */
export function pickEnrollment<T extends EnrollmentView>(enrollments: T[], at: Date): T | null {
  const open = enrollments.filter((e) => windowOpen(e, at));
  const treated = open
    .filter((e) => !e.isHoldout)
    .sort((a, b) => new Date(b.firstSentAt!).getTime() - new Date(a.firstSentAt!).getTime());
  return treated[0] ?? open.find((e) => e.isHoldout) ?? null;
}

export const MAX_JOB_VALUE_CZK = 500_000;
export const HIGH_JOB_VALUE_CZK = 200_000;

/** "4 800", "4800,50", "4 800 Kč" → haléře; null when not a plausible job value. */
export function parseJobValue(input: string): number | null {
  const cleaned = input.replace(/kč/i, "").replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const czk = Number(cleaned);
  if (!Number.isFinite(czk) || czk < 1 || czk > MAX_JOB_VALUE_CZK) return null;
  return Math.round(czk * 100);
}

const DB_ERRORS = [
  "conversion_not_found",
  "conversion_not_contacted",
  "conversion_outside_window",
  "conversion_newer_campaign",
  "conversion_wrong_stage",
  "conversion_revenue_required",
] as const;
export type ConversionErrorCode = (typeof DB_ERRORS)[number];

/** Maps a record_conversion error message to a user-facing error code. */
export function conversionErrorCode(message: string | undefined): ConversionErrorCode | null {
  return DB_ERRORS.find((code) => message?.includes(code)) ?? null;
}
