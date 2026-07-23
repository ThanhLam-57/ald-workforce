import type { DataExportCreateInput, DataExportJobDto, DataExportListQuery } from "@ald/contracts";
import { prisma, type Prisma } from "@ald/db";
import { canAccessBranch, DomainError, requirePermission, type ActorContext } from "@ald/domain";

import { appendSecureAudit } from "./audit-service";
import { enqueueDataExport } from "./job-queue";
import { createPrivateDownloadUrl } from "./object-storage";
import type { RequestMetadata } from "./request-metadata";

const exportSelect = {
  id: true,
  companyId: true,
  branchId: true,
  template: true,
  format: true,
  status: true,
  progress: true,
  objectKey: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  errorMessage: true,
  requestedByUserId: true,
  createdAt: true,
  completedAt: true,
  expiresAt: true,
} satisfies Prisma.DataExportJobSelect;

type ExportRecord = Prisma.DataExportJobGetPayload<{ select: typeof exportSelect }>;

function toDto(job: ExportRecord): DataExportJobDto {
  return {
    id: job.id,
    template: job.template,
    format: job.format,
    status: job.status,
    branchId: job.branchId,
    progress: job.progress,
    fileName: job.fileName,
    mimeType: job.mimeType,
    sizeBytes: job.sizeBytes?.toString() ?? null,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
    expiresAt: job.expiresAt.toISOString(),
  };
}

function exportScope(actor: ActorContext): Prisma.DataExportJobWhereInput {
  return actor.role === "GENERAL_MANAGER"
    ? { companyId: actor.companyId }
    : {
        companyId: actor.companyId,
        branchId: { in: [...actor.activeBranchIds] },
      };
}

function assertTemplateAccess(actor: ActorContext, input: DataExportCreateInput): void {
  requirePermission(actor, "export-center:write");
  if (
    actor.role === "TRAINING_MANAGER" &&
    !["EMPLOYEE_ERROR_REPORT", "BRANCH_MONTHLY"].includes(input.template)
  ) {
    throw new DomainError(
      "FORBIDDEN",
      "Quản lý không được export dữ liệu công ty, audit hoặc payroll.",
    );
  }
  if (actor.role === "LIVE_EMPLOYEE") {
    throw new DomainError("FORBIDDEN", "Nhân viên không có quyền dùng Export Center.");
  }
  if (["EMPLOYEE_ERROR_REPORT", "BRANCH_MONTHLY"].includes(input.template)) {
    if (!input.branchId || !input.month) {
      throw new DomainError("VALIDATION_ERROR", "Template này bắt buộc có cơ sở và tháng.");
    }
  }
  if (input.template === "COMPANY_MONTHLY" && !input.month) {
    throw new DomainError("VALIDATION_ERROR", "Báo cáo công ty bắt buộc có tháng.");
  }
  if (input.template === "PAYSLIP" && (!input.payrollPeriodId || !input.staffId)) {
    throw new DomainError("VALIDATION_ERROR", "Payslip bắt buộc có kỳ lương và nhân viên.");
  }
  if (input.template === "AUDIT" && actor.role !== "GENERAL_MANAGER") {
    throw new DomainError("FORBIDDEN", "Chỉ Tổng quản lý được export audit.");
  }
}

async function validateBranch(
  actor: ActorContext,
  branchId: string | null | undefined,
): Promise<void> {
  if (!branchId) return;
  if (actor.role === "TRAINING_MANAGER" && !canAccessBranch(actor, branchId)) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy cơ sở trong phạm vi.");
  }
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, companyId: actor.companyId },
    select: { id: true },
  });
  if (!branch) throw new DomainError("NOT_FOUND", "Không tìm thấy cơ sở.");
}

function retentionDays(): number {
  const parsed = Number(process.env.EXPORT_RETENTION_DAYS ?? "7");
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 30 ? parsed : 7;
}

