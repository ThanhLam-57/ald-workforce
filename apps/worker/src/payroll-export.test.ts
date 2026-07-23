import ExcelJS from "exceljs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { calculatePayroll, type PayrollCalculationInput } from "@ald/domain";

import {
  createPayslipPdf,
  createPayslipWorkbook,
  createPayrollZip,
  type PayslipExportData,
} from "./payroll-export.js";

function fixture(): PayslipExportData {
  const input: PayrollCalculationInput = {
    staffId: "staff-demo",
    period: {
      month: "2026-07",
      from: "2026-07-01",
      toExclusive: "2026-08-01",
      timezone: "Asia/Ho_Chi_Minh",
    },
    salaryRule: {
      ruleVersionId: "salary-v1",
      configuration: {
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
    },
    monthlyLevelRule: null,
    currentLevel: null,
    attendance: [
      {
        attendanceId: "attendance-1",
        businessDate: "2026-07-01",
        status: "PRESENT",
        workUnits: "0.5",
        overtimeMinutes: 60,
        actualLiveMinutes: 300,
        revenueAmount: "500000",
        dailyRewardRule: {
          ruleVersionId: "daily-v1",
          tiers: [
            {
              code: "ALL",
              minRevenue: "0",
              maxRevenue: null,
              minInclusive: true,
              maxInclusive: false,
              priority: 0,
              rewardAmount: "100000",
            },
          ],
        },
        violations: [
          {
            violationId: "violation-1",
            ruleVersionId: "penalty-v1",
            amount: "50000",
            itemName: "Đi muộn",
          },
        ],
      },
    ],
    adjustments: [],
  };
  return {
    companyName: "ALD Demo",
    employeeRevenueVisible: false,
    branchCode: "HCM",
    branchName: "Hồ Chí Minh",
    month: "2026-07",
    revision: 1,
    status: "PUBLISHED",
    calculationNo: 1,
    calculationHash: "a".repeat(64),
    staff: {
      id: "staff-demo",
      code: "LIVE001",
      fullName: "Nguyễn Thị Ánh",
      streamingAlias: "anh-live",
    },
    input,
    output: calculatePayroll(input),
  };
}

describe("payroll export artifacts", () => {
  it("writes a reconciled XLSX with no hidden revenue column when company setting is off", async () => {
    const data = fixture();
    const buffer = await createPayslipWorkbook(data, new Date("2026-07-31T10:00:00.000Z"));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
    const summary = workbook.getWorksheet("Phiếu lương")!;
    const daily = workbook.getWorksheet("Chi tiết ngày")!;
    const totalCell = summary.getCell("B19");
    expect(totalCell.value).toMatchObject({
      formula: expect.any(String),
      result: Number(data.output.components.totalIncome),
    });
    const headers = daily.getRow(2).values as unknown[];
    expect(headers).not.toContain("Doanh số");
    expect(buffer.length).toBeGreaterThan(8_000);
    if (process.env.PAYROLL_QA_DIR) {
      await mkdir(process.env.PAYROLL_QA_DIR, { recursive: true });
      await writeFile(path.join(process.env.PAYROLL_QA_DIR, "payslip-demo.xlsx"), buffer);
    }
  });

  it("embeds a Vietnamese-capable font and creates a valid PDF", async () => {
    const buffer = await createPayslipPdf(fixture(), new Date("2026-07-31T10:00:00.000Z"));
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(7_000);
    if (process.env.PAYROLL_QA_DIR) {
      await mkdir(process.env.PAYROLL_QA_DIR, { recursive: true });
      await writeFile(path.join(process.env.PAYROLL_QA_DIR, "payslip-demo.pdf"), buffer);
    }
  });

  it("creates a bulk ZIP containing per-employee XLSX and PDF artifacts", async () => {
    const data = fixture();
    const [xlsx, pdf] = await Promise.all([createPayslipWorkbook(data), createPayslipPdf(data)]);
    const zip = await createPayrollZip([
      { name: "LIVE001.xlsx", buffer: xlsx },
      { name: "LIVE001.pdf", buffer: pdf },
    ]);
    expect(zip.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(zip.toString("binary")).toContain("LIVE001.xlsx");
    expect(zip.toString("binary")).toContain("LIVE001.pdf");
  });
});
