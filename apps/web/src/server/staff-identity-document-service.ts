import { randomUUID } from "node:crypto";

import type {
  StaffIdentityDocumentCompleteInput,
  StaffIdentityDocumentDto,
  StaffIdentityDocumentPresignInput,
} from "@ald/contracts";
import { prisma, type Prisma } from "@ald/db";
import { DomainError, requirePermission, type ActorContext } from "@ald/domain";

import { appendSecureAudit, systemAuditReason } from "./audit-service";
import {
  createEvidenceViewUrl,
  createPrivateUploadUrl,
  verifyPrivateObject,
} from "./object-storage";
import type { RequestMetadata } from "./request-metadata";
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
  uploadedAt: true,
  verifiedAt: true,
} satisfies Prisma.StaffIdentityDocumentSelect;

type DocumentRecord = Prisma.StaffIdentityDocumentGetPayload<{
  select: typeof documentSelect;
}>;

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
  const upload = await createPrivateUploadUrl({
    objectKey,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    checksumSha256: input.checksumSha256,
  });
  const document = await prisma.staffIdentityDocument.create({
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
  await appendSecureAudit({
    actor,
    branchId: scope.branchId,
    action: "staff.identity-document.presign",
    entityType: "StaffIdentityDocument",
    entityId: document.id,
    reason: systemAuditReason("STAFF_IDENTITY_DOCUMENT_UPLOAD_STARTED"),
    after: {
      staffId,
      side: document.side,
      originalFileName: document.originalFileName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes.toString(),
      status: document.status,
    },
    metadata,
  });
  return {
    document: documentDto(document),
    upload,
  };
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

  try {
    await verifyPrivateObject({
      objectKey: document.objectKey,
      mimeType: document.mimeType,
      sizeBytes: Number(document.sizeBytes),
      checksumSha256: document.checksumSha256,
    });
  } catch {
    const rejected = await prisma.staffIdentityDocument.updateMany({
      where: {
        id: document.id,
        companyId: actor.companyId,
        staffId,
        status: "PENDING_UPLOAD",
        version: input.version,
      },
      data: {
        status: "REJECTED",
        rejectedAt: new Date(),
        rejectionReason: "Metadata file tải lên không khớp yêu cầu đã ký.",
        version: { increment: 1 },
      },
    });
    if (rejected.count === 1) {
      await appendSecureAudit({
        actor,
        branchId: document.branchId,
        action: "staff.identity-document.reject",
        entityType: "StaffIdentityDocument",
        entityId: document.id,
        reason: systemAuditReason("STAFF_IDENTITY_DOCUMENT_UPLOAD_REJECTED"),
        before: { status: document.status, version: document.version },
        after: {
          status: "REJECTED",
          reason: "Metadata file tải lên không khớp yêu cầu đã ký.",
        },
        metadata,
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
