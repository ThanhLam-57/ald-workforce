import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { PayrollCalculationInput, PayrollCalculationOutput } from "@ald/domain";
import { prisma, type Prisma } from "@ald/db";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

const TEMPLATE_VERSION = "PAYSLIP_V1";
const FONT_REGULAR_URL = import.meta.resolve(
  "@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf",
);
const FONT_BOLD_URL = import.meta.resolve(
  "@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf",
);

export type PayslipExportData = Readonly<{
  companyName: string;
  employeeRevenueVisible: boolean;
  branchCode: string;
  branchName: string;
  month: string;
  revision: number;
  status: "DRAFT" | "CALCULATED" | "REVIEWED" | "LOCKED" | "PUBLISHED";
  calculationNo: number;
  calculationHash: string;
  staff: Readonly<{
    id: string;
    code: string;
    fullName: string;
    streamingAlias: string | null;
  }>;
  input: PayrollCalculationInput;
  output: PayrollCalculationOutput;
}>;

function exactExcelNumber(value: string): number | string {
  const integer = BigInt(value);
  return integer >= BigInt(Number.MIN_SAFE_INTEGER) && integer <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(integer)
    : value;
}

function money(value: string): string {
  return new Intl.NumberFormat("vi-VN").format(BigInt(value));
}

