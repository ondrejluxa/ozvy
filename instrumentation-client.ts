/**
 * Browser error reporting (spec §25): Sentry only when NEXT_PUBLIC_SENTRY_DSN
 * is set, without session replay, tracing or collected request data; events scrubbed.
 */
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  void Promise.all([import("@sentry/nextjs"), import("./lib/domain/pii")]).then(([Sentry, { scrubDeep }]) => {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
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
  });
}
