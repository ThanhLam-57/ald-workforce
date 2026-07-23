import { randomUUID } from "node:crypto";

import type {
  EvidenceCompleteInput,
  EvidenceDto,
  EvidencePresignInput,
  ViolationCancelInput,
  ViolationCreateInput,
  ViolationDto,
} from "@ald/contracts";
import { prisma, type Prisma } from "@ald/db";
import { DomainError, requirePermission, type ActorContext } from "@ald/domain";

import {
  createEvidenceUploadUrl,
  createEvidenceViewUrl,
  verifyEvidenceObject,
} from "./object-storage";
import type { RequestMetadata } from "./request-metadata";

type Transaction = Prisma.TransactionClient;

export const violationSelect = {
  id: true,
  attendanceId: true,
  businessDate: true,
  penaltyItemId: true,
  ruleVersionId: true,
  itemName: true,
  amount: true,
  detail: true,
  note: true,
  overrideReason: true,
  status: true,
  version: true,
  penaltyItem: {
    select: {
      displayColor: true,
    },
  },
  evidenceObjects: {
    select: {
      id: true,
      originalFileName: true,
      mimeType: true,
      sizeBytes: true,
      checksumSha256: true,
      status: true,
      version: true,
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.ViolationSelect;

type ViolationRecord = Prisma.ViolationGetPayload<{ select: typeof violationSelect }>;

function evidenceDto(evidence: ViolationRecord["evidenceObjects"][number]): EvidenceDto {
  return {
    id: evidence.id,
    originalFileName: evidence.originalFileName,
    mimeType: evidence.mimeType as EvidenceDto["mimeType"],
    sizeBytes: evidence.sizeBytes.toString(),
    checksumSha256: evidence.checksumSha256,
    status: evidence.status,
    version: evidence.version,
  };
}

export function toViolationDto(violation: ViolationRecord): ViolationDto {
  return {
    id: violation.id,
    attendanceId: violation.attendanceId,
    businessDate: violation.businessDate.toISOString().slice(0, 10),
    penaltyItemId: violation.penaltyItemId,
    ruleVersionId: violation.ruleVersionId,
    itemName: violation.itemName,
    amount: violation.amount.toString(),
    detail: violation.detail,
    note: violation.note,
    overrideReason: violation.overrideReason,
    status: violation.status,
    version: violation.version,
    displayColor: violation.penaltyItem.displayColor,
    evidence: violation.evidenceObjects.map(evidenceDto),
  };
}

function auditJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function appendAudit(
  tx: Transaction,
  input: {
    actor: ActorContext;
    action: string;
    entityType: "Violation" | "EvidenceObject";
    entityId: string;
    reason: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    metadata: RequestMetadata;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      companyId: input.actor.companyId,
      actorUserId: input.actor.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      reason: input.reason,
      ...(input.before ? { before: auditJson(input.before) } : {}),
      ...(input.after ? { after: auditJson(input.after) } : {}),
      requestId: input.metadata.requestId,
      ipAddress: input.metadata.ipAddress,
      userAgent: input.metadata.userAgent,
    },
  });
}

function violationAuditShape(violation: ViolationRecord): Record<string, unknown> {
  return {
    attendanceId: violation.attendanceId,
    businessDate: violation.businessDate.toISOString().slice(0, 10),
    penaltyItemId: violation.penaltyItemId,
    ruleVersionId: violation.ruleVersionId,
    itemName: violation.itemName,
    amount: violation.amount.toString(),
    detail: violation.detail,
    note: violation.note,
    overrideReason: violation.overrideReason,
    status: violation.status,
    version: violation.version,
  };
}

async function authorizeAttendance(actor: ActorContext, attendanceId: string, mutation: boolean) {
  const attendance = await prisma.attendanceDay.findFirst({
    where: {
      id: attendanceId,
      companyId: actor.companyId,
    },
    select: {
      id: true,
      companyId: true,
      branchId: true,
      staffId: true,
      businessDate: true,
      archivedAt: true,
      staff: {
        select: {
          user: { select: { role: true } },
        },
      },
    },
  });
  if (!attendance) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy attendance trong phạm vi.");
  }
  if (actor.role === "TRAINING_MANAGER") {
    const isLiveEmployee = !attendance.staff.user || attendance.staff.user.role === "LIVE_EMPLOYEE";
    if (
      !isLiveEmployee ||
      !actor.activeBranchIds.includes(attendance.branchId) ||
      (mutation && actor.staffId === attendance.staffId)
    ) {
      throw new DomainError("NOT_FOUND", "Không tìm thấy attendance trong phạm vi.");
    }
  }
  return attendance;
}

async function authorizeViolation(actor: ActorContext, violationId: string, mutation: boolean) {
  const violation = await prisma.violation.findFirst({
    where: { id: violationId, companyId: actor.companyId },
    select: {
      id: true,
      attendanceId: true,
      branchId: true,
      status: true,
      version: true,
    },
  });
  if (!violation) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy vi phạm.");
  }
  await authorizeAttendance(actor, violation.attendanceId, mutation);
  if (actor.role === "TRAINING_MANAGER" && !actor.activeBranchIds.includes(violation.branchId)) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy vi phạm.");
  }
  return violation;
}

