import { env } from "../../env";
import { createBulkGateProvider } from "./bulkgate";
import { createMockSmsProvider } from "./mock";
import type { MessagingProvider } from "./types";

let provider: MessagingProvider | null = null;

/**
 * Resolves the SMS adapter from SMS_PROVIDER (spec §16). lib/env/schema.ts
 * refuses a real provider without credentials and a webhook secret, and
 * outside production without SMS_TEST_WHITELIST; production refuses the mock.
 */
export function getSmsProvider(): MessagingProvider {
  if (provider) return provider;
  if (env.SMS_PROVIDER === "mock") {
    provider = createMockSmsProvider({ webhookSecret: env.SMS_WEBHOOK_SECRET });
  } else if (env.SMS_PROVIDER === "bulkgate") {
    provider = createBulkGateProvider({
      applicationId: env.SMS_PROVIDER_API_KEY!,
      applicationToken: env.SMS_PROVIDER_API_SECRET!,
      webhookSecret: env.SMS_WEBHOOK_SECRET!,
      pricePerSegmentMinor: env.SMS_PRICE_PER_SEGMENT_MINOR,
    });
  } else {
    throw new Error(`Unsupported SMS provider: ${env.SMS_PROVIDER}`);
  }
  return provider;
}
