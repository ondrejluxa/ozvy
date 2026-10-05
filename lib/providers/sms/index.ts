import { env } from "../../env";
import { createMockSmsProvider } from "./mock";
import type { MessagingProvider } from "./types";

let provider: MessagingProvider | null = null;

/**
 * Resolves the SMS adapter. Phase 0 has only the mock; lib/env.ts already
 * refuses any other provider outside production.
 */
export function getSmsProvider(): MessagingProvider {
  if (env.SMS_PROVIDER !== "mock") throw new Error(`Unsupported SMS provider: ${env.SMS_PROVIDER}`);
  provider ??= createMockSmsProvider();
  return provider;
}
