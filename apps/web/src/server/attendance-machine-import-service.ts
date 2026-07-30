import { randomUUID } from "node:crypto";

import type {
  AttendanceMachineImportCommitInput,
  AttendanceMachineImportJobDto,
  AttendanceMachineImportPresignInput,
  AttendanceMachineImportPreviewDto,
  AttendanceMachineImportPreviewRowDto,
  AttendanceMachineImportRowStatus,
  AttendanceMachineImportSummaryDto,
} from "@ald/contracts";
import { Prisma, prisma } from "@ald/db";
import {
  DomainError,
  requirePermission,
  validateAttendanceValues,
  type ActorContext,
} from "@ald/domain";

import { appendSecureAudit, systemAuditReason } from "./audit-service";
import {
  parseAttendanceMachineWorkbook,
  type ParsedAttendanceMachineRow,
} from "./attendance-machine-import-parser";
import { parseBusinessDate } from "./business-date";
import { createPrivateUploadUrl, readPrivateObject, verifyPrivateObject } from "./object-storage";
import type { RequestMetadata } from "./request-metadata";
import { enforceSensitiveMutationRateLimit } from "./sensitive-rate-limit";
import { reconcileAutomaticViolationsInTransaction } from "./violation-service";

const PREVIEW_ROW_LIMIT = 200;
type Transaction = Prisma.TransactionClient;

type ImportTarget = Awaited<ReturnType<typeof resolveImportTarget>>;

type StoredPreviewRow = AttendanceMachineImportPreviewRowDto &
  Readonly<{
    attendanceId: string | null;
    expectedVersion: number | null;
    nextCheckInAt: string | null;
    nextCheckOutAt: string | null;
    nextSpansNextDay: boolean;
  }>;

const previewAttendanceSelect = {
  id: true,
  companyId: true,
  branchId: true,
  staffId: true,
  businessDate: true,
  checkInAt: true,
  checkOutAt: true,
  spansNextDay: true,
  workUnits: true,
  overtimeMinutes: true,
  note: true,
  status: true,
  version: true,
  archivedAt: true,
  liveMetric: {
    select: {
      actualLiveMinutes: true,
      revenueAmount: true,
      revenueUnit: true,
      revenueScale: true,
    },
  },
} satisfies Prisma.AttendanceDaySelect;

type PreviewAttendance = Prisma.AttendanceDayGetPayload<{
  select: typeof previewAttendanceSelect;
}>;

const importJobSelect = {
  id: true,
  companyId: true,
  branchId: true,
  targetStaffId: true,
  targetMonth: true,
  template: true,
  scopeKey: true,
  status: true,
  objectKey: true,
  originalFileName: true,
  mimeType: true,
  sizeBytes: true,
  checksumSha256: true,
  mapping: true,
  sourceHeaders: true,
  previewRows: true,
  totalRows: true,
  validRows: true,
  errorRows: true,
  committedRows: true,
  errorMessage: true,
  requestedByUserId: true,
  reason: true,
  uploadedAt: true,
  validatedAt: true,
  committedAt: true,
} satisfies Prisma.ImportJobSelect;

type AttendanceMachineImportJob = Prisma.ImportJobGetPayload<{
  select: typeof importJobSelect;
}>;

function monthBounds(month: string): { start: Date; end: Date } {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 1));
  return { start, end };
}

function normalizeMachineCode(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

function importScopeKey(branchId: string, staffId: string, month: string): string {
  return `attendance:${branchId}:${staffId}:${month}`;
}

function toJobDto(job: AttendanceMachineImportJob): AttendanceMachineImportJobDto {
  return {
    id: job.id,
    status: job.status,
    originalFileName: job.originalFileName,
    uploadedAt: job.uploadedAt?.toISOString() ?? null,
    validatedAt: job.validatedAt?.toISOString() ?? null,
    committedAt: job.committedAt?.toISOString() ?? null,
    committedRows: job.committedRows,
    errorMessage: job.errorMessage,
  };
}

function jsonStringRecord(value: Prisma.JsonValue | null): Readonly<Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function summaryRecord(summary: AttendanceMachineImportSummaryDto, truncated: boolean) {
  return {
    totalRows: String(summary.totalRows),
    matchedRows: String(summary.matchedRows),
    createRows: String(summary.createRows),
    updateRows: String(summary.updateRows),
    unchangedRows: String(summary.unchangedRows),
    skippedRows: String(summary.skippedRows),
    errorRows: String(summary.errorRows),
    truncated: String(truncated),
  } satisfies Record<string, string>;
}

function summaryFromJob(job: AttendanceMachineImportJob): AttendanceMachineImportSummaryDto {
  const mapping = jsonStringRecord(job.mapping);
  const number = (key: string, fallback: number): number => {
    const value = Number(mapping[key]);
    return Number.isInteger(value) && value >= 0 ? value : fallback;
  };
  return {
    totalRows: number("totalRows", job.totalRows),
    matchedRows: number("matchedRows", job.validRows + job.errorRows),
    createRows: number("createRows", 0),
    updateRows: number("updateRows", 0),
    unchangedRows: number("unchangedRows", 0),
    skippedRows: number("skippedRows", Math.max(0, job.totalRows - job.validRows - job.errorRows)),
    errorRows: number("errorRows", job.errorRows),
  };
}

function storedPreviewRows(value: Prisma.JsonValue | null): readonly StoredPreviewRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is StoredPreviewRow => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const row = item as Record<string, unknown>;
    return (
      typeof row.sheetName === "string" &&
      typeof row.rowNumber === "number" &&
      typeof row.machineCode === "string" &&
      typeof row.status === "string" &&
      (row.attendanceId === null || typeof row.attendanceId === "string") &&
      (row.expectedVersion === null || typeof row.expectedVersion === "number") &&
      (row.nextCheckInAt === null || typeof row.nextCheckInAt === "string") &&
      (row.nextCheckOutAt === null || typeof row.nextCheckOutAt === "string") &&
      typeof row.nextSpansNextDay === "boolean"
    );
  });
}

