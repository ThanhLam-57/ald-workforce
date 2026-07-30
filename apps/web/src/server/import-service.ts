import { createHash, randomUUID } from "node:crypto";

import type {
  ImportCommitInput,
  ImportJobDto,
  ImportListQuery,
  ImportPresignInput,
  ImportPreviewInput,
  ImportTemplate,
  ImportTemplateDefinitionDto,
} from "@ald/contracts";
import { prisma, type Prisma } from "@ald/db";
import {
  canAccessBranch,
  DomainError,
  escapeCsvCell,
  requirePermission,
  type ActorContext,
} from "@ald/domain";

import { appendSecureAudit, systemAuditReason } from "./audit-service";
import {
  defaultImportMapping,
  IMPORT_TEMPLATE_DEFINITIONS,
  parseImportFile,
  validateImportStructure,
  type CanonicalImportRow,
} from "./import-parser";
import { createPrivateUploadUrl, readPrivateObject, verifyPrivateObject } from "./object-storage";
import type { RequestMetadata } from "./request-metadata";
import { enforceSensitiveMutationRateLimit } from "./sensitive-rate-limit";

const IMPORT_BATCH_SIZE = 200;
const MAX_PERSISTED_ERRORS = 10_000;
const MANAGER_TEMPLATES = new Set<ImportTemplate>(["STAFF", "ASSIGNMENTS", "ATTENDANCE_LIVE"]);

function assertGenericImportTemplate(template: ImportTemplate): void {
  if (template === "ATTENDANCE_MACHINE") {
    throw new DomainError(
      "FORBIDDEN",
      "Import máy chấm công chỉ được thực hiện trong hồ sơ Attendance của nhân viên.",
    );
  }
}

type Transaction = Prisma.TransactionClient;
type ValidationError = Omit<ImportJobDto["errors"][number], "id">;

const importJobInclude = {
  errors: {
    orderBy: [{ rowNumber: "asc" as const }, { columnName: "asc" as const }],
    take: 100,
  },
} satisfies Prisma.ImportJobInclude;

type ImportJobRecord = Prisma.ImportJobGetPayload<{ include: typeof importJobInclude }>;

function jsonRecord(value: Prisma.JsonValue | null): Readonly<Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function jsonHeaders(value: Prisma.JsonValue | null): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function jsonPreview(
  value: Prisma.JsonValue | null,
): readonly Readonly<Record<string, string | number | boolean | null>>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, string | number | boolean | null> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
}

function toDto(job: ImportJobRecord): ImportJobDto {
  return {
    id: job.id,
    template: job.template,
    status: job.status,
    branchId: job.branchId,
    originalFileName: job.originalFileName,
    sizeBytes: job.sizeBytes.toString(),
    checksumSha256: job.checksumSha256,
    sourceHeaders: jsonHeaders(job.sourceHeaders),
    mapping: jsonRecord(job.mapping),
    previewRows: jsonPreview(job.previewRows),
    totalRows: job.totalRows,
    validRows: job.validRows,
    errorRows: job.errorRows,
    committedRows: job.committedRows,
    dryRun: job.dryRun,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    uploadedAt: job.uploadedAt?.toISOString() ?? null,
    validatedAt: job.validatedAt?.toISOString() ?? null,
    committedAt: job.committedAt?.toISOString() ?? null,
    errors: job.errors,
  };
}

function requireImportRole(actor: ActorContext, template?: ImportTemplate): void {
  requirePermission(actor, "import:write");
  if (actor.role === "LIVE_EMPLOYEE") {
    throw new DomainError("FORBIDDEN", "Nhân viên không được import dữ liệu.");
  }
  if (template && actor.role === "TRAINING_MANAGER" && !MANAGER_TEMPLATES.has(template)) {
    throw new DomainError("FORBIDDEN", "Quản lý đào tạo không được import template này.");
  }
}

function importScope(actor: ActorContext): Prisma.ImportJobWhereInput {
  return actor.role === "GENERAL_MANAGER"
    ? { companyId: actor.companyId }
    : {
        companyId: actor.companyId,
        OR: [
          { branchId: { in: [...actor.activeBranchIds] } },
          { requestedByUserId: actor.userId, branchId: null },
        ],
      };
}

async function authorizedJob(actor: ActorContext, id: string): Promise<ImportJobRecord> {
  requirePermission(actor, "import:read");
  const job = await prisma.importJob.findFirst({
    where: { id, ...importScope(actor) },
    include: importJobInclude,
  });
  if (!job) throw new DomainError("NOT_FOUND", "Không tìm thấy import job trong phạm vi.");
  requireImportRole(actor, job.template);
  return job;
}

export function listImportTemplates(actor: ActorContext): readonly ImportTemplateDefinitionDto[] {
  requirePermission(actor, "import:read");
  return IMPORT_TEMPLATE_DEFINITIONS.filter(
    (definition) => actor.role === "GENERAL_MANAGER" || MANAGER_TEMPLATES.has(definition.template),
  ).map((definition) => ({
    template: definition.template,
    label: definition.label,
    fields: definition.fields.map(({ key, label, required }) => ({ key, label, required })),
  }));
}

