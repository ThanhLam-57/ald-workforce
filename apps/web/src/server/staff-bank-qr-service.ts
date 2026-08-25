import { randomUUID } from "node:crypto";

import type {
  StaffBankQrDocumentCompleteInput,
  StaffBankQrDocumentDto,
  StaffBankQrDocumentPresignInput,
} from "@ald/contracts";
import { prisma, type Prisma } from "@ald/db";
import { DomainError, requirePermission, type ActorContext } from "@ald/domain";

import { appendSecureAudit, systemAuditReason } from "./audit-service";
import { createEvidenceViewUrl, verifyPrivateObject } from "./object-storage";
import type { RequestMetadata } from "./request-metadata";
import {
  cleanupRejectedPrivateObjects,
  isPrivateDocumentContentFailure,
  privateDocumentStorageUnavailable,
  STAFF_PRIVATE_DOCUMENT_UPLOAD_TTL_MS,
  storeStaffPrivateDocumentUpload,
} from "./staff-private-document-upload";
import { STAFF_PRIVATE_DOCUMENT_VERSION_HEADER } from "./staff-private-document-upload-body";
import { authorizeBranchStaff } from "./staff-onboarding-service";
import { toBusinessDate } from "./business-date";

const bankQrSelect = {
  id: true,
  companyId: true,
  branchId: true,
  staffId: true,
  objectKey: true,
  originalFileName: true,
  mimeType: true,
  sizeBytes: true,
  checksumSha256: true,
  status: true,
  version: true,
  createdAt: true,
  uploadedAt: true,
  verifiedAt: true,
} satisfies Prisma.StaffBankQrDocumentSelect;

type BankQrRecord = Prisma.StaffBankQrDocumentGetPayload<{ select: typeof bankQrSelect }>;

type RejectedPendingBankQr = Readonly<{
  id: string;
  branchId: string;
  objectKey: string;
  version: number;
}>;

function auditJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function bankQrDto(document: BankQrRecord): StaffBankQrDocumentDto {
  return {
    id: document.id,
    originalFileName: document.originalFileName,
    mimeType: document.mimeType as StaffBankQrDocumentDto["mimeType"],
    sizeBytes: document.sizeBytes.toString(),
    status: document.status,
    version: document.version,
    uploadedAt: document.uploadedAt?.toISOString() ?? null,
    verifiedAt: document.verifiedAt?.toISOString() ?? null,
  };
}

function extensionForMimeType(mimeType: StaffBankQrDocumentPresignInput["mimeType"]): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  return "webp";
}

async function rejectPendingBankQr(input: {
  actor: ActorContext;
  staffId: string;
  document: BankQrRecord;
  expectedVersion: number;
  rejectionReason: string;
  auditReason: string;
  metadata: RequestMetadata;
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const rejectedAt = new Date();
    const result = await tx.staffBankQrDocument.updateMany({
      where: {
        id: input.document.id,
        companyId: input.actor.companyId,
        staffId: input.staffId,
        status: "PENDING_UPLOAD",
        version: input.expectedVersion,
      },
      data: {
        status: "REJECTED",
        rejectedAt,
        rejectionReason: input.rejectionReason,
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) return false;
    await appendSecureAudit(
      {
        actor: input.actor,
        branchId: input.document.branchId,
        action: "staff.bank-qr.reject",
        entityType: "StaffBankQrDocument",
        entityId: input.document.id,
        reason: input.auditReason,
        before: {
          status: "PENDING_UPLOAD",
          version: input.expectedVersion,
        },
        after: {
          status: "REJECTED",
          version: input.expectedVersion + 1,
          rejectionReason: input.rejectionReason,
        },
        metadata: input.metadata,
      },
      tx,
    );
    return true;
  });
}

async function findScopedBankQr(
  actor: ActorContext,
  staffId: string,
  documentId: string,
): Promise<BankQrRecord> {
  await authorizeBranchStaff(prisma, actor, staffId);
  const document = await prisma.staffBankQrDocument.findFirst({
    where: {
      id: documentId,
      companyId: actor.companyId,
      staffId,
    },
    select: bankQrSelect,
  });
  if (!document) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy ảnh QR ngân hàng.");
  }
  return document;
}