async function resolveImportTarget(
  actor: ActorContext,
  input: { staffId: string; branchId: string; month: string },
) {
  requirePermission(actor, "attendance:write");
  if (
    actor.role === "TRAINING_MANAGER" &&
    (!actor.activeBranchIds.includes(input.branchId) || actor.staffId === input.staffId)
  ) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy nhân viên trong phạm vi.");
  }

  const { start, end } = monthBounds(input.month);
  const branch = await prisma.branch.findFirst({
    where: { id: input.branchId, companyId: actor.companyId },
    select: { id: true, code: true, name: true },
  });
  if (!branch) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy cơ sở trong phạm vi.");
  }

  const staff = await prisma.staffMember.findFirst({
    where: {
      id: input.staffId,
      companyId: actor.companyId,
      AND: [
        { OR: [{ archivedAt: null }, { archivedAt: { gte: start } }] },
        { OR: [{ joinedDate: null }, { joinedDate: { lt: end } }] },
        { OR: [{ terminationDate: null }, { terminationDate: { gte: start } }] },
      ],
      assignments: {
        some: {
          companyId: actor.companyId,
          branchId: input.branchId,
          assignmentType: "MEMBER",
          archivedAt: null,
          effectiveFrom: { lt: end },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: start } }],
        },
      },
    },
    select: {
      id: true,
      companyId: true,
      staffCode: true,
      fullName: true,
      user: { select: { role: true } },
      company: {
        select: {
          timezone: true,
          revenueUnit: true,
          revenueScale: true,
        },
      },
      assignments: {
        where: {
          companyId: actor.companyId,
          branchId: input.branchId,
          assignmentType: "MEMBER",
          archivedAt: null,
          effectiveFrom: { lt: end },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: start } }],
        },
        select: {
          attendanceMachineCode: true,
          effectiveFrom: true,
          effectiveTo: true,
        },
        orderBy: { effectiveFrom: "desc" },
      },
    },
  });
  const isLiveEmployee = !staff?.user || staff.user.role === "LIVE_EMPLOYEE";
  if (!staff || (actor.role === "TRAINING_MANAGER" && !isLiveEmployee)) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy nhân viên trong phạm vi.");
  }
  const displayedMachineCode =
    staff.assignments.find((assignment) => assignment.attendanceMachineCode)
      ?.attendanceMachineCode ?? null;
  if (!displayedMachineCode) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "Nhân viên chưa được cấu hình mã máy chấm công trong tháng này.",
    );
  }
  return {
    ...staff,
    branch,
    branchId: branch.id,
    month: input.month,
    displayedMachineCode,
    start,
    end,
  };
}

async function authorizedJob(
  actor: ActorContext,
  id: string,
): Promise<{ job: AttendanceMachineImportJob; target: ImportTarget }> {
  requirePermission(actor, "attendance:write");
  const job = await prisma.importJob.findFirst({
    where: {
      id,
      companyId: actor.companyId,
      template: "ATTENDANCE_MACHINE",
      ...(actor.role === "TRAINING_MANAGER"
        ? {
            requestedByUserId: actor.userId,
            branchId: { in: [...actor.activeBranchIds] },
          }
        : {}),
    },
    select: importJobSelect,
  });
  if (!job?.branchId || !job.targetStaffId || !job.targetMonth) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy import máy chấm công trong phạm vi.");
  }
  const target = await resolveImportTarget(actor, {
    branchId: job.branchId,
    staffId: job.targetStaffId,
    month: job.targetMonth,
  });
  return { job, target };
}

function targetDto(target: ImportTarget) {
  return {
    branchId: target.branchId,
    staffId: target.id,
    staffCode: target.staffCode,
    fullName: target.fullName,
    attendanceMachineCode: target.displayedMachineCode,
    month: target.month,
  };
}

