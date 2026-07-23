import type { PayrollExportCreateInput, PayrollExportJobDto } from "@ald/contracts";
import { prisma, type Prisma } from "@ald/db";
import { DomainError, requirePermission, type ActorContext } from "@ald/domain";

import { enqueuePayrollExport } from "./job-queue";
import { createPrivateDownloadUrl } from "./object-storage";
import type { RequestMetadata } from "./request-metadata";

function toJobDto(job: {
  id: string;
  payrollPeriodId: string;
  staffId: string | null;
  kind: "PAYSLIP_XLSX" | "PAYSLIP_PDF" | "BULK_ZIP";
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  progress: number;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: bigint | null;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
}): PayrollExportJobDto {
  return {
    id: job.id,
    periodId: job.payrollPeriodId,
    staffId: job.staffId,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    fileName: job.fileName,
    mimeType: job.mimeType,
    sizeBytes: job.sizeBytes?.toString() ?? null,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

const jobSelect = {
  id: true,
  payrollPeriodId: true,
  staffId: true,
  kind: true,
  status: true,
  progress: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  errorMessage: true,
  createdAt: true,
  completedAt: true,
} satisfies Prisma.PayrollExportJobSelect;

function requireExportAccess(actor: ActorContext): void {
  if (actor.role === "GENERAL_MANAGER") {
    requirePermission(actor, "payroll:export");
  } else if (actor.role === "LIVE_EMPLOYEE") {
    requirePermission(actor, "payslip:read");
  } else {
    throw new DomainError("FORBIDDEN", "Quản lý đào tạo không được truy cập file payroll.");
  }
}

async function employeeSelfServiceEnabled(actor: ActorContext): Promise<void> {
  if (actor.role !== "LIVE_EMPLOYEE") return;
  const enabled = await prisma.company.findFirst({
    where: { id: actor.companyId, selfServiceEnabled: true },
    select: { id: true },
  });
  if (!enabled || !actor.staffId) {
    throw new DomainError("FORBIDDEN", "Self-service chưa được bật.");
  }
}

export async function createPayrollExport(
  actor: ActorContext,
  periodId: string,
  input: PayrollExportCreateInput,
  metadata: RequestMetadata,
): Promise<PayrollExportJobDto> {
  requireExportAccess(actor);
  await employeeSelfServiceEnabled(actor);
  const job = await prisma.$transaction(async (tx) => {
    const period = await tx.payrollPeriod.findFirst({
      where: {
        id: periodId,
        companyId: actor.companyId,
        ...(actor.role === "LIVE_EMPLOYEE"
          ? {
              status: "PUBLISHED",
              entries: { some: { staffId: actor.staffId!, included: true } },
            }
          : {
              status: { in: ["CALCULATED", "REVIEWED", "LOCKED", "PUBLISHED"] },
            }),
      },
      select: { id: true, branchId: true, status: true },
    });
    if (!period) {
      throw new DomainError("NOT_FOUND", "Không tìm thấy kỳ lương có thể export.");
    }
    if (actor.role === "LIVE_EMPLOYEE" && input.kind === "BULK_ZIP") {
      throw new DomainError("FORBIDDEN", "Nhân viên không được tạo bulk payroll export.");
    }
    const staffId = actor.role === "LIVE_EMPLOYEE" ? actor.staffId : (input.staffId ?? null);
    if (input.kind !== "BULK_ZIP") {
      const entry = await tx.payrollEntry.findFirst({
        where: {
          companyId: actor.companyId,
          payrollPeriodId: period.id,
          staffId: staffId!,
          included: true,
          currentSnapshotId: { not: null },
        },
        select: { id: true },
      });
      if (!entry) {
        throw new DomainError("NOT_FOUND", "Không tìm thấy payslip trong kỳ.");
      }
    }
    const created = await tx.payrollExportJob.create({
      data: {
        companyId: actor.companyId,
        branchId: period.branchId,
        payrollPeriodId: period.id,
        staffId: input.kind === "BULK_ZIP" ? null : staffId,
        kind: input.kind,
        requestedByUserId: actor.userId,
        requestReason: input.reason,
      },
      select: jobSelect,
    });
    await tx.auditLog.create({
      data: {
        companyId: actor.companyId,
        actorUserId: actor.userId,
        action: "PAYROLL_EXPORT_REQUEST",
        entityType: "PayrollExportJob",
        entityId: created.id,
        reason: input.reason,
        after: {
          payrollPeriodId: period.id,
          staffId: input.kind === "BULK_ZIP" ? null : staffId,
          kind: input.kind,
        },
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      },
    });
    return created;
  });
  try {
    await enqueuePayrollExport(job.id);
  } catch (error) {
    await prisma.payrollExportJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "Không thể enqueue job.",
        completedAt: new Date(),
      },
    });
    throw error;
  }
  return toJobDto(job);
}

export async function listPayrollExports(
  actor: ActorContext,
  periodId: string,
): Promise<readonly PayrollExportJobDto[]> {
  requireExportAccess(actor);
  await employeeSelfServiceEnabled(actor);
  const jobs = await prisma.payrollExportJob.findMany({
    where: {
      companyId: actor.companyId,
      payrollPeriodId: periodId,
      ...(actor.role === "LIVE_EMPLOYEE"
        ? {
            requestedByUserId: actor.userId,
            staffId: actor.staffId,
            payrollPeriod: { status: "PUBLISHED" },
          }
        : {}),
    },
    select: jobSelect,
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return jobs.map(toJobDto);
}

async function authorizedJob(actor: ActorContext, jobId: string) {
  requireExportAccess(actor);
  await employeeSelfServiceEnabled(actor);
  const job = await prisma.payrollExportJob.findFirst({
    where: {
      id: jobId,
      companyId: actor.companyId,
      ...(actor.role === "LIVE_EMPLOYEE"
        ? {
            requestedByUserId: actor.userId,
            staffId: actor.staffId,
            payrollPeriod: { status: "PUBLISHED" },
          }
        : {}),
    },
    select: {
      ...jobSelect,
      companyId: true,
      branchId: true,
      objectKey: true,
      requestedByUserId: true,
    },
  });
  if (!job) throw new DomainError("NOT_FOUND", "Không tìm thấy export job trong phạm vi.");
  return job;
}

export async function getPayrollExport(
  actor: ActorContext,
  jobId: string,
): Promise<PayrollExportJobDto> {
  return toJobDto(await authorizedJob(actor, jobId));
}

export async function getPayrollExportDownload(
  actor: ActorContext,
  jobId: string,
  metadata: RequestMetadata,
): Promise<Readonly<{ url: string; expiresInSeconds: number; fileName: string }>> {
  const job = await authorizedJob(actor, jobId);
  if (job.status !== "COMPLETED" || !job.objectKey || !job.fileName || !job.mimeType) {
    throw new DomainError("CONFLICT", "File export chưa sẵn sàng.");
  }
  const signed = await createPrivateDownloadUrl({
    objectKey: job.objectKey,
    fileName: job.fileName,
    mimeType: job.mimeType,
  });
  await prisma.payrollDownloadLog.create({
    data: {
      companyId: actor.companyId,
      branchId: job.branchId,
      payrollPeriodId: job.payrollPeriodId,
      exportJobId: job.id,
      staffId: job.staffId,
      downloadedByUserId: actor.userId,
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    },
  });
  return { ...signed, fileName: job.fileName };
}
