import { randomUUID } from "node:crypto";

import { prisma } from "@ald/db";
import type { ActorContext } from "@ald/domain";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  createPrivateUploadUrl: vi.fn(async (input: { mimeType: string }) => ({
    url: "https://private-storage.test/upload",
    expiresInSeconds: 300,
    headers: { "Content-Type": input.mimeType },
  })),
  verifyPrivateObject: vi.fn(async () => undefined),
  createEvidenceViewUrl: vi.fn(async () => ({
    url: "https://private-storage.test/view",
    expiresInSeconds: 60,
  })),
}));

vi.mock("./object-storage", () => storageMocks);

import {
  completeStaffIdentityDocument,
  presignStaffIdentityDocument,
  viewStaffIdentityDocument,
} from "./staff-identity-document-service";
import { completeStaffBankQr, presignStaffBankQr, viewStaffBankQr } from "./staff-bank-qr-service";

const runId = randomUUID().slice(0, 8);
const checksumSha256 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const metadata = {
  requestId: `staff-document-${runId}`,
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
} as const;

let companyId: string;
let branchAId: string;
let branchBId: string;
let staffAId: string;
let staffBId: string;
let archivedStaffId: string;
let archivedIdentityDocumentId: string;
let archivedBankQrDocumentId: string;
let gm: ActorContext;
let manager: ActorContext;

