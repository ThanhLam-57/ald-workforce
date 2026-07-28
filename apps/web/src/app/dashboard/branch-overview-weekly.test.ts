import type { BranchOverviewDayDto } from "@ald/contracts";
import { describe, expect, it } from "vitest";

import { groupBranchOverviewWeeks, overviewTotals } from "./branch-overview-weekly";

function day(
  businessDate: string,
  weekOfMonth: number,
  values: Partial<BranchOverviewDayDto> = {},
): BranchOverviewDayDto {
  return {
    businessDate,
    dayOfWeek: new Date(`${businessDate}T00:00:00.000Z`).getUTCDay(),
    weekOfMonth,
    attendanceId: null,
    version: null,
    archivedAt: null,
    status: null,
    revenueAmount: "0",
    actualLiveMinutes: 0,
    workUnits: "0",
    overtimeMinutes: 0,
    penaltyAmount: "0",
    ...values,
  };
}

describe("branch overview weekly projection", () => {
  it("giữ đúng thứ tự tuần và không tạo ngày ngoài calendar", () => {
    const calendar = [
      day("2026-07-01", 1),
      day("2026-07-05", 1),
      day("2026-07-06", 2),
      day("2026-07-12", 2),
      day("2026-07-27", 5),
      day("2026-07-31", 5),
    ];

    expect(groupBranchOverviewWeeks(calendar)).toEqual([
      {
        weekNo: 1,
        from: "2026-07-01",
        to: "2026-07-05",
        days: calendar.slice(0, 2),
      },
      {
        weekNo: 2,
        from: "2026-07-06",
        to: "2026-07-12",
        days: calendar.slice(2, 4),
      },
      {
        weekNo: 5,
        from: "2026-07-27",
        to: "2026-07-31",
        days: calendar.slice(4),
      },
    ]);
  });

  it("tổng tuần cộng lại bằng tổng tháng mà không làm tròn số công bằng float", () => {
    const firstWeek = [
      day("2026-07-01", 1, {
        revenueAmount: "100000",
        workUnits: "0.5",
        actualLiveMinutes: 120,
        overtimeMinutes: 15,
        penaltyAmount: "20000",
      }),
      day("2026-07-02", 1, {
        revenueAmount: "200000",
        workUnits: "1",
        actualLiveMinutes: 180,
        overtimeMinutes: 0,
        penaltyAmount: "0",
      }),
    ];
    const secondWeek = [
      day("2026-07-06", 2, {
        revenueAmount: "300000",
        workUnits: "0.25",
        actualLiveMinutes: 60,
        overtimeMinutes: 30,
        penaltyAmount: "50000",
      }),
    ];
    const firstTotals = overviewTotals(firstWeek);
    const secondTotals = overviewTotals(secondWeek);
    const monthTotals = overviewTotals([...firstWeek, ...secondWeek]);

    expect(firstTotals).toEqual({
      revenueAmount: "300000",
      workUnits: "1.5",
      actualLiveMinutes: 300,
      overtimeMinutes: 15,
      penaltyAmount: "20000",
    });
    expect(overviewTotals([firstTotals, secondTotals])).toEqual(monthTotals);
  });
});