function publicPreviewRow(row: StoredPreviewRow): AttendanceMachineImportPreviewRowDto {
  return {
    sheetName: row.sheetName,
    rowNumber: row.rowNumber,
    machineCode: row.machineCode,
    businessDate: row.businessDate,
    currentCheckInTime: row.currentCheckInTime,
    currentCheckOutTime: row.currentCheckOutTime,
    fileCheckInTime: row.fileCheckInTime,
    fileCheckOutTime: row.fileCheckOutTime,
    status: row.status,
    message: row.message,
  };
}

function previewDto(
  job: AttendanceMachineImportJob,
  target: ImportTarget,
): AttendanceMachineImportPreviewDto {
  const summary = summaryFromJob(job);
  const mapping = jsonStringRecord(job.mapping);
  return {
    jobId: job.id,
    status: job.status === "SUCCEEDED" ? "SUCCEEDED" : "VALIDATED",
    target: targetDto(target),
    rows: storedPreviewRows(job.previewRows).slice(0, PREVIEW_ROW_LIMIT).map(publicPreviewRow),
    summary,
    canCommit:
      job.status === "VALIDATED" &&
      summary.errorRows === 0 &&
      summary.createRows + summary.updateRows > 0,
    truncated: mapping.truncated === "true",
  };
}

export async function presignAttendanceMachineImportUpload(
  actor: ActorContext,
  input: AttendanceMachineImportPresignInput,
  metadata: RequestMetadata,
) {
  const target = await resolveImportTarget(actor, input);
  const scopeKey = importScopeKey(input.branchId, input.staffId, input.month);
  const byKey = await prisma.importJob.findFirst({
    where: { companyId: actor.companyId, idempotencyKey: input.idempotencyKey },
    select: importJobSelect,
  });
  if (
    byKey &&
    (byKey.checksumSha256 !== input.checksumSha256 ||
      byKey.scopeKey !== scopeKey ||
      byKey.template !== "ATTENDANCE_MACHINE")
  ) {
    throw new DomainError("CONFLICT", "Idempotency key đã được dùng cho dữ liệu khác.");
  }
  let job =
    byKey ??
    (await prisma.importJob.findFirst({
      where: {
        companyId: actor.companyId,
        template: "ATTENDANCE_MACHINE",
        checksumSha256: input.checksumSha256,
        scopeKey,
      },
      select: importJobSelect,
    }));

  if (job && job.requestedByUserId !== actor.userId) {
    throw new DomainError(
      "CONFLICT",
      "File này đã được một người dùng khác yêu cầu import cho cùng hồ sơ.",
    );
  }
  if (
    job &&
    (job.branchId !== input.branchId ||
      job.targetStaffId !== input.staffId ||
      job.targetMonth !== input.month)
  ) {
    throw new DomainError("CONFLICT", "File import đã tồn tại cho một hồ sơ khác.");
  }

  let duplicate = Boolean(job);
  if (!job) {
    const objectKey = `attendance-machine-imports/${actor.companyId}/${randomUUID()}/source.xlsx`;
    job = await prisma.importJob.create({
      data: {
        companyId: actor.companyId,
        branchId: input.branchId,
        targetStaffId: input.staffId,
        targetMonth: input.month,
        template: "ATTENDANCE_MACHINE",
        scopeKey,
        idempotencyKey: input.idempotencyKey,
        objectKey,
        originalFileName: input.originalFileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        checksumSha256: input.checksumSha256,
        requestedByUserId: actor.userId,
        reason: systemAuditReason("ATTENDANCE_MACHINE_IMPORT_UPLOAD_REQUEST"),
      },
      select: importJobSelect,
    });
    duplicate = false;
  } else if (job.status === "FAILED") {
    job = await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: "PENDING_UPLOAD",
        reason: systemAuditReason("ATTENDANCE_MACHINE_IMPORT_UPLOAD_RETRY"),
        originalFileName: input.originalFileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        errorMessage: null,
        sourceHeaders: Prisma.JsonNull,
        previewRows: Prisma.JsonNull,
        mapping: Prisma.JsonNull,
        totalRows: 0,
        validRows: 0,
        errorRows: 0,
      },
      select: importJobSelect,
    });
  }

  const upload =
    job.status === "PENDING_UPLOAD"
      ? await createPrivateUploadUrl({
          objectKey: job.objectKey,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          checksumSha256: input.checksumSha256,
        })
      : null;
  await appendSecureAudit({
    actor,
    action: "ATTENDANCE_MACHINE_IMPORT_UPLOAD_REQUEST",
    entityType: "ImportJob",
    entityId: job.id,
    branchId: input.branchId,
    reason: systemAuditReason("ATTENDANCE_MACHINE_IMPORT_UPLOAD_REQUEST"),
    after: {
      targetStaffId: input.staffId,
      targetMonth: input.month,
      fileName: input.originalFileName,
      sizeBytes: input.sizeBytes,
      checksumSha256: input.checksumSha256,
    },
    metadata,
  });
  return {
    job: toJobDto(job),
    target: targetDto(target),
    duplicate,
    upload,
  };
}

