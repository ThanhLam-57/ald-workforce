import type { PayrollPeriodDto } from "@ald/contracts";
import { expect, test } from "@playwright/test";

function payrollFixture(
  baseSalary = "26000000",
  dailyDuration: Readonly<{ actualLiveMinutes: number; overtimeMinutes: number }> = {
    actualLiveMinutes: 360,
    overtimeMinutes: 30,
  },
): PayrollPeriodDto {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    branch: {
      id: "22222222-2222-4222-8222-222222222222",
      code: "CS01",
      name: "Cơ sở kiểm thử",
    },
    month: "2026-07",
    revision: 1,
    status: "CALCULATED",
    version: baseSalary === "26000000" ? 2 : 3,
    sourcePeriodId: null,
    latestCalculationNo: baseSalary === "26000000" ? 1 : 2,
    standardDaysOff: {
      ruleValue: 5,
      overrideValue: null,
      appliedValue: 5,
      daysInMonth: 31,
      standardPayableDays: 26,
    },
    salaryPolicy: {
      standardDailyMinutes: 360,
      overtimeMultiplierBps: 10_000,
      roundingUnit: 1,
      roundingMode: "HALF_UP",
      roundingApplyAt: "COMPONENT",
    },
    totals: {
      staffCount: 1,
      grossIncome: "1050000",
      penalties: "50000",
      advance: "0",
      totalIncome: "1000000",
    },
    calculatedAt: "2026-07-27T00:00:00.000Z",
    reviewedAt: null,
    lockedAt: null,
    publishedAt: null,
    entries: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        staff: {
          id: "44444444-4444-4444-8444-444444444444",
          staffCode: "LIVE01",
          fullName: "Nhân viên kiểm thử",
          streamingAlias: "live-test",
        },
        workUnits: "1",
        workedDayCount: 1,
        overtimeMinutes: dailyDuration.overtimeMinutes,
        revenueAmount: "100000",
        currentMonthCoins: "100000",
        actualLiveMinutes: dailyDuration.actualLiveMinutes,
        sourceBaseSalary: "26000000",
        baseSalary,
        proratedSalary: "1000000",
        dailyRevenueBonus: "50000",
        monthlyRevenueBonus: "0",
        attendanceBonus: "0",
        achievementBonus: "0",
        levelBonus: "0",
        overtimePay: "0",
        otherBonus: "0",
        penalties: "50000",
        advance: "0",
        totalIncome: "1000000",
        calculatedComponents: {
          proratedSalary: "1000000",
          dailyRevenueBonus: "50000",
          monthlyRevenueBonus: "0",
          attendanceBonus: "0",
          achievementBonus: "0",
          retainLevelBonus: "0",
          jumpLevelBonus: "0",
          overtimePay: "0",
          otherBonus: "0",
          penalties: "50000",
          advance: "0",
          totalIncome: "1000000",
        },
        employmentSalary: {
          joinedDate: "2026-07-01",
          officialDate: "2026-07-15",
          probationSalaryRateBps: 8_500,
          probationWorkUnits: "1",
          officialWorkUnits: "0",
          excludedBeforeJoinWorkUnits: "0",
          probationSalaryAmount: "850000",
          officialSalaryAmount: "0",
          calculatedProratedSalary: "850000",
          fallbackMode: "OFFICIAL_DATE",
        },
        previousLevelCode: "L1",
        sourceCurrentLevelCode: "L1",
        sourceCurrentLevelName: "Bậc 1",
        currentLevelCode: "L1",
        currentLevelName: "Bậc 1",
        monthlyLevel: {
          workedDayCount: 1,
          attendanceRequiredDays: 26,
          attendanceEligible: false,
          previousMonthCoins: "80000",
          previousMonthCoinsSource: "MANUAL_BASELINE",
          previousLevelCode: "L1",
          previousLevelName: "Bậc 1",
          currentMonthCoins: "100000",
          currentLevelCode: "L1",
          currentLevelName: "Bậc 1",
          transition: "RETAIN",
        },
        worksheetOverride:
          baseSalary === "26000000"
            ? null
            : {
                version: 1,
                values: {
                  baseSalaryAmount: baseSalary,
                  days: [],
                  components: {},
                },
              },
        anomalyFlags: [],
        calculationHash: "a".repeat(64),
        calculationNo: baseSalary === "26000000" ? 1 : 2,
        lines: [],
        dailyRows: [
          {
            businessDate: "2026-07-01",
            checkInTime: "09:00",
            checkOutTime: "15:30",
            status: "PRESENT",
            workUnits: "1",
            overtimeMinutes: dailyDuration.overtimeMinutes,
            actualLiveMinutes: dailyDuration.actualLiveMinutes,
            revenueAmount: "100000",
            dailyCoins: "100000",
            rewardThresholdAmount: "100000",
            dailyRevenueBonus: "50000",
            violationCategory: "Đi muộn",
            violationDetail: "Đi muộn 5 phút",
            penalties: "50000",
            note: null,
            source: {
              checkInTime: "09:00",
              checkOutTime: "15:30",
              status: "PRESENT",
              workUnits: "1",
              overtimeMinutes: dailyDuration.overtimeMinutes,
              actualLiveMinutes: dailyDuration.actualLiveMinutes,
              revenueAmount: "100000",
              dailyCoins: "100000",
              rewardThresholdAmount: "100000",
              dailyRevenueBonus: "50000",
              violationCategory: "Đi muộn",
              violationDetail: "Đi muộn 5 phút",
              penalties: "50000",
              note: null,
            },
            overriddenFields: [],
          },
        ],
        previousTotalIncome: null,
        deltaFromPrevious: null,
      },
    ],
  };
}

