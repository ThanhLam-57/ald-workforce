import type { AttendancePrintDataDto } from "@ald/contracts";
import { describe, expect, it } from "vitest";

import { attendancePrintResponse, renderAttendancePrintHtml } from "./attendance-print";

const printData = {
  company: { name: "ALD <script>alert(1)</script>" },
  branch: { id: "branch-1", code: "XT_01", name: "Xuân Thủy" },
  staff: {
    id: "staff-1",
    staffCode: "LIVE01",
    fullName: "Nhân viên Live",
    attendanceMachineCode: "00014",
    streamingAlias: "Bao Ngoc",
  },
  month: "2026-07",
  generatedAt: "2026-07-31T17:00:00.000Z",
  rows: [
    {
      businessDate: "2026-07-01",
      dayOfWeek: 3,
      checkInAt: "2026-07-01T02:00:00.000Z",
      checkOutAt: "2026-07-01T09:30:00.000Z",
      actualLiveMinutes: 345,
      overtimeMinutes: 30,
      workUnits: "1",
      revenueAmount: "100000",
      dailyRewardAmount: "2000000",
      violationNames: ["Đi muộn", "Thiếu giờ Live"],
      penaltyAmount: "70000",
      note: "Ghi chú <b>không phải HTML</b>",
    },
  ],
  totals: {
    workedDayCount: 1,
    workUnits: "1",
    actualLiveMinutes: 345,
    overtimeMinutes: 30,
    revenueAmount: "100000",
    dailyRewardAmount: "2000000",
    penaltyAmount: "70000",
  },
} satisfies AttendancePrintDataDto;

describe("attendance print HTML", () => {
  it("renders all attendance, live, reward, violation and penalty fields", () => {
    const html = renderAttendancePrintHtml(printData);

    expect(html).toContain("Phiếu chấm công");
    expect(html).toContain("00014");
    expect(html).toContain("01/07/2026");
    expect(html).toContain("09:00");
    expect(html).toContain("16:30");
    expect(html).toContain("05:45");
    expect(html).toContain("Đi muộn, Thiếu giờ Live");
    expect(html).toContain("70.000");
    expect(html).toContain("100.000 xu");
  });

  it("escapes user-controlled values and excludes private employee data", () => {
    const html = renderAttendancePrintHtml(printData);

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<b>không phải HTML</b>");
    expect(html).not.toMatch(/CCCD|căn cước|số tài khoản|QR ngân hàng/i);
  });

  it("returns an inline, private and non-cacheable HTML response", async () => {
    const response = attendancePrintResponse(printData);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("content-disposition")).toBe(
      'inline; filename="attendance-2026-07.html"',
    );
    await expect(response.text()).resolves.toContain("Phiếu chấm công");
  });
});
