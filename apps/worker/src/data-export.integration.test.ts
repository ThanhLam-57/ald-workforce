import { prisma } from "@ald/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cleanupExpiredExports, processDataExportJob } from "./data-export";

const enabled = Boolean(process.env.DATABASE_URL && process.env.S3_ENDPOINT);
const runId = crypto.randomUUID();
let companyId: string;
let exportJobId: string;

describe.runIf(enabled)("data export worker and retention", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `Worker export ${runId}`, slug: `worker-export-${runId}` },
    });
    companyId = company.id;
    const branch = await prisma.branch.create({
      data: { companyId, code: `EX-${runId}`, name: "Export Branch" },
    });
    const user = await prisma.user.create({
      data: {
        companyId,
        name: "Export Requester",
        email: `export-${runId}@example.com`,
        role: "GENERAL_MANAGER",
      },
    });
    const expiresAt = new Date();
    expiresAt.setUTCDate(expiresAt.getUTCDate() + 7);
    const job = await prisma.dataExportJob.create({
      data: {
        companyId,
        branchId: branch.id,
        template: "BRANCH_MONTHLY",
        format: "XLSX",
        parameters: { month: "2026-07" },
        requestedByUserId: user.id,
        reason: "Worker integration test.",
        expiresAt,
      },
    });
    exportJobId = job.id;
  });

  afterAll(async () => {
    if (!companyId) return;
    await prisma.$transaction(async (tx) => {
      await tx.dataExportJob.deleteMany({ where: { companyId } });
      await tx.$executeRawUnsafe("SET LOCAL ald.audit_cleanup = 'on'");
      await tx.auditLog.deleteMany({ where: { companyId } });
      await tx.user.deleteMany({ where: { companyId } });
      await tx.branch.deleteMany({ where: { companyId } });
      await tx.company.delete({ where: { id: companyId } });
    });
  });

  it("moves queued -> running -> succeeded and expires the private object", async () => {
    await processDataExportJob(exportJobId);
    const completed = await prisma.dataExportJob.findUniqueOrThrow({
      where: { id: exportJobId },
    });
    expect(completed).toMatchObject({
      status: "SUCCEEDED",
      progress: 100,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    expect(completed.objectKey).toBeTruthy();
    expect(completed.checksumSha256).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    await prisma.dataExportJob.update({
      where: { id: exportJobId },
      data: { expiresAt: new Date("2020-01-01T00:00:00.000Z") },
    });
    expect(await cleanupExpiredExports(new Date())).toBe(1);
    expect(
      await prisma.dataExportJob.findUniqueOrThrow({ where: { id: exportJobId } }),
    ).toMatchObject({
      status: "EXPIRED",
      objectKey: null,
    });
  });
});
