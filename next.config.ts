import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";

function origin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Security headers (spec §22): CSP limited to our own origin plus Supabase
 * (browser uploads go straight to Storage via signed URLs) and Sentry when
 * configured; no framing; strict referrer; minimal permissions. Next.js
 * inlines its bootstrap scripts, hence 'unsafe-inline'; development also
 * needs 'unsafe-eval' for React's dev tooling.
 */
const connectSrc = ["'self'", origin(supabaseUrl), origin(sentryDsn)]
  .concat(isDev ? ["ws:", "http://localhost:*", "http://127.0.0.1:*"] : [])
  .filter(Boolean)
  .join(" ");

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src ${connectSrc}`,
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The demo is usually presented from `pnpm dev`; keep the screen clean.
  devIndicators: false,
  // next-intl reads its request config through this alias. Setting it here
  // replaces next-intl/plugin, which would pull in a native SWC binary.
  turbopack: {
    resolveAlias: { "next-intl/config": "./i18n/request.ts" },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The opt-out page never sends a referrer (the token is in the URL).
      { source: "/o/:token", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default nextConfig;
