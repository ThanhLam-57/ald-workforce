import { createHash } from "node:crypto";

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { prisma, type Prisma } from "@ald/db";
import { escapeCsvCell, redactSensitiveAuditValue, sanitizeSpreadsheetText } from "@ald/domain";
import ExcelJS from "exceljs";

type TabularValue = string | number | boolean | null;
type TabularExport = Readonly<{
  title: string;
  fileBase: string;
  headers: readonly string[];
  rows: readonly (readonly TabularValue[])[];
}>;

type Parameters = Readonly<{
  month?: string;
  staffId?: string;
  payrollPeriodId?: string;
  auditFilters?: Readonly<{
    actorUserId?: string;
    branchId?: string;
    entityType?: string;
    entityId?: string;
    action?: string;
    from?: string;
    to?: string;
  }>;
}>;

function parameters(value: Prisma.JsonValue): Parameters {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Readonly<Record<string, Prisma.JsonValue>>;
  const audit =
    record.auditFilters &&
    typeof record.auditFilters === "object" &&
    !Array.isArray(record.auditFilters)
      ? (record.auditFilters as Readonly<Record<string, Prisma.JsonValue>>)
      : undefined;
  const stringValue = (input: Prisma.JsonValue | undefined) =>
    typeof input === "string" ? input : undefined;
  const month = stringValue(record.month);
  const staffId = stringValue(record.staffId);
  const payrollPeriodId = stringValue(record.payrollPeriodId);
  const auditFilters = audit
    ? Object.fromEntries(
        Object.entries({
          actorUserId: stringValue(audit.actorUserId),
          branchId: stringValue(audit.branchId),
          entityType: stringValue(audit.entityType),
          entityId: stringValue(audit.entityId),
          action: stringValue(audit.action),
          from: stringValue(audit.from),
          to: stringValue(audit.to),
        }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : null;
  return {
    ...(month ? { month } : {}),
    ...(staffId ? { staffId } : {}),
    ...(payrollPeriodId ? { payrollPeriodId } : {}),
    ...(auditFilters ? { auditFilters } : {}),
  };
}

function monthRange(month: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Export thiếu tháng YYYY-MM hợp lệ.");
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

export function safeExportValue(value: TabularValue): TabularValue {
  return typeof value === "string" ? sanitizeSpreadsheetText(value) : value;
}

export function createCsvExport(data: TabularExport): Buffer {
  const lines = [
    data.headers.map(escapeCsvCell).join(","),
    ...data.rows.map((row) => row.map(escapeCsvCell).join(",")),
  ];
  return Buffer.from(`\uFEFF${lines.join("\r\n")}`, "utf8");
}

export async function createXlsxExport(data: TabularExport): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ALD Workforce";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Dữ liệu", {
    views: [{ state: "frozen", ySplit: 3, showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  sheet.mergeCells(1, 1, 1, data.headers.length);
  sheet.getCell(1, 1).value = sanitizeSpreadsheetText(data.title);
  sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  sheet.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF075985" } };
  sheet.getCell(1, 1).alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 30;
  sheet.addRow([]);
  const headerRow = sheet.addRow(data.headers.map(sanitizeSpreadsheetText));
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0284C7" } };
  headerRow.alignment = { vertical: "middle", wrapText: true };
  for (const row of data.rows) {
    sheet.addRow(row.map(safeExportValue));
  }
  sheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: Math.max(3, sheet.rowCount), column: data.headers.length },
  };
  sheet.columns.forEach((column, index) => {
    const maximum = Math.max(
      data.headers[index]?.length ?? 8,
      ...data.rows.slice(0, 500).map((row) => String(row[index] ?? "").length),
    );
    column.width = Math.min(36, Math.max(12, maximum + 2));
  });
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 3) return;
    row.alignment = { vertical: "top", wrapText: true };
    if (rowNumber % 2 === 0) {
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F9FF" } };
    }
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function employeeErrorData(job: {
  companyId: string;
  branchId: string | null;
  parameters: Prisma.JsonValue;
}): Promise<TabularExport> {
  if (!job.branchId) throw new Error("Employee error report thiếu branchId.");
  const params = parameters(job.parameters);
  const range = monthRange(params.month ?? "");
  const violations = await prisma.violation.findMany({
    where: {
      companyId: job.companyId,
      branchId: job.branchId,
      businessDate: { gte: range.start, lt: range.end },
      status: "ACTIVE",
    },
    select: {
      businessDate: true,
      itemName: true,
      detail: true,
      amount: true,
      note: true,
      staff: { select: { staffCode: true, fullName: true } },
      attendance: {
        select: {
          checkInAt: true,
          checkOutAt: true,
          workUnits: true,
          overtimeMinutes: true,
          status: true,
        },
      },
      evidenceObjects: {
        where: { status: "READY" },
        select: { id: true, originalFileName: true },
      },
    },
    orderBy: [{ businessDate: "asc" }, { staff: { staffCode: "asc" } }],
  });
  return {
    title: `Báo lỗi nhân viên ${params.month}`,
    fileBase: `bao-loi-nhan-vien-${params.month}`,
    headers: [
      "Ngày",
      "Mã NV",
      "Nhân viên",
      "Trạng thái",
      "Check-in",
      "Check-out",
      "Số công",
      "Tăng ca (phút)",
      "Loại lỗi",
      "Chi tiết",
      "Tiền phạt",
      "Ghi chú",
      "Evidence",
    ],
    rows: violations.map((item) => [
      item.businessDate.toISOString().slice(0, 10),
      item.staff.staffCode,
      item.staff.fullName,
      item.attendance.status,
      item.attendance.checkInAt?.toISOString() ?? null,
      item.attendance.checkOutAt?.toISOString() ?? null,
      item.attendance.workUnits.toString(),
      item.attendance.overtimeMinutes,
      item.itemName,
      item.detail,
      item.amount.toString(),
      item.note,
      item.evidenceObjects
        .map((evidence) => `${evidence.id}:${evidence.originalFileName}`)
        .join("; "),
    ]),
  };
}

async function branchMonthlyData(job: {
  companyId: string;
  branchId: string | null;
  parameters: Prisma.JsonValue;
}): Promise<TabularExport> {
  if (!job.branchId) throw new Error("Branch monthly export thiếu branchId.");
  const params = parameters(job.parameters);
  const range = monthRange(params.month ?? "");
  const attendance = await prisma.attendanceDay.findMany({
    where: {
      companyId: job.companyId,
      branchId: job.branchId,
      businessDate: { gte: range.start, lt: range.end },
      archivedAt: null,
    },
    select: {
      businessDate: true,
      workUnits: true,
      overtimeMinutes: true,
      status: true,
      staff: { select: { staffCode: true, fullName: true } },
      liveMetric: { select: { actualLiveMinutes: true, revenueAmount: true } },
      violations: { where: { status: "ACTIVE" }, select: { amount: true } },
    },
    orderBy: [{ businessDate: "asc" }, { staff: { staffCode: "asc" } }],
  });
  return {
    title: `Báo cáo cơ sở ${params.month}`,
    fileBase: `bao-cao-co-so-${params.month}`,
    headers: [
      "Ngày",
      "Mã NV",
      "Nhân viên",
      "Trạng thái",
      "Số công",
      "Tăng ca",
      "Phút Live",
      "Doanh số (xu)",
      "Tiền phạt",
    ],
    rows: attendance.map((item) => [
      item.businessDate.toISOString().slice(0, 10),
      item.staff.staffCode,
      item.staff.fullName,
      item.status,
      item.workUnits.toString(),
      item.overtimeMinutes,
      item.liveMetric?.actualLiveMinutes ?? 0,
      item.liveMetric?.revenueAmount.toString() ?? "0",
      item.violations.reduce((sum, violation) => sum + violation.amount, 0n).toString(),
    ]),
  };
}

async function companyMonthlyData(job: {
  companyId: string;
  parameters: Prisma.JsonValue;
}): Promise<TabularExport> {
  const params = parameters(job.parameters);
  const range = monthRange(params.month ?? "");
  const attendance = await prisma.attendanceDay.findMany({
    where: {
      companyId: job.companyId,
      businessDate: { gte: range.start, lt: range.end },
      archivedAt: null,
    },
    select: {
      branchId: true,
      staffId: true,
      branch: { select: { code: true, name: true } },
      staff: { select: { staffCode: true, fullName: true } },
      workUnits: true,
      overtimeMinutes: true,
      liveMetric: { select: { actualLiveMinutes: true, revenueAmount: true } },
      violations: { where: { status: "ACTIVE" }, select: { amount: true } },
    },
  });
  const payroll = await prisma.payrollEntry.findMany({
    where: {
      companyId: job.companyId,
      included: true,
      payrollPeriod: {
        month: range.start,
        status: { in: ["CALCULATED", "REVIEWED", "LOCKED", "PUBLISHED"] },
      },
    },
    select: {
      branchId: true,
      staffId: true,
      branch: { select: { code: true, name: true } },
      staff: { select: { staffCode: true, fullName: true } },
      totalIncome: true,
      monthlyRevenueBonus: true,
      otherBonus: true,
    },
    orderBy: { payrollPeriod: { revision: "asc" } },
  });
  const payrollByStaff = new Map(
    payroll.map((entry) => [`${entry.branchId}:${entry.staffId}`, entry]),
  );
  const aggregates = new Map<
    string,
    {
      branchCode: string;
      branchName: string;
      staffCode: string;
      fullName: string;
      branchId: string;
      staffId: string;
      workUnits: number;
      liveMinutes: number;
      revenue: bigint;
      penalties: bigint;
    }
  >();
  for (const item of attendance) {
    const key = `${item.branchId}:${item.staffId}`;
    const current = aggregates.get(key) ?? {
      branchCode: item.branch.code,
      branchName: item.branch.name,
      staffCode: item.staff.staffCode,
      fullName: item.staff.fullName,
      branchId: item.branchId,
      staffId: item.staffId,
      workUnits: 0,
      liveMinutes: 0,
      revenue: 0n,
      penalties: 0n,
    };
    current.workUnits += Number(item.workUnits);
    current.liveMinutes += item.liveMetric?.actualLiveMinutes ?? 0;
    current.revenue += item.liveMetric?.revenueAmount ?? 0n;
    current.penalties += item.violations.reduce((sum, violation) => sum + violation.amount, 0n);
    aggregates.set(key, current);
  }
  for (const entry of payroll) {
    const key = `${entry.branchId}:${entry.staffId}`;
    if (aggregates.has(key)) continue;
    aggregates.set(key, {
      branchCode: entry.branch.code,
      branchName: entry.branch.name,
      staffCode: entry.staff.staffCode,
      fullName: entry.staff.fullName,
      branchId: entry.branchId,
      staffId: entry.staffId,
      workUnits: 0,
      liveMinutes: 0,
      revenue: 0n,
      penalties: 0n,
    });
  }
  return {
    title: `Báo cáo toàn công ty ${params.month}`,
    fileBase: `bao-cao-cong-ty-${params.month}`,
    headers: [
      "Mã cơ sở",
      "Cơ sở",
      "Mã NV",
      "Nhân viên",
      "Số công",
      "Phút Live",
      "Tổng xu",
      "Tiền phạt",
      "Thưởng",
      "Thực nhận",
    ],
    rows: [...aggregates.values()].map((item) => {
      const entry = payrollByStaff.get(`${item.branchId}:${item.staffId}`);
      return [
        item.branchCode,
        item.branchName,
        item.staffCode,
        item.fullName,
        item.workUnits,
        item.liveMinutes,
        item.revenue.toString(),
        item.penalties.toString(),
        entry ? (entry.monthlyRevenueBonus + entry.otherBonus).toString() : "0",
        entry?.totalIncome.toString() ?? "0",
      ];
    }),
  };
}

async function payslipData(job: {
  companyId: string;
  parameters: Prisma.JsonValue;
}): Promise<TabularExport> {
  const params = parameters(job.parameters);
  const payrollPeriodId = params.payrollPeriodId;
  const staffId = params.staffId;
  if (!payrollPeriodId || !staffId)
    throw new Error("Payslip export thiếu kỳ lương hoặc nhân viên.");
  const entry = await prisma.payrollEntry.findFirstOrThrow({
    where: {
      companyId: job.companyId,
      payrollPeriodId,
      staffId,
      included: true,
      currentSnapshotId: { not: null },
    },
    select: {
      staff: { select: { staffCode: true, fullName: true } },
      payrollPeriod: { select: { month: true, revision: true } },
      currentSnapshotId: true,
    },
  });
  const lines = await prisma.payrollLine.findMany({
    where: {
      companyId: job.companyId,
      payrollEntry: {
        payrollPeriodId,
        staffId,
      },
      calculationSnapshotId: entry.currentSnapshotId!,
    },
    select: { type: true, label: true, amount: true, sourceType: true },
    orderBy: { displayOrder: "asc" },
  });
  const month = entry.payrollPeriod.month.toISOString().slice(0, 7);
  return {
    title: `Phiếu lương ${entry.staff.staffCode} - ${entry.staff.fullName} - ${month}`,
    fileBase: `phieu-luong-${entry.staff.staffCode}-${month}-r${entry.payrollPeriod.revision}`,
    headers: ["Loại", "Nội dung", "Số tiền", "Nguồn"],
    rows: lines.map((line) => [line.type, line.label, line.amount.toString(), line.sourceType]),
  };
}

async function auditData(job: {
  companyId: string;
  parameters: Prisma.JsonValue;
}): Promise<TabularExport> {
  const filters = parameters(job.parameters).auditFilters;
  const logs = await prisma.auditLog.findMany({
    where: {
      companyId: job.companyId,
      ...(filters?.actorUserId ? { actorUserId: filters.actorUserId } : {}),
      ...(filters?.branchId ? { branchId: filters.branchId } : {}),
      ...(filters?.entityType ? { entityType: filters.entityType } : {}),
      ...(filters?.entityId ? { entityId: filters.entityId } : {}),
      ...(filters?.action ? { action: filters.action } : {}),
      ...(filters?.from || filters?.to
        ? {
            occurredAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lt: new Date(filters.to) } : {}),
            },
          }
        : {}),
    },
    select: {
      occurredAt: true,
      branchId: true,
      action: true,
      entityType: true,
      entityId: true,
      reason: true,
      before: true,
      after: true,
      requestId: true,
      ipAddress: true,
      actor: { select: { name: true, email: true } },
    },
    orderBy: { occurredAt: "desc" },
    take: 50_000,
  });
  return {
    title: "Nhật ký audit",
    fileBase: `audit-${new Date().toISOString().slice(0, 10)}`,
    headers: [
      "Thời điểm",
      "Actor",
      "Email",
      "Cơ sở",
      "Action",
      "Entity",
      "Entity ID",
      "Lý do",
      "Before",
      "After",
      "Request ID",
      "IP",
    ],
    rows: logs.map((log) => [
      log.occurredAt.toISOString(),
      log.actor?.name ?? "SYSTEM",
      log.actor?.email ?? null,
      log.branchId,
      log.action,
      log.entityType,
      log.entityId,
      log.reason,
      JSON.stringify(redactSensitiveAuditValue(log.before)),
      JSON.stringify(redactSensitiveAuditValue(log.after)),
      log.requestId,
      log.ipAddress,
    ]),
  };
}

