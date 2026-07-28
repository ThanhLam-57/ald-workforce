import { createHash } from "node:crypto";

import { prisma } from "@ald/db";
import type { ActorContext } from "@ald/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { appendSecureAudit, listAuditLogs } from "./audit-service";
import {
  commitImport,
  completeImportUpload,
  presignImportUpload,
  previewImport,
} from "./import-service";
import type { RequestMetadata } from "./request-metadata";

const runId = crypto.randomUUID();
const metadata: RequestMetadata = {
  requestId: `data-governance-${runId}`,
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
};

let companyId: string;
let branchAId: string;
let branchBId: string;
let gm: ActorContext;
let manager: ActorContext;

beforeAll(async () => {
  const company = await prisma.company.create({
    data: { name: `Data governance ${runId}`, slug: `data-governance-${runId}` },
  });
  companyId = company.id;
  const [branchA, branchB] = await Promise.all([
    prisma.branch.create({ data: { companyId, code: `A-${runId}`, name: "Branch A" } }),
    prisma.branch.create({ data: { companyId, code: `B-${runId}`, name: "Branch B" } }),
  ]);
  branchAId = branchA.id;
  branchBId = branchB.id;
  const [gmUser, managerUser] = await Promise.all([
    prisma.user.create({
      data: {
        companyId,
        name: "GM Import",
        email: `gm-import-${runId}@example.com`,
        role: "GENERAL_MANAGER",
      },
    }),
    prisma.user.create({
      data: {
        companyId,
        name: "Manager Import",
        email: `manager-import-${runId}@example.com`,
        role: "TRAINING_MANAGER",
      },
    }),
  ]);
  gm = {
    userId: gmUser.id,
    companyId,
    staffId: null,
    role: "GENERAL_MANAGER",
    activeBranchIds: [],
  };
  manager = {
    userId: managerUser.id,
    companyId,
    staffId: null,
    role: "TRAINING_MANAGER",
    activeBranchIds: [branchAId],
  };
});

afterAll(async () => {
  await prisma.$transaction(async (tx) => {
    await tx.importError.deleteMany({ where: { companyId } });
    await tx.importJob.deleteMany({ where: { companyId } });
    await tx.dataExportJob.deleteMany({ where: { companyId } });
    await tx.$executeRawUnsafe("SET LOCAL ald.audit_cleanup = 'on'");
    await tx.auditLog.deleteMany({ where: { companyId } });
    await tx.user.deleteMany({ where: { companyId } });
    await tx.branchAssignment.deleteMany({ where: { companyId } });
    await tx.staffMember.deleteMany({ where: { companyId } });
    await tx.branch.deleteMany({ where: { companyId } });
    await tx.company.delete({ where: { id: companyId } });
  });
});

