import type { Instrumentation } from "next";

/**
 * Server error reporting (spec §25): Sentry only when SENTRY_DSN is set.
 * Nothing collected by default, no tracing, every event scrubbed of phone numbers and
 * e-mails before it is sent (lib/domain/pii.ts).
 */
export async function register() {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  const { scrubDeep } = await import("./lib/domain/pii");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.APP_ENV ?? "local",
    // No user info, cookies, headers, bodies, query strings or AI content.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
    },
    tracesSampleRate: 0,
    beforeSend: (event) => scrubDeep(event),
    beforeBreadcrumb: (crumb) => scrubDeep(crumb),
  });
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
