import "server-only";
import { createServiceClient } from "../db/supabase/service-client";
import { env } from "../env";
import { getSmsProvider } from "../providers/sms";
import { runMessagingTick, type MessagingDeps, type TickResult } from "./messaging-core";

/** Production wiring of the messaging tick (service role, provider from env). */
export function messagingDeps(): MessagingDeps {
  return {
    db: createServiceClient(),
    provider: getSmsProvider(),
    now: () => new Date(),
    ratePerSecond: env.SMS_RATE_PER_SECOND,
    // One tick per minute: send for at most ~50 s at the provider rate.
    maxPerTick: env.SMS_RATE_PER_SECOND * 50,
    optOutBase: env.OPT_OUT_BASE_URL,
    whitelist: {
      realProvider: env.SMS_PROVIDER !== "mock",
      production: env.APP_ENV === "production",
      numbers: env.SMS_TEST_WHITELIST,
    },
  };
}

export async function runMessaging(): Promise<TickResult> {
  return runMessagingTick(messagingDeps());
}