describe("import idempotency and branch scope", () => {
  it("returns the same job for the same template/checksum", async () => {
    const checksumSha256 = `${"A".repeat(43)}=`;
    const first = await presignImportUpload(
      gm,
      {
        template: "BRANCHES",
        idempotencyKey: `first-${runId}`,
        originalFileName: "branches.csv",
        mimeType: "text/csv",
        sizeBytes: 128,
        checksumSha256,
        branchId: null,
        reason: "Import idempotency test.",
      },
      metadata,
    );
    const repeated = await presignImportUpload(
      gm,
      {
        template: "BRANCHES",
        idempotencyKey: `second-${runId}`,
        originalFileName: "branches-copy.csv",
        mimeType: "text/csv",
        sizeBytes: 128,
        checksumSha256,
        branchId: null,
        reason: "Import idempotency test repeated.",
      },
      metadata,
    );
    expect(first.duplicate).toBe(false);
    expect(repeated.duplicate).toBe(true);
    expect(repeated.job.id).toBe(first.job.id);
    expect(await prisma.importJob.count({ where: { companyId } })).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { companyId, action: "IMPORT_UPLOAD_REQUEST", entityId: first.job.id },
      }),
    ).toBe(1);
  });

  it("blocks a manager from importing another branch", async () => {
    await expect(
      presignImportUpload(
        manager,
        {
          template: "ATTENDANCE_LIVE",
          idempotencyKey: `cross-branch-${runId}`,
          originalFileName: "attendance.csv",
          mimeType: "text/csv",
          sizeBytes: 128,
          checksumSha256: `${"B".repeat(43)}=`,
          branchId: branchBId,
          reason: "Cross branch test.",
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("blocks manager import even when the target is an assigned branch", async () => {
    const checksumSha256 = `${"C".repeat(43)}=`;
    await presignImportUpload(
      gm,
      {
        template: "STAFF",
        idempotencyKey: `branch-b-file-${runId}`,
        originalFileName: "staff-branch-b.csv",
        mimeType: "text/csv",
        sizeBytes: 128,
        checksumSha256,
        branchId: branchBId,
        reason: "Cross-branch duplicate fixture.",
      },
      metadata,
    );
    await expect(
      presignImportUpload(
        manager,
        {
          template: "STAFF",
          idempotencyKey: `branch-a-copy-${runId}`,
          originalFileName: "staff-branch-a.csv",
          mimeType: "text/csv",
          sizeBytes: 128,
          checksumSha256,
          branchId: branchAId,
          reason: "Cross-branch duplicate disclosure test.",
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not allow manager to start a staff import job", async () => {
    const staffCode = `BRANCH-B-${runId}`;
    const staff = await prisma.staffMember.create({
      data: {
        companyId,
        staffCode,
        fullName: "Branch B Staff",
        jobTitle: "Live",
        employmentCategory: "OFFICIAL",
      },
    });
    await prisma.branchAssignment.create({
      data: {
        companyId,
        branchId: branchBId,
        staffId: staff.id,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    await expect(
      presignImportUpload(
        manager,
        {
          template: "STAFF",
          idempotencyKey: `staff-scope-${runId}`,
          originalFileName: "staff-scope.csv",
          mimeType: "text/csv",
          sizeBytes: 128,
          checksumSha256: createHash("sha256").update(staffCode).digest("base64"),
          branchId: branchAId,
          reason: "Staff branch scope test.",
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await prisma.staffMember.findUniqueOrThrow({
        where: { companyId_staffCode: { companyId, staffCode } },
        select: { fullName: true },
      }),
    ).toEqual({ fullName: "Branch B Staff" });
  });

  it("uploads, previews and commits a CSV batch transactionally", async () => {
    const branchCode = `CSV-${runId}`;
    const body = Buffer.from(
      `code,name,isActive\r\n${branchCode},Imported Branch,true\r\n`,
      "utf8",
    );
    const checksumSha256 = createHash("sha256").update(body).digest("base64");
    const created = await presignImportUpload(
      gm,
      {
        template: "BRANCHES",
        idempotencyKey: `csv-commit-${runId}`,
        originalFileName: "branches-valid.csv",
        mimeType: "text/csv",
        sizeBytes: body.length,
        checksumSha256,
        branchId: null,
        reason: "CSV integration import.",
      },
      metadata,
    );
    expect(created.upload).not.toBeNull();
    const uploaded = await fetch(created.upload!.url, {
      method: "PUT",
      headers: created.upload!.headers,
      body,
    });
    expect(uploaded.ok).toBe(true);
    const completed = await completeImportUpload(gm, created.job.id, metadata);
    expect(completed.status).toBe("UPLOADED");
    const preview = await previewImport(
      gm,
      created.job.id,
      { mapping: completed.mapping, dryRun: true },
      metadata,
    );
    expect(preview).toMatchObject({ status: "VALIDATED", validRows: 1, errorRows: 0 });
    const committed = await commitImport(
      gm,
      created.job.id,
      { confirm: true, reason: "Commit CSV integration import." },
      metadata,
    );
    expect(committed).toMatchObject({ status: "SUCCEEDED", committedRows: 1 });
    expect(await prisma.branch.count({ where: { companyId, code: branchCode } })).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { companyId, entityId: created.job.id, action: "IMPORT_COMMIT" },
      }),
    ).toBe(1);
  });
});

describe("advanced audit", () => {
  it("redacts secrets, exposes readable diffs and remains append-only", async () => {
    await appendSecureAudit({
      actor: gm,
      action: "SECURITY_PROFILE_UPDATE",
      entityType: "User",
      entityId: gm.userId,
      branchId: branchAId,
      reason: "Audit redaction test.",
      before: { name: "Old", password: "old-secret", sessionToken: "old-token" },
      after: { name: "New", password: "new-secret", sessionToken: "new-token" },
      metadata,
    });
    const result = await listAuditLogs(
      gm,
      { action: "SECURITY_PROFILE_UPDATE", branchId: branchAId, limit: 20 },
      metadata,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.before).toMatchObject({
      password: "[REDACTED]",
      sessionToken: "[REDACTED]",
    });
    expect(result.items[0]?.changes).toEqual([{ path: "name", before: "Old", after: "New" }]);
    await expect(
      prisma.auditLog.update({
        where: { id: result.items[0]!.id },
        data: { reason: "Tamper" },
      }),
    ).rejects.toThrow(/append-only/i);
  });
});