export async function listImports(
  actor: ActorContext,
  query: ImportListQuery,
): Promise<readonly ImportJobDto[]> {
  requirePermission(actor, "import:read");
  const jobs = await prisma.importJob.findMany({
    where: {
      ...importScope(actor),
      ...(query.template ? { template: query.template } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
    },
    include: importJobInclude,
    orderBy: { createdAt: "desc" },
    take: query.limit,
  });
  return jobs.map(toDto);
}

export async function getImport(actor: ActorContext, id: string): Promise<ImportJobDto> {
  return toDto(await authorizedJob(actor, id));
}

export async function presignImportUpload(
  actor: ActorContext,
  input: ImportPresignInput,
  metadata: RequestMetadata,
) {
  assertGenericImportTemplate(input.template);
  requireImportRole(actor, input.template);
  if (actor.role === "TRAINING_MANAGER") {
    if (!input.branchId || !canAccessBranch(actor, input.branchId)) {
      throw new DomainError("FORBIDDEN", "Import của quản lý phải chọn cơ sở đang được phân công.");
    }
  } else if (input.branchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: input.branchId, companyId: actor.companyId },
      select: { id: true },
    });
    if (!branch) throw new DomainError("NOT_FOUND", "Không tìm thấy cơ sở.");
  }

  const byKey = await prisma.importJob.findFirst({
    where: { companyId: actor.companyId, idempotencyKey: input.idempotencyKey },
    include: importJobInclude,
  });
  if (byKey && byKey.checksumSha256 !== input.checksumSha256) {
    throw new DomainError("CONFLICT", "Idempotency key đã được dùng cho file khác.");
  }
  const existing =
    byKey ??
    (await prisma.importJob.findFirst({
      where: {
        companyId: actor.companyId,
        template: input.template,
        checksumSha256: input.checksumSha256,
        scopeKey: "global",
      },
      include: importJobInclude,
    }));
  if (existing) {
    if (
      actor.role === "TRAINING_MANAGER" &&
      (!existing.branchId || !canAccessBranch(actor, existing.branchId))
    ) {
      throw new DomainError(
        "CONFLICT",
        "Checksum file đã tồn tại ngoài phạm vi cơ sở hiện tại; vui lòng liên hệ Tổng quản lý.",
      );
    }
    return {
      job: toDto(existing),
      duplicate: true,
      upload: null,
    };
  }

  const extension = input.originalFileName.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";
  const objectKey = `imports/${actor.companyId}/${randomUUID()}/source.${extension}`;
  const job = await prisma.importJob.create({
    data: {
      companyId: actor.companyId,
      branchId: input.branchId ?? null,
      template: input.template,
      scopeKey: "global",
      idempotencyKey: input.idempotencyKey,
      objectKey,
      originalFileName: input.originalFileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      checksumSha256: input.checksumSha256,
      requestedByUserId: actor.userId,
      reason: systemAuditReason("IMPORT_UPLOAD_REQUESTED"),
    },
    include: importJobInclude,
  });
  const upload = await createPrivateUploadUrl({
    objectKey,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    checksumSha256: input.checksumSha256,
  });
  await appendSecureAudit({
    actor,
    action: "IMPORT_UPLOAD_REQUEST",
    entityType: "ImportJob",
    entityId: job.id,
    branchId: job.branchId,
    reason: systemAuditReason("IMPORT_UPLOAD_REQUESTED"),
    after: {
      template: input.template,
      fileName: input.originalFileName,
      sizeBytes: input.sizeBytes,
      checksumSha256: input.checksumSha256,
    },
    metadata,
  });
  return { job: toDto(job), duplicate: false, upload };
}

export async function completeImportUpload(
  actor: ActorContext,
  id: string,
  metadata: RequestMetadata,
): Promise<ImportJobDto> {
  const current = await authorizedJob(actor, id);
  assertGenericImportTemplate(current.template);
  if (current.status !== "PENDING_UPLOAD") {
    return toDto(current);
  }
  try {
    await verifyPrivateObject({
      objectKey: current.objectKey,
      mimeType: current.mimeType,
      sizeBytes: Number(current.sizeBytes),
      checksumSha256: current.checksumSha256,
    });
    const parsed = await parseImportFile(
      await readPrivateObject(current.objectKey),
      current.mimeType,
    );
    const mapping = defaultImportMapping(current.template, parsed.headers);
    const updated = await prisma.importJob.update({
      where: { id: current.id },
      data: {
        status: "UPLOADED",
        sourceHeaders: [...parsed.headers],
        mapping,
        totalRows: parsed.rows.length,
        uploadedAt: new Date(),
        errorMessage: null,
      },
      include: importJobInclude,
    });
    await appendSecureAudit({
      actor,
      action: "IMPORT_UPLOAD_COMPLETE",
      entityType: "ImportJob",
      entityId: current.id,
      branchId: current.branchId,
      reason: "Đã xác minh MIME, kích thước, checksum và cấu trúc file.",
      before: { status: current.status },
      after: { status: updated.status, headers: parsed.headers, rows: parsed.rows.length },
      metadata,
    });
    return toDto(updated);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Không thể đọc file import.";
    await prisma.importJob.update({
      where: { id: current.id },
      data: { status: "FAILED", errorMessage: message },
    });
    throw new DomainError("VALIDATION_ERROR", message);
  }
}

function referenceError(
  row: CanonicalImportRow,
  columnName: string,
  code: string,
  message: string,
  rawValue: unknown,
  severity: ValidationError["severity"] = "ERROR",
): ValidationError {
  return {
    sheetName: row.sheetName,
    rowNumber: row.rowNumber,
    columnName,
    code,
    message,
    severity,
    rawValue: rawValue === null || rawValue === undefined ? null : String(rawValue).slice(0, 500),
  };
}

