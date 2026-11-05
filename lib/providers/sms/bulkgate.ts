import { countSmsSegments } from "../../domain/messaging/sms-segments";
import { secretsEqual, toE164 } from "../../domain/messaging/opt-out";
import type { MessagingProvider, OutboundMessage, ProviderEvent, SendResult } from "./types";

/**
 * BulkGate adapter (Czech gateway, spec §16), Simple Transactional API:
 * POST https://portal.bulkgate.com/api/1.0/simple/transactional (JSON).
 *
 * - Success: { data: { status: "accepted", sms_id, part_id[], number } }.
 * - Error: { type, code, error, detail } where code is the HTTP status.
 *   5xx and 429 are retryable; every documented error type is permanent.
 * - `duplicates_check: "on"` makes the gateway drop the same text to the same
 *   number within 5 minutes, a second guard behind our idempotency key.
 * - Delivery reports: BulkGate calls our URL (GET, one per message) with
 *   status (1 delivered, 2 queued at operator, 3 not delivered, 10 inbound
 *   SMS), smsID, price (credits), channel, date. There is no signature, so
 *   the URL carries a long secret (`?secret=`), compared in constant time.
 * - Prices are in credits; cost uses our CZK price per segment instead.
 *
 * Outside production the dispatcher only lets SMS_TEST_WHITELIST numbers
 * through to this adapter (lib/env/schema.ts, lib/domain/messaging/dispatch.ts).
 */

export const BULKGATE_SEND_URL = "https://portal.bulkgate.com/api/1.0/simple/transactional";

export interface BulkGateOptions {
  applicationId: string;
  applicationToken: string;
  webhookSecret: string;
  pricePerSegmentMinor: number;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const ALPHANUMERIC_SENDER = /^[A-Za-z0-9 ]{1,11}$/;

export function createBulkGateProvider(opts: BulkGateOptions): MessagingProvider {
  const http = opts.fetch ?? fetch;

  return {
    id: "bulkgate",
    channel: "sms",
    capabilities: { deliveryReports: true, inbound: true, alphanumericSender: true, unicode: true },

    async send(msg: OutboundMessage): Promise<SendResult> {
      const info = countSmsSegments(msg.body);
      const sender = msg.senderId && ALPHANUMERIC_SENDER.test(msg.senderId) ? msg.senderId : null;
      const body = {
        application_id: opts.applicationId,
        application_token: opts.applicationToken,
        number: msg.to.replace(/^\+/, ""),
        text: msg.body,
        unicode: info.encoding === "UCS-2",
        sender_id: sender ? "gText" : "gSystem",
        ...(sender ? { sender_id_value: sender } : {}),
        duplicates_check: "on",
      };
      // A network error or timeout throws: the outcome is unknown, so the
      // dispatcher sends the message to manual review instead of retrying.
      const res = await http(BULKGATE_SEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        // 10 s × a claim batch of 10 stays far below the function limit (ADR-017).
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
      let json: Record<string, unknown> = {};
      try {
        json = (await res.json()) as Record<string, unknown>;
      } catch {
        // Non-JSON body: handled by the status checks below.
      }
      const data = json.data as { status?: string; sms_id?: string } | undefined;
      if (res.ok && data?.sms_id && data.status !== "error") {
        return {
          ok: true,
          providerMessageId: data.sms_id,
          segments: info.segments,
          cost: { amountMinor: info.segments * opts.pricePerSegmentMinor, currency: "CZK" },
        };
      }
      const type = typeof json.type === "string" ? json.type : "unknown";
      const status = typeof json.code === "number" ? json.code : res.status;
      return {
        ok: false,
        retryable: status >= 500 || status === 429,
        code: `bulkgate_${type}`.slice(0, 60),
        detail: String(json.detail ?? json.error ?? `HTTP ${res.status}`).slice(0, 300),
      };
    },

    async verifyWebhook(req: Request): Promise<boolean> {
      return secretsEqual(new URL(req.url).searchParams.get("secret"), opts.webhookSecret);
    },

    async parseWebhook(req: Request): Promise<ProviderEvent[]> {
      let records: Record<string, unknown>[];
      if (req.method === "GET") {
        const params = new URL(req.url).searchParams;
        params.delete("secret");
        records = [Object.fromEntries(params.entries())];
      } else {
        const json = (await req.json()) as unknown;
        records = (Array.isArray(json) ? json : [json]) as Record<string, unknown>[];
      }
      return records.map(toEvent);
    },
  };
}

function toEvent(record: Record<string, unknown>): ProviderEvent {
  const status = String(record.status ?? "");
  const smsId = String(record.smsID ?? record.sms_id ?? "");
  const payload = { ...record };
  if ((status === "1" || status === "3") && smsId) {
    return {
      kind: "delivery",
      providerEventId: `${smsId}:${status}`,
      providerMessageId: smsId,
      status: status === "1" ? "delivered" : "undelivered",
      payload,
    };
  }
  if (status === "10") {
    const from = toE164(String(record.from ?? "")) ?? "";
    const text = String(record.message ?? "");
    return {
      kind: "inbound",
      providerEventId: `in:${from}:${record.date ?? ""}:${text.slice(0, 40)}`,
      from,
      text,
      payload,
    };
  }
  // 2 = still queued at the operator (a final report follows), 13 = read (Viber).
  return { kind: "other", providerEventId: `${smsId || "x"}:${status}:${record.date ?? ""}`, payload };
}
