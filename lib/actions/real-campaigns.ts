"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AiOutputError, generateCampaignTemplates, rewriteCampaignTemplate, type GenerationResult } from "../ai/client";
import { attachGenerations, logGeneration, setChosenVariant } from "../ai/log";
import type { TextModel } from "../ai/model";
import { getTextModel } from "../ai/provider";
import { requireContext, type AuthContext } from "../auth/context";
import { ownerEmails } from "../auth/company-contacts";
import { audit, type AuditAction } from "../audit";
import { DomainError } from "../db/mutations";
import type { Json } from "../db/types.gen";
import { getCampaign, resolveSource } from "../db/supabase/campaigns";
import { getCompanyRecord } from "../db/supabase/companies";
import { previewRules } from "../db/supabase/segments";
import { createSupabaseServerClient } from "../db/supabase/server-client";
import { createServiceClient } from "../db/supabase/service-client";
import { canDecideApproval, CampaignTransitionError, nextStatus } from "../domain/campaigns/status";
import { campaignContentIssues, MAX_FOLLOWUPS } from "../domain/campaigns/steps";
import { resolveCompanySettings } from "../domain/company-settings";
import { formatDateTime } from "../domain/dates";
import { PRESETS, type PresetKey } from "../domain/segments/presets";
import { campaignApprovalEmail } from "../emails/campaign-approval";
import { env } from "../env";
import { getEmailProvider } from "../providers/email";
import { run, type ActionResult } from "./result";

/**
 * Campaign actions on real data (spec §12, §20, §40.10, flows F3 and F4).
 * The operator creates, edits, submits and cancels; in client-approval
 * shops the owner approves or returns. Sending itself is slice 12.
 */

const uuid = z.string().uuid();
const presetKey = z.enum(PRESETS.map((p) => p.key) as [PresetKey, ...PresetKey[]]);

const stepSchema = z.object({
  delayDays: z.number().int().min(0).max(60),
  template: z.string().trim().min(20).max(640),
  stripDiacritics: z.boolean(),
});

const contentSchema = z.object({
  name: z.string().trim().min(3).max(80),
  holdoutPct: z.number().min(0).max(0.2),
  steps: z
    .array(stepSchema)
    .min(1)
    .max(MAX_FOLLOWUPS + 1),
  scheduledAt: z.string().datetime(),
});

type Content = z.infer<typeof contentSchema>;

function checkContent(content: Content) {
  const issues = campaignContentIssues({
    steps: content.steps,
    scheduledAt: new Date(content.scheduledAt),
    now: new Date(),
  });
  if (issues.length) throw new DomainError(`campaign_${issues[0].code}`);
}

function transition(from: Parameters<typeof nextStatus>[0], event: Parameters<typeof nextStatus>[1], ctx = {}) {
  try {
    return nextStatus(from, event, ctx);
  } catch (err) {
    if (err instanceof CampaignTransitionError) throw new DomainError("campaign_wrong_state");
    throw err;
  }
}

async function auditCampaign(
  ctx: AuthContext,
  action: AuditAction,
  companyId: string,
  campaignId: string,
  metadata = {},
) {
  await audit({
    action,
    actorType: ctx.isPlatformAdmin ? "admin" : "user",
    actorUserId: ctx.userId,
    companyId,
    entityType: "campaign",
    entityId: campaignId,
    metadata,
  });
}

async function saveSteps(companyId: string, campaignId: string, steps: Content["steps"]) {
  const supabase = await createSupabaseServerClient();
  await supabase.from("campaign_steps").delete().eq("company_id", companyId).eq("campaign_id", campaignId);
  const { error } = await supabase.from("campaign_steps").insert(
    steps.map((s, i) => ({
      company_id: companyId,
      campaign_id: campaignId,
      step_number: i,
      delay_days: i === 0 ? 0 : s.delayDays,
      body_template: s.template,
      strip_diacritics: s.stripDiacritics,
    })),
  );
  if (error) throw new Error(`campaign steps failed: ${error.code}`);
}

// ---------- AI (spec §15): provider from env, every call logged ----------

const generationIds = z.array(uuid).max(50).default([]);

async function shopContext(companyId: string) {
  const company = await getCompanyRecord(companyId);
  if (!company) throw new DomainError("not_found");
  return { companyName: company.name, city: company.city };
}

