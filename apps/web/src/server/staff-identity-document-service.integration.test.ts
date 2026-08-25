import { createHash, randomUUID } from "node:crypto";

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
  putPrivateObject: vi.fn(async () => undefined),
  deletePrivateObject: vi.fn(async () => undefined),
}));

vi.mock("./object-storage", () => storageMocks);

import {
  completeStaffIdentityDocument,
  presignStaffIdentityDocument,
  uploadStaffIdentityDocument,
  viewStaffIdentityDocument,
} from "./staff-identity-document-service";
import {
  completeStaffBankQr,
  presignStaffBankQr,
  uploadStaffBankQr,
  viewStaffBankQr,
} from "./staff-bank-qr-service";
import { STAFF_PRIVATE_DOCUMENT_UPLOAD_TTL_MS } from "./staff-private-document-upload";
import { STAFF_PRIVATE_DOCUMENT_VERSION_HEADER } from "./staff-private-document-upload-body";

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
  it("tải CCCD qua endpoint cùng origin, kiểm tra version/checksum và thay lượt pending cũ", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb]);
    const checksum = createHash("sha256").update(bytes).digest("base64");
    const abandoned = await presignStaffIdentityDocument(
      manager,
      staffAId,
      {
        side: "CITIZEN_ID_BACK",
        originalFileName: "abandoned.jpg",
        mimeType: "image/jpeg",
        sizeBytes: bytes.byteLength,
        checksumSha256: checksum,
      },
      metadata,
    );
    const current = await presignStaffIdentityDocument(
      manager,
      staffAId,
      {
        side: "CITIZEN_ID_BACK",
        originalFileName: "current.jpg",
        mimeType: "image/jpeg",
        sizeBytes: bytes.byteLength,
        checksumSha256: checksum,
      },
      metadata,
    );

    expect(current.upload.url).toBe(
      `/api/staff/${staffAId}/identity-documents/${current.document.id}/upload`,
    );
    expect(current.upload.headers).toMatchObject({
      "Content-Type": "image/jpeg",
      [STAFF_PRIVATE_DOCUMENT_VERSION_HEADER]: String(current.document.version),
    });
    await expect(
      prisma.staffIdentityDocument.findUniqueOrThrow({
        where: { id: abandoned.document.id },
        select: { status: true, version: true, rejectionReason: true },
      }),
    ).resolves.toEqual({
      status: "REJECTED",
      version: abandoned.document.version + 1,
      rejectionReason: "Được thay thế bởi yêu cầu tải ảnh mới.",
    });

    const request = new Request(`http://localhost${current.upload.url}`, {
      method: "PUT",
      headers: current.upload.headers,
      body: bytes,
    });
    await expect(
      uploadStaffIdentityDocument(
        manager,
        staffAId,
        current.document.id,
        current.document.version,
        request,
        metadata,
      ),
    ).resolves.toMatchObject({ id: current.document.id, status: "PENDING_UPLOAD" });
    expect(storageMocks.putPrivateObject).toHaveBeenLastCalledWith(
      expect.objectContaining({ mimeType: "image/jpeg", body: bytes, checksumSha256: checksum }),
    );
  });

  it("xóa object PUT đến muộn và trả conflict khi lượt CCCD đã bị presign mới thay thế", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb]);
    const checksum = createHash("sha256").update(bytes).digest("base64");
    const pending = await presignStaffIdentityDocument(
      manager,
      staffAId,
      {
        side: "CITIZEN_ID_BACK",
        originalFileName: "late-upload.jpg",
        mimeType: "image/jpeg",
        sizeBytes: bytes.byteLength,
        checksumSha256: checksum,
      },
      metadata,
    );
    const stored = await prisma.staffIdentityDocument.findUniqueOrThrow({
      where: { id: pending.document.id },
      select: { objectKey: true },
    });
    let markPutStarted: (() => void) | undefined;
    const putStarted = new Promise<void>((resolve) => {
      markPutStarted = resolve;
    });
    let resumePut: (() => void) | undefined;
    const putMayFinish = new Promise<void>((resolve) => {
      resumePut = resolve;
    });
    storageMocks.putPrivateObject.mockImplementationOnce(async () => {
      markPutStarted?.();
      await putMayFinish;
    });

    const lateUpload = uploadStaffIdentityDocument(
      manager,
      staffAId,
      pending.document.id,
      pending.document.version,
      new Request(`http://localhost${pending.upload.url}`, {
        method: "PUT",
        headers: pending.upload.headers,
        body: bytes,
      }),
      metadata,
    );
    await putStarted;
    await presignStaffIdentityDocument(
      manager,
      staffAId,
      {
        side: "CITIZEN_ID_BACK",
        originalFileName: "replacement.jpg",
        mimeType: "image/jpeg",
        sizeBytes: bytes.byteLength,
        checksumSha256: checksum,
      },
      metadata,
    );
    storageMocks.deletePrivateObject.mockClear();
    const rejectedUpload = expect(lateUpload).rejects.toMatchObject({ code: "CONFLICT" });
    resumePut?.();

    await rejectedUpload;
    expect(storageMocks.deletePrivateObject).toHaveBeenCalledOnce();
    expect(storageMocks.deletePrivateObject).toHaveBeenCalledWith(stored.objectKey);
    await expect(
      prisma.auditLog.count({
        where: {
          companyId,
          entityId: pending.document.id,
          action: "staff.identity-document.reject",
        },
      }),
    ).resolves.toBe(1);
  });

  it("map lỗi kho ảnh khi upload thành dependency unavailable mà không log message nhạy cảm", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const checksum = createHash("sha256").update(bytes).digest("base64");
    const pending = await presignStaffBankQr(
      manager,
      staffAId,
      {
        originalFileName: "qr.png",
        mimeType: "image/png",
        sizeBytes: bytes.byteLength,
        checksumSha256: checksum,
      },
      metadata,
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    storageMocks.putPrivateObject.mockRejectedValueOnce(
      new Error("provider rejected secret-access-key-value"),
    );

    await expect(
      uploadStaffBankQr(
        manager,
        staffAId,
        pending.document.id,
        pending.document.version,
        new Request(`http://localhost${pending.upload.url}`, {
          method: "PUT",
          headers: pending.upload.headers,
          body: bytes,
        }),
        metadata,
      ),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      details: { code: "PRIVATE_DOCUMENT_STORAGE_UNAVAILABLE", retryable: true },
    });
    expect(consoleError).toHaveBeenCalledOnce();
    expect(String(consoleError.mock.calls[0]?.[0])).not.toContain("secret-access-key-value");
    consoleError.mockRestore();
  });

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
    storageMocks.verifyPrivateObject.mockRejectedValueOnce(
      new Error("Metadata evidence trên object storage không khớp yêu cầu đã ký."),
    );
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
    const stored = await prisma.staffIdentityDocument.findUniqueOrThrow({
      where: { id: pending.document.id },
      select: { objectKey: true },
    });
    storageMocks.deletePrivateObject.mockClear();
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
    expect(storageMocks.deletePrivateObject).toHaveBeenCalledOnce();
    expect(storageMocks.deletePrivateObject).toHaveBeenCalledWith(stored.objectKey);
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

  it("không cleanup lại object khi HEAD mismatch nhưng lượt QR đã bị presign mới reject", async () => {
    const pending = await presignStaffBankQr(
      manager,
      staffAId,
      {
        originalFileName: "qr-raced.png",
        mimeType: "image/png",
        sizeBytes: 512,
        checksumSha256,
      },
      metadata,
    );
    let markVerifyStarted: (() => void) | undefined;
    const verifyStarted = new Promise<void>((resolve) => {
      markVerifyStarted = resolve;
    });
    let rejectVerify: ((reason: unknown) => void) | undefined;
    storageMocks.verifyPrivateObject.mockImplementationOnce(
      () =>
        new Promise<undefined>((_resolve, reject) => {
          rejectVerify = reject;
          markVerifyStarted?.();
        }),
    );
    const completion = completeStaffBankQr(
      manager,
      staffAId,
      pending.document.id,
      { version: pending.document.version },
      metadata,
    );
    await verifyStarted;
    await presignStaffBankQr(
      manager,
      staffAId,
      {
        originalFileName: "qr-replacement.png",
        mimeType: "image/png",
        sizeBytes: 512,
        checksumSha256,
      },
      metadata,
    );
    storageMocks.deletePrivateObject.mockClear();
    const rejectedCompletion = expect(completion).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    rejectVerify?.(new Error("Metadata evidence trên object storage không khớp yêu cầu đã ký."));

    await rejectedCompletion;
    expect(storageMocks.deletePrivateObject).not.toHaveBeenCalled();
    await expect(
      prisma.auditLog.count({
        where: {
          companyId,
          entityId: pending.document.id,
          action: "staff.bank-qr.reject",
        },
      }),
    ).resolves.toBe(1);
  });

  it("reject, audit và cleanup CCCD lẫn QR hết TTL mà không gọi HEAD", async () => {
    const [identity, bankQr] = await Promise.all([
      presignStaffIdentityDocument(
        manager,
        staffAId,
        {
          side: "CITIZEN_ID_BACK",
          originalFileName: "expired-identity.png",
          mimeType: "image/png",
          sizeBytes: 512,
          checksumSha256,
        },
        metadata,
      ),
      presignStaffBankQr(
        manager,
        staffAId,
        {
          originalFileName: "expired-qr.png",
          mimeType: "image/png",
          sizeBytes: 512,
          checksumSha256,
        },
        metadata,
      ),
    ]);
    const expiredAt = new Date(Date.now() - STAFF_PRIVATE_DOCUMENT_UPLOAD_TTL_MS - 1);
    await Promise.all([
      prisma.staffIdentityDocument.update({
        where: { id: identity.document.id },
        data: { createdAt: expiredAt },
      }),
      prisma.staffBankQrDocument.update({
        where: { id: bankQr.document.id },
        data: { createdAt: expiredAt },
      }),
    ]);
    const [storedIdentity, storedBankQr] = await Promise.all([
      prisma.staffIdentityDocument.findUniqueOrThrow({
        where: { id: identity.document.id },
        select: { objectKey: true },
      }),
      prisma.staffBankQrDocument.findUniqueOrThrow({
        where: { id: bankQr.document.id },
        select: { objectKey: true },
      }),
    ]);
    const verifyCalls = storageMocks.verifyPrivateObject.mock.calls.length;
    storageMocks.deletePrivateObject.mockClear();

    await expect(
      completeStaffIdentityDocument(
        manager,
        staffAId,
        identity.document.id,
        { version: identity.document.version },
        metadata,
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Yêu cầu tải ảnh đã hết hạn. Vui lòng chọn lại file để tạo lượt tải mới.",
    });
    await expect(
      completeStaffBankQr(
        manager,
        staffAId,
        bankQr.document.id,
        { version: bankQr.document.version },
        metadata,
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Yêu cầu tải ảnh đã hết hạn. Vui lòng chọn lại file để tạo lượt tải mới.",
    });
    expect(storageMocks.verifyPrivateObject).toHaveBeenCalledTimes(verifyCalls);
    expect(storageMocks.deletePrivateObject).toHaveBeenCalledTimes(2);
    expect(storageMocks.deletePrivateObject).toHaveBeenCalledWith(storedIdentity.objectKey);
    expect(storageMocks.deletePrivateObject).toHaveBeenCalledWith(storedBankQr.objectKey);
    await expect(
      Promise.all([
        prisma.staffIdentityDocument.findUniqueOrThrow({
          where: { id: identity.document.id },
          select: { status: true, version: true, rejectionReason: true },
        }),
        prisma.staffBankQrDocument.findUniqueOrThrow({
          where: { id: bankQr.document.id },
          select: { status: true, version: true, rejectionReason: true },
        }),
      ]),
    ).resolves.toEqual([
      {
        status: "REJECTED",
        version: identity.document.version + 1,
        rejectionReason: "Yêu cầu tải ảnh đã hết hạn.",
      },
      {
        status: "REJECTED",
        version: bankQr.document.version + 1,
        rejectionReason: "Yêu cầu tải ảnh đã hết hạn.",
      },
    ]);
    const expiryAudits = await prisma.auditLog.findMany({
      where: { entityId: { in: [identity.document.id, bankQr.document.id] } },
      select: {
        entityId: true,
        reason: true,
        requestId: true,
        ipAddress: true,
        userAgent: true,
      },
    });
    expect(expiryAudits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: identity.document.id,
          reason: "SYSTEM:STAFF_IDENTITY_DOCUMENT_UPLOAD_EXPIRED",
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        }),
        expect.objectContaining({
          entityId: bankQr.document.id,
          reason: "SYSTEM:STAFF_BANK_QR_UPLOAD_EXPIRED",
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        }),
      ]),
    );
  });

  it("reject và audit đủ nhiều pending CCCD/QR trong một lượt presign", async () => {
    const identityKeys = [
      `tests/${runId}/batch-identity-1.png`,
      `tests/${runId}/batch-identity-2.png`,
    ] as const;
    const bankQrKeys = [
      `tests/${runId}/batch-bank-qr-1.png`,
      `tests/${runId}/batch-bank-qr-2.png`,
    ] as const;
    const [identityOne, identityTwo, bankQrOne, bankQrTwo] = await Promise.all([
      prisma.staffIdentityDocument.create({
        data: {
          companyId,
          branchId: branchBId,
          staffId: staffBId,
          side: "CITIZEN_ID_FRONT",
          objectKey: identityKeys[0],
          originalFileName: "batch-identity-1.png",
          mimeType: "image/png",
          sizeBytes: 512n,
          checksumSha256,
          createdByUserId: gm.userId,
        },
      }),
      prisma.staffIdentityDocument.create({
        data: {
          companyId,
          branchId: branchBId,
          staffId: staffBId,
          side: "CITIZEN_ID_FRONT",
          objectKey: identityKeys[1],
          originalFileName: "batch-identity-2.png",
          mimeType: "image/png",
          sizeBytes: 512n,
          checksumSha256,
          createdByUserId: gm.userId,
        },
      }),
      prisma.staffBankQrDocument.create({
        data: {
          companyId,
          branchId: branchBId,
          staffId: staffBId,
          objectKey: bankQrKeys[0],
          originalFileName: "batch-bank-qr-1.png",
          mimeType: "image/png",
          sizeBytes: 512n,
          checksumSha256,
          createdByUserId: gm.userId,
        },
      }),
      prisma.staffBankQrDocument.create({
        data: {
          companyId,
          branchId: branchBId,
          staffId: staffBId,
          objectKey: bankQrKeys[1],
          originalFileName: "batch-bank-qr-2.png",
          mimeType: "image/png",
          sizeBytes: 512n,
          checksumSha256,
          createdByUserId: gm.userId,
        },
      }),
    ]);
    const replacedIds = [identityOne.id, identityTwo.id, bankQrOne.id, bankQrTwo.id];
    storageMocks.deletePrivateObject.mockClear();

    await Promise.all([
      presignStaffIdentityDocument(
        gm,
        staffBId,
        {
          side: "CITIZEN_ID_FRONT",
          originalFileName: "batch-identity-current.png",
          mimeType: "image/png",
          sizeBytes: 512,
          checksumSha256,
        },
        metadata,
      ),
      presignStaffBankQr(
        gm,
        staffBId,
        {
          originalFileName: "batch-bank-qr-current.png",
          mimeType: "image/png",
          sizeBytes: 512,
          checksumSha256,
        },
        metadata,
      ),
    ]);

    const [identityRows, bankQrRows, audits] = await Promise.all([
      prisma.staffIdentityDocument.findMany({
        where: { id: { in: [identityOne.id, identityTwo.id] } },
        select: { status: true, version: true },
      }),
      prisma.staffBankQrDocument.findMany({
        where: { id: { in: [bankQrOne.id, bankQrTwo.id] } },
        select: { status: true, version: true },
      }),
      prisma.auditLog.findMany({
        where: { entityId: { in: replacedIds } },
        select: {
          companyId: true,
          branchId: true,
          actorUserId: true,
          action: true,
          reason: true,
          before: true,
          after: true,
          requestId: true,
          ipAddress: true,
          userAgent: true,
        },
      }),
    ]);
    expect([...identityRows, ...bankQrRows]).toHaveLength(4);
    expect([...identityRows, ...bankQrRows]).toEqual(
      expect.arrayContaining([
        { status: "REJECTED", version: 2 },
        { status: "REJECTED", version: 2 },
        { status: "REJECTED", version: 2 },
        { status: "REJECTED", version: 2 },
      ]),
    );
    expect(storageMocks.deletePrivateObject).toHaveBeenCalledTimes(4);
    for (const objectKey of [...identityKeys, ...bankQrKeys]) {
      expect(storageMocks.deletePrivateObject).toHaveBeenCalledWith(objectKey);
    }
    expect(audits).toHaveLength(4);
    for (const audit of audits) {
      expect(audit).toMatchObject({
        companyId,
        branchId: branchBId,
        actorUserId: gm.userId,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        before: { branchId: branchBId, status: "PENDING_UPLOAD", version: 1 },
        after: {
          branchId: branchBId,
          status: "REJECTED",
          version: 2,
          rejectionReason: "Được thay thế bởi yêu cầu tải ảnh mới.",
        },
      });
      expect(audit.reason).toBe(
        audit.action === "staff.identity-document.reject"
          ? "SYSTEM:STAFF_IDENTITY_DOCUMENT_UPLOAD_REPLACED"
          : "SYSTEM:STAFF_BANK_QR_UPLOAD_REPLACED",
      );
    }
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