async function validateReferences(
  actor: ActorContext,
  template: ImportTemplate,
  rows: readonly CanonicalImportRow[],
  selectedBranchId: string | null,
): Promise<readonly ValidationError[]> {
  const errors: ValidationError[] = [];
  const branchCodes = [
    ...new Set(
      rows
        .map((row) => row.values.branchCode)
        .filter((value): value is string => typeof value === "string"),
    ),
  ];
  const branches = await prisma.branch.findMany({
    where: { companyId: actor.companyId, code: { in: branchCodes } },
    select: { id: true, code: true },
  });
  const branchByCode = new Map(branches.map((branch) => [branch.code, branch]));
  const needsBranch = ["STAFF", "ASSIGNMENTS", "ATTENDANCE_LIVE", "HISTORICAL_PAYROLL"].includes(
    template,
  );
  if (needsBranch) {
    for (const row of rows) {
      const branchCode = String(row.values.branchCode ?? "");
      const branch = branchByCode.get(branchCode);
      if (!branch) {
        errors.push(
          referenceError(
            row,
            "branchCode",
            "BRANCH_NOT_FOUND",
            "Mã cơ sở không tồn tại.",
            branchCode,
          ),
        );
      } else if (
        (selectedBranchId && branch.id !== selectedBranchId) ||
        (actor.role === "TRAINING_MANAGER" && !canAccessBranch(actor, branch.id))
      ) {
        errors.push(
          referenceError(
            row,
            "branchCode",
            "BRANCH_SCOPE",
            "Dòng dữ liệu nằm ngoài cơ sở được phép import.",
            branchCode,
            "CRITICAL",
          ),
        );
      }
    }
  }

  if (["STAFF", "ASSIGNMENTS", "ATTENDANCE_LIVE", "HISTORICAL_PAYROLL"].includes(template)) {
    const staffCodes = [
      ...new Set(
        rows
          .map((row) => row.values.staffCode)
          .filter((value): value is string => typeof value === "string"),
      ),
    ];
    const staff = await prisma.staffMember.findMany({
      where: { companyId: actor.companyId, staffCode: { in: staffCodes }, archivedAt: null },
      select: {
        id: true,
        staffCode: true,
        user: { select: { role: true } },
        assignments: {
          where: {
            branchId: { in: branches.map((branch) => branch.id) },
            archivedAt: null,
          },
          select: { branchId: true, assignmentType: true, effectiveFrom: true, effectiveTo: true },
        },
      },
    });
    const staffByCode = new Map(staff.map((item) => [item.staffCode, item]));
    for (const row of rows) {
      const staffCode = String(row.values.staffCode ?? "");
      const existingStaff = staffByCode.get(staffCode);
      if (!existingStaff && template !== "STAFF") {
        errors.push(
          referenceError(
            row,
            "staffCode",
            "STAFF_NOT_FOUND",
            "Mã nhân viên không tồn tại.",
            staffCode,
          ),
        );
        continue;
      }
      if (actor.role === "TRAINING_MANAGER" && existingStaff) {
        const branch = branchByCode.get(String(row.values.branchCode ?? ""));
        const effectiveValue =
          template === "ATTENDANCE_LIVE" ? row.values.businessDate : row.values.effectiveFrom;
        const effectiveAt =
          typeof effectiveValue === "string" ? new Date(`${effectiveValue}T00:00:00.000Z`) : null;
        const isLiveEmployee =
          existingStaff.id !== actor.staffId &&
          (!existingStaff.user || existingStaff.user.role === "LIVE_EMPLOYEE");
        const isAssigned =
          branch &&
          effectiveAt &&
          existingStaff.assignments.some(
            (assignment) =>
              assignment.branchId === branch.id &&
              assignment.assignmentType === "MEMBER" &&
              assignment.effectiveFrom <= effectiveAt &&
              (!assignment.effectiveTo || effectiveAt < assignment.effectiveTo),
          );
        if (!isLiveEmployee || !isAssigned) {
          errors.push(
            referenceError(
              row,
              "staffCode",
              "STAFF_SCOPE",
              "Nhân viên không thuộc phạm vi Live của cơ sở tại ngày hiệu lực.",
              staffCode,
              "CRITICAL",
            ),
          );
        }
        if (template === "ASSIGNMENTS" && row.values.assignmentType !== "MEMBER") {
          errors.push(
            referenceError(
              row,
              "assignmentType",
              "ASSIGNMENT_ROLE_SCOPE",
              "Quản lý đào tạo chỉ được import phân công MEMBER.",
              row.values.assignmentType,
              "CRITICAL",
            ),
          );
        }
      }
    }
  }

  if (["REWARD_RULES", "PENALTY_RULES"].includes(template)) {
    for (const row of rows) {
      if (row.values.status !== "DRAFT" && !row.values.effectiveFrom) {
        errors.push(
          referenceError(
            row,
            "effectiveFrom",
            "EFFECTIVE_DATE_REQUIRED",
            "Rule đã publish phải có ngày hiệu lực.",
            null,
            "CRITICAL",
          ),
        );
      }
    }
    const type = template === "REWARD_RULES" ? "DAILY_REWARD_TIERS" : "PENALTY";
    const names = [
      ...new Set(
        rows
          .map((row) => row.values.ruleSetName)
          .filter((value): value is string => typeof value === "string"),
      ),
    ];
    const ruleSets = await prisma.ruleSet.findMany({
      where: { companyId: actor.companyId, type, name: { in: names } },
      select: {
        name: true,
        versions: {
          select: {
            versionNo: true,
            status: true,
            effectiveFrom: true,
            effectiveTo: true,
          },
        },
      },
    });
    const setByName = new Map(ruleSets.map((set) => [set.name, set]));
    const checked = new Set<string>();
    for (const row of rows) {
      const name = text(row, "ruleSetName");
      const versionNo = integer(row, "versionNo");
      const key = `${name}:${versionNo}`;
      if (checked.has(key)) continue;
      checked.add(key);
      const set = setByName.get(name);
      if (set?.versions.some((version) => version.versionNo === versionNo)) {
        errors.push(
          referenceError(
            row,
            "versionNo",
            "RULE_VERSION_EXISTS",
            "Phiên bản rule đã tồn tại.",
            versionNo,
            "CRITICAL",
          ),
        );
        continue;
      }
      const effectiveFrom = text(row, "effectiveFrom");
      const effectiveTo = text(row, "effectiveTo");
      if (row.values.status === "DRAFT" || !effectiveFrom) continue;
      const overlap = set?.versions.some((version) => {
        if (version.status === "DRAFT" || !version.effectiveFrom) return false;
        const oldFrom = version.effectiveFrom.toISOString().slice(0, 10);
        const oldTo = version.effectiveTo?.toISOString().slice(0, 10) ?? null;
        return (!effectiveTo || oldFrom < effectiveTo) && (!oldTo || effectiveFrom < oldTo);
      });
      if (overlap) {
        errors.push(
          referenceError(
            row,
            "effectiveFrom",
            "RULE_INTERVAL_OVERLAP",
            "Khoảng hiệu lực rule bị chồng với phiên bản đã publish.",
            effectiveFrom,
            "CRITICAL",
          ),
        );
      }
    }
  }

  const keyForRow = (row: CanonicalImportRow): string => {
    if (template === "BRANCHES") return String(row.values.code);
    if (template === "STAFF") return String(row.values.staffCode);
    if (template === "ATTENDANCE_LIVE") {
      return `${row.values.staffCode}:${row.values.businessDate}`;
    }
    return "";
  };
  if (["BRANCHES", "STAFF", "ATTENDANCE_LIVE"].includes(template)) {
    const seen = new Set<string>();
    for (const row of rows) {
      const key = keyForRow(row);
      if (seen.has(key)) {
        errors.push(
          referenceError(
            row,
            "row",
            "DUPLICATE_ROW",
            "Khóa nghiệp vụ bị trùng trong cùng file.",
            key,
            "CRITICAL",
          ),
        );
      }
      seen.add(key);
    }
  }
  return errors;
}

