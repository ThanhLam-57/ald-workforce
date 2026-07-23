import { describe, expect, it } from "vitest";

import { enumerateBusinessMonth, summarizeMonthlyMetrics, weekOfMonth } from "./index";

describe("branch monthly overview totals", () => {
  it("cộng BIGINT, phút và Decimal mà không dùng floating point", () => {
    expect(
      summarizeMonthlyMetrics([
        {
          revenueAmount: "9007199254740993",
          workUnits: "0.5",
          actualLiveMinutes: 120,
          overtimeMinutes: 15,
          penaltyAmount: "50000",
        },
        {
          revenueAmount: "7",
          workUnits: "1.25",
          actualLiveMinutes: 90,
          overtimeMinutes: 0,
          penaltyAmount: "100000",
        },
      ]),
    ).toEqual({
      revenueAmount: "9007199254741000",
      workUnits: "1.75",
      actualLiveMinutes: 210,
      overtimeMinutes: 15,
      penaltyAmount: "150000",
    });
  });

  it.each([
    ["2026-02-28", 4],
    ["2026-04-30", 5],
    ["2026-07-31", 5],
  ])("xác định tuần cho %s", (date, expected) => {
    expect(weekOfMonth(date)).toBe(expected);
  });

  it.each([
    ["2026-02", 28],
    ["2028-02", 29],
    ["2026-04", 30],
    ["2026-07", 31],
  ])("sinh đủ cột ngày cho tháng %s", (month, expected) => {
    expect(enumerateBusinessMonth(month)).toHaveLength(expected);
  });
});
