/**
 * Messaging provider interface (spec §16). The dispatcher and the webhook
 * route depend only on this interface; each gateway is one adapter file.
 */

export interface OutboundMessage {
  to: string;
  body: string;
  senderId: string | null;
  idempotencyKey: string;
}

export type SendResult =
  | {
      ok: true;
      providerMessageId: string;
      segments: number;
      cost?: { amountMinor: number; currency: "CZK" };
    }
  | { ok: false; retryable: boolean; code: string; detail: string };

export type DeliveryEvent = { providerMessageId: string; status: "delivered" | "undelivered"; at: Date };

/** One provider callback, normalised. `providerEventId` deduplicates retried webhooks. */
export type ProviderEvent =
  | {
      kind: "delivery";
      providerEventId: string;
      providerMessageId: string;
      status: "delivered" | "undelivered";
      payload: Record<string, unknown>;
    }
  | { kind: "inbound"; providerEventId: string; from: string; text: string; payload: Record<string, unknown> }
  | { kind: "other"; providerEventId: string; payload: Record<string, unknown> };

export interface MessagingProvider {
  readonly id: string;
  readonly channel: "sms";
  readonly capabilities: { deliveryReports: boolean; inbound: boolean; alphanumericSender: boolean; unicode: boolean };
  send(msg: OutboundMessage): Promise<SendResult>;
  /** Signature / shared secret / allowlist check for callbacks (spec §17). */
  verifyWebhook?(req: Request): Promise<boolean>;
  /** DLRs and inbound messages from a verified callback. */
  parseWebhook?(req: Request): Promise<ProviderEvent[]>;
  /** The mock reports delivery outcomes on demand instead of calling back. */
  pollDeliveryReports?(providerMessageIds: string[]): Promise<DeliveryEvent[]>;
  /** Remaining credit in SMS segments, when the provider reports one (pre-send check 4). */
  getBalanceSegments?(): Promise<number>;
}
