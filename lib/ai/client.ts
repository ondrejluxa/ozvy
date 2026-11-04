import { z } from "zod";
import { plausibleVocative, normalizeSurname, type Gender, type VocativeGuess } from "../domain/messaging/vocative";
import type { PresetKey } from "../domain/segments/presets";
import { mockTextModel, type ModelRequest, type TextModel } from "./model";
import {
  CAMPAIGN_TEMPLATE_PROMPT_VERSION,
  campaignTemplateSystem,
  campaignTemplateUserPrompt,
  maskFreeText,
  retryFeedback,
  rewriteSystem,
  rewriteUserPrompt,
  type CampaignPromptInput,
  type RewriteAction,
} from "./prompts/campaign-template.v1";
import { VOCATIVES_PROMPT_VERSION, VOCATIVES_SYSTEM, vocativesUserPrompt } from "./prompts/vocatives.v1";
import { validateTemplate } from "./validate";

/**
 * Template and vocative generation on top of a `TextModel` (spec §15).
 * Output is validated before anyone sees it: valid JSON, 1–3 variants, and
 * every variant passes `validateTemplate`. A failed answer is regenerated
 * once with the reasons, then the call fails with `AiOutputError`.
 * Results carry everything ai_generations logs.
 */

export type { RewriteAction } from "./prompts/campaign-template.v1";

export interface GenerationResult {
  variants: string[];
  promptVersion: string;
  model: string;
  /** Logged prompt input (company-level context only). */
  input: Record<string, unknown>;
  tokensIn: number | null;
  tokensOut: number | null;
  attempts: number;
  /** Reasons for rejected attempts, for the log. */
  rejected: string[];
}

export class AiOutputError extends Error {
  constructor(
    readonly partial: Omit<GenerationResult, "variants">,
    readonly reasons: string[],
  ) {
    super(`AI output failed validation: ${reasons.join("; ")}`);
    this.name = "AiOutputError";
  }
}

export interface ShopContext {
  companyName: string;
  city: string | null;
}

/** Demo context: the mock ignores it, real models get it in the user prompt. */
const DEMO_SHOP: ShopContext = { companyName: "Autoservis", city: null };

const variantsSchema = z.object({ variants: z.array(z.string().trim().min(1).max(640)).min(1).max(3) });

/** Pulls the JSON object out of a model answer (tolerates code fences and prose). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function checkVariants(text: string, expected: number, offer: string | null, now: Date) {
  const parsed = variantsSchema.safeParse(extractJson(text));
  if (!parsed.success) return { ok: false as const, reasons: ["invalid JSON or variant count"] };
  const variants = parsed.data.variants.slice(0, expected);
  const reasons = variants.flatMap((v, i) =>
    validateTemplate(v, { offer, now }).map((issue) => `variant ${i + 1}: ${issue.code}`),
  );
  return reasons.length ? { ok: false as const, reasons } : { ok: true as const, variants };
}

async function runValidated(
  model: TextModel,
  req: ModelRequest,
  opts: { expected: number; offer: string | null; now: Date; input: Record<string, unknown> },
): Promise<GenerationResult> {
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  const rejected: string[] = [];
  const add = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt = attempt === 1 ? req.prompt : req.prompt + retryFeedback(rejected);
    const res = await model.complete({ ...req, prompt });
    tokensIn = add(tokensIn, res.tokensIn);
    tokensOut = add(tokensOut, res.tokensOut);
    const checked = checkVariants(res.text, opts.expected, opts.offer, opts.now);
    const base = {
      promptVersion: CAMPAIGN_TEMPLATE_PROMPT_VERSION,
      model: model.id,
      input: opts.input,
      tokensIn,
      tokensOut,
      attempts: attempt,
    };
    if (checked.ok) return { ...base, variants: checked.variants, rejected };
    rejected.push(...checked.reasons);
    if (attempt === 2) throw new AiOutputError({ ...base, rejected }, rejected);
  }
  throw new Error("unreachable");
}

export async function generateCampaignTemplates(input: {
  presetKey: PresetKey;
  now: Date;
  shop?: ShopContext;
  offer?: string | null;
  model?: TextModel;
}): Promise<GenerationResult> {
  const prompt: CampaignPromptInput = {
    presetKey: input.presetKey,
    ...(input.shop ?? DEMO_SHOP),
    offer: input.offer ?? null,
  };
  return runValidated(
    input.model ?? mockTextModel({ delayMs: 700 }),
    {
      system: campaignTemplateSystem(),
      prompt: campaignTemplateUserPrompt(prompt),
      task: { kind: "campaign_template", presetKey: input.presetKey },
    },
    { expected: 3, offer: prompt.offer, now: input.now, input: { ...prompt } },
  );
}

export async function rewriteCampaignTemplate(input: {
  presetKey: PresetKey;
  current: string;
  action: RewriteAction;
  now: Date;
  shop?: ShopContext;
  offer?: string | null;
  model?: TextModel;
}): Promise<GenerationResult> {
  const prompt: CampaignPromptInput = {
    presetKey: input.presetKey,
    ...(input.shop ?? DEMO_SHOP),
    offer: input.offer ?? null,
  };
  const current = maskFreeText(input.current);
  return runValidated(
    input.model ?? mockTextModel({ delayMs: 450 }),
    {
      system: rewriteSystem(input.action),
      prompt: rewriteUserPrompt(prompt, current, input.action),
      task: { kind: "campaign_rewrite", presetKey: input.presetKey, current: input.current, action: input.action },
    },
    { expected: 1, offer: prompt.offer, now: input.now, input: { ...prompt, action: input.action, current } },
  );
}

// ---------- vocatives ----------

/** AI suggestions are never trusted on their own: capped below the review threshold. */
export const AI_VOCATIVE_MAX_CONFIDENCE = 0.85;

const vocativeItems = z.object({
  items: z.array(
    z.object({
      surname: z.string(),
      vocative: z.string(),
      gender: z.enum(["m", "f", "unknown"]).catch("unknown"),
      confidence: z.number().min(0).max(1).catch(0.5),
    }),
  ),
});

export interface VocativeSuggestions {
  suggestions: Map<string, VocativeGuess>;
  promptVersion: string;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  /** Surnames the model answered implausibly or not at all. */
  dropped: string[];
}

/** One batch of surnames → suggestions (surnames only; spec §15). */
export async function suggestVocatives(input: { surnames: string[]; model?: TextModel }): Promise<VocativeSuggestions> {
  const model = input.model ?? mockTextModel();
  const surnames = [...new Set(input.surnames.map(normalizeSurname))];
  const res = await model.complete({
    system: VOCATIVES_SYSTEM,
    prompt: vocativesUserPrompt(surnames),
    task: { kind: "vocatives", surnames },
  });
  const parsed = vocativeItems.safeParse(extractJson(res.text));
  const wanted = new Set(surnames);
  const suggestions = new Map<string, VocativeGuess>();
  for (const item of parsed.success ? parsed.data.items : []) {
    const surname = normalizeSurname(item.surname);
    if (!wanted.has(surname) || !plausibleVocative(surname, item.vocative)) continue;
    suggestions.set(surname, {
      vocative: item.vocative.trim(),
      gender: item.gender as Gender,
      confidence: Math.min(item.confidence, AI_VOCATIVE_MAX_CONFIDENCE),
    });
  }
  return {
    suggestions,
    promptVersion: VOCATIVES_PROMPT_VERSION,
    model: model.id,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    dropped: surnames.filter((s) => !suggestions.has(s)),
  };
}
