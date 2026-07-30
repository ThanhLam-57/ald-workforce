import type { PayrollEntryDto, PayrollPeriodDto } from "@ald/contracts";
import { describe, expect, it } from "vitest";

import { renderPayrollPrintHtml } from "./payroll-print";

const entry = {
  id: "entry-1",
  staff: {
    id: "staff-1",
    staffCode: "LIVE01",
    fullName: "Nhân viên <script>alert(1)</script>",
    streamingAlias: null,
    attendanceMachineCode: "00033",
    attendanceMachineCodeIntervals: [
      {
        assignmentId: "assignment-1",
        attendanceMachineCode: "00033",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
      },
    ],
  },
  workUnits: "1",
  workedDayCount: 1,
  overtimeMinutes: 30,
  currentMonthCoins: "100000",
  actualLiveMinutes: 360,
  sourceBaseSalary: "7000000",
  baseSalary: "7000000",
  proratedSalary: "269231",
  dailyRevenueBonus: "50000",
  monthlyRevenueBonus: "0",
  attendanceBonus: "0",
  achievementBonus: "0",
  levelBonus: "0",
  overtimePay: "10000",
  otherBonus: "0",
  penalties: "20000",
  advance: "0",
  totalIncome: "309231",
  dailyRows: [
    {
      businessDate: "2026-07-01",
      checkInTime: "09:00",
      checkOutTime: "15:30",
      status: "PRESENT",
      workUnits: "1",
      overtimeMinutes: 30,
      actualLiveMinutes: 360,
      dailyCoins: "100000",
      dailyRevenueBonus: "50000",
      violationCategory: "Đi muộn",
      violationDetail: "5 phút",
      penalties: "20000",
      note: "Đã xác nhận",
      source: {},
      overriddenFields: [],
    },
  ],
} as unknown as PayrollEntryDto;

const period = {
  id: "period-1",
  branch: { id: "branch-1", code: "XT_01", name: "Xuân Thủy" },
  month: "2026-07",
  revision: 1,
  entries: [entry],
  totals: {
    staffCount: 1,
    grossIncome: "329231",
    penalties: "20000",
    advance: "0",
    totalIncome: "309231",
  },
} as unknown as PayrollPeriodDto;

describe("payroll print HTML", () => {
  it("render bảng tổng hợp không có cột trạng thái và escape dữ liệu", () => {
    const html = renderPayrollPrintHtml(period, null);
    expect(html).toContain("Bảng lương cơ sở");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<th>Trạng thái</th>");
    expect(html).toContain("<th>Mã máy chấm công</th>");
    expect(html).toContain("00033");
  });

  it("render phiếu cá nhân với dòng ngày và tổng thu nhập", () => {
    const html = renderPayrollPrintHtml(period, entry);
    expect(html).toContain("Phiếu lương nhân viên");
    expect(html).toContain("01/07/2026");
    expect(html).toContain("TỔNG THU NHẬP");
    expect(html).toContain("<small>Mã máy chấm công</small>");
  });
});