test("Payroll lọc theo tháng, cơ sở, nhân viên và lưu ô chỉnh sửa", async ({ page }) => {
  let savedBody: Readonly<Record<string, unknown>> | null = null;

  await page.route("**/api/payroll/periods/ensure", async (route) => {
    await route.fulfill({
      json: {
        data: payrollFixture("26000000", {
          actualLiveMinutes: 0,
          overtimeMinutes: 0,
        }),
      },
    });
  });
  await page.route("**/api/payroll/periods/*/exports", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });
  await page.route("**/api/payroll/periods/*/worksheet", async (route) => {
    savedBody = route.request().postDataJSON() as Readonly<Record<string, unknown>>;
    await route.fulfill({ json: { data: payrollFixture("7000000") } });
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/payroll");

  await expect(page.getByRole("heading", { name: "Payroll", exact: true })).toBeVisible();
  await expect(page.getByText("Kỳ lương theo tháng", { exact: true })).toBeVisible();
  await expect(page.getByLabel("1. Kỳ lương")).toHaveValue("2026-07");
  await page
    .getByLabel("Chọn nhân viên Payroll")
    .selectOption("44444444-4444-4444-8444-444444444444");
  await expect(page.getByText("Cơ sở kiểm thử · kỳ 07/2026", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Thời lượng Live 2026-07-01")).toHaveAttribute("type", "text");
  await expect(page.getByLabel("Thời lượng Live 2026-07-01")).toHaveValue("00:00");
  await expect(page.getByLabel("Thời lượng tăng ca 2026-07-01")).toHaveAttribute("type", "text");
  await expect(page.getByLabel("Thời lượng tăng ca 2026-07-01")).toHaveValue("00:00");
  await expect(page.getByText("Công thử việc · 85%", { exact: true })).toBeVisible();
  await expect(page.getByText("Ngày lên chính thức", { exact: true })).toBeVisible();

  await page.getByLabel("Lương cơ bản áp dụng").fill("7000000");
  await expect(page.getByText("Có thay đổi chưa lưu.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Lưu thay đổi" }).first().click();

  await expect(page.getByText("Đã lưu và tính lại bảng lương.")).toBeVisible();
  expect(savedBody).toMatchObject({
    staffId: "44444444-4444-4444-8444-444444444444",
    periodVersion: 2,
    standardDaysOffOverride: 5,
    values: { baseSalaryAmount: "7000000" },
  });
});