function dateLabel(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

const statusLabels = {
  DRAFT: "Nháp",
  PRESENT: "Có mặt",
  ABSENT: "Vắng",
  LEAVE: "Nghỉ phép",
} as const;

function dailyValues(data: PayslipExportData) {
  const bonusByAttendance = new Map<string, bigint>();
  for (const line of data.output.lines) {
    if (line.type !== "DAILY_REVENUE_BONUS") continue;
    bonusByAttendance.set(
      line.sourceId,
      (bonusByAttendance.get(line.sourceId) ?? 0n) + BigInt(line.amount),
    );
  }
  return [...data.input.attendance]
    .sort((left, right) => left.businessDate.localeCompare(right.businessDate))
    .map((row) => ({
      ...row,
      dailyBonus: (bonusByAttendance.get(row.attendanceId) ?? 0n).toString(),
      penalties: row.violations
        .reduce((total, violation) => total + BigInt(violation.amount), 0n)
        .toString(),
    }));
}

export async function createPayslipWorkbook(
  data: PayslipExportData,
  generatedAt = new Date(),
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ALD Workforce";
  workbook.created = generatedAt;
  workbook.modified = generatedAt;
  workbook.subject = `${TEMPLATE_VERSION} · ${data.calculationHash}`;
  const summary = workbook.addWorksheet("Phiếu lương", {
    properties: { tabColor: { argb: "FF0369A1" } },
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      margins: { left: 0.35, right: 0.35, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });
  summary.views = [{ state: "frozen", ySplit: 7, showGridLines: false }];
  summary.mergeCells("A1:D1");
  summary.getCell("A1").value = "PHIẾU LƯƠNG NHÂN VIÊN";
  summary.getCell("A1").font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
  summary.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF075985" },
  };
  summary.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  summary.getRow(1).height = 34;
  const metadataRows: Array<[string, string, string, string]> = [
    ["Công ty", data.companyName, "Kỳ lương", `${data.month.slice(5)}/${data.month.slice(0, 4)}`],
    ["Nhân viên", `${data.staff.code} — ${data.staff.fullName}`, "Revision", String(data.revision)],
    ["Cơ sở", `${data.branchCode} — ${data.branchName}`, "Calculation", `#${data.calculationNo}`],
    ["ACC / Alias", data.staff.streamingAlias ?? "—", "Template", TEMPLATE_VERSION],
  ];
  metadataRows.forEach((values, index) => {
    const row = summary.getRow(2 + index);
    row.values = values;
    row.height = 24;
    row.eachCell((cell) => {
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    row.getCell(1).font = { bold: true, color: { argb: "FF334155" } };
    row.getCell(3).font = { bold: true, color: { argb: "FF334155" } };
  });
  summary.getRow(7).values = ["Khoản thu nhập", "Số tiền (VND)", "Diễn giải", "Rule / nguồn"];
  summary.getRow(7).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0284C7" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  const componentRows: Array<[string, string, string]> = [
    ["Lương cơ bản tham chiếu", data.output.components.baseSalary, "Không cộng trùng"],
    [
      "Lương theo công",
      data.output.components.proratedSalary,
      `${data.output.aggregates.workUnits} công`,
    ],
    ["Thưởng doanh số ngày", data.output.components.dailyRevenueBonus, "Tổng các ngày"],
    ["Thưởng doanh số tháng", data.output.components.monthlyRevenueBonus, "Theo level tháng"],
    ["Thưởng chuyên cần", data.output.components.attendanceBonus, "Theo rule tháng"],
    ["Thưởng thành tích", data.output.components.achievementBonus, "Theo rule tháng"],
    [
      "Thưởng level",
      data.output.components.levelBonus,
      data.output.suggestedLevelCode ?? "Không có",
    ],
    [
      "Tăng ca",
      data.output.components.overtimePay,
      `${data.output.aggregates.overtimeMinutes} phút`,
    ],
    ["Thưởng / điều chỉnh khác", data.output.components.otherBonus, "Adjustment đã duyệt"],
    ["Tiền phạt", data.output.components.penalties, "Khoản trừ"],
    ["Tạm ứng", data.output.components.advance, "Khoản trừ"],
  ];
  componentRows.forEach(([label, amount, note], index) => {
    const row = summary.getRow(8 + index);
    const lineTypeByIndex = [
      "BASE_SALARY",
      "PRORATED_SALARY",
      "DAILY_REVENUE_BONUS",
      "MONTHLY_REVENUE_BONUS",
      "ATTENDANCE_BONUS",
      "ACHIEVEMENT_BONUS",
      "LEVEL_BONUS",
      "OVERTIME_PAY",
      "OTHER_BONUS",
      "PENALTY",
      "ADVANCE",
    ] as const;
    const sourceRuleIds = data.output.lines
      .filter((line) => line.type === lineTypeByIndex[index] && line.ruleVersionId)
      .map((line) => line.ruleVersionId!)
      .filter((value, sourceIndex, values) => values.indexOf(value) === sourceIndex);
    row.values = [
      label,
      exactExcelNumber(amount),
      note,
      sourceRuleIds.length > 0
        ? sourceRuleIds.map((value) => value.slice(0, 12)).join(", ")
        : `Snapshot #${data.calculationNo}`,
    ];
    row.getCell(2).numFmt = "#,##0;[Red](#,##0);-";
    row.height = 25;
    row.eachCell((cell) => {
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    if (index % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      });
    }
  });
  const totalRowNumber = 8 + componentRows.length;
  const totalRow = summary.getRow(totalRowNumber);
  totalRow.values = [
    "THỰC NHẬN",
    {
      formula: "B9+SUM(B10:B16)-B17-B18",
      result: exactExcelNumber(data.output.components.totalIncome),
    },
    data.output.anomalyFlags.length > 0
      ? `${data.output.anomalyFlags.length} cảnh báo`
      : "Đã reconcile",
    data.calculationHash.slice(0, 10),
  ];
  totalRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FF0F172A" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0F2FE" } };
    cell.border = { top: { style: "medium", color: { argb: "FF0284C7" } } };
  });
  totalRow.getCell(2).numFmt = "#,##0;[Red](#,##0);-";
  summary.columns = [{ width: 29 }, { width: 30 }, { width: 22 }, { width: 24 }];
  summary.pageSetup.printArea = `A1:D${totalRowNumber}`;

  const daily = workbook.addWorksheet("Chi tiết ngày", {
    properties: { tabColor: { argb: "FF38BDF8" } },
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  daily.views = [{ state: "frozen", ySplit: 2, showGridLines: false }];
  daily.mergeCells(1, 1, 1, data.employeeRevenueVisible ? 9 : 8);
  daily.getCell(1, 1).value = `CHI TIẾT NGÀY · ${data.staff.code} · ${data.month}`;
  daily.getCell(1, 1).font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
  daily.getCell(1, 1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF075985" },
  };
  const headers = [
    "Ngày",
    "Trạng thái",
    "Công",
    "Live (phút)",
    "Tăng ca",
    ...(data.employeeRevenueVisible ? ["Doanh số"] : []),
    "Thưởng ngày",
    "Tiền phạt",
    "Attendance ID",
  ];
  daily.getRow(2).values = headers;
  daily.getRow(2).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0284C7" } };
    cell.alignment = { horizontal: "center" };
  });
  dailyValues(data).forEach((value, index) => {
    const row = daily.getRow(3 + index);
    row.values = [
      dateLabel(value.businessDate),
      statusLabels[value.status],
      Number(value.workUnits),
      value.actualLiveMinutes,
      value.overtimeMinutes,
      ...(data.employeeRevenueVisible ? [exactExcelNumber(value.revenueAmount)] : []),
      exactExcelNumber(value.dailyBonus),
      exactExcelNumber(value.penalties),
      value.attendanceId,
    ];
    row.getCell(3).numFmt = "0.00";
    for (let column = 6; column <= headers.length - 1; column += 1) {
      row.getCell(column).numFmt = "#,##0;[Red](#,##0);-";
    }
  });
  daily.columns = headers.map((header) => ({
    width: header === "Attendance ID" ? 38 : header === "Trạng thái" ? 15 : 14,
  }));
  daily.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: headers.length } };
  daily.pageSetup.printTitlesRow = "1:2";

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function pdfFonts(): Promise<{ regular: Buffer; bold: Buffer }> {
  const [regular, bold] = await Promise.all([
    readFile(fileURLToPath(FONT_REGULAR_URL)),
    readFile(fileURLToPath(FONT_BOLD_URL)),
  ]);
  return { regular, bold };
}