async function findViewableBankQr(
  actor: ActorContext,
  staffId: string,
  documentId: string,
): Promise<BankQrRecord> {
  const businessDate = toBusinessDate(new Date());
  const document = await prisma.staffBankQrDocument.findFirst({
    where: {
      id: documentId,
      companyId: actor.companyId,
      staffId,
      ...(actor.role === "TRAINING_MANAGER"
        ? {
            staff: {
              is: {
                companyId: actor.companyId,
                archivedAt: null,
                assignments: {
                  some: {
                    companyId: actor.companyId,
                    branchId: { in: [...actor.activeBranchIds] },
                    assignmentType: "MEMBER",
                    archivedAt: null,
                    effectiveFrom: { lte: businessDate },
                    OR: [{ effectiveTo: null }, { effectiveTo: { gt: businessDate } }],
                  },
                },
              },
            },
          }
        : {}),
    },
    select: bankQrSelect,
  });
  if (!document) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy ảnh QR ngân hàng.");
  }
  return document;
}

export async function presignStaffBankQr(
  actor: ActorContext,
  staffId: string,
  input: StaffBankQrDocumentPresignInput,
  metadata: RequestMetadata,
): Promise<
  Readonly<{
    document: StaffBankQrDocumentDto;
    upload: Readonly<{
      url: string;
      headers: Readonly<Record<string, string>>;
      expiresInSeconds: number;
    }>;
  }>
