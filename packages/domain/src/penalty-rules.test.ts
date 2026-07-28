import { describe, expect, it } from "vitest";

import {
  calculatePenaltyOccurrence,
  comparePenaltyItems,
  effectiveIntervalsOverlap,
  effectiveRuleStatus,
  isDateInEffectiveInterval,
  penaltyCountingPeriod,
  sumPenaltyAmounts,
} from "./index";

describe("effective interval [from, to)", () => {
  it.each([
    ["2026-07-31", false],
    ["2026-08-01", true],
    ["2026-08-31", true],
    ["2026-09-01", false],
  ])("đánh giá boundary %s", (date, expected) => {
    expect(isDateInEffectiveInterval(date, "2026-08-01", "2026-09-01")).toBe(expected);
  });

  it("tính lifecycle theo ngày thay vì tin status lưu cũ", () => {
    expect(effectiveRuleStatus("SCHEDULED", "2026-07-31", "2026-08-01", null)).toBe("SCHEDULED");
    expect(effectiveRuleStatus("SCHEDULED", "2026-08-01", "2026-08-01", null)).toBe("ACTIVE");
    expect(effectiveRuleStatus("ACTIVE", "2026-09-01", "2026-08-01", "2026-09-01")).toBe("RETIRED");
  });

  it("cho phép hai interval chạm biên nhưng chặn giao nhau", () => {
    expect(effectiveIntervalsOverlap("2026-08-01", "2026-09-01", "2026-09-01", null)).toBe(false);
    expect(effectiveIntervalsOverlap("2026-08-01", "2026-09-01", "2026-08-31", null)).toBe(true);
  });
});

describe("penalty snapshot helpers", () => {
  it("cộng tiền bằng BigInt string", () => {
    expect(sumPenaltyAmounts(["9007199254740993", "7"])).toBe("9007199254741000");
  });

  it("so sánh version theo code", () => {
    const base = {
      name: "Đi muộn",
      description: "Mô tả",
      defaultAmount: "50000",
      isActive: true,
      displayColor: "#EF4444",
      displayOrder: 1,
    };
    const result = comparePenaltyItems(
      [
        { code: "LATE", ...base },
        { code: "OLD", ...base },
      ],
      [
        { code: "LATE", ...base, defaultAmount: "70000" },
        { code: "NEW", ...base },
      ],
    );

    expect(result).toEqual({
      addedCodes: ["NEW"],
      removedCodes: ["OLD"],
      changedCodes: ["LATE"],
    });
  });
});

describe("phạt theo số lần", () => {
  const policy = {
    penaltyStartsAt: 4,
    countingWindow: "CALENDAR_MONTH" as const,
    countingKey: "LATE",
  };

  it.each([
    [1, "0", false, 3],
    [2, "0", false, 2],
    [3, "0", false, 1],
    [4, "50000", true, 0],
    [5, "50000", true, 0],
  ])("tính lần %i", (occurrenceNo, amount, chargeable, remaining) => {
    expect(calculatePenaltyOccurrence(policy, occurrenceNo, "50000")).toEqual({
      occurrenceNo,
      computedAmount: amount,
      isChargeable: chargeable,
      remainingReminderCount: remaining,
    });
  });

  it("tách chu kỳ tháng và toàn thời gian", () => {
    expect(penaltyCountingPeriod("2026-07-24", "CALENDAR_MONTH")).toEqual({
      start: "2026-07-01",
      end: "2026-08-01",
    });
    expect(penaltyCountingPeriod("2026-07-24", "LIFETIME")).toEqual({
      start: "1970-01-01",
      end: null,
    });
  });
});