export async function createDataExport(
  actor: ActorContext,
  input: DataExportCreateInput,
  metadata: RequestMetadata,
): Promise<DataExportJobDto> {
  assertTemplateAccess(actor, input);
  await validateBranch(actor, input.branchId);
  if (input.template === "PAYSLIP") {
    const entry = await prisma.payrollEntry.findFirst({
      where: {
        companyId: actor.companyId,
        payrollPeriodId: input.payrollPeriodId!,
        staffId: input.staffId!,
        included: true,
        currentSnapshotId: { not: null },
        payrollPeriod: { status: { in: ["CALCULATED", "REVIEWED", "LOCKED", "PUBLISHED"] } },
      },
      select: { branchId: true },
    });
    if (!entry) throw new DomainError("NOT_FOUND", "Không tìm thấy payslip có thể export.");
    input = { ...input, branchId: entry.branchId };
  }
  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + retentionDays());
  const parameters = Object.fromEntries(
    Object.entries({
      month: input.month,
      staffId: input.staffId,
      payrollPeriodId: input.payrollPeriodId,
      auditFilters: input.auditFilters,
    }).filter(([, value]) => value !== undefined && value !== null),
  ) as Prisma.InputJsonValue;
  const job = await prisma.dataExportJob.create({
    data: {
      companyId: actor.companyId,
      branchId: input.branchId ?? null,
      template: input.template,
      format: input.format,
      parameters,
      requestedByUserId: actor.userId,
      reason: input.reason,
      expiresAt,
    },
    select: exportSelect,
  });
  await appendSecureAudit({
    actor,
    action: "DATA_EXPORT_REQUEST",
    entityType: "DataExportJob",
    entityId: job.id,
    branchId: job.branchId,
    reason: input.reason,
    after: { template: input.template, format: input.format, parameters, expiresAt },
    metadata,
  });
  try {
    await enqueueDataExport(job.id);
  } catch (cause) {
    await prisma.dataExportJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorMessage: cause instanceof Error ? cause.message : "Không thể enqueue export.",
        completedAt: new Date(),
      },
    });
    throw cause;
  }
  return toDto(job);
}

export async function listDataExports(
  actor: ActorContext,
  query: DataExportListQuery,
): Promise<readonly DataExportJobDto[]> {
  requirePermission(actor, "export-center:read");
  const jobs = await prisma.dataExportJob.findMany({
    where: {
      ...exportScope(actor),
      ...(query.status ? { status: query.status } : {}),
    },
    select: exportSelect,
    orderBy: { createdAt: "desc" },
    take: query.limit,
  });
  return jobs.map(toDto);
}

async function authorizedExport(actor: ActorContext, id: string): Promise<ExportRecord> {
  requirePermission(actor, "export-center:read");
  const job = await prisma.dataExportJob.findFirst({
    where: { id, ...exportScope(actor) },
    select: exportSelect,
  });
  if (!job) throw new DomainError("NOT_FOUND", "Không tìm thấy export job trong phạm vi.");
  return job;
}

export async function getDataExport(actor: ActorContext, id: string): Promise<DataExportJobDto> {
  return toDto(await authorizedExport(actor, id));
}

export async function getDataExportDownload(
  actor: ActorContext,
  id: string,
  metadata: RequestMetadata,
) {
  const job = await authorizedExport(actor, id);
  if (job.expiresAt <= new Date() || job.status === "EXPIRED") {
    throw new DomainError("CONFLICT", "File export đã hết hạn.");
  }
  if (job.status !== "SUCCEEDED" || !job.objectKey || !job.fileName || !job.mimeType) {
    throw new DomainError("CONFLICT", "File export chưa sẵn sàng.");
  }
  const signed = await createPrivateDownloadUrl({
    objectKey: job.objectKey,
    fileName: job.fileName,
    mimeType: job.mimeType,
  });
  await appendSecureAudit({
    actor,
    action: "DATA_EXPORT_DOWNLOAD",
    entityType: "DataExportJob",
    entityId: job.id,
    branchId: job.branchId,
    reason: "Tải file private qua signed URL ngắn hạn.",
    after: {
      template: job.template,
      fileName: job.fileName,
      expiresInSeconds: signed.expiresInSeconds,
    },
    metadata,
  });
  return { ...signed, fileName: job.fileName };
}
