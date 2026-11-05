import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../db/types.gen";
import { isOptOutKeyword, suppressionHash } from "../domain/messaging/opt-out";
import type { ProviderEvent } from "../providers/sms/types";

/**
 * Opt-out and provider events (spec §16 steps 5–6, "Opt-out"). Shared by the
 * public /o/[token] page, the webhook route and the messaging tick; all take
 * the service-role client and set company_id themselves.
 */

type Db = SupabaseClient<Database>;
type SuppressionReason = Database["public"]["Tables"]["suppression_list"]["Insert"]["reason"];

/**
 * Suppresses one number for one company (per-company: each shop is its own
 * controller): hash on the suppression list, customers with that number
 * opted out, their running enrollments stopped, queued messages cancelled.
 */
export async function suppressAddress(
  db: Db,
  input: { companyId: string; address: string; reason: SuppressionReason; pepper: string; now: Date },
): Promise<{ customers: number; cancelled: number }> {
  const { companyId, address } = input;
  const { error } = await db.from("suppression_list").upsert(
    {
      company_id: companyId,
      channel: "sms",
      address_hash: suppressionHash(address, input.pepper),
      reason: input.reason,
    },
    { onConflict: "company_id,channel,address_hash", ignoreDuplicates: true },
  );
  if (error) throw new Error(`suppression insert failed: ${error.code}`);

  const { data: customers } = await db
    .from("customers")
    .update({ lifecycle_status: "opted_out" })
    .eq("company_id", companyId)
    .eq("phone_e164", address)
    .select("id");
  const customerIds = (customers ?? []).map((c) => c.id);
  if (customerIds.length) {
    await db
      .from("campaign_enrollments")
      .update({ stage: "opted_out", stopped_reason: "opted_out" })
      .eq("company_id", companyId)
      .in("customer_id", customerIds)
      .eq("stage", "contacted");
  }
  const { data: cancelled } = await db
    .from("messages")
    .update({ status: "cancelled", error_code: "opted_out" })
    .eq("company_id", companyId)
    .eq("to_address", address)
    .eq("status", "queued")
    .select("id");

  await db.from("audit_logs").insert({
    company_id: companyId,
    actor_type: "system",
    action: "customer.opted_out",
    entity_type: "customer",
    entity_id: customerIds[0] ?? null,
    metadata: { reason: input.reason, customers: customerIds.length } as NonNullable<Json>,
  });
  return { customers: customerIds.length, cancelled: (cancelled ?? []).length };
}

// ---------- opt-out link ----------

export interface OptOutTarget {
  shopName: string;
  alreadyOptedOut: boolean;
}

async function messageByToken(db: Db, token: string) {
  if (!/^[A-Za-z0-9]{8}$/.test(token)) return null;
  const { data } = await db
    .from("messages")
    .select("id, company_id, to_address, opted_out_at, companies(name, settings)")
    .eq("opt_out_token", token)
    .maybeSingle();
  return data;
}

/** What the opt-out page shows: the shop's name only. */
export async function optOutTarget(db: Db, token: string): Promise<OptOutTarget | null> {
  const m = await messageByToken(db, token);
  if (!m) return null;
  const company = m.companies as { name: string; settings: Json } | null;
  const settings = (company?.settings ?? {}) as { message_shop_name?: string | null };
  return { shopName: settings.message_shop_name || company?.name || "", alreadyOptedOut: Boolean(m.opted_out_at) };
}

/** The POST behind the button. Idempotent: a second click changes nothing. */
export async function optOutByToken(
  db: Db,
  input: { token: string; pepper: string; now: Date },
): Promise<"done" | "already" | "not_found"> {
  const m = await messageByToken(db, input.token);
  if (!m) return "not_found";
  if (m.opted_out_at) return "already";
  await suppressAddress(db, {
    companyId: m.company_id,
    address: m.to_address,
    reason: "opt_out_link",
    pepper: input.pepper,
    now: input.now,
  });
  await db.from("messages").update({ opted_out_at: input.now.toISOString() }).eq("id", m.id);
  return "done";
}

// ---------- provider events ----------

