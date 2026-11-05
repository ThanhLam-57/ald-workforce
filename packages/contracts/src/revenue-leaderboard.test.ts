import { describe, expect, it } from "vitest";

import {
  revenueLeaderboardDataSchema,
  revenueLeaderboardResponseSchema,
} from "./revenue-leaderboard";

const validData = {
  month: "2026-10",
  timezone: "Asia/Ho_Chi_Minh",
  unit: "COIN",
  generatedAt: "2026-10-28T08:30:00.000Z",
  totalEmployees: 1,
  items: [
    {
      rank: 1,
      staffCode: "NV_XT_017",
      displayName: "Hoài Live",
      branches: [{ code: "XT", name: "Cơ sở Xuân Thủy" }],
      revenue: "9223372036854775807",
    },
  ],
} as const;

describe("revenue leaderboard contract", () => {
  it("accepts the strict public response and preserves bigint revenue as a string", () => {
    const parsed = revenueLeaderboardResponseSchema.parse({ data: validData });

    expect(parsed.data.items[0]?.revenue).toBe("9223372036854775807");
  });

  it("rejects extra staff fields so private data cannot leak through the DTO", () => {
    const result = revenueLeaderboardDataSchema.safeParse({
      ...validData,
      items: [
        {
          ...validData.items[0],
          email: "private@example.com",
          phone: "0900000000",
          baseSalaryAmount: "10000000",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects negative, decimal, and numeric revenue values", () => {
    for (const revenue of ["-1", "1.5", 100]) {
      expect(
        revenueLeaderboardDataSchema.safeParse({
          ...validData,
          items: [{ ...validData.items[0], revenue }],
        }).success,
      ).toBe(false);
    }
  });
});
