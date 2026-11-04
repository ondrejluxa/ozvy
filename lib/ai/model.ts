import { generateText, type LanguageModel } from "ai";
import type { PresetKey } from "../domain/segments/presets";
import type { RewriteAction } from "./prompts/campaign-template.v1";
import { TEMPLATE_LIBRARY, type TemplateTone } from "./templates-library";

/**
 * Thin provider wrapper (spec §15). Everything above this file talks to a
 * `TextModel`: the mock (default outside production, no network) or any
 * Vercel AI SDK language model. Prompts and validation stay the same for both.
 */

/** What the call is for. Only the mock reads it; real models get the prompts. */
export type ModelTask =
  | { kind: "campaign_template"; presetKey: PresetKey }
  | { kind: "campaign_rewrite"; presetKey: PresetKey; current: string; action: RewriteAction }
  | { kind: "vocatives"; surnames: string[] };

export interface ModelRequest {
  system: string;
  prompt: string;
  task: ModelTask;
}

export interface ModelResponse {
  text: string;
  tokensIn: number | null;
  tokensOut: number | null;
}

export interface TextModel {
  /** Logged as ai_generations.model, e.g. "openai:gpt-5-mini" or "mock-czech-sms". */
  id: string;
  complete(req: ModelRequest): Promise<ModelResponse>;
}

// ---------- mock ----------

const ROTATION: TemplateTone[] = ["standard", "friendly", "formal", "short"];
const ACTION_TONE: Record<Exclude<RewriteAction, "regenerate">, TemplateTone> = {
  shorter: "short",
  friendlier: "friendly",
  professional: "formal",
};

const estimateTokens = (s: string) => Math.ceil(s.length / 4);

function mockAnswer(task: ModelTask): unknown {
  if (task.kind === "campaign_template") {
    const lib = TEMPLATE_LIBRARY[task.presetKey];
    return { variants: [lib.standard, lib.friendly, lib.formal] };
  }
  if (task.kind === "campaign_rewrite") {
    const lib = TEMPLATE_LIBRARY[task.presetKey];
    let tone: TemplateTone;
    if (task.action === "regenerate") {
      const idx = ROTATION.findIndex((t) => lib[t] === task.current);
      tone = ROTATION[(idx + 1) % ROTATION.length];
    } else {
      tone = ACTION_TONE[task.action];
    }
    return { variants: [lib[tone]] };
  }
  // Uncertain, review-only suggestions: the stem plus a common ending.
  return {
    items: task.surnames.map((surname) => ({
      surname,
      vocative: /[sz]$/i.test(surname) ? `${surname}i` : surname,
      gender: /[aeiouyáéíóúůý]$/i.test(surname) ? "unknown" : "m",
      confidence: 0.6,
    })),
  };
}

export function mockTextModel(opts: { delayMs?: number } = {}): TextModel {
  const delay = opts.delayMs ?? 0;
  return {
    id: "mock-czech-sms",
    async complete(req) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const text = JSON.stringify(mockAnswer(req.task));
      return { text, tokensIn: estimateTokens(req.system + req.prompt), tokensOut: estimateTokens(text) };
    },
  };
}

// ---------- Vercel AI SDK ----------

export function aiSdkTextModel(model: LanguageModel, id: string): TextModel {
  return {
    id,
    async complete(req) {
      const result = await generateText({
        model,
        instructions: req.system,
        prompt: req.prompt,
        temperature: req.task.kind === "vocatives" ? 0 : 0.7,
        maxOutputTokens: req.task.kind === "vocatives" ? 4000 : 1000,
        maxRetries: 1,
        timeout: 30_000,
      });
      return {
        text: result.text,
        tokensIn: result.usage.inputTokens ?? null,
        tokensOut: result.usage.outputTokens ?? null,
      };
    },
  };
}
