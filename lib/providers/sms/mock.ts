import { hashString } from "../../domain/campaigns/estimates";
import { countSmsSegments } from "../../domain/messaging/sms-segments";
import type { DeliveryEvent, MessagingProvider, OutboundMessage, SendResult } from "./types";

/**
 * Mock SMS provider (spec §16): simulates latency, ~2 % send failures and
 * ~1 % negative delivery reports. Outcomes are derived from the idempotency
 * key, so a re-run produces the same result and the demo is reproducible.
 * Nothing ever leaves the machine.
 */

export const PRICE_PER_SEGMENT_MINOR = 90; // 0,90 Kč

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const roll = (key: string, salt: string) => (hashString(`${salt}:${key}`) % 10_000) / 10_000;

export function createMockSmsProvider(opts: { latencyMs?: number } = {}): MessagingProvider {
  const latency = opts.latencyMs ?? 8;
  const accepted = new Map<string, string>(); // providerMessageId → idempotencyKey

  return {
    id: "mock",
    channel: "sms",
    capabilities: { deliveryReports: true, inbound: false, alphanumericSender: true, unicode: true },

    async send(msg: OutboundMessage): Promise<SendResult> {
      if (latency) await sleep(latency);
      if (roll(msg.idempotencyKey, "send") < 0.02) {
        return { ok: false, retryable: false, code: "MOCK_REJECTED", detail: "Simulated permanent provider rejection" };
      }
      const segments = countSmsSegments(msg.body).segments;
      const providerMessageId = `mock_${hashString(msg.idempotencyKey).toString(36)}`;
      accepted.set(providerMessageId, msg.idempotencyKey);
      return {
        ok: true,
        providerMessageId,
        segments,
        cost: { amountMinor: segments * PRICE_PER_SEGMENT_MINOR, currency: "CZK" },
      };
    },

    async pollDeliveryReports(ids: string[]): Promise<DeliveryEvent[]> {
      const now = new Date();
      return ids.map((id) => ({
        providerMessageId: id,
        status: roll(accepted.get(id) ?? id, "dlr") < 0.01 ? "undelivered" : "delivered",
        at: now,
      }));
    },
  };
}

/** Deterministic outcome helpers, shared with the seed so history looks like real sends. */
export const mockOutcome = {
  sendFails: (idempotencyKey: string) => roll(idempotencyKey, "send") < 0.02,
  undelivered: (idempotencyKey: string) => roll(idempotencyKey, "dlr") < 0.01,
};
