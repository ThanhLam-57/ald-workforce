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
        monthlyCoins: "200",
        workedDayCount: 26,
        attendanceRequiredDays: 26,
        previousLevelCode: "LOW",
        previousLevelOrder: 1,
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
    expect(result.amount).toBe("100");
  });

  it("uses monthly coin thresholds and keeps retain, jump and down mutually exclusive", () => {
    const levels = [
      {
        code: "START",
        name: "Khởi động",
        displayOrder: 1,
        minRevenue: "80000",
        maxRevenue: "150000",
        minInclusive: true,
        maxInclusive: false,
        monthlyRevenueBonus: "0",
        attendanceBonus: "500000",
        achievementBonus: "0",
        retainLevelBonus: "0",
        jumpLevelBonus: "0",
        attendanceMinWorkUnits: null,
        achievementMinLiveMinutes: null,
        jumpMinLevelSteps: 1,
      },
      {
        code: "CREATE",
        name: "Kiến tạo",
        displayOrder: 2,
        minRevenue: "150000",
        maxRevenue: null,
        minInclusive: true,
        maxInclusive: false,
        monthlyRevenueBonus: "0",
        attendanceBonus: "500000",
        achievementBonus: "100000",
        retainLevelBonus: "200000",
        jumpLevelBonus: "300000",
        attendanceMinWorkUnits: null,
        achievementMinLiveMinutes: null,
        jumpMinLevelSteps: 1,
      },
    ] as const;
    const calculate = (
      monthlyCoins: string,
      previousLevelCode: string | null,
      previousLevelOrder: number | null,
    ) =>
      calculateMonthlyLevelResult(
        {
          monthlyCoins,
          workedDayCount: 26,
          attendanceRequiredDays: 26,
          previousLevelCode,
          previousLevelOrder,
        },
        levels,
      );

    expect(calculate("79999", null, null).suggestedLevel).toBeNull();
    expect(calculate("80000", null, null).suggestedLevel?.code).toBe("START");
    expect(calculate("149999", null, null).suggestedLevel?.code).toBe("START");
    expect(calculate("150000", "START", 1)).toMatchObject({
      transition: "JUMP",
      amount: "900000",
    });
    expect(calculate("999999", "CREATE", 2)).toMatchObject({
      transition: "RETAIN",
      amount: "800000",
    });
    expect(calculate("80000", "CREATE", 2)).toMatchObject({
      transition: "DOWN",
      amount: "500000",
    });
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
