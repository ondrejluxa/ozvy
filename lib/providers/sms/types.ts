/**
 * Messaging provider interface (spec §16). The dispatcher depends only on
 * this interface; a real Czech gateway is one more adapter file in Phase 1.
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

export interface MessagingProvider {
  readonly id: string;
  readonly channel: "sms";
  readonly capabilities: { deliveryReports: boolean; inbound: boolean; alphanumericSender: boolean; unicode: boolean };
  send(msg: OutboundMessage): Promise<SendResult>;
  /**
   * Phase 0 stand-in for DLR webhooks: the mock reports delivery outcomes on
   * demand. Real adapters implement parseWebhook/verifyWebhook in Phase 1.
   */
  pollDeliveryReports?(providerMessageIds: string[]): Promise<DeliveryEvent[]>;
  /** Remaining credit in SMS segments, when the provider reports one (pre-send check 4). */
  getBalanceSegments?(): Promise<number>;
}