async function validateJob(
  actor: ActorContext,
  job: ImportJobRecord,
  input: ImportPreviewInput,
): Promise<Readonly<{ rows: readonly CanonicalImportRow[]; errors: readonly ValidationError[] }>> {
  const parsed = await parseImportFile(await readPrivateObject(job.objectKey), job.mimeType);
  const structured = validateImportStructure(parsed, job.template, input.mapping);
  const referenceErrors = await validateReferences(
    actor,
    job.template,
    structured.rows,
    job.branchId,
  );
  return { rows: structured.rows, errors: [...structured.errors, ...referenceErrors] };
}

export async function previewImport(
  actor: ActorContext,
  id: string,
  input: ImportPreviewInput,
  metadata: RequestMetadata,
): Promise<ImportJobDto> {
  await enforceSensitiveMutationRateLimit(actor, "import.commit", {
    windowSeconds: 300,
    maxAttempts: 5,
  });
  const job = await authorizedJob(actor, id);
  assertGenericImportTemplate(job.template);
  if (!["UPLOADED", "VALIDATED", "FAILED"].includes(job.status)) {
    throw new DomainError("CONFLICT", "Import job chưa sẵn sàng để validate.");
  }
  await prisma.importJob.update({ where: { id }, data: { status: "VALIDATING" } });
  try {
    const result = await validateJob(actor, job, input);
    const errorRows = new Set(result.errors.map((item) => `${item.sheetName}:${item.rowNumber}`))
      .size;
    const persisted = result.errors.slice(0, MAX_PERSISTED_ERRORS);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.importError.deleteMany({ where: { importJobId: id, companyId: actor.companyId } });
      if (persisted.length > 0) {
        await tx.importError.createMany({
          data: persisted.map((item) => ({
            ...item,
            companyId: actor.companyId,
            importJobId: id,
          })),
        });
      }
      return tx.importJob.update({
        where: { id },
        data: {
          status: "VALIDATED",
          mapping: input.mapping,
          previewRows: result.rows.slice(0, 20).map((row) => row.values),
          totalRows: result.rows.length,
          validRows: Math.max(0, result.rows.length - errorRows),
          errorRows,
          dryRun: input.dryRun,
          validatedAt: new Date(),
          errorMessage:
            result.errors.length > MAX_PERSISTED_ERRORS
              ? `Chỉ lưu ${MAX_PERSISTED_ERRORS.toLocaleString("vi-VN")} lỗi đầu tiên.`
              : null,
        },
        include: importJobInclude,
      });
    });
    await appendSecureAudit({
      actor,
      action: "IMPORT_VALIDATE",
      entityType: "ImportJob",
      entityId: id,
      branchId: job.branchId,
      reason: input.dryRun ? "Dry-run import." : "Validate trước commit.",
      before: { status: job.status },
      after: {
        status: updated.status,
        totalRows: updated.totalRows,
        validRows: updated.validRows,
        errorRows: updated.errorRows,
        dryRun: updated.dryRun,
      },
      metadata,
    });
    return toDto(updated);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Không thể validate file.";
    await prisma.importJob.update({
      where: { id },
      data: { status: "FAILED", errorMessage: message },
    });
    throw new DomainError("VALIDATION_ERROR", message);
  }
}

function text(row: CanonicalImportRow, key: string): string {
  const value = row.values[key];
  return value === null || value === undefined ? "" : String(value);
}

function integer(row: CanonicalImportRow, key: string, fallback = 0): number {
  const value = row.values[key];
  return typeof value === "number" ? value : value === null ? fallback : Number(value);
}

function boolean(row: CanonicalImportRow, key: string, fallback: boolean): boolean {
  const value = row.values[key];
  return typeof value === "boolean" ? value : fallback;
}

function date(row: CanonicalImportRow, key: string): Date {
  return new Date(`${text(row, key).slice(0, 10)}T00:00:00.000Z`);
}

async function branchForRow(
  tx: Transaction,
  actor: ActorContext,
  row: CanonicalImportRow,
): Promise<{ id: string }> {
  const branch = await tx.branch.findFirst({
    where: { companyId: actor.companyId, code: text(row, "branchCode") },
    select: { id: true },
  });
  if (!branch || (actor.role === "TRAINING_MANAGER" && !canAccessBranch(actor, branch.id))) {
    throw new DomainError("FORBIDDEN", "Cơ sở import nằm ngoài phạm vi.");
  }
  return branch;
}

async function staffForRow(
  tx: Transaction,
  actor: ActorContext,
  row: CanonicalImportRow,
): Promise<{ id: string }> {
  const staff = await tx.staffMember.findFirst({
    where: { companyId: actor.companyId, staffCode: text(row, "staffCode"), archivedAt: null },
    select: { id: true },
  });
  if (!staff) throw new DomainError("NOT_FOUND", "Không tìm thấy nhân viên khi commit import.");
  return staff;
}

async function assertManagerStaffScope(
  tx: Transaction,
  actor: ActorContext,
  input: { staffId: string; branchId: string; effectiveAt: Date },
): Promise<void> {
  if (actor.role !== "TRAINING_MANAGER") return;
  const staff = await tx.staffMember.findFirst({
    where: { id: input.staffId, companyId: actor.companyId, archivedAt: null },
    select: { user: { select: { role: true } } },
  });
  if (
    input.staffId === actor.staffId ||
    !staff ||
    (staff.user && staff.user.role !== "LIVE_EMPLOYEE")
  ) {
    throw new DomainError("FORBIDDEN", "Quản lý chỉ được import dữ liệu nhân viên Live khác mình.");
  }
  const assignment = await tx.branchAssignment.findFirst({
    where: {
      companyId: actor.companyId,
      branchId: input.branchId,
      staffId: input.staffId,
      assignmentType: "MEMBER",
      archivedAt: null,
      effectiveFrom: { lte: input.effectiveAt },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: input.effectiveAt } }],
    },
    select: { id: true },
  });
  if (!assignment) {
    throw new DomainError(
      "FORBIDDEN",
      "Nhân viên không thuộc phạm vi cơ sở của quản lý tại ngày hiệu lực.",
    );
  }
}

