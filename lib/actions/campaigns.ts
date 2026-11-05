"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { generateCampaignTemplates, rewriteCampaignTemplate } from "../ai/client";
import { createCampaign, markBooked, markCompleted, simulateSendBatch, type SendProgress } from "../db/mutations";
import { PRESETS, type PresetKey } from "../domain/segments/presets";
import { toMinor } from "../domain/money";
import { requireContext } from "../auth/context";
import { env } from "../env";
import { fail, run, type ActionResult } from "./result";

/**
 * Phase 0 demo actions on the in-memory store (DATA_SOURCE=demo). On real
 * data they refuse before doing anything; the real flows live in
 * real-campaigns.ts and conversions.ts (ADR-017).
 */
async function demoGuard(): Promise<ActionResult<never> | null> {
  if (env.DATA_SOURCE !== "demo") return fail("forbidden");
  await requireContext({ permission: "admin.access" });
  return null;
}

const presetKey = z.enum(PRESETS.map((p) => p.key) as [PresetKey, ...PresetKey[]]);
const id = z.string().uuid();

const createSchema = z.object({
  companyId: id,
  presetKey,
  name: z.string().trim().min(3).max(80),
  holdoutPct: z.number().min(0).max(0.2),
  template: z.string().trim().min(20).max(640),
  stripDiacritics: z.boolean(),
  scheduledAt: z.string().datetime(),
});

export async function createCampaignAction(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<{ campaignId: string }>> {
  const blocked = await demoGuard();
  if (blocked) return blocked;
  return run(() => {
    const data = createSchema.parse(input);
    return createCampaign({ ...data, scheduledAt: new Date(data.scheduledAt) });
  });
}

export async function simulateSendBatchAction(input: {
  companyId: string;
  campaignId: string;
}): Promise<ActionResult<SendProgress>> {
  const blocked = await demoGuard();
  if (blocked) return blocked;
  return run(() => simulateSendBatch(z.object({ companyId: id, campaignId: id }).parse(input)));
}

export async function generateTemplateAction(input: {
  presetKey: string;
}): Promise<ActionResult<{ variants: string[] }>> {
  const blocked = await demoGuard();
  if (blocked) return blocked;
  return run(async () => {
    const data = z.object({ presetKey }).parse(input);
    const result = await generateCampaignTemplates({ presetKey: data.presetKey, now: new Date() });
    return { variants: result.variants };
  });
}

export async function rewriteTemplateAction(input: {
  presetKey: string;
  current: string;
  action: string;
}): Promise<ActionResult<{ template: string }>> {
  const blocked = await demoGuard();
  if (blocked) return blocked;
  return run(async () => {
    const data = z
      .object({
        presetKey,
        current: z.string().max(640),
        action: z.enum(["shorter", "friendlier", "professional", "regenerate"]),
      })
      .parse(input);
    const result = await rewriteCampaignTemplate({ ...data, now: new Date() });
    return { template: result.variants[0] };
  });
}

const enrollmentInput = z.object({ companyId: id, enrollmentId: id });

export async function markBookedAction(input: {
  companyId: string;
  enrollmentId: string;
}): Promise<ActionResult<void>> {
  const blocked = await demoGuard();
  if (blocked) return blocked;
  const result = await run(() => markBooked(enrollmentInput.parse(input)));
  if (result.ok) refresh();
  return result;
}

export async function markCompletedAction(input: {
  companyId: string;
  enrollmentId: string;
  revenueCzk: number;
}): Promise<ActionResult<void>> {
  const blocked = await demoGuard();
  if (blocked) return blocked;
  const result = await run(() => {
    const data = enrollmentInput.extend({ revenueCzk: z.number().int().min(1).max(500_000) }).parse(input);
    markCompleted({
      companyId: data.companyId,
      enrollmentId: data.enrollmentId,
      revenueMinor: toMinor(data.revenueCzk),
    });
  });
  if (result.ok) refresh();
  return result;
}
