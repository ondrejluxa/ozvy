"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "../auth/context";
import { audit } from "../audit";
import { DomainError } from "../db/mutations";
import { getCompanyRecord } from "../db/supabase/companies";
import { createSupabaseServerClient } from "../db/supabase/server-client";
import { changedFields, parseCompanyProfile, type CompanyProfileInput } from "../domain/company-profile";
import {
  DEFAULT_COMPANY_SETTINGS,
  changedSettingKeys,
  companySettingsSchema,
  resolveCompanySettings,
} from "../domain/company-settings";
import { DPA_BUCKET, dpaFileIssue, dpaObjectPath, sendingBlockers } from "../domain/dpa";
import { run, type ActionResult } from "./result";

/**
 * Operator actions on companies (spec §40.5, flow F1). Every write runs with
 * the operator's own session, so RLS and the company guard trigger apply;
 * audit metadata carries field names only, never values.
 */

export interface CompanyFormState {
  fieldErrors?: Record<string, string>;
  error?: string;
  done?: boolean;
  /** Submitted values, kept after a failed submit (spec §24). */
  values?: Record<string, string>;
}

const PROFILE_FIELDS = [
  "name",
  "ico",
  "dic",
  "address_line",
  "city",
  "postal_code",
  "contact_person",
  "phone",
  "email",
  "website",
  "average_job_value_czk",
  "default_sender_name",
  "opening_hours",
  "status",
] as const;

function profileInput(form: FormData): { input: CompanyProfileInput; values: Record<string, string> } {
  const values = Object.fromEntries(PROFILE_FIELDS.map((f) => [f, String(form.get(f) ?? "").slice(0, 300)]));
  const requiresClientApproval = form.get("requires_client_approval") === "on";
  return {
    input: {
      ...(values as Record<(typeof PROFILE_FIELDS)[number], string>),
      requires_client_approval: requiresClientApproval,
    },
    values: { ...values, requires_client_approval: requiresClientApproval ? "on" : "" },
  };
}

const companyIdSchema = z.string().uuid();

// ---------- create ----------

export async function createCompanyAction(_prev: CompanyFormState, form: FormData): Promise<CompanyFormState> {
  const ctx = await requireContext({ permission: "admin.access" });
  const { input, values } = profileInput(form);
  const parsed = parseCompanyProfile(input);
  if (!parsed.success) return { fieldErrors: parsed.fieldErrors, values };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("companies")
    .insert({
      ...parsed.values,
      service_mode: "managed",
      settings: { ...DEFAULT_COMPANY_SETTINGS },
      sending_enabled: false,
    })
    .select("id")
    .single();
  if (error || !data) return { error: "save_failed", values };

  await audit({
    action: "company.created",
    actorType: "admin",
    actorUserId: ctx.userId,
    companyId: data.id,
    entityType: "company",
    entityId: data.id,
  });
  redirect(`/admin/companies/${data.id}/settings`);
}

// ---------- profile ----------

export async function updateCompanyProfileAction(_prev: CompanyFormState, form: FormData): Promise<CompanyFormState> {
  const companyId = companyIdSchema.parse(form.get("companyId"));
  const ctx = await requireContext({ permission: "admin.access", companyId });
  const { input, values } = profileInput(form);
  const parsed = parseCompanyProfile(input);
  if (!parsed.success) return { fieldErrors: parsed.fieldErrors, values };

  const before = await getCompanyRecord(companyId);
  if (!before) return { error: "not_found", values };
  if (parsed.values.status !== before.status && before.sending_enabled && parsed.values.status !== "active") {
    // Pausing or ending the cooperation stops sending in the same write.
    Object.assign(parsed.values, { sending_enabled: false });
  }
  const fields = changedFields(
    before as unknown as Record<string, unknown>,
    parsed.values as unknown as Record<string, unknown>,
  );
  if (fields.length === 0) return { done: true, values };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("companies").update(parsed.values).eq("id", companyId);
  if (error) return { error: "save_failed", values };

  await audit({
    action: "company.settings_changed",
    actorType: "admin",
    actorUserId: ctx.userId,
    companyId,
    entityType: "company",
    entityId: companyId,
    metadata: { section: "profile", fields: fields.join(",") },
  });
  refresh();
  return { done: true, values };
}

// ---------- settings JSON ----------

const SETTINGS_FIELDS = [
  "active_max_months",
  "at_risk_max_months",
  "max_lookback_months",
  "attribution_window_days",
  "holdout_percent",
  "expected_conversion_percent",
  "gross_margin_percent",
  "message_shop_name",
] as const;

const SETTINGS_ERROR_FIELD: Record<string, string> = {
  lifecycle: "at_risk_max_months",
  holdout_pct: "holdout_percent",
  expected_conversion_rate: "expected_conversion_percent",
  gross_margin_pct: "gross_margin_percent",
};

