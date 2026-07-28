import { describe, expect, it } from "vitest";

import {
  businessWeekOfMonth,
  enumerateBusinessMonth,
  enumerateBusinessWeeks,
  summarizeMonthlyMetrics,
} from "./index";

describe("branch monthly overview totals", () => {
  it("cộng BIGINT, phút và Decimal mà không dùng floating point cho tiền", () => {
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

  it("chia tháng 07/2026 thành tuần Thứ Hai–Chủ nhật và cắt ngày ngoài tháng", () => {
    const weeks = enumerateBusinessWeeks("2026-07");

    expect(weeks).toHaveLength(5);
    expect(weeks[0]?.dates).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
    ]);
    expect(weeks[4]?.dates).toEqual([
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
    ]);
    expect(weeks.flatMap((week) => week.dates).every((date) => date.startsWith("2026-07"))).toBe(
      true,
    );
    expect(businessWeekOfMonth("2026-07-31")).toBe(5);
  });

  it("hỗ trợ tháng có tuần lịch thứ 6", () => {
    const weeks = enumerateBusinessWeeks("2026-08");

    expect(weeks).toHaveLength(6);
    expect(weeks[5]?.dates).toEqual(["2026-08-31"]);
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
