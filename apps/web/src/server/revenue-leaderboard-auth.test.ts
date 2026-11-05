import { describe, expect, it } from "vitest";

import {
  hashRevenueLeaderboardToken,
  isRevenueLeaderboardAuthorized,
  readRevenueLeaderboardConfig,
} from "./revenue-leaderboard-auth";

const companyId = "8f3ac2ee-bfab-4fca-93f2-ce323a494789";
const token = "a-secure-url-safe-token_1234567890";
const tokenSha256 = hashRevenueLeaderboardToken(token);

describe("revenue leaderboard integration configuration", () => {
  it("requires an explicit enable flag, a UUID company, and a SHA-256 token hash", () => {
    expect(
      readRevenueLeaderboardConfig({
        REVENUE_LEADERBOARD_ENABLED: "true",
        REVENUE_LEADERBOARD_COMPANY_ID: companyId,
        REVENUE_LEADERBOARD_TOKEN_SHA256: tokenSha256.toUpperCase(),
      }),
    ).toEqual({ companyId, tokenSha256 });

    for (const environment of [
      {},
      { REVENUE_LEADERBOARD_ENABLED: "false" },
      {
        REVENUE_LEADERBOARD_ENABLED: "true",
        REVENUE_LEADERBOARD_COMPANY_ID: "not-a-uuid",
        REVENUE_LEADERBOARD_TOKEN_SHA256: tokenSha256,
      },
      {
        REVENUE_LEADERBOARD_ENABLED: "true",
        REVENUE_LEADERBOARD_COMPANY_ID: companyId,
        REVENUE_LEADERBOARD_TOKEN_SHA256: "plain-text-token",
      },
    ]) {
      expect(readRevenueLeaderboardConfig(environment)).toBeNull();
    }
  });
});

describe("revenue leaderboard bearer authentication", () => {
  it("accepts only the exact bearer token whose SHA-256 hash is configured", () => {
    expect(isRevenueLeaderboardAuthorized(`Bearer ${token}`, tokenSha256)).toBe(true);
  });

  it("rejects missing, malformed, wrong, and oversized credentials uniformly", () => {
    for (const authorization of [
      null,
      "",
      `bearer ${token}`,
      `Bearer  ${token}`,
      "Bearer short-token",
      "Bearer wrong-token",
      `Bearer ${"x".repeat(257)}`,
      "x".repeat(513),
    ]) {
      expect(isRevenueLeaderboardAuthorized(authorization, tokenSha256)).toBe(false);
    }
  });

  it("fails closed when the configured digest is invalid", () => {
    expect(isRevenueLeaderboardAuthorized(`Bearer ${token}`, "not-a-sha256-digest")).toBe(false);
  });
});