export async function updateCompanySettingsAction(_prev: CompanyFormState, form: FormData): Promise<CompanyFormState> {
  const companyId = companyIdSchema.parse(form.get("companyId"));
  const ctx = await requireContext({ permission: "admin.access", companyId });
  const values = Object.fromEntries(
    SETTINGS_FIELDS.map((f) => [
      f,
      String(form.get(f) ?? "")
        .trim()
        .slice(0, 60),
    ]),
  );
  const num = (s: string) => (s === "" ? Number.NaN : Number(s.replace(",", ".")));
  const percent = (s: string) => Math.round(num(s) * 10) / 1000;

  const parsed = companySettingsSchema.safeParse({
    lifecycle: { active_max_months: num(values.active_max_months), at_risk_max_months: num(values.at_risk_max_months) },
    max_lookback_months: num(values.max_lookback_months),
    attribution_window_days: num(values.attribution_window_days),
    holdout_pct: percent(values.holdout_percent),
    expected_conversion_rate: percent(values.expected_conversion_percent),
    gross_margin_pct: values.gross_margin_percent === "" ? null : percent(values.gross_margin_percent),
    message_shop_name: values.message_shop_name || null,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[issue.path.length - 1]);
      const top = String(issue.path[0]);
      const field = top === "lifecycle" ? key : (SETTINGS_ERROR_FIELD[top] ?? top);
      fieldErrors[field] ??= issue.message === "at_risk_must_exceed_active" ? issue.message : "out_of_range";
    }
    return { fieldErrors, values };
  }

  const before = await getCompanyRecord(companyId);
  if (!before) return { error: "not_found", values };
  const previous = resolveCompanySettings(before.settings);
  const keys = changedSettingKeys(previous, parsed.data);
  if (keys.length === 0) return { done: true, values };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("companies").update({ settings: parsed.data }).eq("id", companyId);
  if (error) return { error: "save_failed", values };

  await audit({
    action: "company.settings_changed",
    actorType: "admin",
    actorUserId: ctx.userId,
    companyId,
    entityType: "company",
    entityId: companyId,
    metadata: { section: "settings", fields: keys.join(",") },
  });
  refresh();
  return { done: true, values };
}

// ---------- DPA ----------

export async function confirmDpaAction(_prev: CompanyFormState, form: FormData): Promise<CompanyFormState> {
  const companyId = companyIdSchema.parse(form.get("companyId"));
  const ctx = await requireContext({ permission: "admin.access", companyId });
  if (form.get("confirmed") !== "on") return { fieldErrors: { confirmed: "required" } };

  const file = form.get("file");
  const blob = file instanceof File ? file : null;
  const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array();
  const issue = dpaFileIssue(blob ? { size: blob.size, type: blob.type, head: bytes.subarray(0, 8) } : null);
  if (issue) return { fieldErrors: { file: issue } };

  const uploadId = randomUUID();
  const path = dpaObjectPath(companyId, uploadId);
  const supabase = await createSupabaseServerClient();
  const upload = await supabase.storage
    .from(DPA_BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (upload.error) return { error: "upload_failed" };

  const { error } = await supabase
    .from("companies")
    .update({ dpa_signed_at: new Date().toISOString(), dpa_document_path: path })
    .eq("id", companyId);
  if (error) return { error: "save_failed" };

  await audit({
    action: "company.dpa_confirmed",
    actorType: "admin",
    actorUserId: ctx.userId,
    companyId,
    entityType: "company",
    entityId: companyId,
    metadata: { upload_id: uploadId },
  });
  refresh();
  return { done: true };
}

// ---------- sending switch ----------

export async function setSendingEnabledAction(input: {
  companyId: string;
  enabled: boolean;
}): Promise<ActionResult<{ enabled: boolean }>> {
  return run(async () => {
    const data = z.object({ companyId: companyIdSchema, enabled: z.boolean() }).parse(input);
    const ctx = await requireContext({ permission: "admin.access", companyId: data.companyId });
    const company = await getCompanyRecord(data.companyId);
    if (!company) throw new Error("company not found");
    if (data.enabled) {
      const blockers = sendingBlockers({ dpaSignedAt: company.dpa_signed_at, status: company.status });
      if (blockers.length) throw new DomainError(`sending_blocked_${blockers[0]}`);
    }
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("companies")
      .update({ sending_enabled: data.enabled })
      .eq("id", data.companyId);
    if (error) throw new Error(`sending switch failed: ${error.code}`);
    await audit({
      action: "company.sending_enabled",
      actorType: "admin",
      actorUserId: ctx.userId,
      companyId: data.companyId,
      entityType: "company",
      entityId: data.companyId,
      metadata: { enabled: data.enabled },
    });
    refresh();
    return { enabled: data.enabled };
  });
}