export async function createViolation(
  actor: ActorContext,
  input: ViolationCreateInput,
  metadata: RequestMetadata,
): Promise<ViolationDto> {
  requirePermission(actor, "violation:write");
  const attendance = await authorizeAttendance(actor, input.attendanceId, true);
  if (attendance.archivedAt) {
    throw new DomainError("CONFLICT", "Không thể thêm lỗi vào attendance đã lưu trữ.");
  }

  const penaltyItem = await prisma.penaltyItem.findFirst({
    where: {
      id: input.penaltyItemId,
      companyId: actor.companyId,
      isActive: true,
      ruleVersion: {
        status: { not: "DRAFT" },
        effectiveFrom: { lte: attendance.businessDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: attendance.businessDate } }],
      },
    },
    select: {
      id: true,
      ruleVersionId: true,
      name: true,
      defaultAmount: true,
    },
  });
  if (!penaltyItem) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "Loại lỗi không thuộc penalty version hiệu lực tại ngày vi phạm.",
    );
  }

  const hasOverride = input.amountOverride !== undefined && input.amountOverride !== null;
  if (hasOverride && actor.role !== "GENERAL_MANAGER") {
    throw new DomainError("FORBIDDEN", "Chỉ Tổng quản lý được override tiền phạt.");
  }
  if (hasOverride && !input.overrideReason) {
    throw new DomainError("VALIDATION_ERROR", "Override tiền phạt bắt buộc có lý do.");
  }
  const amount = hasOverride ? BigInt(input.amountOverride!) : penaltyItem.defaultAmount;
  const overrideReason = hasOverride ? (input.overrideReason ?? null) : null;

  return prisma.$transaction(async (tx) => {
    const created = await tx.violation.create({
      data: {
        companyId: actor.companyId,
        branchId: attendance.branchId,
        attendanceId: attendance.id,
        staffId: attendance.staffId,
        businessDate: attendance.businessDate,
        penaltyItemId: penaltyItem.id,
        ruleVersionId: penaltyItem.ruleVersionId,
        itemName: penaltyItem.name,
        amount,
        detail: input.detail,
        note: input.note ?? null,
        overrideReason,
        createdByUserId: actor.userId,
      },
      select: violationSelect,
    });
    await appendAudit(tx, {
      actor,
      action: hasOverride ? "violation.create_with_override" : "violation.create",
      entityType: "Violation",
      entityId: created.id,
      reason: input.reason,
      after: violationAuditShape(created),
      metadata,
    });
    return toViolationDto(created);
  });
}