/** Stores callbacks raw and deduplicated (unique provider_id + provider_event_id). */
export async function storeEvents(db: Db, providerId: string, events: ProviderEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  const rows = events.map((e) => ({
    provider_id: providerId,
    provider_event_id: e.providerEventId.slice(0, 200),
    type: e.kind === "delivery" ? e.status : e.kind === "inbound" ? "inbound" : "other",
    // Normalised fields next to the raw payload, so processing is provider-independent.
    payload: {
      ...e.payload,
      ...(e.kind === "delivery" ? { _messageId: e.providerMessageId } : {}),
      ...(e.kind === "inbound" ? { _from: e.from, _text: e.text } : {}),
    } as NonNullable<Json>,
  }));
  const { data, error } = await db
    .from("message_events")
    .upsert(rows, { onConflict: "provider_id,provider_event_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`event insert failed: ${error.code}`);
  return (data ?? []).length;
}

export interface EventResult {
  delivered: number;
  undelivered: number;
  optOuts: number;
  ignored: number;
}

/**
 * Applies stored events: DLRs update the message (sent → delivered /
 * undelivered), STOP / ODHLASIT / NE replies suppress the number for the
 * shop that last texted it. Other inbound text is kept but not acted on
 * (two-way SMS is Phase 2).
 */
export async function processEvents(db: Db, opts: { pepper: string; now: Date; limit?: number }): Promise<EventResult> {
  const out: EventResult = { delivered: 0, undelivered: 0, optOuts: 0, ignored: 0 };
  const { data: events, error } = await db
    .from("message_events")
    .select("id, provider_id, type, payload")
    .is("processed_at", null)
    .order("received_at")
    .limit(opts.limit ?? 1000);
  if (error) throw new Error(`event read failed: ${error.code}`);

  for (const e of events ?? []) {
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    let companyId: string | null = null;
    let messageId: string | null = null;

    if (e.type === "delivered" || e.type === "undelivered") {
      const { data: m } = await db
        .from("messages")
        .select("id, company_id, status")
        .eq("provider_id", e.provider_id)
        .eq("provider_message_id", String(payload._messageId ?? ""))
        .maybeSingle();
      if (m) {
        companyId = m.company_id;
        messageId = m.id;
        // Only reports for messages we handed over count; a late "delivered"
        // also settles a message waiting in manual review.
        if (["sent", "needs_review", "expired", "delivered", "undelivered"].includes(m.status)) {
          await db
            .from("messages")
            .update(
              e.type === "delivered"
                ? { status: "delivered", delivered_at: opts.now.toISOString() }
                : { status: "undelivered", failed_at: opts.now.toISOString(), error_code: "undelivered" },
            )
            .eq("id", m.id);
          if (e.type === "delivered") out.delivered++;
          else out.undelivered++;
        } else out.ignored++;
      } else out.ignored++;
    } else if (e.type === "inbound") {
      const e164 = String(payload._from ?? "");
      const text = String(payload._text ?? "");
      if (e164 && isOptOutKeyword(text)) {
        const { data: last } = await db
          .from("messages")
          .select("company_id")
          .eq("to_address", e164)
          .not("sent_at", "is", null)
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (last) {
          companyId = last.company_id;
          await suppressAddress(db, {
            companyId,
            address: e164,
            reason: "keyword",
            pepper: opts.pepper,
            now: opts.now,
          });
          out.optOuts++;
        } else out.ignored++;
      } else out.ignored++;
    } else out.ignored++;

    await db
      .from("message_events")
      .update({ processed_at: opts.now.toISOString(), company_id: companyId, message_id: messageId })
      .eq("id", e.id);
  }
  return out;
}

/** Messages without a delivery report 72 h after sending are expired (spec §16). */
export async function expireMessages(db: Db, providerId: string, now: Date): Promise<number> {
  const { data } = await db
    .from("messages")
    .update({ status: "expired" })
    .eq("provider_id", providerId)
    .eq("status", "sent")
    .lt("sent_at", new Date(now.getTime() - 72 * 3_600_000).toISOString())
    .select("id");
  return (data ?? []).length;
}
