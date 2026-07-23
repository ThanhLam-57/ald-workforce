import { describe, expect, it } from "vitest";

import { DomainError, calculatePayroll, type PayrollCalculationInput } from "./index.js";

const salaryRule = {
  ruleVersionId: "salary-v1",
  configuration: {
    baseSalary: "26000000",
    standardWorkdays: "26",
    standardDailyMinutes: 480,
    overtime: { multiplierBps: 15_000, eligibleAfterMinutes: 0 },
    attendancePolicy: {
      eligibleStatuses: ["PRESENT"] as const,
      prorateMode: "WORK_UNITS" as const,
      minimumWorkUnitsForFullSalary: null,
      capAtStandardWorkdays: true,
    },
    roundingPolicy: {
      unit: 1 as const,
      mode: "HALF_UP" as const,
      applyAt: "COMPONENT" as const,
    },
  },
};

function goldenInput(): PayrollCalculationInput {
  return {
    staffId: "staff-1",
    period: {
      month: "2026-07",
      from: "2026-07-01",
      toExclusive: "2026-08-01",
      timezone: "Asia/Ho_Chi_Minh",
    },
    salaryRule,
    currentLevel: { code: "L1", displayOrder: 1 },
    monthlyLevelRule: {
      ruleVersionId: "monthly-v1",
      levels: [
        {
          code: "L3",
          name: "Level 3",
          displayOrder: 3,
          minRevenue: "1000000",
          maxRevenue: null,
          minInclusive: true,
          maxInclusive: false,
          monthlyRevenueBonus: "500000",
          attendanceBonus: "200000",
          achievementBonus: "300000",
          retainLevelBonus: "100000",
          jumpLevelBonus: "400000",
          attendanceMinWorkUnits: "1.5",
          achievementMinLiveMinutes: 600,
          jumpMinLevelSteps: 2,
        },
      ],
    },
    attendance: [
      {
        attendanceId: "attendance-b",
        businessDate: "2026-07-02",
        status: "PRESENT",
        workUnits: "1",
        overtimeMinutes: 60,
        actualLiveMinutes: 400,
        revenueAmount: "600000",
        dailyRewardRule: {
          ruleVersionId: "daily-v1",
          tiers: [
            {
              code: "HIGH",
              minRevenue: "500000",
              maxRevenue: null,
              minInclusive: true,
              maxInclusive: false,
              rewardAmount: "50000",
              priority: 1,
            },
          ],
        },
        violations: [
          {
            violationId: "violation-b",
            ruleVersionId: "penalty-v1",
            amount: "100000",
            itemName: "Đi muộn",
          },
          {
            violationId: "violation-a",
            ruleVersionId: "penalty-v1",
            amount: "50000",
            itemName: "Thiếu ảnh",
          },
        ],
      },
      {
        attendanceId: "attendance-a",
        businessDate: "2026-07-01",
        status: "PRESENT",
        workUnits: "0.5",
        overtimeMinutes: 30,
        actualLiveMinutes: 300,
        revenueAmount: "500000",
        dailyRewardRule: {
          ruleVersionId: "daily-v1",
          tiers: [
            {
              code: "HIGH",
              minRevenue: "500000",
              maxRevenue: null,
              minInclusive: true,
              maxInclusive: false,
              rewardAmount: "50000",
              priority: 1,
            },
          ],
        },
        violations: [],
      },
    ],
    adjustments: [
      {
        adjustmentId: "adjustment-bonus",
        type: "OTHER_BONUS",
        amount: "100000",
        reason: "Thưởng hỗ trợ",
      },
      {
        adjustmentId: "adjustment-advance",
        type: "ADVANCE",
        amount: "200000",
        reason: "Tạm ứng",
      },
    ],
  };
}

describe("production payroll calculator", () => {
  it("passes the golden case with 0.5 work unit, overtime, tier boundary, level jump and violations", () => {
    const result = calculatePayroll(goldenInput());

    expect(result.aggregates).toEqual({
      workUnits: "1.5",
      overtimeMinutes: 90,
      revenueAmount: "1100000",
      actualLiveMinutes: 700,
      penalties: "150000",
      violationCount: 2,
    });
    expect(result.components).toEqual({
      baseSalary: "26000000",
      proratedSalary: "1500000",
      dailyRevenueBonus: "100000",
      monthlyRevenueBonus: "500000",
      attendanceBonus: "200000",
      achievementBonus: "300000",
      levelBonus: "400000",
      overtimePay: "281250",
      otherBonus: "100000",
      penalties: "150000",
      advance: "200000",
      totalIncome: "3031250",
    });
    expect(result.suggestedLevelCode).toBe("L3");
    expect(result.lines.filter((line) => line.type === "PENALTY")).toHaveLength(2);
  });

  it("is deterministic and independent from source ordering", () => {
    const first = calculatePayroll(goldenInput());
    const reversed = goldenInput();
    const second = calculatePayroll({
      ...reversed,
      attendance: [...reversed.attendance].reverse(),
      adjustments: [...reversed.adjustments].reverse(),
    });
    expect(second).toEqual(first);
  });

  it("keeps a negative total and marks the unresolved debt policy explicitly", () => {
    const input = goldenInput();
    const result = calculatePayroll({
      ...input,
      monthlyLevelRule: null,
      adjustments: [
        {
          adjustmentId: "large-advance",
          type: "ADVANCE",
          amount: "999999999",
          reason: "Kiểm thử",
        },
      ],
    });
    expect(BigInt(result.components.totalIncome)).toBeLessThan(0n);
    expect(result.anomalyFlags).toContain("NEGATIVE_TOTAL");
    expect(result.anomalyFlags).toContain("MISSING_MONTHLY_LEVEL_RULE");
  });

  it("rejects duplicate source IDs and out-of-period attendance", () => {
    const input = goldenInput();
    expect(() =>
      calculatePayroll({
        ...input,
        attendance: [input.attendance[0]!, input.attendance[0]!],
      }),
    ).toThrow(DomainError);
    expect(() =>
      calculatePayroll({
        ...input,
        attendance: [
          {
            ...input.attendance[0]!,
            businessDate: "2026-08-01",
          },
        ],
      }),
    ).toThrow(/ngoài kỳ/i);
  });

  it("allocates total-level rounding without creating a negative overtime component", () => {
    const input = goldenInput();
    const result = calculatePayroll({
      ...input,
      attendance: [
        {
          ...input.attendance[0]!,
          workUnits: "0.5",
          overtimeMinutes: 0,
          violations: [],
          dailyRewardRule: null,
          revenueAmount: "0",
        },
      ],
      adjustments: [],
      monthlyLevelRule: null,
      salaryRule: {
        ...input.salaryRule,
        configuration: {
          ...input.salaryRule.configuration,
          baseSalary: "1000",
          roundingPolicy: {
            unit: 1_000,
            mode: "HALF_UP",
            applyAt: "TOTAL",
          },
        },
      },
    });
    expect(BigInt(result.components.proratedSalary)).toBeGreaterThanOrEqual(0n);
    expect(BigInt(result.components.overtimePay)).toBeGreaterThanOrEqual(0n);
    expect(BigInt(result.components.proratedSalary) + BigInt(result.components.overtimePay)).toBe(
      0n,
    );
  });
});