/** Runs one generation and logs it, including failed ones. */
async function generateLogged(
  ctx: AuthContext,
  companyId: string,
  campaignId: string | null,
  kind: "campaign_template" | "campaign_rewrite",
  call: (model: TextModel) => Promise<GenerationResult>,
): Promise<{ variants: string[]; generationId: string | null }> {
  const model = await getTextModel();
  const log = (r: Omit<GenerationResult, "variants">, output: Record<string, unknown>, chosenIndex: number | null) =>
    logGeneration({
      companyId,
      campaignId,
      kind,
      promptVersion: r.promptVersion,
      model: r.model,
      input: r.input,
      output: { ...output, attempts: r.attempts, rejected: r.rejected },
      chosenIndex,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      createdBy: ctx.userId,
    });
  let result: GenerationResult;
  try {
    result = await call(model);
  } catch (err) {
    if (err instanceof AiOutputError) {
      await log(err.partial, { error: "invalid_output" }, null);
      throw new DomainError("ai_invalid_output");
    }
    console.error("[ai] provider call failed", model.id, err instanceof Error ? err.name : "");
    throw new DomainError("ai_unavailable");
  }
  const generationId = await log(result, { variants: result.variants }, 0);
  return { variants: result.variants, generationId };
}

export async function generateTemplateRealAction(input: {
  companyId: string;
  presetKey: string | null;
  campaignId?: string | null;
}): Promise<ActionResult<{ variants: string[]; generationId: string | null }>> {
  return run(async () => {
    const data = z
      .object({ companyId: uuid, presetKey: presetKey.nullable(), campaignId: uuid.nullish() })
      .parse(input);
    const ctx = await requireContext({ permission: "campaigns.create", companyId: data.companyId });
    const shop = await shopContext(data.companyId);
    return generateLogged(ctx, data.companyId, data.campaignId ?? null, "campaign_template", (model) =>
      generateCampaignTemplates({ presetKey: data.presetKey ?? "no_visit_12m", now: new Date(), shop, model }),
    );
  });
}

export async function rewriteTemplateRealAction(input: {
  companyId: string;
  presetKey: string | null;
  current: string;
  action: string;
  campaignId?: string | null;
}): Promise<ActionResult<{ template: string; generationId: string | null }>> {
  return run(async () => {
    const data = z
      .object({
        companyId: uuid,
        presetKey: presetKey.nullable(),
        current: z.string().max(640),
        action: z.enum(["shorter", "friendlier", "professional", "regenerate"]),
        campaignId: uuid.nullish(),
      })
      .parse(input);
    const ctx = await requireContext({ permission: "campaigns.create", companyId: data.companyId });
    const shop = await shopContext(data.companyId);
    const res = await generateLogged(ctx, data.companyId, data.campaignId ?? null, "campaign_rewrite", (model) =>
      rewriteCampaignTemplate({
        presetKey: data.presetKey ?? "no_visit_12m",
        current: data.current,
        action: data.action,
        now: new Date(),
        shop,
        model,
      }),
    );
    return { template: res.variants[0], generationId: res.generationId };
  });
}

/** Records which of the generated variants the operator picked. */
export async function chooseVariantAction(input: {
  companyId: string;
  generationId: string;
  index: number;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const data = z.object({ companyId: uuid, generationId: uuid, index: z.number().int().min(0).max(2) }).parse(input);
    const ctx = await requireContext({ permission: "campaigns.create", companyId: data.companyId });
    await setChosenVariant(data.companyId, data.generationId, ctx.userId, data.index);
    return null;
  });
}

// ---------- create / edit ----------

