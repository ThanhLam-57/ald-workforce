import type { SimpleRulesDto } from "@ald/contracts";
import { expect, test } from "@playwright/test";

function rulesFixture(): SimpleRulesDto {
  return {
    reward: {
      status: "ACTIVE",
      effectiveFrom: "2026-07-01",
      tiers: [{ thresholdAmount: "10000", rewardAmount: "50000" }],
    },
    monthlyLevel: {
      status: "ACTIVE",
      effectiveFrom: "2026-07-01",
      attendanceRequiredDays: 26,
      levels: [
        {
          code: "KHOI_DONG",
          name: "Khởi Động",
          displayOrder: 1,
          monthlyCoinThreshold: "80000",
          attendanceBonus: "500000",
          achievementBonus: "0",
          retainLevelBonus: "0",
          jumpLevelBonus: "0",
        },
      ],
    },
    penalty: {
      status: "ACTIVE",
      effectiveFrom: "2026-07-01",
      items: [
        {
          code: "DI_MUON",
          name: "Đi muộn",
          description: "Đi muộn quá thời gian cho phép.",
          defaultAmount: "20000",
          reminderCount: 5,
          countingWindow: "CALENDAR_MONTH",
          displayColor: "#DC2626",
          isActive: true,
          automaticCondition: { type: "MANUAL" },
        },
      ],
    },
    salary: {
      status: "ACTIVE",
      effectiveFrom: "2026-07-01",
      standardDaysOffPerMonth: 5,
      probationSalaryRateBps: 8_500,
      standardDailyMinutes: 360,
      overtimeMultiplierBps: 10_000,
      roundingUnit: 1,
      roundingMode: "HALF_UP",
    },
  };
}

test("GM thiết lập thưởng theo xu, thưởng tháng và ngày áp dụng trong quá khứ", async ({
  page,
}) => {
  let rules = rulesFixture();
  let monthlyRequest: Readonly<Record<string, unknown>> | null = null;
  let penaltyRequest: Readonly<Record<string, unknown>> | null = null;

  await page.route("**/api/rules/simple", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { data: rules } });
      return;
    }
    await route.fallback();
  });
  await page.route("**/api/rules/simple/rewards", async (route) => {
    const input = route.request().postDataJSON() as {
      effectiveFrom: string;
      tiers: SimpleRulesDto["reward"]["tiers"];
    };
    rules = {
      ...rules,
      reward: { status: "ACTIVE", effectiveFrom: input.effectiveFrom, tiers: input.tiers },
    };
    await route.fulfill({ json: { data: rules } });
  });
  await page.route("**/api/rules/simple/monthly-levels", async (route) => {
    const input = route.request().postDataJSON() as Readonly<Record<string, unknown>>;
    monthlyRequest = input;
    rules = {
      ...rules,
      monthlyLevel: {
        status: "ACTIVE",
        effectiveFrom: String(input.effectiveFrom),
        attendanceRequiredDays: Number(input.attendanceRequiredDays),
        levels: (input.levels as SimpleRulesDto["monthlyLevel"]["levels"]).map((level, index) => ({
          ...level,
          code: level.code || `LEVEL_${index + 1}`,
          displayOrder: index + 1,
        })),
      },
    };
    await route.fulfill({ json: { data: rules } });
  });
  await page.route("**/api/rules/simple/penalties", async (route) => {
    const input = route.request().postDataJSON() as {
      effectiveFrom: string;
      items: SimpleRulesDto["penalty"]["items"];
    };
    penaltyRequest = input;
    rules = {
      ...rules,
      penalty: { status: "ACTIVE", effectiveFrom: input.effectiveFrom, items: input.items },
    };
    await route.fulfill({ json: { data: rules } });
  });

  await page.goto("/rules");
  await expect(page.getByRole("heading", { name: "Thưởng, phạt & lương" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Thiết lập quy định" })).toBeVisible();

  await expect(page.getByLabel("Số ngày làm việc để nhận chuyên cần")).toHaveValue("26");
  await expect(page.getByText("ngày 0,5 công vẫn tính là một ngày")).toBeVisible();
  await page.getByLabel("Số ngày làm việc để nhận chuyên cần").fill("27");
  await page.getByLabel("achievementBonus bậc 1").fill("250000");
  await page.getByLabel("Ngày áp dụng thưởng tháng").fill("2026-06-01");
  await page.getByRole("button", { name: "Lưu & áp dụng thưởng tháng" }).click();

  await expect(page.getByText("Đã lưu bảng thưởng tháng")).toBeVisible();
  expect(monthlyRequest).toMatchObject({
    effectiveFrom: "2026-06-01",
    attendanceRequiredDays: 27,
    levels: [
      {
        name: "Khởi Động",
        monthlyCoinThreshold: "80000",
        achievementBonus: "250000",
      },
    ],
  });

  await page.getByRole("button", { name: "Thưởng theo xu" }).click();
  const rewardDate = page.getByLabel("Ngày áp dụng thưởng");
  expect(await rewardDate.getAttribute("min")).toBeNull();
  await rewardDate.fill("2026-05-01");
  await page.getByRole("button", { name: "Lưu & áp dụng bảng thưởng" }).click();
  await expect(rewardDate).toHaveValue("2026-05-01");

  await page.getByRole("button", { name: "Phạt vi phạm" }).click();
  const penaltyDate = page.getByLabel("Ngày áp dụng phạt");
  expect(await penaltyDate.getAttribute("min")).toBeNull();
  await page.getByLabel("Cách ghi nhận lỗi 1").selectOption("CHECK_IN_LATE");
  await page.getByLabel("Giờ bắt đầu ca 1").fill("09:00");
  await page.getByLabel("Số phút du di 1").fill("15");
  await expect(page.getByText(/Check-in đến.*09:15.*không bị phạt/)).toBeVisible();
  await page.getByRole("button", { name: "Lưu & áp dụng bảng phạt" }).click();
  expect(penaltyRequest).toMatchObject({
    items: [
      {
        automaticCondition: {
          type: "CHECK_IN_LATE",
          scheduledStartMinutes: 540,
          graceMinutes: 15,
          branchId: null,
        },
      },
    ],
  });
});
