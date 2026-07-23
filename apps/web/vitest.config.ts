import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/*.integration.test.ts", "**/e2e/**", "**/node_modules/**"],
  },
});