async function commitStandardRow(
  tx: Transaction,
  actor: ActorContext,
  template: ImportTemplate,
  row: CanonicalImportRow,
): Promise<void> {
  if (template === "BRANCHES") {
    await tx.branch.upsert({
      where: { companyId_code: { companyId: actor.companyId, code: text(row, "code") } },
      create: {
        companyId: actor.companyId,
        code: text(row, "code"),
        name: text(row, "name"),
        address: text(row, "address") || null,
        isActive: boolean(row, "isActive", true),
      },
      update: {
        name: text(row, "name"),
        address: text(row, "address") || null,
        isActive: boolean(row, "isActive", true),
        version: { increment: 1 },
      },
    });
    return;
  }
  if (template === "STAFF") {
    const branch = await branchForRow(tx, actor, row);
    const effectiveFrom = date(row, "effectiveFrom");
    const existingStaff = await tx.staffMember.findUnique({
      where: {
        companyId_staffCode: {
          companyId: actor.companyId,
          staffCode: text(row, "staffCode"),
        },
      },
      select: { id: true },
    });
    if (existingStaff) {
      await assertManagerStaffScope(tx, actor, {
        staffId: existingStaff.id,
        branchId: branch.id,
        effectiveAt: effectiveFrom,
      });
    }
    const staff = await tx.staffMember.upsert({
      where: {
        companyId_staffCode: {
          companyId: actor.companyId,
          staffCode: text(row, "staffCode"),
        },
      },
      create: {
        companyId: actor.companyId,
        staffCode: text(row, "staffCode"),
        fullName: text(row, "fullName"),
        streamingAlias: text(row, "streamingAlias") || null,
        email: text(row, "email") || null,
        phone: text(row, "phone") || null,
        jobTitle: text(row, "jobTitle"),
        employmentCategory: text(row, "employmentCategory") as
          | "OFFICIAL"
          | "PROBATION"
          | "CONTRACTOR"
          | "INTERN",
        employmentStatus: (text(row, "employmentStatus") || "ACTIVE") as
          | "ACTIVE"
          | "ON_LEAVE"
          | "TERMINATED",
      },
      update: {
        fullName: text(row, "fullName"),
        streamingAlias: text(row, "streamingAlias") || null,
        email: text(row, "email") || null,
        phone: text(row, "phone") || null,
        jobTitle: text(row, "jobTitle"),
        employmentCategory: text(row, "employmentCategory") as
          | "OFFICIAL"
          | "PROBATION"
          | "CONTRACTOR"
          | "INTERN",
        employmentStatus: (text(row, "employmentStatus") || "ACTIVE") as
          | "ACTIVE"
          | "ON_LEAVE"
          | "TERMINATED",
        version: { increment: 1 },
      },
      select: { id: true, employmentCategory: true, employmentStatus: true },
    });
    const exactHistory = await tx.staffEmploymentHistory.findUnique({
      where: {
        companyId_staffId_effectiveFrom: {
          companyId: actor.companyId,
          staffId: staff.id,
          effectiveFrom,
        },
      },
      select: { id: true },
    });
    if (exactHistory) {
      await tx.staffEmploymentHistory.update({
        where: { id: exactHistory.id },
        data: {
          employmentCategory: staff.employmentCategory,
          employmentStatus: staff.employmentStatus,
          version: { increment: 1 },
        },
      });
    } else {
      const activeHistory = await tx.staffEmploymentHistory.findFirst({
        where: {
          companyId: actor.companyId,
          staffId: staff.id,
          effectiveFrom: { lt: effectiveFrom },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
        },
        orderBy: { effectiveFrom: "desc" },
        select: { id: true },
      });
      if (activeHistory) {
        await tx.staffEmploymentHistory.update({
          where: { id: activeHistory.id },
          data: { effectiveTo: effectiveFrom, version: { increment: 1 } },
        });
      }
      await tx.staffEmploymentHistory.create({
        data: {
          companyId: actor.companyId,
          staffId: staff.id,
          employmentCategory: staff.employmentCategory,
          employmentStatus: staff.employmentStatus,
          effectiveFrom,
          createdByUserId: actor.userId,
        },
      });
    }
    const assignment = await tx.branchAssignment.findFirst({
      where: {
        companyId: actor.companyId,
        branchId: branch.id,
        staffId: staff.id,
        assignmentType: "MEMBER",
        effectiveFrom,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!assignment) {
      const activeAssignment = await tx.branchAssignment.findFirst({
        where: {
          companyId: actor.companyId,
          staffId: staff.id,
          assignmentType: "MEMBER",
          effectiveFrom: { lt: effectiveFrom },
          archivedAt: null,
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
        },
        orderBy: { effectiveFrom: "desc" },
        select: { id: true },
      });
      if (activeAssignment) {
        await tx.branchAssignment.update({
          where: { id: activeAssignment.id },
          data: { effectiveTo: effectiveFrom, version: { increment: 1 } },
        });
      }
      await tx.branchAssignment.create({
        data: {
          companyId: actor.companyId,
          branchId: branch.id,
          staffId: staff.id,
          assignmentType: "MEMBER",
          effectiveFrom,
        },
      });
    }
    return;
  }
  if (template === "ASSIGNMENTS") {
    const branch = await branchForRow(tx, actor, row);
    const staff = await staffForRow(tx, actor, row);
    const effectiveFrom = date(row, "effectiveFrom");
    if (actor.role === "TRAINING_MANAGER" && text(row, "assignmentType") !== "MEMBER") {
      throw new DomainError("FORBIDDEN", "Quản lý đào tạo chỉ được import phân công MEMBER.");
    }
    await assertManagerStaffScope(tx, actor, {
      staffId: staff.id,
      branchId: branch.id,
      effectiveAt: effectiveFrom,
    });
    const existing = await tx.branchAssignment.findFirst({
      where: {
        companyId: actor.companyId,
        branchId: branch.id,
        staffId: staff.id,
        assignmentType: text(row, "assignmentType") as
          | "MEMBER"
          | "PRIMARY_MANAGER"
          | "SECONDARY_MANAGER",
        effectiveFrom,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!existing) {
      const assignmentType = text(row, "assignmentType") as
        | "MEMBER"
        | "PRIMARY_MANAGER"
        | "SECONDARY_MANAGER";
      const activeAssignment = await tx.branchAssignment.findFirst({
        where: {
          companyId: actor.companyId,
          staffId: staff.id,
          assignmentType,
          effectiveFrom: { lt: effectiveFrom },
          archivedAt: null,
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
        },
        orderBy: { effectiveFrom: "desc" },
        select: { id: true },
      });
      if (activeAssignment) {
        await tx.branchAssignment.update({
          where: { id: activeAssignment.id },
          data: { effectiveTo: effectiveFrom, version: { increment: 1 } },
        });
      }
      await tx.branchAssignment.create({
        data: {
          companyId: actor.companyId,
          branchId: branch.id,
          staffId: staff.id,
          assignmentType,
          effectiveFrom,
          effectiveTo: text(row, "effectiveTo") ? date(row, "effectiveTo") : null,
        },
      });
    }
    return;
  }
  if (template === "LEVELS") {
    const level = await tx.performanceLevel.upsert({
      where: {
        companyId_code: { companyId: actor.companyId, code: text(row, "levelCode") },
      },
      create: {
        companyId: actor.companyId,
        code: text(row, "levelCode"),
        name: text(row, "levelName"),
        displayOrder: integer(row, "displayOrder"),
        isActive: boolean(row, "isActive", true),
      },
      update: {
        name: text(row, "levelName"),
        displayOrder: integer(row, "displayOrder"),
        isActive: boolean(row, "isActive", true),
      },
    });
    if (text(row, "staffCode") && text(row, "effectiveFrom")) {
      const staff = await staffForRow(tx, actor, row);
      const effectiveFrom = date(row, "effectiveFrom");
      const existing = await tx.levelHistory.findFirst({
        where: { companyId: actor.companyId, staffId: staff.id, effectiveFrom },
        select: { id: true },
      });
      if (existing) {
        await tx.levelHistory.update({
          where: { id: existing.id },
          data: {
            performanceLevelId: level.id,
            effectiveTo: text(row, "effectiveTo") ? date(row, "effectiveTo") : null,
            version: { increment: 1 },
          },
        });
      } else {
        const active = await tx.levelHistory.findFirst({
          where: {
            companyId: actor.companyId,
            staffId: staff.id,
            effectiveFrom: { lt: effectiveFrom },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
          },
          orderBy: { effectiveFrom: "desc" },
          select: { id: true },
        });
        if (active) {
          await tx.levelHistory.update({
            where: { id: active.id },
            data: { effectiveTo: effectiveFrom, version: { increment: 1 } },
          });
        }
        await tx.levelHistory.create({
          data: {
            companyId: actor.companyId,
            staffId: staff.id,
            performanceLevelId: level.id,
            effectiveFrom,
            effectiveTo: text(row, "effectiveTo") ? date(row, "effectiveTo") : null,
            createdByUserId: actor.userId,
          },
        });
      }
    }
    return;
  }
  if (template === "ATTENDANCE_LIVE") {
    const branch = await branchForRow(tx, actor, row);
    const staff = await staffForRow(tx, actor, row);
    const businessDate = date(row, "businessDate");
    await assertManagerStaffScope(tx, actor, {
      staffId: staff.id,
      branchId: branch.id,
      effectiveAt: businessDate,
    });
    const existingAttendance = await tx.attendanceDay.findUnique({
      where: {
        companyId_staffId_businessDate: {
          companyId: actor.companyId,
          staffId: staff.id,
          businessDate,
        },
      },
      select: { branchId: true },
    });
    if (
      actor.role === "TRAINING_MANAGER" &&
      existingAttendance &&
      !canAccessBranch(actor, existingAttendance.branchId)
    ) {
      throw new DomainError("FORBIDDEN", "Attendance hiện có nằm ngoài phạm vi cơ sở.");
    }
    const attendance = await tx.attendanceDay.upsert({
      where: {
        companyId_staffId_businessDate: {
          companyId: actor.companyId,
          staffId: staff.id,
          businessDate,
        },
      },
      create: {
        companyId: actor.companyId,
        branchId: branch.id,
        staffId: staff.id,
        businessDate,
        checkInAt: text(row, "checkInAt") ? new Date(text(row, "checkInAt")) : null,
        checkOutAt: text(row, "checkOutAt") ? new Date(text(row, "checkOutAt")) : null,
        spansNextDay: boolean(row, "spansNextDay", false),
        workUnits: text(row, "workUnits"),
        overtimeMinutes: integer(row, "overtimeMinutes"),
        status: text(row, "status") as "DRAFT" | "PRESENT" | "ABSENT" | "LEAVE",
        note: text(row, "note") || null,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      },
      update: {
        branchId: branch.id,
        checkInAt: text(row, "checkInAt") ? new Date(text(row, "checkInAt")) : null,
        checkOutAt: text(row, "checkOutAt") ? new Date(text(row, "checkOutAt")) : null,
        spansNextDay: boolean(row, "spansNextDay", false),
        workUnits: text(row, "workUnits"),
        overtimeMinutes: integer(row, "overtimeMinutes"),
        status: text(row, "status") as "DRAFT" | "PRESENT" | "ABSENT" | "LEAVE",
        note: text(row, "note") || null,
        updatedByUserId: actor.userId,
        version: { increment: 1 },
      },
      select: { id: true },
    });
    const company = await tx.company.findUniqueOrThrow({
      where: { id: actor.companyId },
      select: { revenueUnit: true, revenueScale: true },
    });
    await tx.liveDailyMetric.upsert({
      where: { attendanceId: attendance.id },
      create: {
        companyId: actor.companyId,
        branchId: branch.id,
        attendanceId: attendance.id,
        actualLiveMinutes: integer(row, "actualLiveMinutes"),
        revenueAmount: BigInt(text(row, "revenueAmount") || "0"),
        revenueUnit: company.revenueUnit,
        revenueScale: company.revenueScale,
      },
      update: {
        branchId: branch.id,
        actualLiveMinutes: integer(row, "actualLiveMinutes"),
        revenueAmount: BigInt(text(row, "revenueAmount") || "0"),
        revenueUnit: company.revenueUnit,
        revenueScale: company.revenueScale,
      },
    });
  }
}

function groupRows(
  rows: readonly CanonicalImportRow[],
  key: (row: CanonicalImportRow) => string,
): readonly (readonly CanonicalImportRow[])[] {
  const groups = new Map<string, CanonicalImportRow[]>();
  for (const row of rows) {
    const groupKey = key(row);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), row]);
  }
  return [...groups.values()];
}

async function commitRuleGroup(
  actor: ActorContext,
  template: "REWARD_RULES" | "PENALTY_RULES",
  rows: readonly CanonicalImportRow[],
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const first = rows[0]!;
    const type = template === "REWARD_RULES" ? "DAILY_REWARD_TIERS" : "PENALTY";
    const ruleSet = await tx.ruleSet.upsert({
      where: {
        companyId_type_name: {
          companyId: actor.companyId,
          type,
          name: text(first, "ruleSetName"),
        },
      },
      create: {
        companyId: actor.companyId,
        type,
        name: text(first, "ruleSetName"),
        createdByUserId: actor.userId,
      },
      update: {},
    });
    const versionNo = integer(first, "versionNo");
    const existing = await tx.ruleVersion.findUnique({
      where: { ruleSetId_versionNo: { ruleSetId: ruleSet.id, versionNo } },
      select: { id: true },
    });
    if (existing) return rows.length;
    const configuration =
      template === "REWARD_RULES"
        ? {
            gapPolicy: "ALLOW_GAPS",
            tiers: rows.map((row) => ({
              minRevenue: text(row, "minRevenue"),
              maxRevenue: text(row, "maxRevenue") || null,
              rewardAmount: text(row, "rewardAmount"),
              minInclusive: boolean(row, "minInclusive", true),
              maxInclusive: boolean(row, "maxInclusive", false),
              priority: integer(row, "priority"),
            })),
          }
        : undefined;
    const version = await tx.ruleVersion.create({
      data: {
        companyId: actor.companyId,
        ruleSetId: ruleSet.id,
        versionNo,
        status: "DRAFT",
        effectiveFrom: text(first, "effectiveFrom") ? date(first, "effectiveFrom") : null,
        effectiveTo: text(first, "effectiveTo") ? date(first, "effectiveTo") : null,
        notes: "Imported from legacy data",
        ...(configuration ? { configuration } : {}),
        createdByUserId: actor.userId,
      },
    });
    if (template === "PENALTY_RULES") {
      await tx.penaltyItem.createMany({
        data: rows.map((row) => ({
          companyId: actor.companyId,
          ruleVersionId: version.id,
          code: text(row, "itemCode"),
          name: text(row, "itemName"),
          description: text(row, "description"),
          defaultAmount: BigInt(text(row, "defaultAmount")),
          isActive: boolean(row, "isActive", true),
          displayColor: text(row, "displayColor") || "#64748B",
          displayOrder: integer(row, "displayOrder"),
        })),
      });
    }
    const targetStatus = text(first, "status") as "DRAFT" | "SCHEDULED" | "ACTIVE" | "RETIRED";
    if (targetStatus !== "DRAFT") {
      await tx.ruleVersion.update({
        where: { id: version.id },
        data: {
          status: targetStatus,
          publishedByUserId: actor.userId,
          publishedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
    }
    return rows.length;
  });
}

async function commitHistoricalPayrollGroup(
  actor: ActorContext,
  rows: readonly CanonicalImportRow[],
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const first = rows[0]!;
    const branch = await branchForRow(tx, actor, first);
    const month = new Date(`${text(first, "month").slice(0, 7)}-01T00:00:00.000Z`);
    const revision = integer(first, "revision", 1) || 1;
    const existing = await tx.payrollPeriod.findUnique({
      where: {
        companyId_branchId_month_revision: {
          companyId: actor.companyId,
          branchId: branch.id,
          month,
          revision,
        },
      },
      select: { id: true },
    });
    if (existing) return rows.length;
    const period = await tx.payrollPeriod.create({
      data: {
        companyId: actor.companyId,
        branchId: branch.id,
        month,
        revision,
        status: "DRAFT",
        latestCalculationNo: 1,
        createdByUserId: actor.userId,
        creationReason: "Import bảng lương lịch sử.",
      },
    });
    for (const row of rows) {
      const staff = await staffForRow(tx, actor, row);
      const components = {
        baseSalary: text(row, "baseSalary"),
        proratedSalary: text(row, "baseSalary"),
        dailyRevenueBonus: "0",
        monthlyRevenueBonus: text(row, "monthlyRevenueBonus") || "0",
        attendanceBonus: "0",
        achievementBonus: "0",
        levelBonus: "0",
        overtimePay: "0",
        otherBonus: text(row, "otherBonus") || "0",
        penalties: text(row, "penalties") || "0",
        advance: text(row, "advance") || "0",
        totalIncome: text(row, "totalIncome"),
      };
      const entry = await tx.payrollEntry.create({
        data: {
          companyId: actor.companyId,
          branchId: branch.id,
          payrollPeriodId: period.id,
          staffId: staff.id,
          workUnits: text(row, "workUnits"),
          overtimeMinutes: integer(row, "overtimeMinutes"),
          revenueAmount: BigInt(text(row, "revenueAmount") || "0"),
          baseSalary: BigInt(components.baseSalary),
          proratedSalary: BigInt(components.proratedSalary),
          monthlyRevenueBonus: BigInt(components.monthlyRevenueBonus),
          otherBonus: BigInt(components.otherBonus),
          penalties: BigInt(components.penalties),
          advance: BigInt(components.advance),
          totalIncome: BigInt(components.totalIncome),
          anomalyFlags: ["HISTORICAL_IMPORT"],
        },
      });
      const snapshotInputs = {
        workUnits: text(row, "workUnits"),
        overtimeMinutes: integer(row, "overtimeMinutes"),
        revenueAmount: text(row, "revenueAmount") || "0",
      };
      const snapshot = await tx.calculationSnapshot.create({
        data: {
          companyId: actor.companyId,
          branchId: branch.id,
          payrollPeriodId: period.id,
          payrollEntryId: entry.id,
          calculationNo: 1,
          inputHash: createHash("sha256")
            .update(JSON.stringify({ periodId: period.id, staffId: staff.id, ...snapshotInputs }))
            .digest("hex"),
          outputHash: createHash("sha256").update(JSON.stringify(components)).digest("hex"),
          engineVersion: "legacy-import-v1",
          inputs: snapshotInputs,
          selectedRuleVersions: [],
          roundingPolicy: { mode: "HISTORICAL_IMPORT" },
          outputs: components,
          calculatedByUserId: actor.userId,
        },
      });
      const lines = [
        ["BASE_SALARY", components.baseSalary, true],
        ["MONTHLY_REVENUE_BONUS", components.monthlyRevenueBonus, true],
        ["OTHER_BONUS", components.otherBonus, true],
        ["PENALTY", components.penalties, true],
        ["ADVANCE", components.advance, true],
        ["TOTAL_INCOME", components.totalIncome, false],
      ] as const;
      await tx.payrollLine.createMany({
        data: lines.map(([type, amount, includedInTotal], index) => ({
          companyId: actor.companyId,
          branchId: branch.id,
          payrollEntryId: entry.id,
          calculationSnapshotId: snapshot.id,
          type,
          amount: BigInt(amount),
          sourceType: "HISTORICAL_IMPORT",
          sourceId: `${period.id}:${staff.id}`,
          label: type,
          calculationDetails: { imported: true },
          includedInTotal,
          displayOrder: index,
        })),
      });
      await tx.payrollEntry.update({
        where: { id: entry.id },
        data: { currentSnapshotId: snapshot.id },
      });
    }
    await tx.payrollPeriod.update({
      where: { id: period.id },
      data: {
        status: "PUBLISHED",
        version: { increment: 1 },
        calculatedAt: new Date(),
        publishedByUserId: actor.userId,
        publishedAt: new Date(),
        publishReason: "Import bảng lương lịch sử.",
      },
    });
    return rows.length;
  });
}

