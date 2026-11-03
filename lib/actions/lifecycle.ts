"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireContext } from "../auth/context";
import { audit } from "../audit";
import { createSupabaseServerClient } from "../db/supabase/server-client";
import { SERVICE_CATEGORIES } from "../domain/service-labels";
import { enqueue } from "../jobs/runner";
import { run, type ActionResult } from "./result";

/** Lifecycle recompute and service category mapping (spec §12, §40.8). Operator only. */

export async function recomputeLifecycleAction(input: { companyId: string }): Promise<ActionResult<null>> {
  return run(async () => {
    const { companyId } = z.object({ companyId: z.string().uuid() }).parse(input);
    await requireContext({ permission: "admin.access", companyId });
    await enqueue({ name: "lifecycle/recompute.requested", data: { companyId } });
    return null;
  });
}

export async function setServiceCategoryAction(input: {
  companyId: string;
  label: string;
  category: string;
}): Promise<ActionResult<{ visits: number }>> {
  return run(async () => {
    const data = z
      .object({
        companyId: z.string().uuid(),
        label: z.string().trim().min(1).max(300),
        category: z.enum(SERVICE_CATEGORIES),
      })
      .parse(input);
    const ctx = await requireContext({ permission: "admin.access", companyId: data.companyId });
    const supabase = await createSupabaseServerClient();
    // Mapping and re-categorised visits in one transaction (RLS: operator only).
    const { data: visits, error } = await supabase.rpc("set_service_category", {
      p_company_id: data.companyId,
      p_label_norm: data.label,
      p_category: data.category,
    });
    if (error) throw new Error(`set_service_category failed: ${error.code}`);
    await audit({
      action: "company.settings_changed",
      actorType: "admin",
      actorUserId: ctx.userId,
      companyId: data.companyId,
      entityType: "company",
      entityId: data.companyId,
      // Work descriptions are shop vocabulary, not personal data.
      metadata: { section: "service_categories", category: data.category, visits_changed: visits ?? 0 },
    });
    refresh();
    return { visits: visits ?? 0 };
  });
}
