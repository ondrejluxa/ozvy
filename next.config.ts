import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The demo is usually presented from `pnpm dev`; keep the screen clean.
  devIndicators: false,
  // next-intl reads its request config through this alias. Setting it here
  // replaces next-intl/plugin, which would pull in a native SWC binary.
  turbopack: {
    resolveAlias: { "next-intl/config": "./i18n/request.ts" },
  },
};

export default nextConfig;
