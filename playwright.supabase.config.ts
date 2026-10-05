import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the LOCAL Supabase stack (DATA_SOURCE=supabase): auth, MFA,
 * invitations, password reset, tenant scoping. Requires `pnpm db:start` and
 * `pnpm env:local`. Run with `pnpm test:e2e:supabase`.
 */
const PORT = 3200;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "tests/e2e-supabase",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    channel: process.env.PLAYWRIGHT_CHANNEL ?? (isCI ? undefined : "msedge"),
  },
  webServer: {
    command: `node scripts/dev/next-with-env.mjs .env.supabase.local dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    // Values set here win over .env.supabase.local.
    env: { NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`, DATA_SOURCE: "supabase" },
  },
});
