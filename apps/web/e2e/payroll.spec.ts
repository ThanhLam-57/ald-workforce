import { expect, test } from "@playwright/test";

test("GM mở sample payroll, calculate và xem breakdown", async ({ page }) => {
  await page.goto("/dashboard");
  const businessMonthParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const month =
    process.env.SEED_PAYROLL_MONTH ??
    `${businessMonthParts.find((part) => part.type === "year")?.value}-${businessMonthParts.find((part) => part.type === "month")?.value}`;
  const payroll = page
    .getByRole("heading", { name: "Review, khóa và publish lương" })
    .locator("xpath=ancestor::section[1]");

  await expect(payroll.getByText("Payroll ledger")).toBeVisible();
  const demoBranchId = await payroll
    .getByLabel("Chọn cơ sở payroll")
    .locator("option")
    .filter({ hasText: /^DEMO\s/ })
    .getAttribute("value");
  expect(demoBranchId).toBeTruthy();
  await payroll.getByLabel("Chọn cơ sở payroll").selectOption(demoBranchId!);
  await payroll.getByLabel("Tháng payroll").fill(month);
  await expect(payroll.getByRole("button", { name: /DEMO · R1/ })).toBeVisible();
  await payroll.getByRole("button", { name: /DEMO · R1/ }).click();
  await payroll.getByRole("button", { name: "Tính / tính lại" }).click();

  await expect(payroll.getByText("LIVEDEMO · calc #1", { exact: true })).toBeVisible();
  await payroll.getByText("Breakdown · LIVEDEMO — Nhân viên Live Demo").click();
  await expect(payroll.getByText("1 công · OT 60′")).toBeVisible();
});
