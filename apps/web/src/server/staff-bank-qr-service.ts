import { randomUUID } from "node:crypto";

import type {
  StaffBankQrDocumentCompleteInput,
  StaffBankQrDocumentDto,
  StaffBankQrDocumentPresignInput,
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
  uploadedAt: true,
  verifiedAt: true,
} satisfies Prisma.StaffBankQrDocumentSelect;

type BankQrRecord = Prisma.StaffBankQrDocumentGetPayload<{ select: typeof bankQrSelect }>;

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
  const upload = await createPrivateUploadUrl({
    objectKey,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    checksumSha256: input.checksumSha256,
  });
  const document = await prisma.staffBankQrDocument.create({
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
  await appendSecureAudit({
    actor,
    branchId: scope.branchId,
    action: "staff.bank-qr.presign",
    entityType: "StaffBankQrDocument",
    entityId: document.id,
    reason: systemAuditReason("STAFF_BANK_QR_UPLOAD_STARTED"),
    after: {
      staffId,
      originalFileName: document.originalFileName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes.toString(),
      status: document.status,
    },
    metadata,
  });
  return { document: bankQrDto(document), upload };
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

  try {
    await verifyPrivateObject({
      objectKey: document.objectKey,
      mimeType: document.mimeType,
      sizeBytes: Number(document.sizeBytes),
      checksumSha256: document.checksumSha256,
    });
  } catch {
    const rejected = await prisma.staffBankQrDocument.updateMany({
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
        action: "staff.bank-qr.reject",
        entityType: "StaffBankQrDocument",
        entityId: document.id,
        reason: systemAuditReason("STAFF_BANK_QR_UPLOAD_REJECTED"),
        before: { status: document.status, version: document.version },
        after: { status: "REJECTED", reason: "Metadata file không khớp." },
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
