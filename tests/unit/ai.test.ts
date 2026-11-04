import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import {
  AI_VOCATIVE_MAX_CONFIDENCE,
  AiOutputError,
  extractJson,
  generateCampaignTemplates,
  rewriteCampaignTemplate,
  suggestVocatives,
} from "@/lib/ai/client";
import { aiSdkTextModel, mockTextModel, type ModelRequest, type TextModel } from "@/lib/ai/model";
import {
  CAMPAIGN_TEMPLATE_PROMPT_VERSION,
  campaignTemplateSystem,
  campaignTemplateUserPrompt,
  maskFreeText,
} from "@/lib/ai/prompts/campaign-template.v1";
import { validateTemplate } from "@/lib/ai/validate";
import { PRESETS } from "@/lib/domain/segments/presets";

const now = new Date("2026-11-04T10:00:00Z");
const shop = { companyName: "Autoservis Dvořák s.r.o.", city: "Kolín" };
const GOOD =
  "{{osloveni}} je to už přes rok, co jsme viděli {{vozidlo}}. Rádi vám najdeme termín. {{servis}}, tel. {{telefon}}. {{odhlaseni}}";

/** A scripted model that records every request. */
function scripted(...answers: string[]): TextModel & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  let i = 0;
  return {
    id: "test-model",
    requests,
    async complete(req) {
      requests.push(req);
      const text = answers[Math.min(i++, answers.length - 1)];
      return { text, tokensIn: 100, tokensOut: 50 };
    },
  };
}

describe("campaign template generation", () => {
  it("the mock returns three valid variants for every preset (with the long greeting)", async () => {
    for (const preset of PRESETS) {
      const res = await generateCampaignTemplates({ presetKey: preset.key, now, model: mockTextModel() });
      expect(res.variants).toHaveLength(3);
      expect(res.attempts).toBe(1);
      expect(res.promptVersion).toBe(CAMPAIGN_TEMPLATE_PROMPT_VERSION);
      for (const v of res.variants) expect(validateTemplate(v, { now })).toEqual([]);
    }
  });

  it("parses fenced JSON and sums tokens", async () => {
    const model = scripted("```json\n" + JSON.stringify({ variants: [GOOD, GOOD] }) + "\n```");
    const res = await generateCampaignTemplates({ presetKey: "no_visit_12m", now, shop, model });
    expect(res).toMatchObject({ variants: [GOOD, GOOD], model: "test-model", tokensIn: 100, tokensOut: 50 });
    expect(res.input).toEqual({ presetKey: "no_visit_12m", ...shop, offer: null });
  });

  it("regenerates once with the reasons, then succeeds", async () => {
    const bad = JSON.stringify({ variants: ["{{osloveni}} Vaše auto nutně potřebuje servis! {{servis}}"] });
    const model = scripted(bad, JSON.stringify({ variants: [GOOD] }));
    const res = await generateCampaignTemplates({ presetKey: "no_visit_12m", now, shop, model });
    expect(res.attempts).toBe(2);
    expect(res.tokensIn).toBe(200);
    expect(res.rejected).toEqual(expect.arrayContaining(["variant 1: missing_required", "variant 1: denylist"]));
    expect(model.requests[1].prompt).toContain("Your previous answer was rejected");
    expect(model.requests[1].prompt).toContain("missing_required");
  });

  it("fails after the second invalid answer", async () => {
    const model = scripted("Sorry, I cannot help.", JSON.stringify({ variants: [] }));
    const err = await generateCampaignTemplates({ presetKey: "no_visit_12m", now, shop, model }).catch((e) => e);
    expect(err).toBeInstanceOf(AiOutputError);
    expect((err as AiOutputError).partial).toMatchObject({ attempts: 2, tokensIn: 200, model: "test-model" });
    expect((err as AiOutputError).reasons).toEqual(["invalid JSON or variant count", "invalid JSON or variant count"]);
  });

  it("rejects URLs, unknown placeholders and too many variants", async () => {
    const url = GOOD.replace("Rádi", "Viz https://example.cz. Rádi");
    const unknown = GOOD.replace("{{vozidlo}}", "{{jmeno}}");
    for (const answer of [{ variants: [url] }, { variants: [unknown] }, { variants: [GOOD, GOOD, GOOD, GOOD] }]) {
      const err = await generateCampaignTemplates({
        presetKey: "no_visit_12m",
        now,
        shop,
        model: scripted(JSON.stringify(answer)),
      }).catch((e) => e);
      expect(err).toBeInstanceOf(AiOutputError);
    }
  });

  it("rewrites return one variant and the mock follows the action", async () => {
    const first = await generateCampaignTemplates({ presetKey: "no_visit_12m", now, model: mockTextModel() });
    const shorter = await rewriteCampaignTemplate({
      presetKey: "no_visit_12m",
      current: first.variants[0],
      action: "shorter",
      now,
      model: mockTextModel(),
    });
    expect(shorter.variants).toHaveLength(1);
    expect(shorter.variants[0].length).toBeLessThan(first.variants[0].length);
    const again = await rewriteCampaignTemplate({
      presetKey: "no_visit_12m",
      current: first.variants[0],
      action: "regenerate",
      now,
      model: mockTextModel(),
    });
    expect(again.variants[0]).not.toBe(first.variants[0]);
  });

  it("never sends phone numbers or e-mails typed into the template", async () => {
    const model = scripted(JSON.stringify({ variants: [GOOD] }));
    const current = "{{osloveni}} volejte Janu na 777 123 456 nebo jana@example.cz. {{servis}} {{odhlaseni}}";
    const res = await rewriteCampaignTemplate({
      presetKey: "no_visit_12m",
      current,
      action: "friendlier",
      now,
      shop,
      model,
    });
    expect(model.requests[0].prompt).not.toMatch(/777 123 456|jana@example\.cz/);
    expect(model.requests[0].prompt).toContain("[číslo]");
    expect(JSON.stringify(res.input)).not.toContain("777");
  });
});