export async function completeAttendanceMachineImportUpload(
  actor: ActorContext,
  id: string,
  metadata: RequestMetadata,
): Promise<AttendanceMachineImportJobDto> {
  const { job } = await authorizedJob(actor, id);
  if (job.status !== "PENDING_UPLOAD") return toJobDto(job);
  try {
    await verifyPrivateObject({
      objectKey: job.objectKey,
      mimeType: job.mimeType,
      sizeBytes: Number(job.sizeBytes),
      checksumSha256: job.checksumSha256,
    });
    const parsed = await parseAttendanceMachineWorkbook(await readPrivateObject(job.objectKey));
    const updated = await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: "UPLOADED",
        sourceHeaders: [...parsed.headers],
        totalRows: parsed.rows.length,
        uploadedAt: new Date(),
        errorMessage: null,
      },
      select: importJobSelect,
    });
    await appendSecureAudit({
      actor,
      action: "ATTENDANCE_MACHINE_IMPORT_UPLOAD_COMPLETE",
      entityType: "ImportJob",
      entityId: job.id,
      branchId: job.branchId,
      reason: job.reason,
      before: { status: job.status },
      after: {
        status: updated.status,
        sheetName: parsed.sheetName,
        headerRowNumber: parsed.headerRowNumber,
        totalRows: parsed.rows.length,
      },
      metadata,
    });
    return toJobDto(updated);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Không thể đọc file máy chấm công.";
    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMessage: message },
    });
    throw new DomainError("VALIDATION_ERROR", message);
  }
}

function assignmentForDate(target: ImportTarget, businessDate: string) {
  const date = parseBusinessDate(businessDate);
  return target.assignments.find(
    (assignment) =>
      assignment.effectiveFrom <= date &&
      (!assignment.effectiveTo || date < assignment.effectiveTo),
  );
}

function displayTime(value: Date | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

function nextBusinessDate(value: string): string {
  const date = parseBusinessDate(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function timestampFor(businessDate: string, time: string, nextDay = false): string {
  const date = nextDay ? nextBusinessDate(businessDate) : businessDate;
  return new Date(`${date}T${time}:00+07:00`).toISOString();
}

function timeMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours! * 60 + minutes!;
}

function errorRow(
  source: ParsedAttendanceMachineRow,
  message: string,
  status: AttendanceMachineImportRowStatus = "ERROR",
): StoredPreviewRow {
  return {
    sheetName: source.sheetName,
    rowNumber: source.rowNumber,
    machineCode: source.machineCode,
    businessDate: source.businessDate,
    currentCheckInTime: null,
    currentCheckOutTime: null,
    fileCheckInTime: source.checkInTime,
    fileCheckOutTime: source.checkOutTime,
    status,
    message,
    attendanceId: null,
    expectedVersion: null,
    nextCheckInAt: null,
    nextCheckOutAt: null,
    nextSpansNextDay: false,
  };
}

function scheduleForDate(
  schedules: readonly Readonly<{
    effectiveFrom: Date;
    effectiveTo: Date | null;
    spansNextDay: boolean;
  }>[],
  businessDate: string,
) {
  const date = parseBusinessDate(businessDate);
  return schedules.find(
    (schedule) =>
      schedule.effectiveFrom <= date && (!schedule.effectiveTo || date < schedule.effectiveTo),
  );
}

function buildProposedTimes(
  source: ParsedAttendanceMachineRow,
  existing: PreviewAttendance | undefined,
  schedule: ReturnType<typeof scheduleForDate>,
) {
  const currentCheckInTime = displayTime(existing?.checkInAt ?? null);
  const currentCheckOutTime = displayTime(existing?.checkOutAt ?? null);
  const effectiveCheckInTime = source.checkInTime ?? currentCheckInTime;
  if (source.checkOutTime && !effectiveCheckInTime) {
    throw new DomainError("VALIDATION_ERROR", "Không thể nhập Giờ ra khi chưa có Giờ vào.");
  }

  let nextSpansNextDay = existing?.spansNextDay ?? false;
  let nextCheckInAt = existing?.checkInAt?.toISOString() ?? null;
  let nextCheckOutAt = existing?.checkOutAt?.toISOString() ?? null;
  if (source.checkInTime) {
    nextCheckInAt = timestampFor(source.businessDate!, source.checkInTime);
  }
  if (source.checkOutTime && effectiveCheckInTime) {
    const needsNextDay = timeMinutes(source.checkOutTime) <= timeMinutes(effectiveCheckInTime);
    if (needsNextDay && !schedule?.spansNextDay) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Giờ ra trước Giờ vào nhưng ca làm không cho phép qua ngày.",
      );
    }
    nextSpansNextDay = needsNextDay;
    nextCheckOutAt = timestampFor(source.businessDate!, source.checkOutTime, needsNextDay);
  }

  validateAttendanceValues(
    {
      businessDate: source.businessDate!,
      checkInAt: nextCheckInAt,
      checkOutAt: nextCheckOutAt,
      spansNextDay: nextSpansNextDay,
    },
    "Asia/Ho_Chi_Minh",
  );
  return {
    currentCheckInTime,
    currentCheckOutTime,
    nextCheckInAt,
    nextCheckOutAt,
    nextSpansNextDay,
  };
}