beforeAll(async () => {
  const company = await prisma.company.create({
    data: {
      name: `Staff document ${runId}`,
      slug: `staff-document-${runId}`,
    },
  });
  companyId = company.id;
  const [branchA, branchB] = await Promise.all([
    prisma.branch.create({
      data: { companyId, code: `DA${runId}`, name: "Cơ sở A" },
    }),
    prisma.branch.create({
      data: { companyId, code: `DB${runId}`, name: "Cơ sở B" },
    }),
  ]);
  branchAId = branchA.id;
  branchBId = branchB.id;
  const [gmStaff, managerStaff, staffA, staffB, archivedStaff] = await Promise.all([
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `DGM${runId}`,
        fullName: "Tổng quản lý",
        jobTitle: "Tổng quản lý",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `DM${runId}`,
        fullName: "Quản lý A",
        jobTitle: "Quản lý đào tạo",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `DLA${runId}`,
        fullName: "Live A",
        jobTitle: "Nhân viên Live",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `DLB${runId}`,
        fullName: "Live B",
        jobTitle: "Nhân viên Live",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `DEND${runId}`,
        fullName: "Nhân viên đã lưu trữ",
        jobTitle: "Nhân viên Live",
        employmentCategory: "OFFICIAL",
        employmentStatus: "TERMINATED",
        terminationDate: new Date("2026-03-31T00:00:00.000Z"),
        archivedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
    }),
  ]);
  staffAId = staffA.id;
  staffBId = staffB.id;
  archivedStaffId = archivedStaff.id;
  const [gmUser, managerUser] = await Promise.all([
    prisma.user.create({
      data: {
        companyId,
        staffId: gmStaff.id,
        name: "Tổng quản lý",
        email: `staff-document-gm-${runId}@test.local`,
        username: `staff_document_gm_${runId}`,
        role: "GENERAL_MANAGER",
      },
    }),
    prisma.user.create({
      data: {
        companyId,
        staffId: managerStaff.id,
        name: "Quản lý A",
        email: `staff-document-manager-${runId}@test.local`,
        username: `staff_document_manager_${runId}`,
        role: "TRAINING_MANAGER",
      },
    }),
  ]);
  await Promise.all([
    prisma.branchAssignment.create({
      data: {
        companyId,
        branchId: branchAId,
        staffId: managerStaff.id,
        assignmentType: "PRIMARY_MANAGER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
    prisma.branchAssignment.create({
      data: {
        companyId,
        branchId: branchAId,
        staffId: staffAId,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
    prisma.branchAssignment.create({
      data: {
        companyId,
        branchId: branchBId,
        staffId: staffBId,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
    prisma.branchAssignment.create({
      data: {
        companyId,
        branchId: branchAId,
        staffId: archivedStaffId,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-04-01T00:00:00.000Z"),
      },
    }),
  ]);
  const [archivedIdentityDocument, archivedBankQrDocument] = await Promise.all([
    prisma.staffIdentityDocument.create({
      data: {
        companyId,
        branchId: branchAId,
        staffId: archivedStaffId,
        side: "CITIZEN_ID_FRONT",
        objectKey: `tests/${runId}/archived-front.jpg`,
        originalFileName: "archived-front.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 100n,
        checksumSha256,
        status: "READY",
        uploadedAt: new Date("2026-03-01T00:00:00.000Z"),
        verifiedAt: new Date("2026-03-01T00:00:00.000Z"),
        createdByUserId: gmUser.id,
      },
    }),
    prisma.staffBankQrDocument.create({
      data: {
        companyId,
        branchId: branchAId,
        staffId: archivedStaffId,
        objectKey: `tests/${runId}/archived-bank-qr.png`,
        originalFileName: "archived-bank-qr.png",
        mimeType: "image/png",
        sizeBytes: 100n,
        checksumSha256,
        status: "READY",
        uploadedAt: new Date("2026-03-01T00:00:00.000Z"),
        verifiedAt: new Date("2026-03-01T00:00:00.000Z"),
        createdByUserId: gmUser.id,
      },
    }),
  ]);
  archivedIdentityDocumentId = archivedIdentityDocument.id;
  archivedBankQrDocumentId = archivedBankQrDocument.id;
  gm = {
    userId: gmUser.id,
    companyId,
    staffId: gmStaff.id,
    role: "GENERAL_MANAGER",
    activeBranchIds: [],
  };
  manager = {
    userId: managerUser.id,
    companyId,
    staffId: managerStaff.id,
    role: "TRAINING_MANAGER",
    activeBranchIds: [branchAId],
  };
});

afterAll(async () => {
  if (!companyId) return;
  await prisma.$transaction(async (tx) => {
    await tx.staffBankQrDocument.deleteMany({ where: { companyId } });
    await tx.staffIdentityDocument.deleteMany({ where: { companyId } });
    await tx.$executeRawUnsafe("SET LOCAL ald.audit_cleanup = 'on'");
    await tx.auditLog.deleteMany({ where: { companyId } });
    await tx.branchAssignment.deleteMany({ where: { companyId } });
    await tx.user.deleteMany({ where: { companyId } });
    await tx.staffMember.deleteMany({ where: { companyId } });
    await tx.branch.deleteMany({ where: { companyId } });
    await tx.company.deleteMany({ where: { id: companyId } });
  });
});

describe("private staff identity documents", () => {
  it("presign, xác minh, thay ảnh và không trả objectKey", async () => {
    const first = await presignStaffIdentityDocument(
      manager,
      staffAId,
      {
        side: "CITIZEN_ID_FRONT",
        originalFileName: "front-old.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1_024,
        checksumSha256,
      },
      metadata,
    );
    expect(first.document).not.toHaveProperty("objectKey");
    expect(first.document).not.toHaveProperty("checksumSha256");
    expect(first.upload.expiresInSeconds).toBeLessThanOrEqual(300);
    const firstReady = await completeStaffIdentityDocument(
      manager,
      staffAId,
      first.document.id,
      {
        version: first.document.version,
      },
      metadata,
    );
    expect(firstReady.status).toBe("READY");

    const replacement = await presignStaffIdentityDocument(
      manager,
      staffAId,
      {
        side: "CITIZEN_ID_FRONT",
        originalFileName: "front-new.webp",
        mimeType: "image/webp",
        sizeBytes: 2_048,
        checksumSha256,
      },
      metadata,
    );
    const replacementReady = await completeStaffIdentityDocument(
      manager,
      staffAId,
      replacement.document.id,
      {
        version: replacement.document.version,
      },
      metadata,
    );
    expect(replacementReady.status).toBe("READY");
    expect(
      await prisma.staffIdentityDocument.findUniqueOrThrow({
        where: { id: first.document.id },
        select: { status: true },
      }),
    ).toEqual({ status: "SUPERSEDED" });
    expect(storageMocks.verifyPrivateObject).toHaveBeenCalledTimes(2);
  });

  it("cấp link xem tối đa 60 giây và ghi audit sensitive read", async () => {
    const current = await prisma.staffIdentityDocument.findFirstOrThrow({
      where: {
        companyId,
        staffId: staffAId,
        side: "CITIZEN_ID_FRONT",
        status: "READY",
      },
      select: { id: true },
    });
    const signed = await viewStaffIdentityDocument(manager, staffAId, current.id, metadata);
    expect(signed.expiresInSeconds).toBeLessThanOrEqual(60);
    expect(signed.url).toBe("https://private-storage.test/view");
    expect(
      await prisma.auditLog.count({
        where: {
          companyId,
          entityId: current.id,
          action: "staff.identity-document.read",
        },
      }),
    ).toBe(1);
  });

  it("GM xem được ảnh của nhân viên đang làm và đã nghỉ/lưu trữ", async () => {
    const activeDocument = await prisma.staffIdentityDocument.findFirstOrThrow({
      where: {
        companyId,
        staffId: staffAId,
        side: "CITIZEN_ID_FRONT",
        status: "READY",
      },
      select: { id: true },
    });

    await expect(
      viewStaffIdentityDocument(gm, staffAId, activeDocument.id, metadata),
    ).resolves.toMatchObject({ expiresInSeconds: 60 });
    await expect(
      viewStaffIdentityDocument(gm, archivedStaffId, archivedIdentityDocumentId, metadata),
    ).resolves.toMatchObject({ expiresInSeconds: 60 });
    await expect(
      viewStaffBankQr(gm, archivedStaffId, archivedBankQrDocumentId, metadata),
    ).resolves.toMatchObject({ expiresInSeconds: 60 });

    expect(
      await prisma.auditLog.count({
        where: {
          companyId,
          entityId: { in: [activeDocument.id, archivedIdentityDocumentId] },
          action: "staff.identity-document.read",
          actorUserId: gm.userId,
        },
      }),
    ).toBe(2);
    expect(
      await prisma.auditLog.count({
        where: {
          companyId,
          entityId: archivedBankQrDocumentId,
          action: "staff.bank-qr.read",
          actorUserId: gm.userId,
        },
      }),
    ).toBe(1);
  });

  it("manager không xem được nhân viên đã hết phân công và hồ sơ đã lưu trữ", async () => {
    await expect(
      viewStaffIdentityDocument(manager, archivedStaffId, archivedIdentityDocumentId, metadata),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      viewStaffBankQr(manager, archivedStaffId, archivedBankQrDocumentId, metadata),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("từ chối documentId không thuộc staffId kể cả với GM", async () => {
    const signerCalls = storageMocks.createEvidenceViewUrl.mock.calls.length;
    await expect(
      viewStaffIdentityDocument(gm, staffAId, archivedIdentityDocumentId, metadata),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      viewStaffBankQr(gm, staffAId, archivedBankQrDocumentId, metadata),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(storageMocks.createEvidenceViewUrl).toHaveBeenCalledTimes(signerCalls);
  });

  it("đánh dấu REJECTED khi HEAD verify không khớp MIME, kích thước hoặc checksum", async () => {
    storageMocks.verifyPrivateObject.mockRejectedValueOnce(new Error("metadata mismatch"));
    const pending = await presignStaffIdentityDocument(
      manager,
      staffAId,
      {
        side: "CITIZEN_ID_BACK",
        originalFileName: "back-invalid.png",
        mimeType: "image/png",
        sizeBytes: 321,
        checksumSha256,
      },
      metadata,
    );
    await expect(
      completeStaffIdentityDocument(
        manager,
        staffAId,
        pending.document.id,
        { version: pending.document.version },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(
      await prisma.staffIdentityDocument.findUniqueOrThrow({
        where: { id: pending.document.id },
        select: { status: true },
      }),
    ).toEqual({ status: "REJECTED" });
  });

  it("manager cơ sở A không được xem CCCD nhân viên cơ sở B", async () => {
    const document = await prisma.staffIdentityDocument.create({
      data: {
        companyId,
        branchId: branchBId,
        staffId: staffBId,
        side: "CITIZEN_ID_BACK",
        objectKey: `tests/${runId}/branch-b-back.jpg`,
        originalFileName: "back.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 100n,
        checksumSha256,
        status: "READY",
        uploadedAt: new Date(),
        verifiedAt: new Date(),
        createdByUserId: manager.userId,
      },
    });
    await expect(
      viewStaffIdentityDocument(manager, staffBId, document.id, metadata),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("tải, thay và cấp link QR ngân hàng private mà không lộ metadata storage", async () => {
    const first = await presignStaffBankQr(
      manager,
      staffAId,
      {
        originalFileName: "bank-old.png",
        mimeType: "image/png",
        sizeBytes: 1_024,
        checksumSha256,
      },
      metadata,
    );
    expect(first.document).not.toHaveProperty("objectKey");
    expect(first.document).not.toHaveProperty("checksumSha256");
    const firstReady = await completeStaffBankQr(
      manager,
      staffAId,
      first.document.id,
      { version: first.document.version },
      metadata,
    );
    expect(firstReady.status).toBe("READY");

    const replacement = await presignStaffBankQr(
      manager,
      staffAId,
      {
        originalFileName: "bank-new.webp",
        mimeType: "image/webp",
        sizeBytes: 2_048,
        checksumSha256,
      },
      metadata,
    );
    const replacementReady = await completeStaffBankQr(
      manager,
      staffAId,
      replacement.document.id,
      { version: replacement.document.version },
      metadata,
    );
    expect(replacementReady.status).toBe("READY");
    expect(
      await prisma.staffBankQrDocument.findUniqueOrThrow({
        where: { id: first.document.id },
        select: { status: true },
      }),
    ).toEqual({ status: "SUPERSEDED" });

    const signed = await viewStaffBankQr(manager, staffAId, replacement.document.id, metadata);
    expect(signed.expiresInSeconds).toBeLessThanOrEqual(60);
    expect(signed.url).toBe("https://private-storage.test/view");
  });

  it("manager cơ sở A không được xem QR nhân viên cơ sở B", async () => {
    const document = await prisma.staffBankQrDocument.create({
      data: {
        companyId,
        branchId: branchBId,
        staffId: staffBId,
        objectKey: `tests/${runId}/branch-b-bank-qr.png`,
        originalFileName: "bank-qr.png",
        mimeType: "image/png",
        sizeBytes: 100n,
        checksumSha256,
        status: "READY",
        uploadedAt: new Date(),
        verifiedAt: new Date(),
        createdByUserId: manager.userId,
      },
    });
    await expect(viewStaffBankQr(manager, staffBId, document.id, metadata)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
