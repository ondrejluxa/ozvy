"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireContext } from "../auth/context";
import { audit } from "../audit";
import { getCustomerDetail } from "../db/supabase/customers";
import { createSupabaseServerClient } from "../db/supabase/server-client";
import { changedFields } from "../domain/company-profile";
import { parseCustomerContact } from "../domain/customer-search";

/**
 * customers.edit_contact (spec §20): owners, managers and the operator may
 * correct a customer's name, phone, e-mail and notes. Everything else is
 * protected by app.guard_customer_update in the database.
 */

export interface ContactFormState {
  fieldErrors?: Record<string, string>;
  error?: string;
  done?: boolean;
  values?: Record<string, string>;
}

const FIELDS = ["first_name", "last_name", "phone", "email", "notes"] as const;

export async function updateCustomerContactAction(_prev: ContactFormState, form: FormData): Promise<ContactFormState> {
  const ids = z
    .object({ companyId: z.string().uuid(), customerId: z.string().uuid() })
    .parse({ companyId: form.get("companyId"), customerId: form.get("customerId") });
  const ctx = await requireContext({ permission: "customers.edit_contact", companyId: ids.companyId });
  const values = Object.fromEntries(FIELDS.map((f) => [f, String(form.get(f) ?? "").slice(0, 2000)]));
  const parsed = parseCustomerContact(values as Record<(typeof FIELDS)[number], string>);
  if (!parsed.success) return { fieldErrors: parsed.fieldErrors, values };

  const before = await getCustomerDetail(ids.companyId, ids.customerId);
  if (!before) return { error: "not_found", values };
  const previous = {
    first_name: before.customer.firstName,
    last_name: before.customer.lastName,
    phone_e164: before.customer.phone,
    phone_type: before.customer.phoneType,
    email: before.customer.email,
    notes: before.customer.notes,
  };
  const fields = changedFields(previous, parsed.values);
  if (fields.length === 0) return { done: true, values };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("customers")
    .update(parsed.values)
    .eq("company_id", ids.companyId)
    .eq("id", ids.customerId)
    .select("id");
  if (error || !data?.length) return { error: "save_failed", values };

  await audit({
    action: "customer.updated",
    actorType: ctx.isPlatformAdmin ? "admin" : "user",
    actorUserId: ctx.userId,
    companyId: ids.companyId,
    entityType: "customer",
    entityId: ids.customerId,
    metadata: { fields: fields.join(",") },
  });
  refresh();
  return { done: true, values };
}