async function buildPreview(
  target: ImportTarget,
  parsedRows: readonly ParsedAttendanceMachineRow[],
): Promise<{
  rows: readonly StoredPreviewRow[];
  summary: AttendanceMachineImportSummaryDto;
}> {
  const [attendance, schedules] = await Promise.all([
    prisma.attendanceDay.findMany({
      where: {
        companyId: target.companyId,
        staffId: target.id,
        businessDate: { gte: target.start, lt: target.end },
      },
      select: previewAttendanceSelect,
    }),
    prisma.staffWorkSchedule.findMany({
      where: {
        companyId: target.companyId,
        branchId: target.branchId,
        staffId: target.id,
        archivedAt: null,
        effectiveFrom: { lt: target.end },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: target.start } }],
      },
      select: { effectiveFrom: true, effectiveTo: true, spansNextDay: true },
      orderBy: { effectiveFrom: "desc" },
    }),
  ]);
  const attendanceByDate = new Map(
    attendance.map((record) => [record.businessDate.toISOString().slice(0, 10), record]),
  );

  const preclassified = parsedRows.map((source) => {
    if (source.issues.length > 0) {
      return {
        source,
        row: errorRow(source, source.issues.map((issue) => issue.message).join(" ")),
        matched: false,
      };
    }
    if (!source.businessDate) {
      return { source, row: errorRow(source, "Ngày không hợp lệ."), matched: false };
    }
    if (!source.businessDate.startsWith(`${target.month}-`)) {
      return {
        source,
        row: errorRow(source, "Ngày nằm ngoài tháng đang xem.", "SKIP_OUTSIDE_MONTH"),
        matched: false,
      };
    }
    const effectiveAssignment = assignmentForDate(target, source.businessDate);
    if (!effectiveAssignment) {
      return {
        source,
        row: errorRow(source, "Ngày không thuộc thời gian nhân viên làm việc tại cơ sở đang chọn."),
        matched: false,
      };
    }
    if (
      normalizeMachineCode(effectiveAssignment.attendanceMachineCode) !==
      normalizeMachineCode(source.machineCode)
    ) {
      return {
        source,
        row: errorRow(
          source,
          "Mã trong file không trùng mã máy của nhân viên tại ngày chấm công.",
          "SKIP_CODE_MISMATCH",
        ),
        matched: false,
      };
    }
    return { source, row: null, matched: true };
  });

  const matchedDateCounts = new Map<string, number>();
  for (const item of preclassified) {
    if (item.matched && item.source.businessDate) {
      matchedDateCounts.set(
        item.source.businessDate,
        (matchedDateCounts.get(item.source.businessDate) ?? 0) + 1,
      );
    }
  }

  const rows: StoredPreviewRow[] = [];
  for (const item of preclassified) {
    if (item.row) {
      rows.push(item.row);
      continue;
    }
    const source = item.source;
    const businessDate = source.businessDate!;
    if ((matchedDateCounts.get(businessDate) ?? 0) > 1) {
      rows.push(errorRow(source, "Mã Nhân Viên và Ngày bị trùng trong file.", "DUPLICATE"));
      continue;
    }
    if (!source.checkInTime && !source.checkOutTime) {
      rows.push(errorRow(source, "Không có Giờ vào hoặc Giờ ra để nhập.", "SKIP_EMPTY_TIME"));
      continue;
    }

    const existing = attendanceByDate.get(businessDate);
    if (existing && existing.branchId !== target.branchId) {
      rows.push(errorRow(source, "Ngày này đã có attendance ở một cơ sở khác; không thể ghi đè."));
      continue;
    }
    try {
      const proposed = buildProposedTimes(
        source,
        existing,
        scheduleForDate(schedules, businessDate),
      );
      const changed =
        proposed.nextCheckInAt !== (existing?.checkInAt?.toISOString() ?? null) ||
        proposed.nextCheckOutAt !== (existing?.checkOutAt?.toISOString() ?? null) ||
        proposed.nextSpansNextDay !== (existing?.spansNextDay ?? false);
      const status: AttendanceMachineImportRowStatus = existing
        ? changed
          ? "UPDATE"
          : "UNCHANGED"
        : "CREATE";
      const warning =
        source.checkInTime && !source.checkOutTime
          ? "Chỉ nhập Giờ vào; Giờ ra hiện có được giữ nguyên."
          : !source.checkInTime && source.checkOutTime
            ? "Chỉ nhập Giờ ra; Giờ vào hiện có được giữ nguyên."
            : null;
      rows.push({
        sheetName: source.sheetName,
        rowNumber: source.rowNumber,
        machineCode: source.machineCode,
        businessDate,
        currentCheckInTime: proposed.currentCheckInTime,
        currentCheckOutTime: proposed.currentCheckOutTime,
        fileCheckInTime: source.checkInTime,
        fileCheckOutTime: source.checkOutTime,
        status,
        message: warning,
        attendanceId: existing?.id ?? null,
        expectedVersion: existing?.version ?? null,
        nextCheckInAt: proposed.nextCheckInAt,
        nextCheckOutAt: proposed.nextCheckOutAt,
        nextSpansNextDay: proposed.nextSpansNextDay,
      });
    } catch (cause) {
      rows.push(
        errorRow(source, cause instanceof Error ? cause.message : "Giờ vào/Giờ ra không hợp lệ."),
      );
    }
  }

  const count = (status: AttendanceMachineImportRowStatus) =>
    rows.filter((row) => row.status === status).length;
  const summary: AttendanceMachineImportSummaryDto = {
    totalRows: rows.length,
    matchedRows: rows.filter(
      (row) => !["SKIP_CODE_MISMATCH", "SKIP_OUTSIDE_MONTH"].includes(row.status),
    ).length,
    createRows: count("CREATE"),
    updateRows: count("UPDATE"),
    unchangedRows: count("UNCHANGED"),
    skippedRows:
      count("SKIP_CODE_MISMATCH") + count("SKIP_OUTSIDE_MONTH") + count("SKIP_EMPTY_TIME"),
    errorRows: count("ERROR") + count("DUPLICATE"),
  };
  return { rows, summary };
}

