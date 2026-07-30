import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
  send: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("@ald/db", () => ({
  prisma: {
    importJob: { findMany: mocks.findMany },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@aws-sdk/client-s3", () => ({
  DeleteObjectCommand: class DeleteObjectCommand {
    constructor(readonly input: unknown) {}
  },
  S3Client: class S3Client {
    send = mocks.send;
    destroy = mocks.destroy;
  },
}));

import { cleanupAttendanceMachineImports } from "./attendance-import-cleanup.js";

const now = new Date("2026-07-30T08:00:00.000Z");

describe("cleanupAttendanceMachineImports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.S3_BUCKET = "private";
    process.env.S3_ENDPOINT = "http://storage.internal";
    process.env.S3_ACCESS_KEY = "test-access";
    process.env.S3_SECRET_KEY = "test-secret";
    delete process.env.ATTENDANCE_IMPORT_RETENTION_DAYS;
    mocks.transaction.mockImplementation(
      async (
        callback: (tx: {
          importJob: { updateMany: typeof mocks.updateMany };
          auditLog: { create: typeof mocks.auditCreate };
        }) => Promise<unknown>,
      ) =>
        callback({
          importJob: { updateMany: mocks.updateMany },
          auditLog: { create: mocks.auditCreate },
        }),
    );
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.auditCreate.mockResolvedValue({});
    mocks.send.mockResolvedValue({});
  });

  it("expires a stale attempt with compare-and-set and an append-only audit", async () => {
    mocks.findMany
      .mockResolvedValueOnce([
        {
          id: "job-pending",
          companyId: "company-1",
          branchId: "branch-1",
          requestedByUserId: "user-1",
          status: "PENDING_UPLOAD",
          expiresAt: new Date("2026-07-30T07:59:00.000Z"),
        },
      ])
      .mockResolvedValueOnce([]);

    await expect(cleanupAttendanceMachineImports(now)).resolves.toEqual({
      expired: 1,
      objectsDeleted: 0,
      errors: 0,
    });
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "job-pending",
          status: "PENDING_UPLOAD",
          expiresAt: { lte: now },
        }),
        data: { status: "EXPIRED" },
      }),
    );
    expect(mocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: null,
          action: "ATTENDANCE_MACHINE_IMPORT_EXPIRED",
          entityId: "job-pending",
        }),
      }),
    );
  });

  it("deletes an expired private object idempotently and keeps job metadata", async () => {
    mocks.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "job-expired",
        companyId: "company-1",
        branchId: "branch-1",
        status: "EXPIRED",
        objectKey: "company-1/imports/job-expired/source.xlsx",
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        uploadedAt: null,
        validatedAt: null,
        committedAt: null,
        expiresAt: new Date("2026-05-01T00:30:00.000Z"),
      },
    ]);

    await expect(cleanupAttendanceMachineImports(now)).resolves.toEqual({
      expired: 0,
      objectsDeleted: 1,
      errors: 0,
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "job-expired",
          status: "EXPIRED",
          objectDeletedAt: null,
        }),
        data: { objectDeletedAt: now },
      }),
    );
    expect(mocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "ATTENDANCE_MACHINE_IMPORT_OBJECT_DELETED",
          entityId: "job-expired",
        }),
      }),
    );
  });

  it("does not write an audit when another worker wins the expiry CAS", async () => {
    mocks.findMany
      .mockResolvedValueOnce([
        {
          id: "job-raced",
          companyId: "company-1",
          branchId: "branch-1",
          requestedByUserId: "user-1",
          status: "VALIDATED",
          expiresAt: new Date("2026-07-29T08:00:00.000Z"),
        },
      ])
      .mockResolvedValueOnce([]);
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(cleanupAttendanceMachineImports(now)).resolves.toEqual({
      expired: 0,
      objectsDeleted: 0,
      errors: 0,
    });
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
