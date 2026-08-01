import { describe, expect, it } from "vitest";

import { attendanceBatchSaveSchema } from "./index";

const staffId = "11111111-1111-4111-8111-111111111111";

function row(businessDate: string) {
  return {
    businessDate,
    attendanceId: null,
    version: null,
    checkInAt: null,
    checkOutAt: null,
    spansNextDay: false,
    workUnits: "1",
    overtimeMinutes: 0,
    note: null,
    actualLiveMinutes: 360,
    revenueAmount: "100000",
  } as const;
}

describe("attendance batch save contract", () => {
  it("accepts up to one row per business date in the selected month", () => {
    const input = {
      staffId,
      month: "2026-07",
      rows: [row("2026-07-01"), row("2026-07-02")],
    };

    expect(attendanceBatchSaveSchema.parse(input)).toEqual(input);
  });

  it("rejects duplicate dates and dates outside the selected month", () => {
    expect(
      attendanceBatchSaveSchema.safeParse({
        staffId,
        month: "2026-07",
        rows: [row("2026-07-01"), row("2026-07-01")],
      }).success,
    ).toBe(false);
    expect(
      attendanceBatchSaveSchema.safeParse({
        staffId,
        month: "2026-07",
        rows: [row("2026-08-01")],
      }).success,
    ).toBe(false);
  });

  it("requires attendance id and version to be supplied together", () => {
    expect(
      attendanceBatchSaveSchema.safeParse({
        staffId,
        month: "2026-07",
        rows: [{ ...row("2026-07-01"), attendanceId: staffId }],
      }).success,
    ).toBe(false);
    expect(
      attendanceBatchSaveSchema.safeParse({
        staffId,
        month: "2026-07",
        rows: [{ ...row("2026-07-01"), version: 1 }],
      }).success,
    ).toBe(false);
  });
});