export async function cancelViolation(
  actor: ActorContext,
  id: string,
  input: ViolationCancelInput,
  metadata: RequestMetadata,
): Promise<ViolationDto> {
  requirePermission(actor, "violation:cancel");
  const authorized = await authorizeViolation(actor, id, true);
  if (authorized.status === "CANCELLED") {
    const existing = await prisma.violation.findUniqueOrThrow({
      where: { id },
      select: violationSelect,
    });
    return toViolationDto(existing);
  }

  return prisma.$transaction(async (tx) => {
    const before = await tx.violation.findUniqueOrThrow({
      where: { id },
      select: violationSelect,
    });
    const result = await tx.violation.updateMany({
      where: {
        id,
        companyId: actor.companyId,
        status: "ACTIVE",
        version: input.version,
      },
      data: {
        status: "CANCELLED",
        cancelledByUserId: actor.userId,
        cancelledAt: new Date(),
        cancellationReason: input.reason,
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) {
      throw new DomainError("CONFLICT", "Vi phạm đã được cập nhật bởi người khác.");
    }
    const after = await tx.violation.findUniqueOrThrow({
      where: { id },
      select: violationSelect,
    });
    await appendAudit(tx, {
      actor,
      action: "violation.cancel",
      entityType: "Violation",
      entityId: id,
      reason: input.reason,
      before: violationAuditShape(before),
      after: violationAuditShape(after),
      metadata,
    });
    return toViolationDto(after);
  });
}

const extensionByMime = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export async function presignEvidenceUpload(
  actor: ActorContext,
  input: EvidencePresignInput,
  metadata: RequestMetadata,
) {
  requirePermission(actor, "evidence:upload");
  const violation = await authorizeViolation(actor, input.violationId, true);
  if (violation.status !== "ACTIVE") {
    throw new DomainError("CONFLICT", "Không thể thêm ảnh vào vi phạm đã hủy.");
  }
  const extension = extensionByMime[input.mimeType];
  const objectKey = `companies/${actor.companyId}/violations/${violation.id}/${randomUUID()}.${extension}`;
  const upload = await createEvidenceUploadUrl({
    objectKey,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    checksumSha256: input.checksumSha256,
  });

  const evidence = await prisma.$transaction(async (tx) => {
    const created = await tx.evidenceObject.create({
      data: {
        companyId: actor.companyId,
        branchId: violation.branchId,
        violationId: violation.id,
        objectKey,
        originalFileName: input.originalFileName,
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.sizeBytes),
        checksumSha256: input.checksumSha256,
        createdByUserId: actor.userId,
      },
    });
    await appendAudit(tx, {
      actor,
      action: "evidence.presign_upload",
      entityType: "EvidenceObject",
      entityId: created.id,
      reason: input.reason,
      after: {
        violationId: created.violationId,
        originalFileName: created.originalFileName,
        mimeType: created.mimeType,
        sizeBytes: created.sizeBytes.toString(),
        checksumSha256: created.checksumSha256,
        status: created.status,
      },
      metadata,
    });
    return created;
  });

  return {
    evidence: {
      id: evidence.id,
      originalFileName: evidence.originalFileName,
      mimeType: evidence.mimeType as EvidenceDto["mimeType"],
      sizeBytes: evidence.sizeBytes.toString(),
      checksumSha256: evidence.checksumSha256,
      status: evidence.status,
      version: evidence.version,
    } satisfies EvidenceDto,
    upload,
  };
}

export async function completeEvidenceUpload(
  actor: ActorContext,
  id: string,
  input: EvidenceCompleteInput,
  metadata: RequestMetadata,
): Promise<EvidenceDto> {
  requirePermission(actor, "evidence:upload");
  const existing = await prisma.evidenceObject.findFirst({
    where: { id, companyId: actor.companyId },
    include: {
      violation: {
        select: { attendanceId: true },
      },
    },
  });
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy evidence.");
  }
  await authorizeAttendance(actor, existing.violation.attendanceId, true);
  if (existing.status !== "PENDING_UPLOAD") {
    throw new DomainError("CONFLICT", "Evidence không còn chờ upload.");
  }
  if (existing.version !== input.version) {
    throw new DomainError("CONFLICT", "Evidence đã được cập nhật bởi người khác.");
  }

  try {
    await verifyEvidenceObject({
      objectKey: existing.objectKey,
      mimeType: existing.mimeType,
      sizeBytes: Number(existing.sizeBytes),
      checksumSha256: existing.checksumSha256,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Không thể xác minh object upload.";
    await prisma.$transaction(async (tx) => {
      const result = await tx.evidenceObject.updateMany({
        where: {
          id,
          companyId: actor.companyId,
          status: "PENDING_UPLOAD",
          version: input.version,
        },
        data: {
          status: "REJECTED",
          rejectionReason: reason,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        throw new DomainError("CONFLICT", "Evidence đã được cập nhật bởi người khác.");
      }
      await appendAudit(tx, {
        actor,
        action: "evidence.reject",
        entityType: "EvidenceObject",
        entityId: id,
        reason: "Object upload không khớp metadata đã ký.",
        before: { status: existing.status, version: existing.version },
        after: { status: "REJECTED", rejectionReason: reason },
        metadata,
      });
    });
    throw new DomainError(
      "VALIDATION_ERROR",
      "Ảnh upload không khớp MIME, kích thước hoặc checksum đã khai báo.",
    );
  }

  return prisma.$transaction(async (tx) => {
    const result = await tx.evidenceObject.updateMany({
      where: {
        id,
        companyId: actor.companyId,
        status: "PENDING_UPLOAD",
        version: input.version,
      },
      data: {
        status: "READY",
        uploadedAt: new Date(),
        verifiedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) {
      throw new DomainError("CONFLICT", "Evidence đã được cập nhật bởi người khác.");
    }
    const ready = await tx.evidenceObject.findUniqueOrThrow({ where: { id } });
    await appendAudit(tx, {
      actor,
      action: "evidence.verify",
      entityType: "EvidenceObject",
      entityId: id,
      reason: "Đã xác minh MIME, kích thước và SHA-256.",
      before: { status: existing.status, version: existing.version },
      after: { status: ready.status, version: ready.version },
      metadata,
    });
    return {
      id: ready.id,
      originalFileName: ready.originalFileName,
      mimeType: ready.mimeType as EvidenceDto["mimeType"],
      sizeBytes: ready.sizeBytes.toString(),
      checksumSha256: ready.checksumSha256,
      status: ready.status,
      version: ready.version,
    };
  });
}

export async function getEvidenceView(actor: ActorContext, id: string) {
  requirePermission(actor, "evidence:read");
  const evidence = await prisma.evidenceObject.findFirst({
    where: { id, companyId: actor.companyId, status: "READY" },
    include: {
      violation: {
        select: { attendanceId: true },
      },
    },
  });
  if (!evidence) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy evidence.");
  }
  await authorizeAttendance(actor, evidence.violation.attendanceId, false);
  if (actor.role === "TRAINING_MANAGER" && !actor.activeBranchIds.includes(evidence.branchId)) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy evidence.");
  }
  return createEvidenceViewUrl({
    objectKey: evidence.objectKey,
    originalFileName: evidence.originalFileName,
    mimeType: evidence.mimeType,
  });
}
