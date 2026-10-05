/**
 * Versioned generation prompt (spec §15). Phase 0 never calls a model; the
 * mock provider returns library templates but records this version so the
 * ai_generations log looks the same once a real provider is wired in.
 * The AI never receives customer names, phones, emails, plates or notes.
 */
export const CAMPAIGN_TEMPLATE_PROMPT_VERSION = "campaign-template.v1";

export const CAMPAIGN_TEMPLATE_SYSTEM = `You write short SMS messages in natural, polite Czech for an
independent car repair shop.
Rules:
- Use only the placeholders provided. Never invent facts about the customer or vehicle.
- Never claim the vehicle needs a repair, is unsafe, or is overdue for a specific part.
- Mention a price or discount only if OFFER is provided; use it verbatim.
- No exclamation marks in more than one sentence. No emoji. No English words.
- Max {max_chars} characters after rendering with typical values.
- Must contain {{servis}} and {{odhlaseni}}. Start with {{osloveni}}.
- Tone: {tone}. Channel: SMS.
Return JSON: {"variants": ["...", "...", "..."]}`;

export interface CampaignTemplatePromptInput {
  companyName: string;
  city: string | null;
  goal: string;
  category: string;
  monthsRange: string;
  offer: string | null;
}

export function campaignTemplateUserPrompt(i: CampaignTemplatePromptInput): string {
  return `Shop: ${i.companyName}, ${i.city ?? ""}. Campaign goal: ${i.goal}.
Service category: ${i.category}. Typical time since last visit: ${i.monthsRange}.
Offer: ${i.offer ?? "none"}. Call to action: call {{telefon}}.`;
}
