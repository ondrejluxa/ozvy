"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireContext } from "../auth/context";
import { audit, type AuditAction } from "../audit";
import { DomainError } from "../db/mutations";
import { createServiceClient } from "../db/supabase/service-client";
import { conversionErrorCode, MAX_JOB_VALUE_CZK } from "../domain/attribution/conversions";
import { run, type ActionResult } from "./result";

/**
 * Conversion pipeline buttons (spec §6 F5, §14): "Objednal se", "Dokončeno"
 * with the job value, corrections. Shop owners, managers and the operator
 * (conversions.mark). Every rule lives in public.record_conversion; the
 * action checks the permission, calls it with the service role and audits.
 */

const AUDIT: Record<string, AuditAction> = {
  book: "conversion.booked",
  complete: "conversion.completed",
  edit: "conversion.updated",
  revert: "conversion.reverted",
};

export async function recordConversionAction(input: {
  companyId: string;
  enrollmentId: string;
  action: "book" | "complete" | "edit" | "revert";
  revenueMinor?: number | null;
  at?: string | null;
}): Promise<ActionResult<{ stage: string }>> {
  return run(async () => {
    const data = z
      .object({
        companyId: z.string().uuid(),
        enrollmentId: z.string().uuid(),
        action: z.enum(["book", "complete", "edit", "revert"]),
        revenueMinor: z
          .number()
          .int()
          .min(100)
          .max(MAX_JOB_VALUE_CZK * 100)
          .nullish(),
        at: z.string().datetime({ offset: true }).nullish(),
      })
      .parse(input);
    if ((data.action === "complete" || data.action === "edit") && !data.revenueMinor) {
      throw new DomainError("conversion_revenue_required");
    }
    const ctx = await requireContext({ permission: "conversions.mark", companyId: data.companyId });
    const { data: row, error } = await createServiceClient().rpc("record_conversion", {
      p_company_id: data.companyId,
      p_enrollment_id: data.enrollmentId,
      p_action: data.action,
      p_at: data.at ?? new Date().toISOString(),
      p_revenue_minor: data.revenueMinor ?? undefined,
      p_user: ctx.userId ?? undefined,
    });
    if (error) {
      const code = conversionErrorCode(error.message);
      if (code) throw new DomainError(code);
      throw new Error(`record_conversion failed: ${error.code}`);
    }
    await audit({
      action: AUDIT[data.action],
      actorType: ctx.isPlatformAdmin ? "admin" : "user",
      actorUserId: ctx.userId,
      companyId: data.companyId,
      entityType: "campaign_enrollment",
      entityId: data.enrollmentId,
      metadata: {
        revenue_minor: data.revenueMinor ?? null,
        holdout: row?.is_holdout ?? null,
      },
    });
    refresh();
    return { stage: data.action === "revert" ? "reverted" : (row?.stage ?? "") };
  });
}
