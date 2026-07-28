import { describe, expect, it } from "vitest";

import { simplePenaltyRuleApplySchema } from "./index.js";

const baseItem = {
  name: "Đi muộn",
  description: "Tự động tính theo giờ check-in.",
  defaultAmount: "20000",
  reminderCount: 0,
  countingWindow: "CALENDAR_MONTH" as const,
  displayColor: "#EF4444",
  isActive: true,
};

describe("automatic penalty contracts", () => {
  it("giữ rule cũ không có automaticCondition ở chế độ thủ công", () => {
    const parsed = simplePenaltyRuleApplySchema.parse({
      effectiveFrom: "2026-07-01",
      items: [baseItem],
    });
    expect(parsed.items[0]?.automaticCondition).toBeUndefined();
  });

  it("chặn phút du di lớn hơn thời lượng Live yêu cầu", () => {
    expect(() =>
      simplePenaltyRuleApplySchema.parse({
        effectiveFrom: "2026-07-01",
        items: [
          {
            ...baseItem,
            automaticCondition: {
              type: "LIVE_DURATION_SHORT",
              requiredLiveMinutes: 360,
              graceMinutes: 361,
              branchId: null,
            },
          },
        ],
      }),
    ).toThrow();
  });

  it("chặn hai rule tự động active cùng trigger và phạm vi", () => {
    expect(() =>
      simplePenaltyRuleApplySchema.parse({
        effectiveFrom: "2026-07-01",
        items: [
          {
            ...baseItem,
            name: "Đi muộn 1",
            automaticCondition: {
              type: "CHECK_IN_LATE",
              scheduledStartMinutes: 540,
              graceMinutes: 15,
              branchId: null,
            },
          },
          {
            ...baseItem,
            name: "Đi muộn 2",
            automaticCondition: {
              type: "CHECK_IN_LATE",
              scheduledStartMinutes: 600,
              graceMinutes: 5,
              branchId: null,
            },
          },
        ],
      }),
    ).toThrow();
  });
});
