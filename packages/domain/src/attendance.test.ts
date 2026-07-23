import { describe, expect, it } from "vitest";

import {
  DomainError,
  enumerateBusinessMonth,
  toBusinessDateString,
  validateAttendanceValues,
} from "./index";

describe("ngày nghiệp vụ Asia/Ho_Chi_Minh", () => {
  it.each([
    ["2026-07-22T16:59:59.999Z", "2026-07-22"],
    ["2026-07-22T17:00:00.000Z", "2026-07-23"],
    ["2026-12-31T17:30:00.000Z", "2027-01-01"],
  ])("đổi %s thành %s", (timestamp, expected) => {
    expect(toBusinessDateString(new Date(timestamp))).toBe(expected);
  });

  it("sinh đủ ngày và thứ cho tháng nhuận", () => {
    const days = enumerateBusinessMonth("2028-02");
    expect(days).toHaveLength(29);
    expect(days[0]).toEqual({ businessDate: "2028-02-01", dayOfWeek: 2 });
    expect(days[28]?.businessDate).toBe("2028-02-29");
  });
});

describe("validation attendance", () => {
  it("chấp nhận ca qua ngày khi timestamp và cờ nhất quán", () => {
    expect(() =>
      validateAttendanceValues({
        businessDate: "2026-07-23",
        checkInAt: "2026-07-23T23:00:00+07:00",
        checkOutAt: "2026-07-24T02:00:00+07:00",
        spansNextDay: true,
        workUnits: "1.25",
        overtimeMinutes: 30,
        actualLiveMinutes: 120,
        revenueAmount: "1500000",
      }),
    ).not.toThrow();
  });

  it("chặn check-out qua ngày khi chưa đánh dấu", () => {
    expect(() =>
      validateAttendanceValues({
        businessDate: "2026-07-23",
        checkInAt: "2026-07-23T23:00:00+07:00",
        checkOutAt: "2026-07-24T02:00:00+07:00",
        spansNextDay: false,
      }),
    ).toThrowError(DomainError);
  });

  it("chặn check-out trước check-in dù có đánh dấu qua ngày sai timestamp", () => {
    expect(() =>
      validateAttendanceValues({
        businessDate: "2026-07-23",
        checkInAt: "2026-07-23T23:00:00+07:00",
        checkOutAt: "2026-07-23T02:00:00+07:00",
        spansNextDay: true,
      }),
    ).toThrowError(/check-out phải sau check-in/);
  });

  it.each([
    [{ businessDate: "2026-07-23", workUnits: "-0.5" }],
    [{ businessDate: "2026-07-23", overtimeMinutes: -1 }],
    [{ businessDate: "2026-07-23", actualLiveMinutes: -1 }],
    [{ businessDate: "2026-07-23", revenueAmount: "-1" }],
  ])("chặn giá trị âm: %o", (input) => {
    expect(() => validateAttendanceValues(input)).toThrowError(DomainError);
  });
});
