import { validateTemplate, type TemplateIssue } from "../../ai/validate";
import { isWithinSendingWindow } from "../messaging/sending-window";

/**
 * Campaign content rules (spec §12): an initial message plus at most two
 * follow-ups, at least two days apart; every step carries the opt-out
 * placeholder and passes template validation; the send time lies in the
 * sending window and in the future.
 */

export interface StepInput {
  delayDays: number;
  template: string;
  stripDiacritics: boolean;
}

export type CampaignContentIssue =
  | { code: "too_many_followups" }
  | { code: "followup_too_soon"; step: number }
  | { code: "template_invalid"; step: number; issues: TemplateIssue["code"][] }
  | { code: "send_time_past" }
  | { code: "send_time_outside_window" };

const BLOCKING: TemplateIssue["code"][] = ["unknown_placeholder", "missing_required"];
export const MIN_FOLLOWUP_GAP_DAYS = 2;
export const MAX_FOLLOWUPS = 2;

export function campaignContentIssues(input: {
  steps: StepInput[];
  scheduledAt: Date | null;
  now: Date;
}): CampaignContentIssue[] {
  const issues: CampaignContentIssue[] = [];
  if (input.steps.length === 0 || input.steps.length > MAX_FOLLOWUPS + 1) issues.push({ code: "too_many_followups" });
  input.steps.forEach((step, i) => {
    const previous = i === 0 ? 0 : input.steps[i - 1].delayDays;
    if (i > 0 && step.delayDays - previous < MIN_FOLLOWUP_GAP_DAYS) issues.push({ code: "followup_too_soon", step: i });
    const blocking = validateTemplate(step.template, { now: input.now })
      .map((t) => t.code)
      .filter((c) => BLOCKING.includes(c));
    if (blocking.length) issues.push({ code: "template_invalid", step: i, issues: blocking });
  });
  if (input.scheduledAt) {
    if (input.scheduledAt.getTime() <= input.now.getTime()) issues.push({ code: "send_time_past" });
    else if (!isWithinSendingWindow(input.scheduledAt)) issues.push({ code: "send_time_outside_window" });
  }
  return issues;
}

/** Default follow-up texts (operator edits them); each keeps the shop and opt-out placeholders. */
export const DEFAULT_FOLLOWUPS = [
  "{{osloveni}} jen připomínáme nabídku servisu {{servis}}. Termín domluvíte na {{telefon}}. {{odhlaseni}}",
  "{{osloveni}} naposledy připomínáme volné termíny v {{servis}}, tel. {{telefon}}. {{odhlaseni}}",
];
