import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["lib/domain/**/*.ts"],
      reporter: ["text-summary", "text"],
      // Spec §30: 90 %+ lines in lib/domain.
      thresholds: { lines: 90 },
    },
  },
});