> {
  requirePermission(actor, "staff-bank-qr:write");
  const scope = await authorizeBranchStaff(prisma, actor, staffId);
  const objectKey =
    `companies/${actor.companyId}/staff/${staffId}/bank-qr/` +
    `${randomUUID()}.${extensionForMimeType(input.mimeType)}`;
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT 1::integer
      FROM pg_advisory_xact_lock(
        hashtextextended(${`staff-bank-qr-upload:${actor.companyId}:${staffId}`}, 0)
      )
    `;
    const rejectedAt = new Date();
    const rejected = await tx.$queryRaw<RejectedPendingBankQr[]>`
      UPDATE "staff_bank_qr_documents"
      SET
        "status" = 'REJECTED',
        "rejectedAt" = ${rejectedAt},
        "rejectionReason" = 'Được thay thế bởi yêu cầu tải ảnh mới.',
        "version" = "version" + 1,
        "updatedAt" = ${rejectedAt}
      WHERE "companyId" = ${actor.companyId}::uuid
        AND "staffId" = ${staffId}::uuid
        AND "status" = 'PENDING_UPLOAD'
      RETURNING "id", "branchId", "objectKey", "version"
    `;
    if (rejected.length > 0) {
      await tx.auditLog.createMany({
        data: rejected.map((previous) => ({
          companyId: actor.companyId,
          branchId: previous.branchId,
          actorUserId: actor.userId,
          action: "staff.bank-qr.reject",
          entityType: "StaffBankQrDocument",
          entityId: previous.id,
          reason: systemAuditReason("STAFF_BANK_QR_UPLOAD_REPLACED"),
          before: auditJson({
            branchId: previous.branchId,
            status: "PENDING_UPLOAD",
            version: previous.version - 1,
          }),
          after: auditJson({
            branchId: previous.branchId,
            status: "REJECTED",
            version: previous.version,
            rejectionReason: "Được thay thế bởi yêu cầu tải ảnh mới.",
          }),
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        })),
      });
    }

    const created = await tx.staffBankQrDocument.create({
      data: {
        companyId: actor.companyId,
        branchId: scope.branchId,
        staffId,
        objectKey,
        originalFileName: input.originalFileName,
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.sizeBytes),
        checksumSha256: input.checksumSha256,
        createdByUserId: actor.userId,
      },
      select: bankQrSelect,
    });
    await appendSecureAudit(
      {
        actor,
        branchId: scope.branchId,
        action: "staff.bank-qr.presign",
        entityType: "StaffBankQrDocument",
        entityId: created.id,
        reason: systemAuditReason("STAFF_BANK_QR_UPLOAD_STARTED"),
        after: {
          staffId,
          originalFileName: created.originalFileName,
          mimeType: created.mimeType,
          sizeBytes: created.sizeBytes.toString(),
          status: created.status,
        },
        metadata,
      },
      tx,
    );
    return {
      document: created,
      replacedObjectKeys: rejected.map((previous) => previous.objectKey),
    };
  });
  await cleanupRejectedPrivateObjects({
    objectKeys: result.replacedObjectKeys,
    metadata,
    event: "staff.bank-qr.replaced_object_cleanup_failed",
  });
  const document = result.document;
  const encodedStaffId = encodeURIComponent(staffId);
  const encodedDocumentId = encodeURIComponent(document.id);
  return {
    document: bankQrDto(document),
    upload: {
      url: `/api/staff/${encodedStaffId}/bank-qr/${encodedDocumentId}/upload`,
      expiresInSeconds: STAFF_PRIVATE_DOCUMENT_UPLOAD_TTL_MS / 1_000,
      headers: {
        "Content-Type": input.mimeType,
        [STAFF_PRIVATE_DOCUMENT_VERSION_HEADER]: String(document.version),
      },
    },
  };
}

export async function uploadStaffBankQr(
  actor: ActorContext,
  staffId: string,
  documentId: string,
  expectedVersion: number,
  request: Request,
  metadata: RequestMetadata,
): Promise<StaffBankQrDocumentDto> {
  requirePermission(actor, "staff-bank-qr:write");
  const document = await findScopedBankQr(actor, staffId, documentId);
  await storeStaffPrivateDocumentUpload({
    document,
    expectedVersion,
    request,
    metadata,
    event: "staff.bank-qr.storage_upload_failed",
  });
  const current = await findScopedBankQr(actor, staffId, documentId);
  if (current.status !== "PENDING_UPLOAD" || current.version !== expectedVersion) {
    if (current.status === "REJECTED") {
      await cleanupRejectedPrivateObjects({
        objectKeys: [document.objectKey],
        metadata,
        event: "staff.bank-qr.rejected_upload_cleanup_failed",
      });
    }
    throw new DomainError("CONFLICT", "Yêu cầu tải ảnh đã thay đổi. Vui lòng tải lại hồ sơ.");
  }
  return bankQrDto(current);
}

export async function completeStaffBankQr(
  actor: ActorContext,
  staffId: string,
  documentId: string,
  input: StaffBankQrDocumentCompleteInput,
  metadata: RequestMetadata,
): Promise<StaffBankQrDocumentDto> {
  requirePermission(actor, "staff-bank-qr:write");
  const document = await findScopedBankQr(actor, staffId, documentId);
  if (document.status !== "PENDING_UPLOAD" || document.version !== input.version) {
    throw new DomainError("CONFLICT", "Yêu cầu tải ảnh đã thay đổi. Vui lòng tải lại hồ sơ.");
  }
  if (Date.now() - document.createdAt.getTime() > STAFF_PRIVATE_DOCUMENT_UPLOAD_TTL_MS) {
    const rejected = await rejectPendingBankQr({
      actor,
      staffId,
      document,
      expectedVersion: input.version,
      rejectionReason: "Yêu cầu tải ảnh đã hết hạn.",
      auditReason: systemAuditReason("STAFF_BANK_QR_UPLOAD_EXPIRED"),
      metadata,
    });
    if (rejected) {
      await cleanupRejectedPrivateObjects({
        objectKeys: [document.objectKey],
        metadata,
        event: "staff.bank-qr.expired_object_cleanup_failed",
      });
    }
    throw new DomainError(
      "CONFLICT",
      "Yêu cầu tải ảnh đã hết hạn. Vui lòng chọn lại file để tạo lượt tải mới.",
    );
  }

  try {
    await verifyPrivateObject({
      objectKey: document.objectKey,
      mimeType: document.mimeType,
      sizeBytes: Number(document.sizeBytes),
      checksumSha256: document.checksumSha256,
    });
  } catch (cause) {
    if (!isPrivateDocumentContentFailure(cause)) {
      throw privateDocumentStorageUnavailable(cause, {
        event: "staff.bank-qr.storage_verify_failed",
        requestId: metadata.requestId,
        documentId: document.id,
      });
    }
    const rejected = await rejectPendingBankQr({
      actor,
      staffId,
      document,
      expectedVersion: input.version,
      rejectionReason: "Metadata file tải lên không khớp yêu cầu đã ký.",
      auditReason: systemAuditReason("STAFF_BANK_QR_UPLOAD_REJECTED"),
      metadata,
    });
    if (rejected) {
      await cleanupRejectedPrivateObjects({
        objectKeys: [document.objectKey],
        metadata,
        event: "staff.bank-qr.invalid_object_cleanup_failed",
      });
    }
    throw new DomainError(
      "VALIDATION_ERROR",
      "File tải lên không đúng loại, kích thước hoặc checksum đã đăng ký.",
    );
  }

  const completed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT 1::integer
      FROM pg_advisory_xact_lock(
        hashtextextended(${`staff-bank-qr:${actor.companyId}:${staffId}`}, 0)
      )
    `;
    const completedAt = new Date();
    await tx.staffBankQrDocument.updateMany({
      where: {
        companyId: actor.companyId,
        staffId,
        status: "READY",
        id: { not: document.id },
      },
      data: {
        status: "SUPERSEDED",
        supersededAt: completedAt,
        version: { increment: 1 },
      },
    });
    const result = await tx.staffBankQrDocument.updateMany({
      where: {
        id: document.id,
        companyId: actor.companyId,
        staffId,
        status: "PENDING_UPLOAD",
        version: input.version,
      },
      data: {
        status: "READY",
        uploadedAt: completedAt,
        verifiedAt: completedAt,
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) {
      throw new DomainError("CONFLICT", "Ảnh QR đã được xử lý bởi người dùng khác.");
    }
    return tx.staffBankQrDocument.findUniqueOrThrow({
      where: { id: document.id },
      select: bankQrSelect,
    });
  });

  await appendSecureAudit({
    actor,
    branchId: completed.branchId,
    action: "staff.bank-qr.complete",
    entityType: "StaffBankQrDocument",
    entityId: completed.id,
    reason: systemAuditReason("STAFF_BANK_QR_UPLOAD_COMPLETED"),
    before: { status: document.status, version: document.version },
    after: {
      staffId,
      originalFileName: completed.originalFileName,
      mimeType: completed.mimeType,
      sizeBytes: completed.sizeBytes.toString(),
      status: completed.status,
      version: completed.version,
    },
    metadata,
  });
  return bankQrDto(completed);
}

export async function viewStaffBankQr(
  actor: ActorContext,
  staffId: string,
  documentId: string,
  metadata: RequestMetadata,
): Promise<Readonly<{ url: string; expiresInSeconds: number }>> {
  requirePermission(actor, "staff-bank-qr:read");
  const document = await findViewableBankQr(actor, staffId, documentId);
  if (document.status !== "READY") {
    throw new DomainError("NOT_FOUND", "Ảnh QR ngân hàng chưa sẵn sàng để xem.");
  }
  const signed = await createEvidenceViewUrl({
    objectKey: document.objectKey,
    originalFileName: document.originalFileName,
    mimeType: document.mimeType,
  });
  await appendSecureAudit({
    actor,
    branchId: document.branchId,
    action: "staff.bank-qr.read",
    entityType: "StaffBankQrDocument",
    entityId: document.id,
    reason: "Xem ảnh QR ngân hàng của nhân viên.",
    after: { staffId, expiresInSeconds: signed.expiresInSeconds },
    metadata,
  });
  return signed;
}
