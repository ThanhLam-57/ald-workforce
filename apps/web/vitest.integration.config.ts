import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    sequence: {
      concurrent: false,
    },
    testTimeout: 20_000,
  },
});
