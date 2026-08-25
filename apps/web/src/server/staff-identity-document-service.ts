import { randomUUID } from "node:crypto";

import type {
  StaffIdentityDocumentCompleteInput,
  StaffIdentityDocumentDto,
  StaffIdentityDocumentPresignInput,
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

const documentSelect = {
  id: true,
  companyId: true,
  branchId: true,
  staffId: true,
  side: true,
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
} satisfies Prisma.StaffIdentityDocumentSelect;

type DocumentRecord = Prisma.StaffIdentityDocumentGetPayload<{
  select: typeof documentSelect;
}>;

type RejectedPendingDocument = Readonly<{
  id: string;
  branchId: string;
  objectKey: string;
  version: number;
}>;

function auditJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function documentDto(document: DocumentRecord): StaffIdentityDocumentDto {
  return {
    id: document.id,
    side: document.side,
    originalFileName: document.originalFileName,
    mimeType: document.mimeType as StaffIdentityDocumentDto["mimeType"],
    sizeBytes: document.sizeBytes.toString(),
    status: document.status,
    version: document.version,
    uploadedAt: document.uploadedAt?.toISOString() ?? null,
    verifiedAt: document.verifiedAt?.toISOString() ?? null,
  };
}

function extensionForMimeType(mimeType: StaffIdentityDocumentPresignInput["mimeType"]): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  return "webp";
}

