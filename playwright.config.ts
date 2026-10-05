import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests (spec §30): the core demo loop on desktop plus a 390 px mobile
 * pass. Locally they use the Microsoft Edge already installed on Windows (no
 * browser download); CI installs Playwright's Chromium.
 */
const PORT = 3100;
const isCI = !!process.env.CI;
const channel = process.env.PLAYWRIGHT_CHANNEL ?? (isCI ? undefined : "msedge");

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,
  timeout: 90_000,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], channel, viewport: { width: 1280, height: 800 } },
      testIgnore: /mobile/,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], channel, viewport: { width: 390, height: 844 } },
      testMatch: /mobile/,
    },
  ],
  webServer: {
    // CI tests the production build; locally the dev server is enough.
    command: isCI
      ? `node node_modules/next/dist/bin/next start -p ${PORT}`
      : `node node_modules/next/dist/bin/next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/admin`,
    reuseExistingServer: !isCI,
    timeout: 180_000,
    env: { DATA_SOURCE: "demo" },
  },
});
