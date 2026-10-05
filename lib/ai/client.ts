import type { PresetKey } from "../domain/segments/presets";
import { CAMPAIGN_TEMPLATE_PROMPT_VERSION } from "./prompts/campaign-template.v1";
import { TEMPLATE_LIBRARY, type TemplateTone } from "./templates-library";
import { validateTemplate } from "./validate";

/**
 * Thin AI provider wrapper. Phase 0 ships only the mock provider, which
 * returns library templates after a short, realistic delay. Phase 1 adds a
 * real provider (Vercel AI SDK, chosen by AI_PROVIDER) behind the same
 * functions; callers do not change.
 */

export type RewriteAction = "shorter" | "friendlier" | "professional" | "regenerate";

export interface GenerationResult {
  variants: string[];
  promptVersion: string;
  model: string;
}

const MODEL = "mock-czech-sms";
const VARIANT_TONES: TemplateTone[] = ["standard", "friendly", "formal"];
const ROTATION: TemplateTone[] = ["standard", "friendly", "formal", "short"];

const ACTION_TONE: Record<Exclude<RewriteAction, "regenerate">, TemplateTone> = {
  shorter: "short",
  friendlier: "friendly",
  professional: "formal",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function assertValid(template: string, now: Date) {
  const issues = validateTemplate(template, { now });
  if (issues.length) throw new Error(`Template failed validation: ${issues.map((i) => i.code).join(", ")}`);
  return template;
}

export async function generateCampaignTemplates(input: { presetKey: PresetKey; now: Date }): Promise<GenerationResult> {
  await sleep(700);
  const library = TEMPLATE_LIBRARY[input.presetKey];
  return {
    variants: VARIANT_TONES.map((tone) => assertValid(library[tone], input.now)),
    promptVersion: CAMPAIGN_TEMPLATE_PROMPT_VERSION,
    model: MODEL,
  };
}

export async function rewriteCampaignTemplate(input: {
  presetKey: PresetKey;
  current: string;
  action: RewriteAction;
  now: Date;
}): Promise<GenerationResult> {
  await sleep(450);
  const library = TEMPLATE_LIBRARY[input.presetKey];
  let tone: TemplateTone;
  if (input.action === "regenerate") {
    const currentIdx = ROTATION.findIndex((t) => library[t] === input.current);
    tone = ROTATION[(currentIdx + 1) % ROTATION.length];
  } else {
    tone = ACTION_TONE[input.action];
  }
  return {
    variants: [assertValid(library[tone], input.now)],
    promptVersion: CAMPAIGN_TEMPLATE_PROMPT_VERSION,
    model: MODEL,
  };
}