function persistedRows(rows: readonly StoredPreviewRow[]): readonly StoredPreviewRow[] {
  const visibleRows = rows.slice(0, PREVIEW_ROW_LIMIT);
  const visibleKeys = new Set(visibleRows.map((row) => `${row.sheetName}:${row.rowNumber}`));
  const additionalActionRows = rows.filter(
    (row) =>
      ["CREATE", "UPDATE"].includes(row.status) &&
      !visibleKeys.has(`${row.sheetName}:${row.rowNumber}`),
  );
  return [...visibleRows, ...additionalActionRows];
}

export async function previewAttendanceMachineImport(
  actor: ActorContext,
  id: string,
  metadata: RequestMetadata,
): Promise<AttendanceMachineImportPreviewDto> {
  await enforceSensitiveMutationRateLimit(actor, "attendance-machine-import.preview", {
    windowSeconds: 300,
    maxAttempts: 20,
  });
  const { job, target } = await authorizedJob(actor, id);
  if (!["UPLOADED", "VALIDATED"].includes(job.status)) {
    throw new DomainError("CONFLICT", "File chưa sẵn sàng để xem trước.");
  }
  await prisma.importJob.update({ where: { id }, data: { status: "VALIDATING" } });
  try {
    const parsed = await parseAttendanceMachineWorkbook(await readPrivateObject(job.objectKey));
    const result = await buildPreview(target, parsed.rows);
    const rowsToStore = persistedRows(result.rows);
    const truncated = result.rows.length > PREVIEW_ROW_LIMIT;
    const importErrors = result.rows.filter((row) => ["ERROR", "DUPLICATE"].includes(row.status));
    const updated = await prisma.$transaction(async (tx) => {
      await tx.importError.deleteMany({
        where: { companyId: actor.companyId, importJobId: job.id },
      });
      if (importErrors.length > 0) {
        await tx.importError.createMany({
          data: importErrors.slice(0, 10_000).map((row) => ({
            companyId: actor.companyId,
            importJobId: job.id,
            sheetName: row.sheetName,
            rowNumber: row.rowNumber,
            columnName: "attendance",
            code: row.status,
            message: row.message ?? "Dòng dữ liệu không hợp lệ.",
            severity: row.status === "DUPLICATE" ? "CRITICAL" : "ERROR",
            rawValue: `${row.machineCode}|${row.businessDate ?? ""}`.slice(0, 500),
          })),
        });
      }
      return tx.importJob.update({
        where: { id: job.id },
        data: {
          status: "VALIDATED",
          mapping: summaryRecord(result.summary, truncated),
          previewRows: rowsToStore as unknown as Prisma.InputJsonValue,
          totalRows: result.summary.totalRows,
          validRows:
            result.summary.createRows + result.summary.updateRows + result.summary.unchangedRows,
          errorRows: result.summary.errorRows,
          validatedAt: new Date(),
          errorMessage: truncated
            ? `Chỉ hiển thị ${PREVIEW_ROW_LIMIT.toLocaleString("vi-VN")} dòng đầu tiên.`
            : null,
        },
        select: importJobSelect,
      });
    });
    await appendSecureAudit({
      actor,
      action: "ATTENDANCE_MACHINE_IMPORT_PREVIEW",
      entityType: "ImportJob",
      entityId: job.id,
      branchId: target.branchId,
      reason: job.reason,
      before: { status: job.status },
      after: { status: updated.status, ...result.summary, targetStaffId: target.id },
      metadata,
    });
    return previewDto(updated, target);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Không thể preview file.";
    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMessage: message },
    });
    if (cause instanceof DomainError) throw cause;
    throw new DomainError("VALIDATION_ERROR", message);
  }
}

