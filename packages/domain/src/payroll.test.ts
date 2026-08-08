import { describe, expect, it } from "vitest";

import {
  DomainError,
  calculatePayroll,
  calculateSalaryProjection,
  countWorkedDays,
  daysInPayrollMonth,
  standardPayableDays,
  type PayrollCalculationInput,
} from "./index.js";

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
    baseSalaryAmount: "26000000",
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
      attendanceRequiredDays: 2,
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
    previousMonth: {
      coins: "500000",
      source: "ATTENDANCE_LIVE",
      level: { code: "L1", name: "Level 1", displayOrder: 1 },
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
      workedDayCount: 2,
      overtimeMinutes: 90,
      revenueAmount: "1100000",
      currentMonthCoins: "1100000",
      actualLiveMinutes: 700,
      penalties: "150000",
      violationCount: 2,
    });
    expect(result.components).toEqual({
      baseSalary: "26000000",
      proratedSalary: "1500000",
      dailyRevenueBonus: "100000",
      monthlyRevenueBonus: "0",
      attendanceBonus: "200000",
      achievementBonus: "300000",
      retainLevelBonus: "0",
      jumpLevelBonus: "400000",
      levelBonus: "400000",
      overtimePay: "281250",
      otherBonus: "100000",
      penalties: "150000",
      advance: "200000",
      totalIncome: "2531250",
    });
    expect(result.monthlyLevel).toMatchObject({
      workedDayCount: 2,
      attendanceRequiredDays: 2,
      previousMonthCoins: "500000",
      previousMonthCoinsSource: "ATTENDANCE_LIVE",
      previousLevelCode: "L1",
      currentMonthCoins: "1100000",
      currentLevelCode: "L3",
      transition: "JUMP",
    });
    expect(result.suggestedLevelCode).toBe("L3");
    expect(result.lines.filter((line) => line.type === "PENALTY")).toHaveLength(2);
    expect(result.lines.find((line) => line.type === "BASE_SALARY")).toMatchObject({
      amount: "26000000",
      sourceType: "STAFF_MEMBER",
      sourceId: "staff-1",
    });
  });

  it.each([
    ["ngày đầu tháng", "OFFICIAL", "2026-07-01", "1500000", "0", "1.5"],
    ["giữa tháng", "OFFICIAL", "2026-07-02", "1425000", "0.5", "1"],
    ["sau các ngày đã làm", "PROBATION", "2026-07-31", "1275000", "1.5", "0"],
    ["thử việc chưa có ngày chính thức", "PROBATION", null, "1275000", "1.5", "0"],
    ["chính thức cũ chưa có ngày", "OFFICIAL", null, "1500000", "0", "1.5"],
    ["hợp đồng không áp dụng 85%", "CONTRACTOR", null, "1500000", "0", "1.5"],
    ["thực tập không áp dụng 85%", "INTERN", null, "1500000", "0", "1.5"],
  ] as const)(
    "splits probation and official salary at %s",
    (_label, category, officialDate, expectedSalary, probationUnits, officialUnits) => {
      const input = goldenInput();
      const result = calculatePayroll({
        ...input,
        employment: {
          joinedDate: "2026-07-01",
          officialDate,
          category,
        },
        salaryRule: {
          ...input.salaryRule,
          configuration: {
            ...input.salaryRule.configuration,
            probationSalaryRateBps: 8_500,
          },
        },
      });

      expect(result.components.proratedSalary).toBe(expectedSalary);
      expect(result.employmentSalary).toMatchObject({
        joinedDate: "2026-07-01",
        officialDate,
        probationSalaryRateBps: 8_500,
        probationWorkUnits: probationUnits,
        officialWorkUnits: officialUnits,
        calculatedProratedSalary: expectedSalary,
      });
    },
  );

  it("excludes work before joinedDate only from base salary and keeps rewards, penalties and overtime", () => {
    const input = goldenInput();
    const baseline = calculatePayroll({
      ...input,
      employment: {
        joinedDate: "2026-07-01",
        officialDate: "2026-07-01",
        category: "OFFICIAL",
      },
    });
    const joinedMidMonth = calculatePayroll({
      ...input,
      employment: {
        joinedDate: "2026-07-02",
        officialDate: "2026-07-02",
        category: "OFFICIAL",
      },
    });

    expect(joinedMidMonth.components.proratedSalary).toBe("1000000");
    expect(joinedMidMonth.employmentSalary).toMatchObject({
      excludedBeforeJoinWorkUnits: "0.5",
      probationWorkUnits: "0",
      officialWorkUnits: "1",
    });
    expect(joinedMidMonth.anomalyFlags).toContain("WORK_BEFORE_JOIN_DATE");
    expect(joinedMidMonth.components.dailyRevenueBonus).toBe(baseline.components.dailyRevenueBonus);
    expect(joinedMidMonth.components.penalties).toBe(baseline.components.penalties);
    expect(joinedMidMonth.components.overtimePay).toBe(baseline.components.overtimePay);
  });

  it("keeps the calculated 85/100 breakdown when prorated salary is overridden", () => {
    const input = goldenInput();
    const result = calculatePayroll({
      ...input,
      employment: {
        joinedDate: "2026-07-01",
        officialDate: "2026-07-02",
        category: "OFFICIAL",
      },
      componentOverrides: { proratedSalary: "2000000" },
    });

    expect(result.components.proratedSalary).toBe("2000000");
    expect(result.calculatedComponents.proratedSalary).toBe("1425000");
    expect(result.employmentSalary).toMatchObject({
      probationSalaryAmount: "425000",
      officialSalaryAmount: "1000000",
      calculatedProratedSalary: "1425000",
    });
  });

  it("counts working days instead of summing work units for attendance bonus", () => {
    const source = goldenInput();
    const attendance = Array.from({ length: 26 }, (_, index) => ({
      attendanceId: `worked-${index + 1}`,
      businessDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
      status: "PRESENT" as const,
      workUnits: index === 0 ? "0.5" : "1",
      overtimeMinutes: 0,
      actualLiveMinutes: 0,
      revenueAmount: index === 0 ? "1100000" : "0",
      dailyRewardRule: null,
      violations: [],
    }));
    const eligible = calculatePayroll({
      ...source,
      attendance,
      monthlyLevelRule: source.monthlyLevelRule
        ? { ...source.monthlyLevelRule, attendanceRequiredDays: 26 }
        : null,
      adjustments: [],
    });
    expect(eligible.aggregates).toMatchObject({
      workedDayCount: 26,
      workUnits: "25.5",
    });
    expect(eligible.components.attendanceBonus).toBe("200000");

    const twentyFiveDays = attendance
      .slice(0, 25)
      .map((row, index) => (index === 0 ? { ...row, workUnits: "2" } : row));
    const notEligible = calculatePayroll({
      ...source,
      attendance: twentyFiveDays,
      monthlyLevelRule: source.monthlyLevelRule
        ? { ...source.monthlyLevelRule, attendanceRequiredDays: 26 }
        : null,
      adjustments: [],
    });
    expect(notEligible.aggregates).toMatchObject({
      workedDayCount: 25,
      workUnits: "26",
    });
    expect(notEligible.components.attendanceBonus).toBe("0");
  });

  it("requires all 27 standard payable days before granting the attendance bonus", () => {
    const source = goldenInput();
    const attendance = Array.from({ length: 27 }, (_, index) => ({
      attendanceId: `standard-day-${index + 1}`,
      businessDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
      status: "PRESENT" as const,
      workUnits: "1",
      overtimeMinutes: 0,
      actualLiveMinutes: 0,
      revenueAmount: index === 0 ? "1100000" : "0",
      dailyRewardRule: null,
      violations: [],
    }));
    const input = {
      ...source,
      salaryRule: {
        ...source.salaryRule,
        configuration: {
          ...source.salaryRule.configuration,
          standardDaysOffPerMonth: 4,
        },
      },
      monthlyLevelRule: source.monthlyLevelRule
        ? { ...source.monthlyLevelRule, attendanceRequiredDays: 27 }
        : null,
      adjustments: [],
    };

    const twentySixDays = calculatePayroll({ ...input, attendance: attendance.slice(0, 26) });
    expect(twentySixDays.salaryBasis).toEqual({
      daysInMonth: 31,
      standardDaysOffPerMonth: 4,
      standardPayableDays: 27,
    });
    expect(twentySixDays.monthlyLevel).toMatchObject({
      workedDayCount: 26,
      attendanceRequiredDays: 27,
      attendanceEligible: false,
    });
    expect(twentySixDays.components.attendanceBonus).toBe("0");

    const twentySevenDays = calculatePayroll({ ...input, attendance });
    expect(twentySevenDays.monthlyLevel).toMatchObject({
      workedDayCount: 27,
      attendanceRequiredDays: 27,
      attendanceEligible: true,
    });
    expect(twentySevenDays.components.attendanceBonus).toBe("200000");
  });

  it("counts each date with positive work units regardless of attendance status", () => {
    const row = (
      attendanceId: string,
      businessDate: string,
      status: "DRAFT" | "PRESENT" | "ABSENT" | "LEAVE",
      workUnits: string,
      overtimeMinutes = 0,
    ): PayrollCalculationInput["attendance"][number] => ({
      attendanceId,
      businessDate,
      status,
      workUnits,
      overtimeMinutes,
      actualLiveMinutes: 0,
      revenueAmount: "0",
      dailyRewardRule: null,
      violations: [],
    });
    expect(
      countWorkedDays([
        row("one", "2026-07-01", "PRESENT", "1.5", 600),
        row("duplicate-date", "2026-07-01", "PRESENT", "0.5"),
        row("zero", "2026-07-02", "PRESENT", "0"),
        row("leave", "2026-07-03", "LEAVE", "1"),
        row("absent", "2026-07-04", "ABSENT", "1"),
        row("draft", "2026-07-05", "DRAFT", "1"),
      ]),
    ).toBe(4);
  });

  it("calculates salary and overtime without using attendance status", () => {
    const result = calculateSalaryProjection(
      salaryRule.configuration,
      [
        { status: "DRAFT", workUnits: "1", overtimeMinutes: 60 },
        { status: "ABSENT", workUnits: "1", overtimeMinutes: 0 },
        { status: "LEAVE", workUnits: "0", overtimeMinutes: 30 },
      ],
    );

    expect(result).toEqual({
      baseSalaryAmount: "2000000",
      overtimeAmount: "281250",
      totalAmount: "2281250",
    });
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
      baseSalaryAmount: "1000",
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

  it.each([
    ["2026-02", 28],
    ["2024-02", 29],
    ["2026-04", 30],
    ["2026-07", 31],
  ])("uses the real calendar length for %s", (month, expectedDays) => {
    expect(daysInPayrollMonth(month)).toBe(expectedDays);
    expect(standardPayableDays(month, 0)).toBe(expectedDays);
    expect(standardPayableDays(month, 4)).toBe(expectedDays - 4);
    expect(standardPayableDays(month, 5)).toBe(expectedDays - 5);
  });

  it("rejects invalid standard days off", () => {
    expect(() => standardPayableDays("2026-07", -1)).toThrow(DomainError);
    expect(() => standardPayableDays("2026-02", 28)).toThrow(DomainError);
    expect(() => standardPayableDays("invalid", 5)).toThrow(DomainError);
  });

  it("calculates 7,000,000 / 26 × 3.5 as 942,308 without floating point", () => {
    const input = goldenInput();
    const result = calculatePayroll({
      ...input,
      baseSalaryAmount: "7000000",
      currentLevel: null,
      monthlyLevelRule: null,
      adjustments: [],
      salaryRule: {
        ...input.salaryRule,
        configuration: {
          ...input.salaryRule.configuration,
          baseSalary: "7000000",
          standardDaysOffPerMonth: 5,
          overtime: { multiplierBps: 10_000, eligibleAfterMinutes: 0 },
        },
      },
      attendance: [
        ...[1, 2, 3].map((day) => ({
          attendanceId: `work-${day}`,
          businessDate: `2026-07-0${day}`,
          status: "PRESENT" as const,
          workUnits: "1",
          overtimeMinutes: 0,
          actualLiveMinutes: 0,
          revenueAmount: "0",
          dailyRewardRule: null,
          violations: [],
        })),
        {
          attendanceId: "work-4",
          businessDate: "2026-07-04",
          status: "PRESENT",
          workUnits: "0.5",
          overtimeMinutes: 0,
          actualLiveMinutes: 0,
          revenueAmount: "0",
          dailyRewardRule: null,
          violations: [],
        },
      ],
    });

    expect(result.salaryBasis).toEqual({
      daysInMonth: 31,
      standardDaysOffPerMonth: 5,
      standardPayableDays: 26,
    });
    expect(result.components.proratedSalary).toBe("942308");
  });

  it("honors zero and signed component overrides and reconciles total income", () => {
    const input = goldenInput();
    const result = calculatePayroll({
      ...input,
      componentOverrides: {
        dailyRevenueBonus: "0",
        otherBonus: "-50000",
        penalties: "0",
      },
    });

    expect(result.components.dailyRevenueBonus).toBe("0");
    expect(result.components.otherBonus).toBe("-50000");
    expect(result.components.penalties).toBe("0");
    const includedDailyLines = result.lines.filter(
      (line) => line.type === "DAILY_REVENUE_BONUS" && line.includedInTotal,
    );
    expect(includedDailyLines).toHaveLength(1);
    expect(includedDailyLines[0]!.amount).toBe("0");
    expect(
      result.lines
        .filter((line) => line.includedInTotal)
        .reduce((total, line) => {
          const amount = BigInt(line.amount);
          return line.type === "PENALTY" || line.type === "ADVANCE"
            ? total - amount
            : total + amount;
        }, 0n),
    ).toBe(BigInt(result.components.totalIncome));
  });
});
