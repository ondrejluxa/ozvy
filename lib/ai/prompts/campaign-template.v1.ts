import type { PresetKey } from "../../domain/segments/presets";

/**
 * Versioned generation prompt (spec §15). Any wording change gets a new file
 * and version so ai_generations rows stay comparable. The AI never receives
 * customer names, phones, e-mails, plates or notes: only company-level
 * context and the campaign goal.
 */
export const CAMPAIGN_TEMPLATE_PROMPT_VERSION = "campaign-template.v1";

/** Target: 2 segments with diacritics; the validator's hard limit is 320. */
export const MAX_CHARS = 300;

export type RewriteAction = "shorter" | "friendlier" | "professional" | "regenerate";

const DEFAULT_TONE = "polite, warm and matter-of-fact";

const ACTION_TONE: Record<RewriteAction, string> = {
  shorter: DEFAULT_TONE,
  friendlier: "friendly and personal, still polite",
  professional: "formal and professional",
  regenerate: DEFAULT_TONE,
};

const ACTION_INSTRUCTION: Record<RewriteAction, string> = {
  shorter: "Make it noticeably shorter, ideally one SMS segment of text plus the placeholders.",
  friendlier: "Make it friendlier and more personal.",
  professional: "Make it more formal and professional.",
  regenerate: "Write a different version with the same purpose.",
};

export function campaignTemplateSystem(tone: string = DEFAULT_TONE, variants = 3): string {
  const example = Array.from({ length: variants }, () => '"..."').join(", ");
  return `You write short SMS messages in natural, polite Czech for an independent car repair shop.
Rules:
- Use only these placeholders: {{osloveni}}, {{vozidlo}}, {{posledni_navsteva}}, {{servis}}, {{telefon}}, {{odhlaseni}}.
  {{vozidlo}} renders in the accusative ("vaši Škodu Octavia"). {{posledni_navsteva}} renders like "loni v září".
- Never invent facts about the customer or vehicle.
- Never claim the vehicle needs a repair, is unsafe, or is overdue for a specific part.
- Mention a price or discount only if OFFER is provided; use it verbatim.
- No exclamation marks in more than one sentence. No emoji. No English words. No links.
- Max ${MAX_CHARS} characters after rendering with typical values.
- Must contain {{servis}} and {{odhlaseni}}. Start with {{osloveni}} (it renders as "Dobrý den," including the comma).
- Tone: ${tone}. Channel: SMS.
Return only JSON: {"variants": [${example}]}`;
}

/** English goal descriptions per preset: company-level context only. */
export const PRESET_CONTEXT: Record<PresetKey, { goal: string; category: string; monthsRange: string }> = {
  no_visit_6m: {
    goal: "invite customers back after a longer pause",
    category: "any service",
    monthsRange: "6–12 months",
  },
  no_visit_12m: {
    goal: "win back customers who have not visited for over a year",
    category: "any service",
    monthsRange: "12–18 months",
  },
  no_visit_18m: {
    goal: "win back long-lost customers",
    category: "any service",
    monthsRange: "18–48 months",
  },
  regular_service_10_14: {
    goal: "remind customers that the yearly service interval is approaching",
    category: "regular service / oil change",
    monthsRange: "10–14 months",
  },
  tyre_last_season: {
    goal: "offer the seasonal tyre change to last season's customers",
    category: "tyre change",
    monthsRange: "about 6–12 months",
  },
  ac_18_24: { goal: "offer an air-conditioning check", category: "air conditioning", monthsRange: "18–24 months" },
  valuable_lost: {
    goal: "win back valuable customers who have not returned",
    category: "any service",
    monthsRange: "9+ months",
  },
  regulars_stopped: {
    goal: "invite back former regular customers who stopped coming",
    category: "any service",
    monthsRange: "12+ months",
  },
  stk_approaching: {
    goal: "remind customers that the vehicle inspection (STK) is due soon and offer the pre-inspection check",
    category: "STK inspection",
    monthsRange: "about 22–24 months",
  },
};

export interface CampaignPromptInput {
  presetKey: PresetKey;
  companyName: string;
  city: string | null;
  offer: string | null;
}

export function campaignTemplateUserPrompt(i: CampaignPromptInput): string {
  const ctx = PRESET_CONTEXT[i.presetKey];
  return `Shop: ${i.companyName}${i.city ? `, ${i.city}` : ""}. Campaign goal: ${ctx.goal}.
Service category: ${ctx.category}. Typical time since last visit: ${ctx.monthsRange}.
Offer: ${i.offer ?? "none"}. Call to action: call {{telefon}}.`;
}

export function rewriteSystem(action: RewriteAction): string {
  return campaignTemplateSystem(ACTION_TONE[action], 1);
}

export function rewriteUserPrompt(i: CampaignPromptInput, current: string, action: RewriteAction): string {
  return `${campaignTemplateUserPrompt(i)}
Current template: ${current}
Task: ${ACTION_INSTRUCTION[action]} Keep the placeholders that carry meaning.`;
}

/**
 * Removes anything personal an operator may have typed into a template
 * before it is sent to the model: e-mails and phone-like digit runs.
 */
export function maskFreeText(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[e-mail]")
    .replace(/\+?\d[\d ]{5,}\d/g, "[číslo]")
    .slice(0, 640);
}

/** Feedback for the single retry (spec §15: regenerate once, then show an error). */
export function retryFeedback(problems: string[]): string {
  return `\nYour previous answer was rejected: ${problems.join("; ")}. Follow every rule and return only the JSON.`;
}