export async function createPayslipPdf(
  data: PayslipExportData,
  generatedAt = new Date(),
): Promise<Buffer> {
  const fonts = await pdfFonts();
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({
      size: "A4",
      margins: { top: 40, right: 38, bottom: 42, left: 38 },
      info: {
        Title: `Phiếu lương ${data.staff.code} ${data.month}`,
        Author: "ALD Workforce",
        Subject: `${TEMPLATE_VERSION} · ${data.calculationHash}`,
        CreationDate: generatedAt,
      },
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.registerFont("Noto", fonts.regular);
    document.registerFont("NotoBold", fonts.bold);

    const pageWidth = document.page.width - 76;
    document.rect(38, 38, pageWidth, 48).fill("#075985");
    document
      .font("NotoBold")
      .fontSize(18)
      .fillColor("#FFFFFF")
      .text("PHIẾU LƯƠNG NHÂN VIÊN", 38, 52, { width: pageWidth, align: "center" });
    document.font("Noto").fontSize(9.5).fillColor("#334155");
    const metaY = 102;
    document.text(`Công ty: ${data.companyName}`, 38, metaY);
    document.text(
      `Kỳ lương: ${data.month.slice(5)}/${data.month.slice(0, 4)} · R${data.revision}`,
      330,
      metaY,
    );
    document.text(`Nhân viên: ${data.staff.code} — ${data.staff.fullName}`, 38, metaY + 17);
    document.text(`Cơ sở: ${data.branchCode} — ${data.branchName}`, 330, metaY + 17);
    document.text(`ACC / Alias: ${data.staff.streamingAlias ?? "—"}`, 38, metaY + 34);
    document.text(`Calculation #${data.calculationNo}`, 330, metaY + 34);

    const summaryRows: Array<[string, string, boolean?]> = [
      ["Lương cơ bản tham chiếu", data.output.components.baseSalary],
      ["Lương theo công", data.output.components.proratedSalary],
      ["Thưởng doanh số ngày", data.output.components.dailyRevenueBonus],
      ["Thưởng doanh số tháng", data.output.components.monthlyRevenueBonus],
      ["Thưởng chuyên cần", data.output.components.attendanceBonus],
      ["Thưởng thành tích", data.output.components.achievementBonus],
      ["Thưởng level", data.output.components.levelBonus],
      ["Tiền tăng ca", data.output.components.overtimePay],
      ["Thưởng / điều chỉnh khác", data.output.components.otherBonus],
      ["Tiền phạt", data.output.components.penalties, true],
      ["Tạm ứng", data.output.components.advance, true],
    ];
    let y = 165;
    document.rect(38, y, pageWidth, 24).fill("#0284C7");
    document.font("NotoBold").fontSize(10).fillColor("#FFFFFF");
    document.text("Khoản thu nhập", 48, y + 7);
    document.text("Số tiền (VND)", 380, y + 7, { width: 160, align: "right" });
    y += 24;
    summaryRows.forEach(([label, amount, deduction], index) => {
      if (index % 2 === 1) document.rect(38, y, pageWidth, 22).fill("#F8FAFC");
      document
        .font("Noto")
        .fontSize(9.5)
        .fillColor(deduction ? "#B91C1C" : "#0F172A");
      document.text(label, 48, y + 6, { width: 300, lineBreak: false });
      document.text(
        `${deduction && BigInt(amount) !== 0n ? "− " : ""}${money(amount)}`,
        380,
        y + 6,
        {
          width: 160,
          align: "right",
          lineBreak: false,
        },
      );
      y += 22;
    });
    document.rect(38, y, pageWidth, 30).fill("#E0F2FE");
    document.font("NotoBold").fontSize(12).fillColor("#0F172A");
    document.text("THỰC NHẬN", 48, y + 9);
    document.text(`${money(data.output.components.totalIncome)} VND`, 310, y + 9, {
      width: 230,
      align: "right",
    });
    y += 45;
    if (data.output.anomalyFlags.length > 0) {
      document
        .font("Noto")
        .fontSize(8.5)
        .fillColor("#9A3412")
        .text(`Cảnh báo: ${data.output.anomalyFlags.join(", ")}`, 38, y);
      y += 24;
    }
    document.font("NotoBold").fontSize(11).fillColor("#0F172A").text("Chi tiết ngày", 38, y);
    y += 20;
    const daily = dailyValues(data);
    const drawDailyHeader = (): void => {
      document.rect(38, y, pageWidth, 22).fill("#0369A1");
      document.font("NotoBold").fontSize(7.5).fillColor("#FFFFFF");
      document.text("Ngày", 43, y + 7, { width: 62 });
      document.text("Trạng thái", 108, y + 7, { width: 75 });
      document.text("Công", 187, y + 7, { width: 35, align: "right" });
      document.text("Live", 230, y + 7, { width: 42, align: "right" });
      document.text("OT", 279, y + 7, { width: 35, align: "right" });
      document.text("Thưởng ngày", 330, y + 7, { width: 90, align: "right" });
      document.text("Phạt", 438, y + 7, { width: 100, align: "right" });
      y += 22;
    };
    drawDailyHeader();
    for (const [index, row] of daily.entries()) {
      if (y > 755) {
        document.addPage();
        y = 42;
        drawDailyHeader();
      }
      if (index % 2 === 1) document.rect(38, y, pageWidth, 20).fill("#F8FAFC");
      document.font("Noto").fontSize(7.5).fillColor("#0F172A");
      document.text(dateLabel(row.businessDate), 43, y + 6, { width: 62 });
      document.text(statusLabels[row.status], 108, y + 6, { width: 75 });
      document.text(row.workUnits, 187, y + 6, { width: 35, align: "right" });
      document.text(String(row.actualLiveMinutes), 230, y + 6, { width: 42, align: "right" });
      document.text(String(row.overtimeMinutes), 279, y + 6, { width: 35, align: "right" });
      document.text(money(row.dailyBonus), 330, y + 6, { width: 90, align: "right" });
      document.text(money(row.penalties), 438, y + 6, { width: 100, align: "right" });
      y += 20;
    }
    const pages = document.bufferedPageRange();
    for (let page = 0; page < pages.count; page += 1) {
      document.switchToPage(page);
      document
        .font("Noto")
        .fontSize(7)
        .fillColor("#64748B")
        .text(
          `${TEMPLATE_VERSION} · ${data.calculationHash.slice(0, 16)} · Trang ${page + 1}/${pages.count}`,
          38,
          document.page.height - 52,
          { width: pageWidth, align: "center", lineBreak: false },
        );
    }
    document.end();
  });
}