function attendanceAuditShape(record: PreviewAttendance) {
  return {
    id: record.id,
    companyId: record.companyId,
    branchId: record.branchId,
    staffId: record.staffId,
    businessDate: record.businessDate.toISOString().slice(0, 10),
    checkInAt: record.checkInAt?.toISOString() ?? null,
    checkOutAt: record.checkOutAt?.toISOString() ?? null,
    spansNextDay: record.spansNextDay,
    workUnits: record.workUnits.toString(),
    overtimeMinutes: record.overtimeMinutes,
    note: record.note,
    status: record.status,
    version: record.version,
    archivedAt: record.archivedAt?.toISOString() ?? null,
    actualLiveMinutes: record.liveMetric?.actualLiveMinutes ?? null,
    revenueAmount: record.liveMetric?.revenueAmount.toString() ?? null,
  };
}

async function appendAttendanceImportAudit(
  tx: Transaction,
  actor: ActorContext,
  input: {
    job: AttendanceMachineImportJob;
    row: StoredPreviewRow;
    before: PreviewAttendance | null;
    after: PreviewAttendance;
    reason: string;
    metadata: RequestMetadata;
  },
) {
  await tx.auditLog.create({
    data: {
      companyId: actor.companyId,
      branchId: input.after.branchId,
      actorUserId: actor.userId,
      action: input.before
        ? "attendance.machine-import.update"
        : "attendance.machine-import.create",
      entityType: "AttendanceDay",
      entityId: input.after.id,
      reason: input.reason,
      ...(input.before
        ? { before: attendanceAuditShape(input.before) as Prisma.InputJsonValue }
        : {}),
      after: {
        ...attendanceAuditShape(input.after),
        importSource: {
          importJobId: input.job.id,
          fileName: input.job.originalFileName,
          sheetName: input.row.sheetName,
          rowNumber: input.row.rowNumber,
        },
      },
      requestId: input.metadata.requestId,
      ipAddress: input.metadata.ipAddress,
      userAgent: input.metadata.userAgent,
    },
  });
}

async function assertPreviewStillCurrent(
  actor: ActorContext,
  target: ImportTarget,
  rows: readonly StoredPreviewRow[],
) {
  for (const row of rows) {
    if (!row.businessDate || !["CREATE", "UPDATE"].includes(row.status)) continue;
    const effectiveAssignment = assignmentForDate(target, row.businessDate);
    if (
      !effectiveAssignment ||
      normalizeMachineCode(effectiveAssignment.attendanceMachineCode) !==
        normalizeMachineCode(row.machineCode)
    ) {
      throw new DomainError("CONFLICT", "Mã máy hoặc phân công đã thay đổi; hãy preview lại.", {
        code: "IMPORT_PREVIEW_STALE",
      });
    }
    const current = await prisma.attendanceDay.findFirst({
      where: {
        companyId: actor.companyId,
        staffId: target.id,
        businessDate: parseBusinessDate(row.businessDate),
      },
      select: { id: true, branchId: true, version: true },
    });
    const stale =
      row.expectedVersion === null
        ? current !== null
        : !current ||
          current.id !== row.attendanceId ||
          current.branchId !== target.branchId ||
          current.version !== row.expectedVersion;
    if (stale) {
      throw new DomainError("CONFLICT", "Attendance đã thay đổi; hãy tải lại và preview lại.", {
        code: "IMPORT_PREVIEW_STALE",
        businessDate: row.businessDate,
      });
    }
  }
}