describe("prompt v1", () => {
  it("contains the spec rules and only company-level context", () => {
    const system = campaignTemplateSystem();
    expect(system).toContain("Must contain {{servis}} and {{odhlaseni}}. Start with {{osloveni}}");
    expect(system).toContain('{"variants": ["...", "...", "..."]}');
    const user = campaignTemplateUserPrompt({ presetKey: "stk_approaching", ...shop, offer: null });
    expect(user).toContain("Shop: Autoservis Dvořák s.r.o., Kolín.");
    expect(user).toContain("STK");
    expect(user).toContain("Offer: none");
  });

  it("maskFreeText removes contact data", () => {
    expect(maskFreeText("tel. +420 777 123 456, mail a.b@example.com")).toBe("tel. [číslo], mail [e-mail]");
  });

  it("extractJson tolerates prose around the object", () => {
    expect(extractJson('Here: {"a": 1} done')).toEqual({ a: 1 });
    expect(extractJson("{broken")).toBeNull();
    expect(extractJson("{not json}")).toBeNull();
  });
});

describe("Vercel AI SDK adapter", () => {
  it("passes the prompts and reports token usage", async () => {
    const language = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: JSON.stringify({ variants: [GOOD] }) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 321, noCache: 321, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 87, text: 87, reasoning: undefined },
        },
        warnings: [],
      }),
    });
    const model = aiSdkTextModel(language, "openai:test-small");
    const res = await generateCampaignTemplates({ presetKey: "no_visit_12m", now, shop, model });
    expect(res).toMatchObject({ variants: [GOOD], model: "openai:test-small", tokensIn: 321, tokensOut: 87 });
    const call = language.doGenerateCalls[0];
    expect(JSON.stringify(call.prompt)).toContain("You write short SMS messages in natural, polite Czech");
    expect(JSON.stringify(call.prompt)).toContain("Autoservis Dvořák s.r.o.");
  });
});

describe("vocative suggestions", () => {
  it("keeps plausible answers for requested surnames and caps confidence", async () => {
    const model = scripted(
      JSON.stringify({
        items: [
          { surname: "Klaus", vocative: "Klausi", gender: "m", confidence: 0.99 },
          { surname: "Matějů", vocative: "Matějů", gender: "x", confidence: 2 },
          { surname: "Novák", vocative: "Nováku", gender: "m", confidence: 0.9 },
          { surname: "Kraus", vocative: "Novotný", gender: "m", confidence: 0.9 },
        ],
      }),
    );
    const res = await suggestVocatives({ surnames: ["Klaus", "MATĚJŮ", "Kraus", "Klaus"], model });
    expect(model.requests[0].prompt).toBe("Surnames:\nKlaus\nMatějů\nKraus");
    expect(res.suggestions.get("Klaus")).toEqual({
      vocative: "Klausi",
      gender: "m",
      confidence: AI_VOCATIVE_MAX_CONFIDENCE,
    });
    expect(res.suggestions.get("Matějů")).toEqual({ vocative: "Matějů", gender: "unknown", confidence: 0.5 });
    expect(res.suggestions.has("Novák")).toBe(false);
    expect(res.dropped).toEqual(["Kraus"]);
    expect(res.promptVersion).toBe("vocatives.v1");
  });

  it("a broken answer drops everything; the mock suggests review-only forms", async () => {
    expect((await suggestVocatives({ surnames: ["Klaus"], model: scripted("nope") })).dropped).toEqual(["Klaus"]);
    const mock = await suggestVocatives({ surnames: ["Klaus", "Matějů"] });
    expect(mock.suggestions.get("Klaus")).toMatchObject({ vocative: "Klausi", gender: "m" });
    expect(mock.suggestions.get("Matějů")).toMatchObject({ gender: "unknown" });
    for (const s of mock.suggestions.values()) expect(s.confidence).toBeLessThan(0.9);
  });
});