type ZipArchiveLike = NodeJS.ReadableStream & {
  append(source: Buffer, data: { name: string }): ZipArchiveLike;
  finalize(): Promise<void>;
  on(event: "error", listener: (error: Error) => void): ZipArchiveLike;
  pipe<T extends NodeJS.WritableStream>(destination: T): T;
};

export async function createPayrollZip(
  files: readonly Readonly<{ name: string; buffer: Buffer }>[],
) {
  const archiverModule = (await import("archiver")) as unknown as {
    ZipArchive: new (options: { zlib: { level: number } }) => ZipArchiveLike;
  };
  const archive = new archiverModule.ZipArchive({ zlib: { level: 9 } });
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    output.on("data", (chunk: Buffer) => chunks.push(chunk));
    output.on("end", () => resolve(Buffer.concat(chunks)));
    output.on("error", reject);
    archive.on("error", reject);
  });
  archive.pipe(output);
  files.forEach((file) => archive.append(file.buffer, { name: file.name }));
  await archive.finalize();
  return result;
}

function safeFilePart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-");
}

const exportJobInclude = {
  company: { select: { name: true, employeeRevenueVisible: true } },
  branch: { select: { code: true, name: true } },
  payrollPeriod: {
    select: { month: true, revision: true, status: true },
  },
} satisfies Prisma.PayrollExportJobInclude;