async function commitRows(
  actor: ActorContext,
  template: ImportTemplate,
  rows: readonly CanonicalImportRow[],
  jobId: string,
  reason: string,
  metadata: RequestMetadata,
): Promise<number> {
  let committed = 0;
  if (template === "REWARD_RULES" || template === "PENALTY_RULES") {
    const groups = groupRows(
      rows,
      (row) => `${text(row, "ruleSetName")}:${integer(row, "versionNo")}`,
    );
    for (const group of groups) {
      committed += await commitRuleGroup(actor, template, group);
    }
    return committed;
  }
  if (template === "HISTORICAL_PAYROLL") {
    const groups = groupRows(
      rows,
      (row) =>
        `${text(row, "branchCode")}:${text(row, "month").slice(0, 7)}:${integer(row, "revision", 1)}`,
    );
    for (const group of groups) {
      committed += await commitHistoricalPayrollGroup(actor, group);
    }
    return committed;
  }
  for (let offset = 0; offset < rows.length; offset += IMPORT_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + IMPORT_BATCH_SIZE);
    await prisma.$transaction(async (tx) => {
      for (const row of batch) {
        await commitStandardRow(tx, actor, template, row);
      }
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          branchId: null,
          actorUserId: actor.userId,
          action: "IMPORT_BATCH_COMMIT",
          entityType: "ImportJob",
          entityId: jobId,
          reason,
          after: {
            template,
            fromRow: offset + 1,
            toRow: offset + batch.length,
            committedRows: batch.length,
          },
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        },
      });
    });
    committed += batch.length;
  }
  return committed;
}