async function loadExportData(job: {
  companyId: string;
  branchId: string | null;
  template: "EMPLOYEE_ERROR_REPORT" | "BRANCH_MONTHLY" | "PAYSLIP" | "COMPANY_MONTHLY" | "AUDIT";
  parameters: Prisma.JsonValue;
}): Promise<TabularExport> {
  if (job.template === "EMPLOYEE_ERROR_REPORT") return employeeErrorData(job);
  if (job.template === "BRANCH_MONTHLY") return branchMonthlyData(job);
  if (job.template === "COMPANY_MONTHLY") return companyMonthlyData(job);
  if (job.template === "PAYSLIP") return payslipData(job);
  return auditData(job);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Thiếu biến môi trường ${name}.`);
  return value;
}

let storageBucketReady: Promise<void> | null = null;

function storageClient() {
  const bucket = requiredEnvironment("S3_BUCKET");
  const client = new S3Client({
    endpoint: requiredEnvironment("S3_ENDPOINT"),
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: requiredEnvironment("S3_ACCESS_KEY"),
      secretAccessKey: requiredEnvironment("S3_SECRET_KEY"),
    },
  });
  return { bucket, client, autoCreateBucket: process.env.S3_AUTO_CREATE_BUCKET === "true" };
}

async function ensureBucket(storage: ReturnType<typeof storageClient>): Promise<void> {
  if (!storage.autoCreateBucket) return;
  if (storageBucketReady) return storageBucketReady;
  storageBucketReady = (async () => {
    try {
      await storage.client.send(new HeadBucketCommand({ Bucket: storage.bucket }));
    } catch {
      await storage.client.send(new CreateBucketCommand({ Bucket: storage.bucket }));
    }
  })();
  return storageBucketReady;
}

export async function processDataExportJob(exportJobId: string): Promise<void> {
  await prisma.dataExportJob.update({
    where: { id: exportJobId },
    data: { status: "RUNNING", progress: 5, startedAt: new Date(), errorMessage: null },
  });
  try {
    const job = await prisma.dataExportJob.findUniqueOrThrow({
      where: { id: exportJobId },
      select: {
        id: true,
        companyId: true,
        branchId: true,
        template: true,
        format: true,
        parameters: true,
        requestedByUserId: true,
      },
    });
    const data = await loadExportData(job);
    await prisma.dataExportJob.update({ where: { id: job.id }, data: { progress: 70 } });
    const buffer = job.format === "CSV" ? createCsvExport(data) : await createXlsxExport(data);
    const extension = job.format.toLowerCase();
    const mimeType =
      job.format === "CSV"
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const fileName = `${data.fileBase}.${extension}`;
    const objectKey = `${job.companyId}/exports/${job.id}/${fileName}`;
    const checksumSha256 = createHash("sha256").update(buffer).digest("base64");
    const storage = storageClient();
    await ensureBucket(storage);
    await storage.client.send(
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: objectKey,
        Body: buffer,
        ContentType: mimeType,
        ContentDisposition: `attachment; filename="${fileName}"`,
        ChecksumSHA256: checksumSha256,
        Metadata: { exportjobid: job.id, template: job.template },
      }),
    );
    await prisma.$transaction([
      prisma.dataExportJob.update({
        where: { id: job.id },
        data: {
          status: "SUCCEEDED",
          progress: 100,
          objectKey,
          fileName,
          mimeType,
          sizeBytes: buffer.length,
          checksumSha256,
          completedAt: new Date(),
        },
      }),
      prisma.auditLog.create({
        data: {
          companyId: job.companyId,
          branchId: job.branchId,
          actorUserId: job.requestedByUserId,
          action: "DATA_EXPORT_SUCCEEDED",
          entityType: "DataExportJob",
          entityId: job.id,
          reason: "Worker hoàn tất export.",
          after: { template: job.template, format: job.format, fileName, sizeBytes: buffer.length },
        },
      }),
    ]);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.slice(0, 1_000) : "Unknown error";
    const failed = await prisma.dataExportJob.update({
      where: { id: exportJobId },
      data: { status: "FAILED", errorMessage: message, completedAt: new Date() },
      select: { companyId: true, branchId: true, requestedByUserId: true },
    });
    await prisma.auditLog.create({
      data: {
        companyId: failed.companyId,
        branchId: failed.branchId,
        actorUserId: failed.requestedByUserId,
        action: "DATA_EXPORT_FAILED",
        entityType: "DataExportJob",
        entityId: exportJobId,
        reason: "Worker export thất bại.",
        after: { errorMessage: message },
      },
    });
    throw cause;
  }
}

export async function cleanupExpiredExports(now = new Date()): Promise<number> {
  const jobs = await prisma.dataExportJob.findMany({
    where: {
      status: "SUCCEEDED",
      expiresAt: { lte: now },
      objectKey: { not: null },
      deletedAt: null,
    },
    select: {
      id: true,
      companyId: true,
      branchId: true,
      objectKey: true,
      requestedByUserId: true,
    },
    take: 500,
  });
  if (jobs.length === 0) return 0;
  const storage = storageClient();
  for (const job of jobs) {
    await storage.client.send(
      new DeleteObjectCommand({ Bucket: storage.bucket, Key: job.objectKey! }),
    );
    await prisma.$transaction([
      prisma.dataExportJob.update({
        where: { id: job.id },
        data: {
          status: "EXPIRED",
          progress: 100,
          deletedAt: now,
          objectKey: null,
        },
      }),
      prisma.auditLog.create({
        data: {
          companyId: job.companyId,
          branchId: job.branchId,
          actorUserId: job.requestedByUserId,
          action: "DATA_EXPORT_EXPIRED",
          entityType: "DataExportJob",
          entityId: job.id,
          reason: "Retention policy cleanup.",
          after: { deletedAt: now.toISOString() },
        },
      }),
    ]);
  }
  return jobs.length;
}
