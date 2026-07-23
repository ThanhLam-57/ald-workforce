import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";

import type { CompanyMonthlyReportDto } from "@ald/contracts";
import { prisma } from "@ald/db";
import type { ActorContext } from "@ald/domain";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

import type { RequestMetadata } from "./request-metadata";

function excelNumber(value: string): number | string {
  const integer = BigInt(value);
  return integer >= BigInt(Number.MIN_SAFE_INTEGER) && integer <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(integer)
    : value;
}

function money(value: string): string {
  return new Intl.NumberFormat("vi-VN").format(BigInt(value));
}

function styleHeader(row: ExcelJS.Row, color = "FF075985"): void {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
      right: { style: "thin", color: { argb: "FFCBD5E1" } },
    };
  });
  row.height = 28;
}

export async function createCompanyReportWorkbook(
  report: CompanyMonthlyReportDto,
  generatedAt = new Date(),
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ALD Workforce";
  workbook.created = generatedAt;
  workbook.modified = generatedAt;
  workbook.subject = `COMPANY_REPORT_V1 · ${report.month}`;

  const summary = workbook.addWorksheet("Tổng hợp", {
    properties: { tabColor: { argb: "FF0369A1" } },
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, paperSize: 9 },
  });
  summary.views = [{ state: "frozen", ySplit: 6, showGridLines: false }];
  summary.mergeCells("A1:H1");
  summary.getCell("A1").value = "BÁO CÁO THÁNG TOÀN CÔNG TY";
  summary.getCell("A1").font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
  summary.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0C4A6E" },
  };
  summary.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  summary.getRow(1).height = 34;
  summary.mergeCells("A2:H2");
  summary.getCell("A2").value =
    `Tháng ${report.month.slice(5)}/${report.month.slice(0, 4)} · Xuất ${new Intl.DateTimeFormat(
      "vi-VN",
      { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" },
    ).format(generatedAt)}`;
  summary.getCell("A2").alignment = { horizontal: "center" };
  summary.getCell("A2").font = { italic: true, color: { argb: "FF475569" } };
  summary.getRow(4).values = [
    "Doanh số",
    excelNumber(report.totals.revenueAmount),
    "Thưởng doanh số",
    excelNumber(report.totals.revenueBonus),
    "Thưởng tháng",
    excelNumber(report.totals.monthlyBonus),
    "Tổng thu nhập",
    excelNumber(report.totals.totalIncome),
  ];
  for (let column = 1; column <= 8; column += 2) {
    summary.getCell(4, column).font = { bold: true, color: { argb: "FF0C4A6E" } };
    summary.getCell(4, column + 1).font = { bold: true, size: 12 };
    summary.getCell(4, column + 1).numFmt = "#,##0;[Red](#,##0);-";
  }
  summary.getRow(6).values = [
    "Mã cơ sở",
    "Cơ sở",
    "Doanh số",
    "Thưởng doanh số",
    "Thưởng tháng",
    "Lương cơ bản",
    "Phạt",
    "Tổng thu nhập",
  ];
  styleHeader(summary.getRow(6));
  report.branches.forEach((branch, index) => {
    const row = summary.getRow(7 + index);
    row.values = [
      branch.branch.code,
      branch.branch.name,
      excelNumber(branch.totals.revenueAmount),
      excelNumber(branch.totals.revenueBonus),
      excelNumber(branch.totals.monthlyBonus),
      excelNumber(branch.totals.baseSalary),
      excelNumber(branch.totals.penalties),
      excelNumber(branch.totals.totalIncome),
    ];
    row.height = 23;
    row.eachCell((cell, column) => {
      cell.border = { bottom: { style: "thin", color: { argb: "FFE2E8F0" } } };
      if (column >= 3) cell.numFmt = "#,##0;[Red](#,##0);-";
    });
  });
  const totalRowNumber = 7 + report.branches.length;
  const totalRow = summary.getRow(totalRowNumber);
  summary.mergeCells(`A${totalRowNumber}:B${totalRowNumber}`);
  totalRow.getCell(1).value = "TỔNG CÔNG TY";
  totalRow.getCell(1).alignment = { horizontal: "center" };
  for (let column = 3; column <= 8; column += 1) {
    const letter = String.fromCharCode(64 + column);
    const resultKey = [
      "revenueAmount",
      "revenueBonus",
      "monthlyBonus",
      "baseSalary",
      "penalties",
      "totalIncome",
    ][column - 3] as keyof typeof report.totals;
    totalRow.getCell(column).value = {
      formula:
        report.branches.length === 0 ? "0" : `SUM(${letter}7:${letter}${totalRowNumber - 1})`,
      result: excelNumber(report.totals[resultKey]),
    };
    totalRow.getCell(column).numFmt = "#,##0;[Red](#,##0);-";
  }
  totalRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0F2FE" } };
    cell.border = { top: { style: "medium", color: { argb: "FF64748B" } } };
  });
  [14, 25, 17, 18, 18, 17, 15, 18].forEach((width, index) => {
    summary.getColumn(index + 1).width = width;
  });

  const detail = workbook.addWorksheet("Chi tiết", {
    properties: { tabColor: { argb: "FF0EA5E9" } },
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, paperSize: 9 },
  });
  detail.views = [{ state: "frozen", ySplit: 2, xSplit: 5, showGridLines: false }];
  const headers = [
    "Cơ sở",
    "Mã NV",
    "Nhân viên",
    "Trạng thái",
    "Loại NV",
    "Level",
    ...report.weeks.map((week) => `Tuần ${week.weekNo}`),
    "Doanh số tháng",
    "Thưởng doanh số",
    "Thưởng tháng",
    "Lương cơ bản",
    "Tổng thu nhập",
  ];
  detail.mergeCells(1, 1, 1, headers.length);
  detail.getCell(1, 1).value = `CHI TIẾT THEO CƠ SỞ VÀ NHÂN VIÊN · ${report.month}`;
  detail.getCell(1, 1).font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
  detail.getCell(1, 1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0C4A6E" },
  };
  detail.getCell(1, 1).alignment = { horizontal: "center" };
  detail.getRow(2).values = headers;
  styleHeader(detail.getRow(2));
  let detailRow = 3;
  for (const branch of report.branches) {
    for (const item of branch.staff) {
      const row = detail.getRow(detailRow);
      row.values = [
        branch.branch.code,
        item.staff.staffCode,
        item.staff.fullName,
        item.staff.employmentStatus,
        item.staff.employmentCategory,
        item.staff.performanceLevel?.name ?? "Chưa xếp hạng",
        ...item.weeks.map((week) => excelNumber(week.revenueAmount)),
        excelNumber(item.totals.revenueAmount),
        excelNumber(item.totals.revenueBonus),
        excelNumber(item.totals.monthlyBonus),
        excelNumber(item.totals.baseSalary),
        excelNumber(item.totals.totalIncome),
      ];
      row.height = 23;
      row.eachCell((cell, column) => {
        cell.border = { bottom: { style: "thin", color: { argb: "FFE2E8F0" } } };
        if (column >= 7) cell.numFmt = "#,##0;[Red](#,##0);-";
      });
      detailRow += 1;
    }
  }
  [13, 13, 25, 14, 14, 17].forEach((width, index) => {
    detail.getColumn(index + 1).width = width;
  });
  for (let index = 6; index < headers.length; index += 1) {
    detail.getColumn(index + 1).width = 16;
  }

  const checks = workbook.addWorksheet("Kiểm tra", {
    properties: { tabColor: { argb: "FF22C55E" } },
  });
  checks.views = [{ showGridLines: false }];
  checks.getRow(1).values = ["Kiểm tra", "Giá trị báo cáo", "Tổng cơ sở", "Trạng thái"];
  styleHeader(checks.getRow(1), "FF166534");
  const checkRows: Array<[string, keyof typeof report.totals, number]> = [
    ["Doanh số", "revenueAmount", 3],
    ["Thưởng doanh số", "revenueBonus", 4],
    ["Thưởng tháng", "monthlyBonus", 5],
    ["Lương cơ bản", "baseSalary", 6],
    ["Tiền phạt", "penalties", 7],
    ["Tổng thu nhập", "totalIncome", 8],
  ];
  checkRows.forEach(([label, key, summaryColumn], index) => {
    const row = 2 + index;
    const summaryLetter = String.fromCharCode(64 + summaryColumn);
    checks.getCell(row, 1).value = label;
    checks.getCell(row, 2).value = excelNumber(report.totals[key]);
    checks.getCell(row, 3).value = {
      formula: `'Tổng hợp'!${summaryLetter}${totalRowNumber}`,
      result: excelNumber(report.totals[key]),
    };
    checks.getCell(row, 4).value = {
      formula: `IF(B${row}=C${row},"PASS","FAIL")`,
      result: "PASS",
    };
    checks.getCell(row, 2).numFmt = "#,##0;[Red](#,##0);-";
    checks.getCell(row, 3).numFmt = "#,##0;[Red](#,##0);-";
  });
  checks.getColumn(1).width = 24;
  checks.getColumn(2).width = 20;
  checks.getColumn(3).width = 20;
  checks.getColumn(4).width = 14;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function readBundledFont(fileName: string): Promise<Buffer> {
  const processEntryDirectory = path.dirname(process.argv[1] ?? process.cwd());
  const roots = [
    path.join(process.cwd(), "apps", "web", "assets", "fonts"),
    path.join(process.cwd(), "assets", "fonts"),
    path.join(processEntryDirectory, "assets", "fonts"),
  ];
  let lastError: unknown;
  for (const root of new Set(roots)) {
    try {
      return await readFile(path.join(root, fileName));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Không tìm thấy font Noto Sans.");
}

async function pdfFonts(): Promise<{ regular: Buffer; bold: Buffer }> {
  const [regular, bold] = await Promise.all([
    readBundledFont("NotoSans_400Regular.ttf"),
    readBundledFont("NotoSans_700Bold.ttf"),
  ]);
  return { regular, bold };
}

export async function createCompanyReportPdf(
  report: CompanyMonthlyReportDto,
  generatedAt = new Date(),
): Promise<Buffer> {
  const fonts = await pdfFonts();
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 32,
      info: {
        Title: `Báo cáo công ty ${report.month}`,
        Author: "ALD Workforce",
        Subject: "COMPANY_REPORT_V1",
      },
    });
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk));
    output.on("end", () => resolve(Buffer.concat(chunks)));
    output.on("error", reject);
    document.on("error", reject);
    document.pipe(output);
    document.registerFont("Noto", fonts.regular);
    document.registerFont("NotoBold", fonts.bold);
    document.font("NotoBold").fontSize(1).fillColor("#075985").text(".", 1, 35, {
      lineBreak: false,
    });

    const drawPageHeader = (subtitle: string, compact = false): void => {
      const title = "BÁO CÁO THÁNG TOÀN CÔNG TY";
      const contentWidth = document.page.width - 64;
      document.rect(0, 0, document.page.width, 90).fill("#075985");
      if (compact) {
        document.font("Noto").fontSize(15).fillColor("#FFFFFF").text(subtitle, 32, 46, {
          width: contentWidth,
          align: "center",
          lineBreak: false,
        });
        document.x = 32;
        document.y = 108;
        return;
      }
      document.font("NotoBold").fontSize(17).fillColor("#FFFFFF");
      document.text(title, 32, 35, {
        width: contentWidth,
        align: "center",
        lineBreak: false,
      });
      document.font("Noto").fontSize(8);
      document.text(subtitle, 32, 62, {
        width: contentWidth,
        align: "center",
        lineBreak: false,
      });
      document.x = 32;
      document.y = 108;
    };
    const beginPage = (subtitle: string, compact = false): number => {
      drawPageHeader(subtitle, compact);
      return 108;
    };
    let y = beginPage(
      `Tháng ${report.month.slice(5)}/${report.month.slice(0, 4)} · ${new Intl.DateTimeFormat(
        "vi-VN",
        { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" },
      ).format(generatedAt)}`,
    );
    const cards = [
      ["Doanh số", report.totals.revenueAmount],
      ["Thưởng doanh số", report.totals.revenueBonus],
      ["Thưởng tháng", report.totals.monthlyBonus],
      ["Tiền phạt", report.totals.penalties],
      ["Tổng thu nhập", report.totals.totalIncome],
    ] as const;
    const cardWidth = (document.page.width - 64 - 4 * 10) / 5;
    cards.forEach(([label, value], index) => {
      const x = 32 + index * (cardWidth + 10);
      document.roundedRect(x, y, cardWidth, 55, 5).fillAndStroke("#F0F9FF", "#BAE6FD");
      document
        .font("Noto")
        .fontSize(8)
        .fillColor("#475569")
        .text(label, x + 8, y + 8);
      document
        .font("NotoBold")
        .fontSize(12)
        .fillColor("#0F172A")
        .text(`${money(value)} đ`, x + 8, y + 26, { width: cardWidth - 16 });
    });
    y += 73;
    const tableHeader = (): void => {
      document.rect(32, y, document.page.width - 64, 22).fill("#0C4A6E");
      const headers = [
        ["Cơ sở", 32, 100],
        ["Doanh số", 132, 120],
        ["Thưởng DS", 252, 105],
        ["Thưởng tháng", 357, 115],
        ["Lương cơ bản", 472, 115],
        ["Phạt", 587, 90],
        ["Tổng thu nhập", 677, 105],
      ] as const;
      document.font("NotoBold").fontSize(8).fillColor("#FFFFFF");
      headers.forEach(([label, x, width]) => document.text(label, x + 5, y + 7, { width }));
      y += 22;
    };
    tableHeader();
    for (const branch of report.branches) {
      if (y > document.page.height - 55) {
        document.addPage();
        y = beginPage(`Tổng hợp theo cơ sở · ${report.month}`, true);
        tableHeader();
      }
      document.rect(32, y, document.page.width - 64, 23).fill("#F8FAFC");
      document.font("Noto").fontSize(8).fillColor("#0F172A");
      const values = [
        [`${branch.branch.code} - ${branch.branch.name}`, 32, 100],
        [money(branch.totals.revenueAmount), 132, 120],
        [money(branch.totals.revenueBonus), 252, 105],
        [money(branch.totals.monthlyBonus), 357, 115],
        [money(branch.totals.baseSalary), 472, 115],
        [money(branch.totals.penalties), 587, 90],
        [money(branch.totals.totalIncome), 677, 105],
      ] as const;
      values.forEach(([value, x, width], index) =>
        document.text(value, x + 5, y + 7, {
          width: width - 10,
          align: index === 0 ? "left" : "right",
          ellipsis: true,
        }),
      );
      y += 23;
    }

    for (const branch of report.branches) {
      document.addPage();
      y = beginPage(`${branch.branch.code} - ${branch.branch.name}`, true);
      document.font("NotoBold").fontSize(10).fillColor("#0F172A").text("Chi tiết nhân viên", 32, y);
      y += 20;
      document.rect(32, y, document.page.width - 64, 22).fill("#0C4A6E");
      document.font("NotoBold").fontSize(7.3).fillColor("#FFFFFF");
      const headers = [
        "Mã NV",
        "Nhân viên",
        "Trạng thái",
        "Level",
        "Doanh số",
        "Thưởng",
        "Lương CB",
        "Thu nhập",
      ];
      const widths = [60, 145, 70, 75, 105, 100, 105, 105];
      let x = 32;
      headers.forEach((header, index) => {
        document.text(header, x + 4, y + 7, { width: widths[index]! - 8 });
        x += widths[index]!;
      });
      y += 22;
      for (const row of branch.staff) {
        if (y > document.page.height - 45) {
          document.addPage();
          y = beginPage(`${branch.branch.code} - ${branch.branch.name} · tiếp`, true);
        }
        document.rect(32, y, document.page.width - 64, 22).fill("#F8FAFC");
        document.font("Noto").fontSize(7.3).fillColor("#0F172A");
        const bonus = (
          BigInt(row.totals.revenueBonus) + BigInt(row.totals.monthlyBonus)
        ).toString();
        const values = [
          row.staff.staffCode,
          row.staff.fullName,
          row.staff.employmentStatus,
          row.staff.performanceLevel?.name ?? "-",
          money(row.totals.revenueAmount),
          money(bonus),
          money(row.totals.baseSalary),
          money(row.totals.totalIncome),
        ];
        x = 32;
        values.forEach((value, index) => {
          document.text(value, x + 4, y + 7, {
            width: widths[index]! - 8,
            align: index >= 4 ? "right" : "left",
            ellipsis: true,
          });
          x += widths[index]!;
        });
        y += 22;
      }
    }
    document.end();
  });
}

export async function logCompanyReportExport(
  actor: ActorContext,
  report: CompanyMonthlyReportDto,
  format: "xlsx" | "pdf",
  metadata: RequestMetadata,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      companyId: actor.companyId,
      actorUserId: actor.userId,
      action: "COMPANY_REPORT_EXPORT",
      entityType: "CompanyMonthlyReport",
      entityId: report.month,
      reason: `Xuất báo cáo công ty định dạng ${format.toUpperCase()}`,
      after: {
        month: report.month,
        format,
        branchIds: report.branches.map((branch) => branch.branch.id),
        totals: report.totals,
      },
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    },
  });
}
