import type { AttendancePrintDataDto } from "@ald/contracts";

export function escapeAttendancePrintHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function displayDate(value: string): string {
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
}

function displayTimestamp(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function displayTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function duration(minutes: number): string {
  const safe = Math.max(0, Math.trunc(minutes));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function money(value: string): string {
  return `${new Intl.NumberFormat("vi-VN").format(BigInt(value))} ₫`;
}

function coins(value: string): string {
  return `${new Intl.NumberFormat("vi-VN").format(BigInt(value))} xu`;
}

const weekdays = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

export function renderAttendancePrintHtml(data: AttendancePrintDataDto): string {
  const monthLabel = `${data.month.slice(5, 7)}/${data.month.slice(0, 4)}`;
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Phiếu chấm công ${escapeAttendancePrintHtml(monthLabel)} - ${escapeAttendancePrintHtml(data.staff.fullName)}</title>
  <style>
    :root { color: #0f172a; font-family: Arial, sans-serif; font-size: 11px; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 18px; background: #fff; }
    .toolbar { display: flex; justify-content: flex-end; margin-bottom: 14px; }
    button { border: 0; border-radius: 8px; background: #075985; color: #fff; cursor: pointer; padding: 9px 15px; font-weight: 700; }
    header { border-bottom: 2px solid #0369a1; margin-bottom: 12px; padding-bottom: 10px; }
    h1 { font-size: 21px; margin: 0; }
    h2 { font-size: 16px; margin: 4px 0 0; }
    p { margin: 4px 0 0; color: #475569; overflow-wrap: anywhere; }
    .identity { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; margin: 12px 0; }
    .identity > div { border: 1px solid #cbd5e1; border-radius: 7px; padding: 7px; min-width: 0; }
    .identity small, .identity strong { display: block; overflow-wrap: anywhere; }
    .identity small { color: #64748b; }
    .identity strong { margin-top: 3px; }
    table { border-collapse: collapse; table-layout: fixed; width: 100%; }
    th, td { border: 1px solid #cbd5e1; overflow-wrap: anywhere; padding: 5px; vertical-align: top; }
    thead th { background: #e0f2fe; text-align: left; }
    tfoot th, tfoot td { background: #bae6fd; font-weight: 800; }
    .number { text-align: right; white-space: nowrap; }
    .penalty { color: #be123c; }
    .date { width: 7%; }
    .weekday { width: 6%; }
    .time { width: 6%; }
    .duration { width: 6%; }
    .work { width: 5%; }
    .coins { width: 8%; }
    .money { width: 8%; }
    .violations { width: 12%; }
    .note { width: 12%; }
    @page { size: A4 landscape; margin: 8mm; }
    @media print {
      body { padding: 0; }
      .toolbar { display: none; }
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }
      tr { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">In phiếu chấm công</button></div>
  <header>
    <h1>${escapeAttendancePrintHtml(data.company.name)}</h1>
    <h2>PHIẾU CHẤM CÔNG VÀ CHỈ SỐ LIVE THÁNG ${escapeAttendancePrintHtml(monthLabel)}</h2>
    <p>Cơ sở ${escapeAttendancePrintHtml(data.branch.code)} — ${escapeAttendancePrintHtml(data.branch.name)} · Tạo lúc ${escapeAttendancePrintHtml(displayTimestamp(data.generatedAt))}</p>
  </header>
  <section class="identity">
    <div><small>Họ và tên</small><strong>${escapeAttendancePrintHtml(data.staff.fullName)}</strong></div>
    <div><small>Mã nhân viên</small><strong>${escapeAttendancePrintHtml(data.staff.staffCode)}</strong></div>
    <div><small>Mã máy chấm công</small><strong>${escapeAttendancePrintHtml(data.staff.attendanceMachineCode ?? "—")}</strong></div>
    <div><small>Tên kênh / alias</small><strong>${escapeAttendancePrintHtml(data.staff.streamingAlias ?? "—")}</strong></div>
  </section>
  <table>
    <thead>
      <tr>
        <th class="date">Ngày</th><th class="weekday">Thứ</th><th class="time">Check-in</th><th class="time">Check-out</th>
        <th class="duration">Live</th><th class="duration">Tăng ca</th><th class="work">Công</th><th class="coins">Doanh số</th>
        <th class="money">Thưởng ngày</th><th class="violations">Lỗi hiện hành</th><th class="money">Tiền phạt</th><th class="note">Ghi chú</th>
      </tr>
    </thead>
    <tbody>
      ${data.rows
        .map(
          (row) => `<tr>
        <td>${escapeAttendancePrintHtml(displayDate(row.businessDate))}</td>
        <td>${escapeAttendancePrintHtml(weekdays[row.dayOfWeek] ?? "")}</td>
        <td class="number">${escapeAttendancePrintHtml(displayTime(row.checkInAt))}</td>
        <td class="number">${escapeAttendancePrintHtml(displayTime(row.checkOutAt))}</td>
        <td class="number">${escapeAttendancePrintHtml(duration(row.actualLiveMinutes))}</td>
        <td class="number">${escapeAttendancePrintHtml(duration(row.overtimeMinutes))}</td>
        <td class="number">${escapeAttendancePrintHtml(row.workUnits)}</td>
        <td class="number">${escapeAttendancePrintHtml(coins(row.revenueAmount))}</td>
        <td class="number">${escapeAttendancePrintHtml(money(row.dailyRewardAmount))}</td>
        <td>${escapeAttendancePrintHtml(row.violationNames.length > 0 ? row.violationNames.join(", ") : "—")}</td>
        <td class="number penalty">${escapeAttendancePrintHtml(money(row.penaltyAmount))}</td>
        <td>${escapeAttendancePrintHtml(row.note ?? "")}</td>
      </tr>`,
        )
        .join("")}
    </tbody>
    <tfoot>
      <tr>
        <th colspan="4">TỔNG · ${data.totals.workedDayCount} ngày làm việc</th>
        <th class="number">${escapeAttendancePrintHtml(duration(data.totals.actualLiveMinutes))}</th>
        <th class="number">${escapeAttendancePrintHtml(duration(data.totals.overtimeMinutes))}</th>
        <th class="number">${escapeAttendancePrintHtml(data.totals.workUnits)}</th>
        <th class="number">${escapeAttendancePrintHtml(coins(data.totals.revenueAmount))}</th>
        <th class="number">${escapeAttendancePrintHtml(money(data.totals.dailyRewardAmount))}</th>
        <th></th>
        <th class="number penalty">${escapeAttendancePrintHtml(money(data.totals.penaltyAmount))}</th>
        <th></th>
      </tr>
    </tfoot>
  </table>
  <script>window.addEventListener("load",function(){setTimeout(function(){window.print()},150)})</script>
</body>
</html>`;
}

export function attendancePrintResponse(data: AttendancePrintDataDto): Response {
  return new Response(renderAttendancePrintHtml(data), {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `inline; filename="attendance-${data.month}.html"`,
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
}