function outputFromJson(value: Prisma.JsonValue): PayrollCalculationOutput {
  return value as unknown as PayrollCalculationOutput;
}

function inputFromJson(value: Prisma.JsonValue): PayrollCalculationInput {
  return value as unknown as PayrollCalculationInput;
}

async function loadPayslips(jobId: string): Promise<{
  job: Prisma.PayrollExportJobGetPayload<{ include: typeof exportJobInclude }>;
  payslips: PayslipExportData[];
}> {
  const job = await prisma.payrollExportJob.findUnique({
    where: { id: jobId },
    include: exportJobInclude,
  });
  if (!job) throw new Error("Không tìm thấy payroll export job.");
  const entries = await prisma.payrollEntry.findMany({
    where: {
      companyId: job.companyId,
      payrollPeriodId: job.payrollPeriodId,
      included: true,
      ...(job.staffId ? { staffId: job.staffId } : {}),
    },
    select: {
      staff: {
        select: { id: true, staffCode: true, fullName: true, streamingAlias: true },
      },
      currentSnapshot: {
        select: {
          calculationNo: true,
          inputHash: true,
          inputs: true,
          outputs: true,
        },
      },
    },
    orderBy: { staff: { staffCode: "asc" } },
  });
  const payslips = entries.flatMap((entry) =>
    entry.currentSnapshot
      ? [
          {
            companyName: job.company.name,
            employeeRevenueVisible: job.company.employeeRevenueVisible,
            branchCode: job.branch.code,
            branchName: job.branch.name,
            month: job.payrollPeriod.month.toISOString().slice(0, 7),
            revision: job.payrollPeriod.revision,
            status: job.payrollPeriod.status,
            calculationNo: entry.currentSnapshot.calculationNo,
            calculationHash: entry.currentSnapshot.inputHash,
            staff: {
              id: entry.staff.id,
              code: entry.staff.staffCode,
              fullName: entry.staff.fullName,
              streamingAlias: entry.staff.streamingAlias,
            },
            input: inputFromJson(entry.currentSnapshot.inputs),
            output: outputFromJson(entry.currentSnapshot.outputs),
          } satisfies PayslipExportData,
        ]
      : [],
  );
  if (payslips.length === 0) throw new Error("Kỳ lương chưa có snapshot phù hợp để export.");
  return { job, payslips };
}

let storageBucketReady: Promise<void> | null = null;

