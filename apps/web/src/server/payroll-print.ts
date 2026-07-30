import type { PayrollEntryDto, PayrollPeriodDto } from "@ald/contracts";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value: string | bigint): string {
  return `${new Intl.NumberFormat("vi-VN").format(BigInt(value))} ₫`;
}

function coins(value: string | undefined): string {
  return value === undefined
    ? "Đã ẩn"
    : `${new Intl.NumberFormat("vi-VN").format(BigInt(value))} xu`;
}

function date(value: string): string {
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
}

function duration(minutes: number): string {
  const safe = Math.max(0, Math.trunc(minutes));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function machineCodeLabel(entry: PayrollEntryDto): string {
  const codes = [
    ...new Set(
      entry.staff.attendanceMachineCodeIntervals
        .map((interval) => interval.attendanceMachineCode)
        .filter((code): code is string => code !== null),
    ),
  ];
  return codes.length > 0 ? codes.join(" → ") : (entry.staff.attendanceMachineCode ?? "—");
}

function bonusTotal(entry: PayrollEntryDto): bigint {
  return (
    BigInt(entry.dailyRevenueBonus) +
    BigInt(entry.monthlyRevenueBonus) +
    BigInt(entry.attendanceBonus) +
    BigInt(entry.achievementBonus) +
    BigInt(entry.levelBonus) +
    BigInt(entry.overtimePay) +
    BigInt(entry.otherBonus)
  );
}

function summary(period: PayrollPeriodDto): string {
  return `
    <h2>Bảng lương cơ sở</h2>
    <table>
      <thead>
        <tr>
          <th>Nhân viên</th><th>Mã máy chấm công</th><th>Lương cơ bản</th><th>Ngày làm việc</th><th>Tổng công</th>
          <th>Tổng xu</th><th>Lương theo công</th><th>Tổng thưởng</th><th>Tổng phạt</th>
          <th>Tạm ứng</th><th>Thực nhận</th>
        </tr>
      </thead>
      <tbody>
        ${period.entries
          .map(
            (entry) => `
          <tr>
            <td><strong>${escapeHtml(entry.staff.fullName)}</strong><br><small>${escapeHtml(entry.staff.staffCode)}</small></td>
            <td>${escapeHtml(machineCodeLabel(entry))}</td>
            <td class="number">${escapeHtml(money(entry.baseSalary))}</td>
            <td class="number">${entry.workedDayCount}</td>
            <td class="number">${escapeHtml(entry.workUnits)}</td>
            <td class="number">${escapeHtml(coins(entry.currentMonthCoins))}</td>
            <td class="number">${escapeHtml(money(entry.proratedSalary))}</td>
            <td class="number positive">${escapeHtml(money(bonusTotal(entry)))}</td>
            <td class="number negative">${escapeHtml(money(entry.penalties))}</td>
            <td class="number">${escapeHtml(money(entry.advance))}</td>
            <td class="number total">${escapeHtml(money(entry.totalIncome))}</td>
          </tr>`,
          )
          .join("")}
      </tbody>
      <tfoot>
        <tr>
          <th colspan="7">TỔNG CƠ SỞ</th>
          <th class="number">${escapeHtml(money(BigInt(period.totals.grossIncome) - period.entries.reduce((sum, entry) => sum + BigInt(entry.proratedSalary), 0n)))}</th>
          <th class="number">${escapeHtml(money(period.totals.penalties))}</th>
          <th class="number">${escapeHtml(money(period.totals.advance))}</th>
          <th class="number">${escapeHtml(money(period.totals.totalIncome))}</th>
        </tr>
      </tfoot>
    </table>`;
}

function payslip(period: PayrollPeriodDto, entry: PayrollEntryDto): string {
  const components = [
    ["Lương theo công", entry.proratedSalary],
    ["Thưởng xu theo ngày", entry.dailyRevenueBonus],
    ["Thưởng xu tháng", entry.monthlyRevenueBonus],
    ["Thưởng chuyên cần", entry.attendanceBonus],
    ["Thưởng thành tích", entry.achievementBonus],
    ["Thưởng bậc", entry.levelBonus],
    ["Tiền tăng ca", entry.overtimePay],
    ["Thưởng khác", entry.otherBonus],
    ["Tiền phạt", `-${entry.penalties}`],
    ["Tạm ứng", `-${entry.advance}`],
  ] as const;
  return `
    <h2>Phiếu lương nhân viên</h2>
    <div class="identity">
      <div><small>Mã nhân viên</small><strong>${escapeHtml(entry.staff.staffCode)}</strong></div>
      <div><small>Mã máy chấm công</small><strong>${escapeHtml(machineCodeLabel(entry))}</strong></div>
      <div><small>Họ tên</small><strong>${escapeHtml(entry.staff.fullName)}</strong></div>
      <div><small>Cơ sở</small><strong>${escapeHtml(period.branch.code)} — ${escapeHtml(period.branch.name)}</strong></div>
      <div><small>Thực nhận</small><strong>${escapeHtml(money(entry.totalIncome))}</strong></div>
    </div>
    <h3>Chi tiết theo ngày</h3>
    <table>
      <thead>
        <tr>
          <th>Ngày</th><th>Check-in</th><th>Check-out</th><th>Live</th><th>Tăng ca</th>
          <th>Công</th><th>Doanh số</th><th>Thưởng ngày</th><th>Lỗi</th><th>Phạt</th><th>Ghi chú</th>
        </tr>
      </thead>
      <tbody>
        ${entry.dailyRows
          .map(
            (row) => `
          <tr>
            <td>${escapeHtml(date(row.businessDate))}</td>
            <td>${escapeHtml(row.checkInTime ?? "—")}</td>
            <td>${escapeHtml(row.checkOutTime ?? "—")}</td>
            <td class="number">${escapeHtml(duration(row.actualLiveMinutes))}</td>
            <td class="number">${escapeHtml(duration(row.overtimeMinutes))}</td>
            <td class="number">${escapeHtml(row.workUnits)}</td>
            <td class="number">${escapeHtml(coins(row.dailyCoins ?? row.revenueAmount))}</td>
            <td class="number">${escapeHtml(money(row.dailyRevenueBonus))}</td>
            <td>${escapeHtml(row.violationCategory ?? "—")}</td>
            <td class="number negative">${escapeHtml(money(row.penalties))}</td>
            <td>${escapeHtml(row.note ?? "")}</td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table>
    <h3>Tổng hợp thu nhập</h3>
    <table class="components">
      <tbody>
        ${components
          .map(
            ([label, amount]) => `
          <tr><th>${escapeHtml(label)}</th><td class="number">${escapeHtml(money(amount))}</td></tr>`,
          )
          .join("")}
        <tr class="grand-total"><th>TỔNG THU NHẬP</th><td class="number">${escapeHtml(money(entry.totalIncome))}</td></tr>
      </tbody>
    </table>`;
}

export function renderPayrollPrintHtml(
  period: PayrollPeriodDto,
  entry: PayrollEntryDto | null,
): string {
  const monthLabel = `${period.month.slice(5, 7)}/${period.month.slice(0, 4)}`;
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${entry ? "Phiếu lương" : "Bảng lương"} ${escapeHtml(monthLabel)}</title>
  <style>
    :root { color: #0f172a; font-family: Arial, sans-serif; font-size: 12px; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 20px; background: #fff; }
    .toolbar { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 16px; }
    button { border: 0; border-radius: 8px; background: #075985; color: #fff; cursor: pointer; padding: 9px 15px; font-weight: 700; }
    header { border-bottom: 2px solid #0369a1; margin-bottom: 16px; padding-bottom: 10px; }
    h1 { font-size: 22px; margin: 0; }
    h2 { font-size: 17px; margin: 16px 0 10px; }
    h3 { font-size: 14px; margin: 16px 0 8px; }
    p { margin: 5px 0 0; color: #475569; }
    table { border-collapse: collapse; table-layout: auto; width: 100%; }
    th, td { border: 1px solid #cbd5e1; max-width: 220px; overflow-wrap: anywhere; padding: 6px; vertical-align: top; }
    thead th { background: #e0f2fe; text-align: left; }
    tfoot th, tfoot td, .grand-total th, .grand-total td { background: #bae6fd; font-weight: 800; }
    small { color: #64748b; }
    .number { text-align: right; white-space: nowrap; }
    .positive { color: #047857; }
    .negative { color: #be123c; }
    .total { font-weight: 800; }
    .identity { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
    .identity > div { border: 1px solid #cbd5e1; border-radius: 8px; padding: 9px; }
    .identity small, .identity strong { display: block; overflow-wrap: anywhere; }
    .identity strong { margin-top: 4px; }
    .components { margin-left: auto; max-width: 520px; }
    .components th { text-align: left; }
    @page { size: A4 landscape; margin: 9mm; }
    @media print {
      body { padding: 0; }
      .toolbar { display: none; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">In bảng lương</button></div>
  <header>
    <h1>ALD WORKFORCE</h1>
    <p>Kỳ lương ${escapeHtml(monthLabel)} · Cơ sở ${escapeHtml(period.branch.code)} — ${escapeHtml(period.branch.name)} · Lần ${period.revision}</p>
  </header>
  ${entry ? payslip(period, entry) : summary(period)}
  <script>window.addEventListener("load",function(){setTimeout(function(){window.print()},150)})</script>
</body>
</html>`;
}