export async function createCampaignRealAction(
  input: Content & {
    companyId: string;
    presetKey: string | null;
    segmentId: string | null;
    submit: boolean;
    generationIds?: string[];
  },
): Promise<ActionResult<{ campaignId: string }>> {
  return run(async () => {
    const data = contentSchema
      .extend({
        companyId: uuid,
        presetKey: presetKey.nullable(),
        segmentId: uuid.nullable(),
        submit: z.boolean(),
        generationIds,
      })
      .parse(input);
    const ctx = await requireContext({ permission: "campaigns.create", companyId: data.companyId });
    checkContent(data);
    const [company, source] = await Promise.all([
      getCompanyRecord(data.companyId),
      resolveSource(data.companyId, { preset: data.presetKey ?? undefined, segment: data.segmentId ?? undefined }),
    ]);
    if (!company || !source) throw new DomainError("not_found");
    if (source.unavailableReason) throw new DomainError("campaign_segment_unavailable");
    const settings = resolveCompanySettings(company.settings);

    const supabase = await createSupabaseServerClient();
    const { data: created, error } = await supabase
      .from("campaigns")
      .insert({
        company_id: data.companyId,
        name: data.name,
        segment_id: source.segmentId,
        segment_preset: source.presetKey,
        segment_rules_snapshot: source.rules as unknown as NonNullable<Json>,
        status: "draft",
        scheduled_at: data.scheduledAt,
        holdout_pct: data.holdoutPct,
        expected_conversion_rate: settings.expected_conversion_rate,
        attribution_window_days: settings.attribution_window_days,
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error || !created) throw new Error(`campaign insert failed: ${error?.code}`);
    await saveSteps(data.companyId, created.id, data.steps);
    await attachGenerations(data.companyId, created.id, ctx.userId, data.generationIds);
    await auditCampaign(ctx, "campaign.created", data.companyId, created.id, { steps: data.steps.length });
    if (data.submit) await submit(ctx, data.companyId, created.id);
    refresh();
    return { campaignId: created.id };
  });
}

export async function updateDraftAction(
  input: Content & { companyId: string; campaignId: string },
): Promise<ActionResult<null>> {
  return run(async () => {
    const data = contentSchema.extend({ companyId: uuid, campaignId: uuid }).parse(input);
    const ctx = await requireContext({ permission: "campaigns.create", companyId: data.companyId });
    checkContent(data);
    const existing = await getCampaign(data.companyId, data.campaignId);
    if (!existing) throw new DomainError("not_found");
    if (existing.campaign.status !== "draft") throw new DomainError("campaign_wrong_state");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("campaigns")
      .update({ name: data.name, holdout_pct: data.holdoutPct, scheduled_at: data.scheduledAt })
      .eq("company_id", data.companyId)
      .eq("id", data.campaignId);
    if (error) throw new Error(`campaign update failed: ${error.code}`);
    await saveSteps(data.companyId, data.campaignId, data.steps);
    await auditCampaign(ctx, "campaign.updated", data.companyId, data.campaignId, { steps: data.steps.length });
    refresh();
    return null;
  });
}

export async function deleteDraftAction(input: { companyId: string; campaignId: string }): Promise<ActionResult<null>> {
  return run(async () => {
    const data = z.object({ companyId: uuid, campaignId: uuid }).parse(input);
    const ctx = await requireContext({ permission: "campaigns.create", companyId: data.companyId });
    const supabase = await createSupabaseServerClient();
    const { data: deleted, error } = await supabase
      .from("campaigns")
      .delete()
      .eq("company_id", data.companyId)
      .eq("id", data.campaignId)
      .eq("status", "draft")
      .select("id");
    if (error) throw new Error(`campaign delete failed: ${error.code}`);
    if (!deleted?.length) throw new DomainError("campaign_wrong_state");
    await auditCampaign(ctx, "campaign.deleted", data.companyId, data.campaignId);
    return null;
  });
}

// ---------- submit / approve / reject / cancel ----------

/** Submit (spec F3.5): waiting_for_approval in client-approval shops, else scheduled by the operator. */
async function submit(ctx: AuthContext, companyId: string, campaignId: string) {
  const loaded = await getCampaign(companyId, campaignId);
  const company = await getCompanyRecord(companyId);
  if (!loaded || !company) throw new DomainError("not_found");
  const { campaign, steps } = loaded;
  checkContent({
    name: campaign.name,
    holdoutPct: Number(campaign.holdout_pct),
    scheduledAt: campaign.scheduled_at ?? new Date(0).toISOString(),
    steps: steps.map((s) => ({
      delayDays: s.delay_days,
      template: s.body_template,
      stripDiacritics: s.strip_diacritics,
    })),
  });
  const to = transition(campaign.status, "submit", { requiresClientApproval: company.requires_client_approval });
  // The count the shop agrees to; the send job pauses on a > 20 % drift (spec §12).
  const counts = await previewRules(companyId, campaign.segment_rules_snapshot as never, campaign.segment_preset);
  if (counts.eligible === 0) throw new DomainError("no_recipients");
  const now = new Date().toISOString();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("campaigns")
    .update({
      status: to,
      approved_recipient_count: counts.eligible,
      submitted_by: ctx.userId,
      submitted_at: now,
      approval_comment: null,
      ...(to === "scheduled" && { approved_by: ctx.userId, approved_at: now }),
    })
    .eq("company_id", companyId)
    .eq("id", campaignId);
  if (error) throw new Error(`campaign submit failed: ${error.code}`);
  await auditCampaign(ctx, "campaign.submitted", companyId, campaignId, { recipients: counts.eligible });

  if (to === "scheduled") {
    await auditCampaign(ctx, "campaign.scheduled", companyId, campaignId);
    return;
  }
  // Ask the owners (spec F4); the link opens the phone-friendly approval page.
  const owners = await ownerEmails(companyId);
  const email = getEmailProvider();
  for (const to of owners) {
    await email.send(
      await campaignApprovalEmail({
        to,
        companyName: company.name,
        campaignName: campaign.name,
        recipients: counts.eligible,
        sendAt: campaign.scheduled_at ? formatDateTime(campaign.scheduled_at) : "—",
        link: `${env.NEXT_PUBLIC_APP_URL}/app/campaigns/${campaignId}`,
      }),
    );
  }
}

export async function submitCampaignAction(input: {
  companyId: string;
  campaignId: string;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const data = z.object({ companyId: uuid, campaignId: uuid }).parse(input);
    const ctx = await requireContext({ permission: "campaigns.create", companyId: data.companyId });
    await submit(ctx, data.companyId, data.campaignId);
    refresh();
    return null;
  });
}

