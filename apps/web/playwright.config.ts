import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";
const webServerPort = new URL(baseURL).port || "3000";
const webServerCommand =
  process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ?? `pnpm exec next dev -p ${webServerPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Các spec dùng chung seed database và cố ý kiểm tra mutation liên module.
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: webServerCommand,
    url: `${baseURL}/api/health/live`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      testIgnore: /.*\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.PLAYWRIGHT_SKIP_AUTH_STATE === "1"
          ? {}
          : { storageState: "test-results/.auth/gm.json" }),
      },
    },
  ],
});