export async function commitImport(
  actor: ActorContext,
  id: string,
  _input: ImportCommitInput,
  metadata: RequestMetadata,
): Promise<ImportJobDto> {
  const commitReason = systemAuditReason("IMPORT_COMMITTED");
  const job = await authorizedJob(actor, id);
  assertGenericImportTemplate(job.template);
  if (job.status === "SUCCEEDED") return toDto(job);
  if (job.status !== "VALIDATED" || job.errorRows > 0) {
    throw new DomainError("CONFLICT", "Import phải validate thành công và không còn lỗi.");
  }
  const validation = await validateJob(actor, job, {
    mapping: jsonRecord(job.mapping),
    dryRun: false,
  });
  if (validation.errors.length > 0) {
    throw new DomainError("CONFLICT", "Dữ liệu hoặc phạm vi đã thay đổi; hãy preview lại.");
  }
  await prisma.importJob.update({
    where: { id },
    data: { status: "COMMITTING", dryRun: false, errorMessage: null },
  });
  try {
    const committedRows = await commitRows(
      actor,
      job.template,
      validation.rows,
      id,
      commitReason,
      metadata,
    );
    const updated = await prisma.importJob.update({
      where: { id },
      data: {
        status: "SUCCEEDED",
        committedRows,
        committedAt: new Date(),
      },
      include: importJobInclude,
    });
    await appendSecureAudit({
      actor,
      action: "IMPORT_COMMIT",
      entityType: "ImportJob",
      entityId: id,
      branchId: job.branchId,
      reason: commitReason,
      before: { status: job.status, committedRows: job.committedRows },
      after: { status: updated.status, committedRows },
      metadata,
    });
    return toDto(updated);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Commit import thất bại.";
    await prisma.importJob.update({
      where: { id },
      data: { status: "FAILED", errorMessage: message },
    });
    await appendSecureAudit({
      actor,
      action: "IMPORT_COMMIT_FAILED",
      entityType: "ImportJob",
      entityId: id,
      branchId: job.branchId,
      reason: systemAuditReason("IMPORT_COMMIT_FAILED"),
      after: { status: "FAILED", errorMessage: message },
      metadata,
    });
    throw cause;
  }
}

export async function exportImportErrorsCsv(actor: ActorContext, id: string): Promise<Uint8Array> {
  const job = await authorizedJob(actor, id);
  const errors = await prisma.importError.findMany({
    where: { companyId: actor.companyId, importJobId: job.id },
    orderBy: [{ sheetName: "asc" }, { rowNumber: "asc" }, { columnName: "asc" }],
  });
  const header = ["Sheet", "Dòng", "Cột", "Mã lỗi", "Mức độ", "Thông báo", "Giá trị"];
  const lines = [
    header.map(escapeCsvCell).join(","),
    ...errors.map((item) =>
      [
        item.sheetName,
        item.rowNumber,
        item.columnName,
        item.code,
        item.severity,
        item.message,
        item.rawValue,
      ]
        .map(escapeCsvCell)
        .join(","),
    ),
  ];
  return new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}`);
}