async function decide(
  input: { companyId: string; campaignId: string; comment?: string },
  approve: boolean,
): Promise<ActionResult<null>> {
  return run(async () => {
    const data = z
      .object({ companyId: uuid, campaignId: uuid, comment: z.string().trim().max(1000).optional() })
      .parse(input);
    const ctx = await requireContext({ permission: "campaigns.approve", companyId: data.companyId });
    if (
      !canDecideApproval({
        isPlatformAdmin: ctx.isPlatformAdmin,
        role: ctx.membership?.role ?? null,
        requiresClientApproval: ctx.membership?.requiresClientApproval ?? false,
      })
    ) {
      throw new DomainError("forbidden");
    }
    if (!approve && !data.comment) throw new DomainError("campaign_comment_required");
    const loaded = await getCampaign(data.companyId, data.campaignId);
    if (!loaded) throw new DomainError("not_found");
    const to = transition(loaded.campaign.status, approve ? "approve" : "reject");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("campaigns")
      .update(
        approve
          ? { status: to, approved_by: ctx.userId, approved_at: new Date().toISOString() }
          : { status: to, approval_comment: data.comment },
      )
      .eq("company_id", data.companyId)
      .eq("id", data.campaignId);
    if (error) throw new Error(`campaign decision failed: ${error.code}`);
    await auditCampaign(ctx, approve ? "campaign.approved" : "campaign.rejected", data.companyId, data.campaignId);
    if (approve) await auditCampaign(ctx, "campaign.scheduled", data.companyId, data.campaignId);
    refresh();
    return null;
  });
}

export async function approveCampaignAction(input: { companyId: string; campaignId: string }) {
  return decide(input, true);
}

export async function rejectCampaignAction(input: { companyId: string; campaignId: string; comment: string }) {
  return decide(input, false);
}

export async function cancelCampaignAction(input: {
  companyId: string;
  campaignId: string;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const data = z.object({ companyId: uuid, campaignId: uuid }).parse(input);
    const ctx = await requireContext({ permission: "campaigns.pause", companyId: data.companyId });
    if (!ctx.isPlatformAdmin) throw new DomainError("forbidden");
    const loaded = await getCampaign(data.companyId, data.campaignId);
    if (!loaded) throw new DomainError("not_found");
    const to = transition(loaded.campaign.status, "cancel");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("campaigns")
      .update({ status: to })
      .eq("company_id", data.companyId)
      .eq("id", data.campaignId);
    if (error) throw new Error(`campaign cancel failed: ${error.code}`);
    // Queued messages of a cancelled campaign never go out (spec §16).
    const { error: msgError } = await createServiceClient()
      .from("messages")
      .update({ status: "cancelled", error_code: "campaign_cancelled" })
      .eq("company_id", data.companyId)
      .eq("campaign_id", data.campaignId)
      .eq("status", "queued");
    if (msgError) throw new Error(`message cancel failed: ${msgError.code}`);
    await auditCampaign(ctx, "campaign.cancelled", data.companyId, data.campaignId);
    refresh();
    return null;
  });
}
