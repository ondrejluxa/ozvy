"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireContext } from "../auth/context";
import { audit } from "../audit";
import { DomainError } from "../db/mutations";
import { createSupabaseServerClient } from "../db/supabase/server-client";
import { enqueue } from "../jobs/runner";
import { run, type ActionResult } from "./result";

/** Vocative suggestions and operator review (spec §15). Operator only. */

const uuid = z.string().uuid();

export async function refreshVocativesAction(input: { companyId: string }): Promise<ActionResult<null>> {
  return run(async () => {
    const { companyId } = z.object({ companyId: uuid }).parse(input);
    const ctx = await requireContext({ permission: "admin.access", companyId });
    await enqueue({ name: "vocatives/refresh.requested", data: { companyId, userId: ctx.userId } });
    await audit({
      action: "vocatives.refreshed",
      actorType: "admin",
      actorUserId: ctx.userId,
      companyId,
      entityType: "company",
      entityId: companyId,
    });
    return null;
  });
}

export async function reviewVocativeAction(input: {
  companyId: string;
  id: string;
  vocative: string;
  gender: string;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const data = z
      .object({
        companyId: uuid,
        id: uuid,
        vocative: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .regex(/^\p{L}+(?:[-' ]\p{L}+)*$/u),
        gender: z.enum(["m", "f", "unknown"]),
      })
      .parse(input);
    const ctx = await requireContext({ permission: "admin.access", companyId: data.companyId });
    const supabase = await createSupabaseServerClient();
    const { data: existing } = await supabase
      .from("name_vocatives")
      .select("vocative, gender")
      .eq("company_id", data.companyId)
      .eq("id", data.id)
      .maybeSingle();
    if (!existing) throw new DomainError("not_found");
    const changed = existing.vocative !== data.vocative || existing.gender !== data.gender;
    const { error } = await supabase
      .from("name_vocatives")
      .update({
        vocative: data.vocative,
        gender: data.gender,
        reviewed_by: ctx.userId,
        reviewed_at: new Date().toISOString(),
        ...(changed ? { source: "operator", confidence: 1 } : {}),
      })
      .eq("company_id", data.companyId)
      .eq("id", data.id);
    if (error) throw new Error(`vocative review failed: ${error.code}`);
    await audit({
      action: "vocative.reviewed",
      actorType: "admin",
      actorUserId: ctx.userId,
      companyId: data.companyId,
      entityType: "name_vocative",
      entityId: data.id,
      metadata: { changed, gender: data.gender },
    });
    refresh();
    return null;
  });
}