function storageClient(): { bucket: string; client: S3Client; autoCreateBucket: boolean } {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Thiếu cấu hình private object storage.");
  }
  return {
    bucket,
    autoCreateBucket: process.env.S3_AUTO_CREATE_BUCKET === "true",
    client: new S3Client({
      endpoint,
      region: process.env.S3_REGION ?? "us-east-1",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

async function ensureStorageBucket(storage: ReturnType<typeof storageClient>): Promise<void> {
  if (!storage.autoCreateBucket) return;
  if (storageBucketReady) return storageBucketReady;
  storageBucketReady = (async () => {
    try {
      await storage.client.send(new HeadBucketCommand({ Bucket: storage.bucket }));
    } catch {
      try {
        await storage.client.send(new CreateBucketCommand({ Bucket: storage.bucket }));
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (name !== "BucketAlreadyExists" && name !== "BucketAlreadyOwnedByYou") {
          storageBucketReady = null;
          throw error;
        }
      }
    }
  })();
  return storageBucketReady;
}

export async function processPayrollExportJob(exportJobId: string): Promise<void> {
  await prisma.payrollExportJob.update({
    where: { id: exportJobId },
    data: { status: "PROCESSING", progress: 5, startedAt: new Date(), errorMessage: null },
  });
  try {
    const { job, payslips } = await loadPayslips(exportJobId);
    let buffer: Buffer;
    let extension: string;
    let mimeType: string;
    let baseName: string;
    if (job.kind === "PAYSLIP_XLSX") {
      buffer = await createPayslipWorkbook(payslips[0]!);
      extension = "xlsx";
      mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      baseName = `phieu-luong-${safeFilePart(payslips[0]!.staff.code)}-${payslips[0]!.month}`;
    } else if (job.kind === "PAYSLIP_PDF") {
      buffer = await createPayslipPdf(payslips[0]!);
      extension = "pdf";
      mimeType = "application/pdf";
      baseName = `phieu-luong-${safeFilePart(payslips[0]!.staff.code)}-${payslips[0]!.month}`;
    } else {
      const files: Array<{ name: string; buffer: Buffer }> = [];
      for (const [index, payslip] of payslips.entries()) {
        const employee = safeFilePart(`${payslip.staff.code}-${payslip.staff.fullName}`);
        files.push(
          { name: `${employee}.xlsx`, buffer: await createPayslipWorkbook(payslip) },
          { name: `${employee}.pdf`, buffer: await createPayslipPdf(payslip) },
        );
        await prisma.payrollExportJob.update({
          where: { id: exportJobId },
          data: { progress: Math.min(85, 10 + Math.round(((index + 1) / payslips.length) * 70)) },
        });
      }
      buffer = await createPayrollZip(files);
      extension = "zip";
      mimeType = "application/zip";
      baseName = `phieu-luong-${payslips[0]!.month}-r${job.payrollPeriod.revision}`;
    }
    const fileName = `${baseName}.${extension}`;
    const objectKey = `${job.companyId}/payroll/${job.payrollPeriodId}/${exportJobId}/${fileName}`;
    const checksum = createHash("sha256").update(buffer).digest("base64");
    const storage = storageClient();
    await ensureStorageBucket(storage);
    await storage.client.send(
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: objectKey,
        Body: buffer,
        ContentType: mimeType,
        ContentDisposition: `attachment; filename="${fileName}"`,
        ChecksumSHA256: checksum,
        Metadata: {
          template: TEMPLATE_VERSION,
          payrollperiodid: job.payrollPeriodId,
        },
      }),
    );
    await prisma.payrollExportJob.update({
      where: { id: exportJobId },
      data: {
        status: "COMPLETED",
        progress: 100,
        objectKey,
        fileName,
        mimeType,
        sizeBytes: BigInt(buffer.length),
        checksumSha256: checksum,
        completedAt: new Date(),
      },
    });
  } catch (error) {
    await prisma.payrollExportJob.update({
      where: { id: exportJobId },
      data: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message.slice(0, 1_000) : "Unknown error",
        completedAt: new Date(),
      },
    });
    throw error;
  }
}
