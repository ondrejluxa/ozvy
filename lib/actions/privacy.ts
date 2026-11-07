"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireContext } from "../auth/context";
import { audit } from "../audit";
import { DomainError } from "../db/mutations";
import { getCustomerDetail } from "../db/supabase/customers";
import { getDataSubjectRequest } from "../db/supabase/privacy";
import { createServiceClient } from "../db/supabase/service-client";
import { createSupabaseServerClient } from "../db/supabase/server-client";
import { DSR_TYPES, canOwnerRequest } from "../domain/privacy";
import { env } from "../env";
import { suppressAddress } from "../jobs/opt-out-core";
import { run, type ActionResult } from "./result";

/**
 * Data subject requests and retention objections (spec §21, ADR-018).
 * Owners (customers.export) file access and erasure requests for their shop;
 * the operator records any type and completes or rejects them. Completing
 * an erasure deletes the customer, redacts their messages and keeps the
 * suppression hash; an objection suppresses the number for this shop.
 */

const ids = z.object({ companyId: z.string().uuid(), customerId: z.string().uuid() });

export async function createDataSubjectRequestAction(input: {
  companyId: string;
  customerId: string;
  type: string;
}): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const data = ids.extend({ type: z.enum(DSR_TYPES) }).parse(input);
    const ctx = await requireContext({ permission: "customers.export", companyId: data.companyId });
    const asOperator = ctx.isPlatformAdmin;
    if (!asOperator && !canOwnerRequest(data.type)) throw new DomainError("forbidden");
    const customer = await getCustomerDetail(data.companyId, data.customerId);
    if (!customer) throw new DomainError("not_found");

    const supabase = await createSupabaseServerClient();
    const { data: row, error } = await supabase
      .from("data_subject_requests")
      .insert({
        company_id: data.companyId,
        customer_id: data.customerId,
        subject_reference: data.customerId,
        type: data.type,
        source: asOperator ? "operator" : "shop",
        requested_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error?.code === "23505") throw new DomainError("dsr_already_open");
    if (error || !row) throw new Error(`request insert failed: ${error?.code}`);

    await audit({
      action: "dsr.created",
      actorType: asOperator ? "admin" : "user",
      actorUserId: ctx.userId,
      companyId: data.companyId,
      entityType: "data_subject_request",
      entityId: row.id,
      metadata: { type: data.type, scope: "customer", customer_id: data.customerId },
    });
    refresh();
    return { id: row.id };
  });
}

export async function completeDataSubjectRequestAction(input: {
  companyId: string;
  requestId: string;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const data = z.object({ companyId: z.string().uuid(), requestId: z.string().uuid() }).parse(input);
    const ctx = await requireContext({ permission: "admin.access", companyId: data.companyId });
    const request = await getDataSubjectRequest(data.companyId, data.requestId);
    if (!request) throw new DomainError("not_found");
    if (request.status !== "open") throw new DomainError("dsr_not_open");
    const supabase = await createSupabaseServerClient();
    const counts: Record<string, number> = {};

    if (request.type === "erasure" || request.type === "objection") {
      const customer = request.customer_id ? await getCustomerDetail(data.companyId, request.customer_id) : null;
      if (request.type === "objection" && !customer) throw new DomainError("not_found");
      // Objection to direct marketing is absolute (spec §21); an erased person is
      // also kept off future imports' campaigns by the suppression hash.
      if (customer?.customer.phone) {
        if (!env.SUPPRESSION_PEPPER) throw new Error("SUPPRESSION_PEPPER missing");
        const suppressed = await suppressAddress(createServiceClient(), {
          companyId: data.companyId,
          address: customer.customer.phone,
          reason: request.type === "erasure" ? "erasure" : "manual",
          pepper: env.SUPPRESSION_PEPPER,
          now: new Date(),
        });
        counts.cancelled_messages = suppressed.cancelled;
      }
      if (request.type === "erasure" && request.customer_id) {
        const { data: erased, error } = await supabase.rpc("erase_customer", {
          p_company_id: data.companyId,
          p_customer_id: request.customer_id,
        });
        if (error) throw new Error(`erasure failed: ${error.code}`);
        const result = erased as { customers: number; messages_redacted: number; import_rows: number };
        Object.assign(counts, result);
        await audit({
          action: "customer.deleted",
          actorType: "admin",
          actorUserId: ctx.userId,
          companyId: data.companyId,
          entityType: "customer",
          entityId: request.customer_id,
          metadata: { reason: "erasure_request", request_id: request.id, ...result },
        });
      }
    }

    const { error } = await supabase
      .from("data_subject_requests")
      .update({ status: "completed", completed_at: new Date().toISOString(), handled_by: ctx.userId })
      .eq("company_id", data.companyId)
      .eq("id", request.id)
      .eq("status", "open");
    if (error) throw new Error(`request update failed: ${error.code}`);
    await audit({
      action: "dsr.completed",
      actorType: "admin",
      actorUserId: ctx.userId,
      companyId: data.companyId,
      entityType: "data_subject_request",
      entityId: request.id,
      metadata: { type: request.type, ...counts },
    });
    refresh();
    return null;
  });
}

export async function rejectDataSubjectRequestAction(input: {
  companyId: string;
  requestId: string;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const data = z.object({ companyId: z.string().uuid(), requestId: z.string().uuid() }).parse(input);
    const ctx = await requireContext({ permission: "admin.access", companyId: data.companyId });
    const request = await getDataSubjectRequest(data.companyId, data.requestId);
    if (!request) throw new DomainError("not_found");
    if (request.status !== "open") throw new DomainError("dsr_not_open");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("data_subject_requests")
      .update({ status: "rejected", completed_at: new Date().toISOString(), handled_by: ctx.userId })
      .eq("company_id", data.companyId)
      .eq("id", request.id)
      .eq("status", "open");
    if (error) throw new Error(`request update failed: ${error.code}`);
    await audit({
      action: "dsr.completed",
      actorType: "admin",
      actorUserId: ctx.userId,
      companyId: data.companyId,
      entityType: "data_subject_request",
      entityId: request.id,
      metadata: { type: request.type, outcome: "rejected" },
    });
    refresh();
    return null;
  });
}

/** The shop objects to the deletion of customers flagged by retention: kept for another year. */
export async function keepFlaggedCustomersAction(input: {
  companyId: string;
}): Promise<ActionResult<{ kept: number }>> {
  return run(async () => {
    const data = z.object({ companyId: z.string().uuid() }).parse(input);
    const ctx = await requireContext({ permission: "settings.company", companyId: data.companyId });
    const supabase = await createSupabaseServerClient();
    const { data: kept, error } = await supabase.rpc("keep_flagged_customers", { p_company_id: data.companyId });
    if (error) throw new Error(`keep failed: ${error.code}`);
    await audit({
      action: "customer.retention_kept",
      actorType: ctx.isPlatformAdmin ? "admin" : "user",
      actorUserId: ctx.userId,
      companyId: data.companyId,
      entityType: "company",
      entityId: data.companyId,
      metadata: { count: kept ?? 0 },
    });
    refresh();
    return { kept: kept ?? 0 };
  });
}
