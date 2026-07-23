import { describe, expect, it } from "vitest";

import {
  DomainError,
  calculateDailyReward,
  calculateKpiMaximumScore,
  calculateMonthlyLevelResult,
  calculateSalaryProjection,
  compareConfigurationPaths,
  matchRevenueBand,
  validateRevenueBands,
} from "./index.js";

const tiers = [
  {
    code: "LOW",
    minRevenue: "0",
    maxRevenue: "100",
    minInclusive: true,
    maxInclusive: false,
    rewardAmount: "10000",
    priority: 1,
  },
  {
    code: "MID",
    minRevenue: "100",
    maxRevenue: "200",
    minInclusive: true,
    maxInclusive: true,
    rewardAmount: "20000",
    priority: 2,
  },
  {
    code: "HIGH",
    minRevenue: "200",
    maxRevenue: null,
    minInclusive: false,
    maxInclusive: false,
    rewardAmount: "30000",
    priority: 3,
  },
] as const;

describe("configured reward rules", () => {
  it("resolves exact thresholds, inclusive/exclusive boundaries and no-max tier", () => {
    validateRevenueBands(tiers, "REQUIRE_CONTIGUOUS");

    expect(calculateDailyReward("0", tiers)).toBe("10000");
    expect(calculateDailyReward("99", tiers)).toBe("10000");
    expect(calculateDailyReward("100", tiers)).toBe("20000");
    expect(calculateDailyReward("200", tiers)).toBe("20000");
    expect(calculateDailyReward("201", tiers)).toBe("30000");
    expect(calculateDailyReward("999999999999", tiers)).toBe("30000");
  });

  it("rejects overlaps and obeys the configured gap policy", () => {
    expect(() =>
      validateRevenueBands(
        [tiers[0], { ...tiers[1], minRevenue: "99", minInclusive: true }],
        "ALLOW_GAPS",
      ),
    ).toThrow(DomainError);

    expect(() =>
      validateRevenueBands([tiers[0], { ...tiers[1], minRevenue: "101" }], "REQUIRE_CONTIGUOUS"),
    ).toThrow(/khoảng trống/i);

    expect(() =>
      validateRevenueBands([tiers[0], { ...tiers[1], minRevenue: "101" }], "ALLOW_GAPS"),
    ).not.toThrow();
    expect(matchRevenueBand("100", [tiers[0], { ...tiers[1], minRevenue: "101" }])).toBeNull();
  });

  it("calculates monthly bonuses and transition bonuses from typed inputs", () => {
    const result = calculateMonthlyLevelResult(
      {
        revenueAmount: "200",
        workUnits: "26",
        actualLiveMinutes: 8_000,
        currentLevelCode: "LOW",
        currentLevelOrder: 1,
      },
      [
        {
          code: "HIGH",
          name: "Cao",
          displayOrder: 3,
          minRevenue: "100",
          maxRevenue: null,
          minInclusive: true,
          maxInclusive: false,
          monthlyRevenueBonus: "100",
          attendanceBonus: "20",
          achievementBonus: "30",
          retainLevelBonus: "40",
          jumpLevelBonus: "50",
          attendanceMinWorkUnits: "26",
          achievementMinLiveMinutes: 8_000,
          jumpMinLevelSteps: 2,
        },
      ],
    );

    expect(result.suggestedLevel?.code).toBe("HIGH");
    expect(result.transition).toBe("JUMP");
    expect(result.amount).toBe("200");
  });

  it("calculates salary with integer rational arithmetic and explicit rounding", () => {
    const result = calculateSalaryProjection(
      {
        baseSalary: "26000000",
        standardWorkdays: "26",
        standardDailyMinutes: 480,
        overtime: { multiplierBps: 15_000, eligibleAfterMinutes: 0 },
        attendancePolicy: {
          eligibleStatuses: ["PRESENT"],
          prorateMode: "WORK_UNITS",
          minimumWorkUnitsForFullSalary: null,
          capAtStandardWorkdays: true,
        },
        roundingPolicy: { unit: 1, mode: "HALF_UP", applyAt: "COMPONENT" },
      },
      [
        { status: "PRESENT", workUnits: "13", overtimeMinutes: 60 },
        { status: "ABSENT", workUnits: "13", overtimeMinutes: 60 },
      ],
    );

    expect(result.baseSalaryAmount).toBe("13000000");
    expect(result.overtimeAmount).toBe("187500");
    expect(result.totalAmount).toBe("13187500");
  });

  it("validates weighted KPI scoring and reports changed configuration paths", () => {
    expect(
      calculateKpiMaximumScore([
        { weightBps: 6_000, maxScore: 100 },
        { weightBps: 4_000, maxScore: 50 },
      ]),
    ).toBe("80");
    expect(
      compareConfigurationPaths(
        { kind: "KPI_TEMPLATE", criteria: [{ code: "A", maxScore: 50 }] },
        { kind: "KPI_TEMPLATE", criteria: [{ code: "A", maxScore: 100 }] },
      ),
    ).toContain("$.criteria.0.maxScore");
  });
});
