import "server-only";
import { env } from "../env";
import { aiSdkTextModel, mockTextModel, type TextModel } from "./model";

/**
 * Picks the model from the environment (spec §15, §26): AI_PROVIDER=mock
 * (default) never touches the network; openai / anthropic require AI_MODEL
 * and AI_API_KEY (enforced in lib/env/schema.ts). The demo always uses the
 * mock, whatever is configured.
 */
let cached: TextModel | null = null;

export async function getTextModel(): Promise<TextModel> {
  if (cached) return cached;
  if (env.AI_PROVIDER === "mock" || env.DATA_SOURCE === "demo") {
    cached = mockTextModel({ delayMs: 400 });
  } else if (env.AI_PROVIDER === "openai") {
    const { createOpenAI } = await import("@ai-sdk/openai");
    cached = aiSdkTextModel(createOpenAI({ apiKey: env.AI_API_KEY })(env.AI_MODEL!), `openai:${env.AI_MODEL}`);
  } else {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    cached = aiSdkTextModel(createAnthropic({ apiKey: env.AI_API_KEY })(env.AI_MODEL!), `anthropic:${env.AI_MODEL}`);
  }
  return cached;
}
