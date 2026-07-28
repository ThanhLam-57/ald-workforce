import { describe, expect, it } from "vitest";

import { resolveAppUrl, resolveTrustedOrigins } from "./app-url";

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...values };
}

describe("resolveAppUrl", () => {
  it("uses an explicit auth URL when present", () => {
    expect(
      resolveAppUrl(env({
        BETTER_AUTH_URL: "https://app.test",
        RAILWAY_PUBLIC_DOMAIN: "railway.test",
      })),
    ).toBe("https://app.test");
  });

  it("uses the Railway public domain without manual variables", () => {
    expect(
      resolveAppUrl(env({
        NODE_ENV: "production",
        RAILWAY_PUBLIC_DOMAIN: "ald-workforce-production.up.railway.app",
      })),
    ).toBe("https://ald-workforce-production.up.railway.app");
  });

  it("ignores imported localhost URLs on Railway", () => {
    expect(
      resolveAppUrl(env({
        NODE_ENV: "production",
        BETTER_AUTH_URL: "http://localhost:3000",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        RAILWAY_PUBLIC_DOMAIN: "ald-workforce-production.up.railway.app",
      })),
    ).toBe("https://ald-workforce-production.up.railway.app");
  });
});

describe("resolveTrustedOrigins", () => {
  it("deduplicates app URL and trusted origins", () => {
    expect(
      resolveTrustedOrigins("https://app.test", env({
        NEXT_PUBLIC_APP_URL: "https://app.test",
        TRUSTED_ORIGINS: "https://admin.test,https://app.test",
      })),
    ).toEqual(["https://app.test", "https://admin.test"]);
  });
});