export async function commitAttendanceMachineImport(
  actor: ActorContext,
  id: string,
  _input: AttendanceMachineImportCommitInput,
  metadata: RequestMetadata,
): Promise<AttendanceMachineImportJobDto> {
  const commitReason = systemAuditReason("ATTENDANCE_MACHINE_IMPORT_COMMIT");
  await enforceSensitiveMutationRateLimit(actor, "attendance-machine-import.commit", {
    windowSeconds: 300,
    maxAttempts: 10,
  });
  const { job, target } = await authorizedJob(actor, id);
  if (job.status === "SUCCEEDED") return toJobDto(job);
  const summary = summaryFromJob(job);
  if (
    job.status !== "VALIDATED" ||
    summary.errorRows > 0 ||
    summary.createRows + summary.updateRows === 0
  ) {
    throw new DomainError("CONFLICT", "Preview chưa hợp lệ hoặc không có dòng cần cập nhật.");
  }
  const rows = storedPreviewRows(job.previewRows).filter((row) =>
    ["CREATE", "UPDATE"].includes(row.status),
  );
  if (rows.length !== summary.createRows + summary.updateRows) {
    throw new DomainError("CONFLICT", "Preview không đầy đủ; hãy đọc lại file.");
  }
  await assertPreviewStillCurrent(actor, target, rows);

  const updatedJob = await prisma.$transaction(
    async (tx) => {
      const locked = await tx.importJob.updateMany({
        where: {
          id: job.id,
          companyId: actor.companyId,
          template: "ATTENDANCE_MACHINE",
          status: "VALIDATED",
        },
        data: { status: "COMMITTING", errorMessage: null },
      });
      if (locked.count !== 1) {
        throw new DomainError("CONFLICT", "Import đang được xử lý hoặc đã thay đổi.");
      }

      for (const row of rows) {
        const businessDate = parseBusinessDate(row.businessDate!);
        let before: PreviewAttendance | null = null;
        let attendanceId: string;
        if (row.status === "CREATE") {
          const created = await tx.attendanceDay.create({
            data: {
              companyId: actor.companyId,
              branchId: target.branchId,
              staffId: target.id,
              businessDate,
              checkInAt: row.nextCheckInAt ? new Date(row.nextCheckInAt) : null,
              checkOutAt: row.nextCheckOutAt ? new Date(row.nextCheckOutAt) : null,
              spansNextDay: row.nextSpansNextDay,
              workUnits: "0",
              overtimeMinutes: 0,
              note: null,
              status: "DRAFT",
              createdByUserId: actor.userId,
              updatedByUserId: actor.userId,
            },
          });
          attendanceId = created.id;
          await tx.liveDailyMetric.create({
            data: {
              companyId: actor.companyId,
              branchId: target.branchId,
              attendanceId,
              actualLiveMinutes: 0,
              revenueAmount: 0n,
              revenueUnit: target.company.revenueUnit,
              revenueScale: target.company.revenueScale,
            },
          });
        } else {
          before = await tx.attendanceDay.findUnique({
            where: { id: row.attendanceId! },
            select: previewAttendanceSelect,
          });
          if (!before) {
            throw new DomainError("CONFLICT", "Attendance đã thay đổi; hãy preview lại.", {
              code: "IMPORT_PREVIEW_STALE",
              businessDate: row.businessDate,
            });
          }
          const result = await tx.attendanceDay.updateMany({
            where: {
              id: row.attendanceId!,
              companyId: actor.companyId,
              branchId: target.branchId,
              staffId: target.id,
              version: row.expectedVersion!,
            },
            data: {
              checkInAt: row.nextCheckInAt ? new Date(row.nextCheckInAt) : null,
              checkOutAt: row.nextCheckOutAt ? new Date(row.nextCheckOutAt) : null,
              spansNextDay: row.nextSpansNextDay,
              updatedByUserId: actor.userId,
              version: { increment: 1 },
            },
          });
          if (result.count !== 1) {
            throw new DomainError("CONFLICT", "Attendance đã thay đổi; hãy preview lại.", {
              code: "IMPORT_PREVIEW_STALE",
              businessDate: row.businessDate,
            });
          }
          attendanceId = row.attendanceId!;
        }

        const after = await tx.attendanceDay.findUniqueOrThrow({
          where: { id: attendanceId },
          select: previewAttendanceSelect,
        });
        await appendAttendanceImportAudit(tx, actor, {
          job,
          row,
          before,
          after,
          reason: commitReason,
          metadata,
        });
        await reconcileAutomaticViolationsInTransaction(
          tx,
          actor,
          attendanceId,
          systemAuditReason("AUTOMATIC_VIOLATIONS_RECONCILED_AFTER_MACHINE_IMPORT"),
          metadata,
        );
      }

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          branchId: target.branchId,
          actorUserId: actor.userId,
          action: "ATTENDANCE_MACHINE_IMPORT_COMMIT",
          entityType: "ImportJob",
          entityId: job.id,
          reason: commitReason,
          after: {
            targetStaffId: target.id,
            targetMonth: target.month,
            committedRows: rows.length,
          },
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        },
      });
      return tx.importJob.update({
        where: { id: job.id },
        data: {
          status: "SUCCEEDED",
          committedRows: rows.length,
          committedAt: new Date(),
          errorMessage: null,
        },
        select: importJobSelect,
      });
    },
    { maxWait: 5_000, timeout: 60_000 },
  );
  return toJobDto(updatedJob);
}
