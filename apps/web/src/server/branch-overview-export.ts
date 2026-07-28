import type { BranchMonthlyOverviewDto } from "@ald/contracts";
import ExcelJS from "exceljs";

const employmentCategoryLabels = {
  OFFICIAL: "Chính thức",
  PROBATION: "Thử việc",
  CONTRACTOR: "Hợp đồng",
  INTERN: "Thực tập",
} as const;

const HEADER_FILL = "FF075985";
const SUBHEADER_FILL = "FFE0F2FE";
const TOTAL_FILL = "FFF1F5F9";
const BORDER_COLOR = "FFCBD5E1";

function columnName(column: number): string {
  let value = column;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function exactExcelNumber(value: string): number | string {
  const integer = BigInt(value);
  return integer <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(integer) : value;
}

export async function createBranchOverviewWorkbook(
  overview: BranchMonthlyOverviewDto,
  generatedAt = new Date(),
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ALD Workforce";
  workbook.created = generatedAt;
  workbook.modified = generatedAt;

  const sheet = workbook.addWorksheet("Tổng quan cơ sở", {
    properties: { tabColor: { argb: "FF0284C7" } },
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      paperSize: 9,
      margins: {
        left: 0.25,
        right: 0.25,
        top: 0.5,
        bottom: 0.5,
        header: 0.2,
        footer: 0.2,
      },
    },
  });
  sheet.views = [
    {
      state: "frozen",
      xSplit: 6,
      ySplit: 6,
      topLeftCell: "G7",
      showGridLines: false,
    },
  ];

  const identityHeaders = [
    "STT",
    "Mã nhân viên",
    "Nhân viên",
    "ACC / Alias",
    "Loại nhân sự",
    "Cấp bậc",
  ];
  const totalHeaders = ["Tổng xu", "Tổng công", "Tổng Live", "Tăng ca", "Tiền phạt"];
  const firstDayColumn = identityHeaders.length + 1;
  const firstTotalColumn = firstDayColumn + overview.calendar.length * 2;
  const lastColumn = firstTotalColumn + totalHeaders.length - 1;
  const lastColumnName = columnName(lastColumn);
  const titleEndColumnName = columnName(Math.min(lastColumn, 20));

  sheet.mergeCells(`A1:${titleEndColumnName}1`);
  sheet.getCell("A1").value = "BẢNG TỔNG QUAN THÁNG THEO CƠ SỞ";
  sheet.getCell("A1").font = {
    bold: true,
    size: 18,
    color: { argb: "FF0F172A" },
  };
  sheet.getCell("A1").alignment = {
    horizontal: "center",
    vertical: "middle",
  };
  sheet.getRow(1).height = 30;

  sheet.mergeCells(`A2:${titleEndColumnName}2`);
  sheet.getCell("A2").value =
    `Cơ sở: ${overview.branch.code} — ${overview.branch.name} · Tháng ${overview.month.slice(
      5,
    )}/${overview.month.slice(0, 4)}`;
  sheet.getCell("A2").font = { italic: true, color: { argb: "FF475569" } };
  sheet.getCell("A2").alignment = { horizontal: "center" };

  sheet.mergeCells(`A3:${titleEndColumnName}3`);
  sheet.getCell("A3").value = `Xuất lúc ${new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
    timeStyle: "short",
  }).format(
    generatedAt,
  )} · Doanh số tính bằng xu`;
  sheet.getCell("A3").font = { size: 10, color: { argb: "FF64748B" } };
  sheet.getCell("A3").alignment = { horizontal: "center" };

  identityHeaders.forEach((header, index) => {
    const column = index + 1;
    sheet.mergeCells(5, column, 6, column);
    sheet.getCell(5, column).value = header;
  });
  overview.calendar.forEach((day, index) => {
    const column = firstDayColumn + index * 2;
    sheet.mergeCells(5, column, 5, column + 1);
    sheet.getCell(5, column).value = `${day.businessDate.slice(8, 10)}/${day.businessDate.slice(
      5,
      7,
    )} · Tuần ${day.weekOfMonth}`;
    sheet.getCell(6, column).value = "Số xu";
    sheet.getCell(6, column + 1).value = "Live (phút)";
  });
  totalHeaders.forEach((header, index) => {
    const column = firstTotalColumn + index;
    sheet.mergeCells(5, column, 6, column);
    sheet.getCell(5, column).value = header;
  });

  const headerRange = sheet.getRows(5, 2) ?? [];
  for (const row of headerRange) {
    row.height = 27;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: row.number === 5 ? HEADER_FILL : SUBHEADER_FILL },
      };
      cell.font = {
        bold: true,
        color: { argb: row.number === 5 ? "FFFFFFFF" : "FF0C4A6E" },
        size: 10,
      };
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
      cell.border = {
        bottom: { style: "thin", color: { argb: BORDER_COLOR } },
        right: { style: "thin", color: { argb: BORDER_COLOR } },
      };
    });
  }

  overview.rows.forEach((overviewRow, rowIndex) => {
    const excelRow = sheet.getRow(7 + rowIndex);
    const values: Array<string | number | null> = [
      rowIndex + 1,
      overviewRow.staff.staffCode,
      overviewRow.staff.fullName,
      overviewRow.staff.streamingAlias,
      employmentCategoryLabels[overviewRow.staff.employmentCategory],
      overviewRow.staff.performanceLevel?.name ?? "Chưa xếp hạng",
    ];
    for (const day of overviewRow.days) {
      values.push(exactExcelNumber(day.revenueAmount), day.actualLiveMinutes);
    }
    values.push(
      exactExcelNumber(overviewRow.totals.revenueAmount),
      Number(overviewRow.totals.workUnits),
      overviewRow.totals.actualLiveMinutes,
      overviewRow.totals.overtimeMinutes,
      exactExcelNumber(overviewRow.totals.penaltyAmount),
    );
    excelRow.values = values;
    excelRow.height = 24;
    excelRow.eachCell({ includeEmpty: true }, (cell, column) => {
      cell.alignment = {
        vertical: "middle",
        horizontal: column <= 6 ? "left" : "right",
      };
      cell.border = {
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
      if (rowIndex % 2 === 1) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF8FAFC" },
        };
      }
    });
  });

  const totalRow = sheet.getRow(7 + overview.rows.length);
  sheet.mergeCells(totalRow.number, 1, totalRow.number, 6);
  totalRow.getCell(1).value = "TỔNG CƠ SỞ";
  const totalValues: Array<number | string> = [
    exactExcelNumber(overview.totals.revenueAmount),
    Number(overview.totals.workUnits),
    overview.totals.actualLiveMinutes,
    overview.totals.overtimeMinutes,
    exactExcelNumber(overview.totals.penaltyAmount),
  ];
  totalValues.forEach((value, index) => {
    totalRow.getCell(firstTotalColumn + index).value = value;
  });
  totalRow.height = 27;
  totalRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: TOTAL_FILL },
    };
    cell.font = { bold: true, color: { argb: "FF0F172A" } };
    cell.border = {
      top: { style: "medium", color: { argb: "FF64748B" } },
      bottom: { style: "thin", color: { argb: BORDER_COLOR } },
    };
  });

  [1, 7, 8, 9, 10, 11].forEach((column) => {
    if (column <= lastColumn) sheet.getColumn(column).numFmt = "#,##0";
  });
  for (let index = 0; index < overview.calendar.length; index += 1) {
    sheet.getColumn(firstDayColumn + index * 2).numFmt = "#,##0";
    sheet.getColumn(firstDayColumn + index * 2 + 1).numFmt = "#,##0";
  }
  sheet.getColumn(firstTotalColumn).numFmt = "#,##0";
  sheet.getColumn(firstTotalColumn + 1).numFmt = "#,##0.00";
  sheet.getColumn(firstTotalColumn + 2).numFmt = "#,##0";
  sheet.getColumn(firstTotalColumn + 3).numFmt = "#,##0";
  sheet.getColumn(firstTotalColumn + 4).numFmt = "#,##0";

  const widths = [6, 14, 24, 18, 16, 18];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  for (let index = 0; index < overview.calendar.length; index += 1) {
    sheet.getColumn(firstDayColumn + index * 2).width = 14;
    sheet.getColumn(firstDayColumn + index * 2 + 1).width = 12;
  }
  for (let index = 0; index < totalHeaders.length; index += 1) {
    sheet.getColumn(firstTotalColumn + index).width = index === 0 ? 16 : 13;
  }

  sheet.pageSetup.printTitlesRow = "1:6";
  sheet.pageSetup.printArea = `A1:${lastColumnName}${totalRow.number}`;

  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data);
}