async function rejectPendingIdentityDocument(input: {
  actor: ActorContext;
  staffId: string;
  document: DocumentRecord;
  expectedVersion: number;
  rejectionReason: string;
  auditReason: string;
  metadata: RequestMetadata;
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const rejectedAt = new Date();
    const result = await tx.staffIdentityDocument.updateMany({
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
        action: "staff.identity-document.reject",
        entityType: "StaffIdentityDocument",
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

async function findScopedDocument(
  actor: ActorContext,
  staffId: string,
  documentId: string,
): Promise<DocumentRecord> {
  await authorizeBranchStaff(prisma, actor, staffId);
  const document = await prisma.staffIdentityDocument.findFirst({
    where: {
      id: documentId,
      companyId: actor.companyId,
      staffId,
    },
    select: documentSelect,
  });
  if (!document) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy ảnh căn cước công dân.");
  }
  return document;
}

async function findViewableDocument(
  actor: ActorContext,
  staffId: string,
  documentId: string,
): Promise<DocumentRecord> {
  const businessDate = toBusinessDate(new Date());
  const document = await prisma.staffIdentityDocument.findFirst({
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
    select: documentSelect,
  });
  if (!document) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy ảnh căn cước công dân.");
  }
  return document;
}

export async function presignStaffIdentityDocument(
  actor: ActorContext,
  staffId: string,
  input: StaffIdentityDocumentPresignInput,
  metadata: RequestMetadata,
): Promise<
  Readonly<{
    document: StaffIdentityDocumentDto;
    upload: Readonly<{
      url: string;
      headers: Readonly<Record<string, string>>;
      expiresInSeconds: number;
    }>;
  }>
> {
  requirePermission(actor, "staff-identity-document:write");
  const scope = await authorizeBranchStaff(prisma, actor, staffId);
  const objectKey =
    `companies/${actor.companyId}/staff/${staffId}/identity/` +
    `${input.side.toLowerCase()}/${randomUUID()}.${extensionForMimeType(input.mimeType)}`;
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT 1::integer
      FROM pg_advisory_xact_lock(
        hashtextextended(
          ${`staff-identity-upload:${actor.companyId}:${staffId}:${input.side}`},
          0
        )
      )
    `;
    const rejectedAt = new Date();
    const rejected = await tx.$queryRaw<RejectedPendingDocument[]>`
      UPDATE "staff_identity_documents"
      SET
        "status" = 'REJECTED'::"StaffIdentityDocumentStatus",
        "rejectedAt" = ${rejectedAt},
        "rejectionReason" = 'Được thay thế bởi yêu cầu tải ảnh mới.',
        "version" = "version" + 1,
        "updatedAt" = ${rejectedAt}
      WHERE "companyId" = ${actor.companyId}::uuid
        AND "staffId" = ${staffId}::uuid
        AND "side" = ${input.side}::"StaffIdentityDocumentSide"
        AND "status" = 'PENDING_UPLOAD'::"StaffIdentityDocumentStatus"
      RETURNING "id", "branchId", "objectKey", "version"
    `;
    if (rejected.length > 0) {
      await tx.auditLog.createMany({
        data: rejected.map((previous) => ({
          companyId: actor.companyId,
          branchId: previous.branchId,
          actorUserId: actor.userId,
          action: "staff.identity-document.reject",
          entityType: "StaffIdentityDocument",
          entityId: previous.id,
          reason: systemAuditReason("STAFF_IDENTITY_DOCUMENT_UPLOAD_REPLACED"),
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

    const created = await tx.staffIdentityDocument.create({
      data: {
        companyId: actor.companyId,
        branchId: scope.branchId,
        staffId,
        side: input.side,
        objectKey,
        originalFileName: input.originalFileName,
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.sizeBytes),
        checksumSha256: input.checksumSha256,
        createdByUserId: actor.userId,
      },
      select: documentSelect,
    });
    await appendSecureAudit(
      {
        actor,
        branchId: scope.branchId,
        action: "staff.identity-document.presign",
        entityType: "StaffIdentityDocument",
        entityId: created.id,
        reason: systemAuditReason("STAFF_IDENTITY_DOCUMENT_UPLOAD_STARTED"),
        after: {
          staffId,
          side: created.side,
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
    event: "staff.identity-document.replaced_object_cleanup_failed",
  });
  const document = result.document;
  const encodedStaffId = encodeURIComponent(staffId);
  const encodedDocumentId = encodeURIComponent(document.id);
  return {
    document: documentDto(document),
    upload: {
      url: `/api/staff/${encodedStaffId}/identity-documents/${encodedDocumentId}/upload`,
      expiresInSeconds: STAFF_PRIVATE_DOCUMENT_UPLOAD_TTL_MS / 1_000,
      headers: {
        "Content-Type": input.mimeType,
        [STAFF_PRIVATE_DOCUMENT_VERSION_HEADER]: String(document.version),
      },
    },
  };
}

export async function uploadStaffIdentityDocument(
  actor: ActorContext,
  staffId: string,
  documentId: string,
  expectedVersion: number,
  request: Request,
  metadata: RequestMetadata,
): Promise<StaffIdentityDocumentDto> {
  requirePermission(actor, "staff-identity-document:write");
  const document = await findScopedDocument(actor, staffId, documentId);
  await storeStaffPrivateDocumentUpload({
    document,
    expectedVersion,
    request,
    metadata,
    event: "staff.identity-document.storage_upload_failed",
  });
  const current = await findScopedDocument(actor, staffId, documentId);
  if (current.status !== "PENDING_UPLOAD" || current.version !== expectedVersion) {
    if (current.status === "REJECTED") {
      await cleanupRejectedPrivateObjects({
        objectKeys: [document.objectKey],
        metadata,
        event: "staff.identity-document.rejected_upload_cleanup_failed",
      });
    }
    throw new DomainError(
      "CONFLICT",
      "Yêu cầu tải ảnh đã thay đổi. Vui lòng tải lại thông tin nhân viên.",
    );
  }
  return documentDto(current);
}

export async function completeStaffIdentityDocument(
  actor: ActorContext,
  staffId: string,
  documentId: string,
  input: StaffIdentityDocumentCompleteInput,
  metadata: RequestMetadata,
): Promise<StaffIdentityDocumentDto> {
  requirePermission(actor, "staff-identity-document:write");
  const document = await findScopedDocument(actor, staffId, documentId);
  if (document.status !== "PENDING_UPLOAD" || document.version !== input.version) {
    throw new DomainError(
      "CONFLICT",
      "Yêu cầu tải ảnh đã thay đổi. Vui lòng tải lại thông tin nhân viên.",
    );
  }
  if (Date.now() - document.createdAt.getTime() > STAFF_PRIVATE_DOCUMENT_UPLOAD_TTL_MS) {
    const rejected = await rejectPendingIdentityDocument({
      actor,
      staffId,
      document,
      expectedVersion: input.version,
      rejectionReason: "Yêu cầu tải ảnh đã hết hạn.",
      auditReason: systemAuditReason("STAFF_IDENTITY_DOCUMENT_UPLOAD_EXPIRED"),
      metadata,
    });
    if (rejected) {
      await cleanupRejectedPrivateObjects({
        objectKeys: [document.objectKey],
        metadata,
        event: "staff.identity-document.expired_object_cleanup_failed",
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
        event: "staff.identity-document.storage_verify_failed",
        requestId: metadata.requestId,
        documentId: document.id,
      });
    }
    const rejected = await rejectPendingIdentityDocument({
      actor,
      staffId,
      document,
      expectedVersion: input.version,
      rejectionReason: "Metadata file tải lên không khớp yêu cầu đã ký.",
      auditReason: systemAuditReason("STAFF_IDENTITY_DOCUMENT_UPLOAD_REJECTED"),
      metadata,
    });
    if (rejected) {
      await cleanupRejectedPrivateObjects({
        objectKeys: [document.objectKey],
        metadata,
        event: "staff.identity-document.invalid_object_cleanup_failed",
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
        hashtextextended(
          ${`staff-identity:${actor.companyId}:${staffId}:${document.side}`},
          0
        )
      )
    `;
    const now = new Date();
    await tx.staffIdentityDocument.updateMany({
      where: {
        companyId: actor.companyId,
        staffId,
        side: document.side,
        status: "READY",
        id: { not: document.id },
      },
      data: {
        status: "SUPERSEDED",
        supersededAt: now,
        version: { increment: 1 },
      },
    });
    const result = await tx.staffIdentityDocument.updateMany({
      where: {
        id: document.id,
        companyId: actor.companyId,
        staffId,
        status: "PENDING_UPLOAD",
        version: input.version,
      },
      data: {
        status: "READY",
        uploadedAt: now,
        verifiedAt: now,
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) {
      throw new DomainError("CONFLICT", "Ảnh căn cước đã được xử lý bởi người dùng khác.");
    }
    return tx.staffIdentityDocument.findUniqueOrThrow({
      where: { id: document.id },
      select: documentSelect,
    });
  });

  await appendSecureAudit({
    actor,
    branchId: completed.branchId,
    action: "staff.identity-document.complete",
    entityType: "StaffIdentityDocument",
    entityId: completed.id,
    reason: systemAuditReason("STAFF_IDENTITY_DOCUMENT_UPLOAD_COMPLETED"),
    before: { status: document.status, version: document.version },
    after: {
      staffId,
      side: completed.side,
      originalFileName: completed.originalFileName,
      mimeType: completed.mimeType,
      sizeBytes: completed.sizeBytes.toString(),
      status: completed.status,
      version: completed.version,
    },
    metadata,
  });
  return documentDto(completed);
}

export async function viewStaffIdentityDocument(
  actor: ActorContext,
  staffId: string,
  documentId: string,
  metadata: RequestMetadata,
): Promise<Readonly<{ url: string; expiresInSeconds: number }>> {
  requirePermission(actor, "staff-identity-document:read");
  const document = await findViewableDocument(actor, staffId, documentId);
  if (document.status !== "READY") {
    throw new DomainError("NOT_FOUND", "Ảnh căn cước chưa sẵn sàng để xem.");
  }
  const signed = await createEvidenceViewUrl({
    objectKey: document.objectKey,
    originalFileName: document.originalFileName,
    mimeType: document.mimeType,
  });
  await appendSecureAudit({
    actor,
    branchId: document.branchId,
    action: "staff.identity-document.read",
    entityType: "StaffIdentityDocument",
    entityId: document.id,
    reason: `Xem ${document.side === "CITIZEN_ID_FRONT" ? "mặt trước" : "mặt sau"} CCCD nhân viên.`,
    after: {
      staffId,
      side: document.side,
      expiresInSeconds: signed.expiresInSeconds,
    },
    metadata,
  });
  return signed;
}
