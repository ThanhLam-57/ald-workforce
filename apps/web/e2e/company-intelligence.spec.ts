import { expect, test } from "@playwright/test";

function currentBusinessMonth(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

test("GM xem company intelligence, export và tạo draft KPI quản lý", async ({ page }) => {
  const month = process.env.SEED_PAYROLL_MONTH ?? currentBusinessMonth();
  await page.goto("/company-report");

  await expect(page.getByRole("heading", { name: "Dashboard và báo cáo công ty" })).toBeVisible();

  const reportResponse = await page.request.get(`/api/company-report?month=${month}`);
  expect(reportResponse.ok()).toBe(true);
  const report = (await reportResponse.json()) as {
    data: {
      totals: { revenueAmount: string };
      branches: Array<{ branch: { code: string } }>;
    };
  };
  expect(BigInt(report.data.totals.revenueAmount)).toBeGreaterThanOrEqual(2_000_000n);
  expect(report.data.branches.map((branch) => branch.branch.code)).toContain("DEMO");

  const [xlsxResponse, pdfResponse] = await Promise.all([
    page.request.get(`/api/exports/company-report?month=${month}&format=xlsx`),
    page.request.get(`/api/exports/company-report?month=${month}&format=pdf`),
  ]);
  expect(xlsxResponse.ok()).toBe(true);
  expect(xlsxResponse.headers()["content-type"]).toContain(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  expect(pdfResponse.ok()).toBe(true);
  expect(pdfResponse.headers()["content-type"]).toContain("application/pdf");

  const evaluationsResponse = await page.request.get(`/api/manager-kpi/evaluations?month=${month}`);
  expect(evaluationsResponse.ok()).toBe(true);
  const evaluations = (await evaluationsResponse.json()) as {
    data: Array<{ managerStaffId: string }>;
  };
  if (evaluations.data.length === 0) {
    const candidatesResponse = await page.request.get(`/api/manager-kpi/candidates?month=${month}`);
    expect(candidatesResponse.ok()).toBe(true);
    const candidates = (await candidatesResponse.json()) as {
      data: Array<{ id: string }>;
    };
    expect(candidates.data[0]?.id).toBeTruthy();
    const createResponse = await page.request.post("/api/manager-kpi/evaluations", {
      data: {
        month,
        managerStaffId: candidates.data[0]!.id,
      },
    });
    expect(createResponse.ok()).toBe(true);
  }

  await page.goto("/manager-kpi");
  await expect(page.getByRole("heading", { level: 1, name: "KPI quản lý đào tạo" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 3, name: "TMDEMO — Quản lý đào tạo Demo" }),
  ).toBeVisible();
});
