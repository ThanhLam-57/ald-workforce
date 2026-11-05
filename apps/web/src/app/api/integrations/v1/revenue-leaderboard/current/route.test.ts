import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashRevenueLeaderboardToken } from "../../../../../../server/revenue-leaderboard-auth";
import {
  getCurrentRevenueLeaderboard,
  RevenueLeaderboardUnavailableError,
} from "../../../../../../server/revenue-leaderboard-service";

import { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } from "./route";

vi.mock("../../../../../../server/revenue-leaderboard-service", () => {
  return {
    getCurrentRevenueLeaderboard: vi.fn(),
    RevenueLeaderboardUnavailableError: class RevenueLeaderboardUnavailableError extends Error {
      readonly reason: string;

      constructor(reason: string) {
        super("Revenue leaderboard is unavailable.");
        this.name = "RevenueLeaderboardUnavailableError";
        this.reason = reason;
      }
    },
  };
});

const companyId = "8f3ac2ee-bfab-4fca-93f2-ce323a494789";
const token = "integration-test-token-at-least-32-characters";
const requestId = "leaderboard-route-test";
const mockedGetCurrentRevenueLeaderboard = vi.mocked(getCurrentRevenueLeaderboard);

function request(path = "", authorization: string | null = `Bearer ${token}`): Request {
  const headers = new Headers({ "x-request-id": requestId });
  if (authorization !== null) headers.set("authorization", authorization);
  return new Request(`http://localhost/api/integrations/v1/revenue-leaderboard/current${path}`, {
    headers,
  });
}

beforeEach(() => {
  vi.stubEnv("REVENUE_LEADERBOARD_ENABLED", "true");
  vi.stubEnv("REVENUE_LEADERBOARD_COMPANY_ID", companyId);
  vi.stubEnv("REVENUE_LEADERBOARD_TOKEN_SHA256", hashRevenueLeaderboardToken(token));
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  mockedGetCurrentRevenueLeaderboard.mockReset();
  mockedGetCurrentRevenueLeaderboard.mockResolvedValue({
    month: "2026-10",
    timezone: "Asia/Ho_Chi_Minh",
    unit: "COIN",
    generatedAt: "2026-10-28T08:30:00.000Z",
    totalEmployees: 1,
    items: [
      {
        rank: 1,
        staffCode: "A01",
        displayName: "An Live",
        branches: [{ code: "A", name: "Cơ sở A" }],
        revenue: "100",
      },
    ],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET revenue leaderboard integration", () => {
  it("fails closed when the integration is disabled or misconfigured", async () => {
    vi.stubEnv("REVENUE_LEADERBOARD_ENABLED", "false");

    const disabled = await GET(request());

    expect(disabled.status).toBe(503);
    await expect(disabled.json()).resolves.toEqual({
      error: {
        code: "INTEGRATION_UNAVAILABLE",
        message: "Tích hợp hiện không khả dụng.",
      },
    });

    vi.stubEnv("REVENUE_LEADERBOARD_ENABLED", "true");
    vi.stubEnv("REVENUE_LEADERBOARD_TOKEN_SHA256", "not-a-sha256-hash");
    const misconfigured = await GET(request());

    expect(misconfigured.status).toBe(503);
    await expect(misconfigured.json()).resolves.toEqual({
      error: {
        code: "INTEGRATION_UNAVAILABLE",
        message: "Tích hợp hiện không khả dụng.",
      },
    });
    expect(mockedGetCurrentRevenueLeaderboard).not.toHaveBeenCalled();
  });

  it("returns the same 401 body for missing and wrong credentials", async () => {
    const missing = await GET(request("", null));
    const wrong = await GET(request("", "Bearer wrong-token"));

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await missing.json()).toEqual(await wrong.json());
    expect(mockedGetCurrentRevenueLeaderboard).not.toHaveBeenCalled();
  });

  it("rejects every query parameter without calling the data service", async () => {
    for (const query of [
      "?companyId=another-company",
      "?branchId=another-branch",
      "?month=2026-09",
    ]) {
      const response = await GET(request(query));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "UNSUPPORTED_QUERY" },
      });
    }
    expect(mockedGetCurrentRevenueLeaderboard).not.toHaveBeenCalled();
  });

  it("returns a strict allow-listed response with no-store integration headers", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(mockedGetCurrentRevenueLeaderboard).toHaveBeenCalledWith(companyId);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        unit: "COIN",
        items: [{ staffCode: "A01", revenue: "100" }],
      },
    });
  });

  it("returns a generic 500 without logging service errors or response data", async () => {
    mockedGetCurrentRevenueLeaderboard.mockRejectedValue(
      new Error("database-password=do-not-expose"),
    );

    const response = await GET(request());
    const logs = vi.mocked(console.info).mock.calls.flat().join(" ");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Hệ thống đang gặp sự cố. Vui lòng thử lại.",
      },
    });
    expect(logs).not.toContain("database-password");
    expect(logs).not.toContain(token);
    expect(logs).not.toContain("A01");
    expect(logs).toContain(requestId);
  });

  it("returns a generic 503 when the data service fails closed", async () => {
    mockedGetCurrentRevenueLeaderboard.mockRejectedValue(
      new RevenueLeaderboardUnavailableError("INCONSISTENT_METRIC_CONFIGURATION"),
    );

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTEGRATION_UNAVAILABLE",
        message: "Tích hợp hiện không khả dụng.",
      },
    });
  });
});

describe("unsupported revenue leaderboard methods", () => {
  it("returns 405 for every method other than GET, including HEAD and OPTIONS", async () => {
    for (const handler of [HEAD, POST, PUT, PATCH, DELETE, OPTIONS]) {
      const response = handler(request());
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET");
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "METHOD_NOT_ALLOWED" },
      });
    }
  });
});
