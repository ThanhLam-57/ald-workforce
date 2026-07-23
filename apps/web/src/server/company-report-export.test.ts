import type { CompanyMonthlyReportDto } from "@ald/contracts";
import ExcelJS from "exceljs";
import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { createCompanyReportPdf, createCompanyReportWorkbook } from "./company-report-export";

export const sampleCompanyReport: CompanyMonthlyReportDto = {
  month: "2026-09",
  generatedAt: "2026-10-01T01:00:00.000Z",
  weeks: [
    { weekNo: 1, from: "2026-09-01", to: "2026-09-06" },
    { weekNo: 2, from: "2026-09-07", to: "2026-09-13" },
    { weekNo: 3, from: "2026-09-14", to: "2026-09-20" },
    { weekNo: 4, from: "2026-09-21", to: "2026-09-27" },
    { weekNo: 5, from: "2026-09-28", to: "2026-09-30" },
  ],
  branches: [
    {
      branch: { id: "branch-a", code: "A", name: "Cơ sở A" },
      payrollStatus: "PUBLISHED",
      payrollRevision: 1,
      staff: [
        {
          staff: {
            id: "staff-a",
            staffCode: "LIVE-A",
            fullName: "Nhân viên A",
            employmentCategory: "OFFICIAL",
            employmentStatus: "ACTIVE",
            performanceLevel: { id: "level-a", code: "L1", name: "Level 1" },
          },
          weeks: [
            { weekNo: 1, revenueAmount: "1000000" },
            { weekNo: 2, revenueAmount: "2000000" },
            { weekNo: 3, revenueAmount: "0" },
            { weekNo: 4, revenueAmount: "0" },
            { weekNo: 5, revenueAmount: "0" },
          ],
          payrollStatus: "PUBLISHED",
          payrollRevision: 1,
          totals: {
            revenueAmount: "3000000",
            revenueBonus: "100000",
            monthlyBonus: "200000",
            baseSalary: "13000000",
            totalIncome: "12800000",
            workUnits: "20",
            penalties: "500000",
          },
        },
      ],
      totals: {
        revenueAmount: "3000000",
        revenueBonus: "100000",
        monthlyBonus: "200000",
        baseSalary: "13000000",
        totalIncome: "12800000",
        workUnits: "20",
        penalties: "500000",
      },
    },
    {
      branch: { id: "branch-b", code: "B", name: "Cơ sở B" },
      payrollStatus: "LOCKED",
      payrollRevision: 2,
      staff: [
        {
          staff: {
            id: "staff-b",
            staffCode: "LIVE-B",
            fullName: "Nhân viên B đã nghỉ",
            employmentCategory: "PROBATION",
            employmentStatus: "TERMINATED",
            performanceLevel: null,
          },
          weeks: [
            { weekNo: 1, revenueAmount: "1000000" },
            { weekNo: 2, revenueAmount: "0" },
            { weekNo: 3, revenueAmount: "0" },
            { weekNo: 4, revenueAmount: "0" },
            { weekNo: 5, revenueAmount: "0" },
          ],
          payrollStatus: "LOCKED",
          payrollRevision: 2,
          totals: {
            revenueAmount: "1000000",
            revenueBonus: "50000",
            monthlyBonus: "0",
            baseSalary: "8000000",
            totalIncome: "3500000",
            workUnits: "10",
            penalties: "0",
          },
        },
      ],
      totals: {
        revenueAmount: "1000000",
        revenueBonus: "50000",
        monthlyBonus: "0",
        baseSalary: "8000000",
        totalIncome: "3500000",
        workUnits: "10",
        penalties: "0",
      },
    },
  ],
  totals: {
    revenueAmount: "4000000",
    revenueBonus: "150000",
    monthlyBonus: "200000",
    baseSalary: "21000000",
    totalIncome: "16300000",
    workUnits: "30",
    penalties: "500000",
  },
  charts: {
    revenueByBranch: [
      { id: "branch-a", label: "A", value: "3000000" },
      { id: "branch-b", label: "B", value: "1000000" },
    ],
    revenueByEmployee: [
      { id: "staff-a", label: "LIVE-A - Nhân viên A", value: "3000000" },
      { id: "staff-b", label: "LIVE-B - Nhân viên B đã nghỉ", value: "1000000" },
    ],
    revenueTrend: [
      { businessDate: "2026-09-01", value: "2000000" },
      { businessDate: "2026-09-07", value: "2000000" },
    ],
    bonusPenalty: [
      { label: "A", bonus: "300000", penalty: "500000" },
      { label: "B", bonus: "50000", penalty: "0" },
    ],
  },
};

describe("company report exports", () => {
  it("creates an auditable workbook with formulas and checks", async () => {
    const buffer = await createCompanyReportWorkbook(
      sampleCompanyReport,
      new Date("2026-10-01T01:00:00.000Z"),
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(buffer).buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Tổng hợp",
      "Chi tiết",
      "Kiểm tra",
    ]);
    expect(workbook.getWorksheet("Tổng hợp")?.getCell("C9").value).toMatchObject({
      formula: "SUM(C7:C8)",
      result: 4000000,
    });
    expect(workbook.getWorksheet("Kiểm tra")?.getCell("D2").value).toMatchObject({
      formula: 'IF(B2=C2,"PASS","FAIL")',
      result: "PASS",
    });
    if (process.env.REPORT_QA_DIR) {
      await mkdir(process.env.REPORT_QA_DIR, { recursive: true });
      await writeFile(`${process.env.REPORT_QA_DIR}/company-report-demo.xlsx`, buffer);
    }
  });

  it("creates a Vietnamese PDF", async () => {
    const buffer = await createCompanyReportPdf(
      sampleCompanyReport,
      new Date("2026-10-01T01:00:00.000Z"),
    );

    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(10_000);
    if (process.env.REPORT_QA_DIR) {
      await mkdir(process.env.REPORT_QA_DIR, { recursive: true });
      await writeFile(`${process.env.REPORT_QA_DIR}/company-report-demo.pdf`, buffer);
    }
  });
});
