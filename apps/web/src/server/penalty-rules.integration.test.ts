import { createHash, randomUUID } from "node:crypto";

import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "@ald/db";
import type { ActorContext } from "@ald/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createAttendance,
  createEmployeeErrorReport,
  getAttendanceMonth,
} from "./attendance-service";
import {
  createPenaltyRuleDraft,
  createPenaltyRuleSet,
  listActivePenaltyVersions,
  publishPenaltyRuleVersion,
  retirePenaltyRuleVersion,
  updatePenaltyRuleDraft,
} from "./penalty-rule-service";
import {
  completeEvidenceUpload,
  createViolation,
  getEvidenceView,
  presignEvidenceUpload,
} from "./violation-service";

const runId = randomUUID().slice(0, 8);
const metadata = {
  requestId: `penalty-${runId}`,
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
} as const;

let companyId: string;
let branchAId: string;
let branchBId: string;
let liveAId: string;
let liveBId: string;
let gm: ActorContext;
let managerA: ActorContext;
let managerB: ActorContext;
let attendanceAId: string;
let attendanceBId: string;
let versionOneId: string;
let versionOneRowVersion: number;
let penaltyItemOneId: string;
let oldViolationId: string;

beforeAll(async () => {
  const company = await prisma.company.create({
    data: { name: `Penalty ${runId}`, slug: `penalty-${runId}` },
  });
  companyId = company.id;
  const [branchA, branchB] = await Promise.all([
    prisma.branch.create({
      data: { companyId, code: "A", name: "Cơ sở A" },
    }),
    prisma.branch.create({
      data: { companyId, code: "B", name: "Cơ sở B" },
    }),
  ]);
  branchAId = branchA.id;
  branchBId = branchB.id;

  const [gmStaff, managerAStaff, managerBStaff, liveA, liveB] = await Promise.all([
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: "GM",
        fullName: "GM Penalty",
        jobTitle: "Tổng quản lý",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: "TMA",
        fullName: "Manager A",
        jobTitle: "Quản lý đào tạo",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: "TMB",
        fullName: "Manager B",
        jobTitle: "Quản lý đào tạo",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: "LA",
        fullName: "Live A",
        jobTitle: "Live",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: "LB",
        fullName: "Live B",
        jobTitle: "Live",
        employmentCategory: "OFFICIAL",
      },
    }),
  ]);
  liveAId = liveA.id;
  liveBId = liveB.id;

  const [gmUser, managerAUser, managerBUser] = await Promise.all([
    prisma.user.create({
      data: {
        companyId,
        staffId: gmStaff.id,
        name: "GM Penalty",
        email: `penalty-gm-${runId}@test.local`,
        username: `penalty_gm_${runId}`,
        role: "GENERAL_MANAGER",
      },
    }),
    prisma.user.create({
      data: {
        companyId,
        staffId: managerAStaff.id,
        name: "Manager A",
        email: `penalty-manager-a-${runId}@test.local`,
        username: `penalty_manager_a_${runId}`,
        role: "TRAINING_MANAGER",
      },
    }),
    prisma.user.create({
      data: {
        companyId,
        staffId: managerBStaff.id,
        name: "Manager B",
        email: `penalty-manager-b-${runId}@test.local`,
        username: `penalty_manager_b_${runId}`,
        role: "TRAINING_MANAGER",
      },
    }),
  ]);

  await Promise.all([
    prisma.branchAssignment.create({
      data: {
        companyId,
        branchId: branchAId,
        staffId: managerAStaff.id,
        assignmentType: "PRIMARY_MANAGER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
    prisma.branchAssignment.create({
      data: {
        companyId,
        branchId: branchBId,
        staffId: managerBStaff.id,
        assignmentType: "PRIMARY_MANAGER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
    prisma.branchAssignment.create({
      data: {
        companyId,
        branchId: branchAId,
        staffId: liveA.id,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
    prisma.branchAssignment.create({
      data: {
        companyId,
        branchId: branchBId,
        staffId: liveB.id,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
  ]);

  gm = {
    userId: gmUser.id,
    companyId,
    staffId: gmStaff.id,
    role: "GENERAL_MANAGER",
    activeBranchIds: [],
  };
  managerA = {
    userId: managerAUser.id,
    companyId,
    staffId: managerAStaff.id,
    role: "TRAINING_MANAGER",
    activeBranchIds: [branchAId],
  };
  managerB = {
    userId: managerBUser.id,
    companyId,
    staffId: managerBStaff.id,
    role: "TRAINING_MANAGER",
    activeBranchIds: [branchBId],
  };

  const [attendanceA, attendanceB] = await Promise.all([
    createAttendance(
      gm,
      {
        staffId: liveAId,
        businessDate: "2026-08-15",
        status: "PRESENT",
        revenueAmount: "9999999",
        reason: "Fixture attendance A",
      },
      metadata,
    ),
    createAttendance(
      gm,
      {
        staffId: liveBId,
        businessDate: "2026-08-15",
        status: "PRESENT",
        reason: "Fixture attendance B",
      },
      metadata,
    ),
  ]);
  attendanceAId = attendanceA.id;
  attendanceBId = attendanceB.id;

  const ruleSet = await createPenaltyRuleSet(
    gm,
    { name: `Quy định Live ${runId}`, reason: "Tạo rule test" },
    metadata,
  );
  const draft = ruleSet.versions[0]!;
  const saved = await updatePenaltyRuleDraft(
    gm,
    draft.id,
    {
      notes: "Version đầu",
      rowVersion: draft.rowVersion,
      reason: "Thêm danh mục lỗi",
      items: [
        {
          code: "LATE",
          name: "Đi muộn",
          description: "Nhân viên bắt đầu Live muộn.",
          defaultAmount: "50000",
          isActive: true,
          displayColor: "#EF4444",
          displayOrder: 1,
        },
      ],
    },
    metadata,
  );
  const published = await publishPenaltyRuleVersion(
    gm,
    saved.id,
    {
      effectiveFrom: "2026-08-01",
      effectiveTo: "2026-09-01",
      rowVersion: saved.rowVersion,
      reason: "Publish version đầu",
    },
    metadata,
    new Date("2026-07-20T03:00:00.000Z"),
  );
  versionOneId = published.id;
  versionOneRowVersion = published.rowVersion;
  penaltyItemOneId = published.items[0]!.id;
});

afterAll(async () => {
  const evidenceKeys = await prisma.evidenceObject.findMany({
    where: { companyId },
    select: { objectKey: true },
  });
  const storageClient = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? "http://127.0.0.1:9000",
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? "ald_minio",
      secretAccessKey: process.env.S3_SECRET_KEY ?? "ald_minio_local_password",
    },
  });
  try {
    await Promise.allSettled(
      evidenceKeys.map((evidence) =>
        storageClient.send(
          new DeleteObjectCommand({
            Bucket: process.env.S3_BUCKET ?? "ald-private",
            Key: evidence.objectKey,
          }),
        ),
      ),
    );
  } finally {
    storageClient.destroy();
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'ALTER TABLE "violations" DISABLE TRIGGER "violations_no_hard_delete"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "penalty_items" DISABLE TRIGGER "penalty_items_published_immutable"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "rule_versions" DISABLE TRIGGER "rule_versions_published_immutable"',
    );

    await tx.evidenceObject.deleteMany({ where: { companyId } });
    await tx.violation.deleteMany({ where: { companyId } });
    await tx.penaltyItem.deleteMany({ where: { companyId } });
    await tx.ruleVersion.deleteMany({ where: { companyId } });
    await tx.ruleSet.deleteMany({ where: { companyId } });
    await tx.liveDailyMetric.deleteMany({ where: { companyId } });
    await tx.attendanceDay.deleteMany({ where: { companyId } });
    await tx.auditLog.deleteMany({ where: { companyId } });
    await tx.branchAssignment.deleteMany({ where: { companyId } });
    await tx.session.deleteMany({ where: { user: { companyId } } });
    await tx.account.deleteMany({ where: { user: { companyId } } });
    await tx.user.deleteMany({ where: { companyId } });
    await tx.branch.deleteMany({ where: { companyId } });
    await tx.staffMember.deleteMany({ where: { companyId } });
    await tx.company.deleteMany({ where: { id: companyId } });

    await tx.$executeRawUnsafe(
      'ALTER TABLE "rule_versions" ENABLE TRIGGER "rule_versions_published_immutable"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "penalty_items" ENABLE TRIGGER "penalty_items_published_immutable"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "violations" ENABLE TRIGGER "violations_no_hard_delete"',
    );
  });
});

describe("effective date và published immutable", () => {
  it.each([
    ["2026-07-31", 0],
    ["2026-08-01", 1],
    ["2026-08-31", 1],
    ["2026-09-01", 0],
  ])("áp dụng boundary %s", async (date, expected) => {
    const versions = await listActivePenaltyVersions(managerA, date);
    expect(versions).toHaveLength(expected);
  });

  it("không cho sửa application hoặc DB item của version đã publish", async () => {
    await expect(
      updatePenaltyRuleDraft(
        gm,
        versionOneId,
        {
          notes: "Không được sửa",
          rowVersion: versionOneRowVersion,
          reason: "Thử sửa published",
          items: [],
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(
      prisma.penaltyItem.update({
        where: { id: penaltyItemOneId },
        data: { defaultAmount: 1n },
      }),
    ).rejects.toThrow(/immutable/i);
  });
});

describe("violation snapshot, totals và branch scope", () => {
  it("snapshot amount cũ không đổi khi publish version mới", async () => {
    const oldViolation = await createViolation(
      managerA,
      {
        attendanceId: attendanceAId,
        penaltyItemId: penaltyItemOneId,
        detail: "Đi muộn 15 phút",
        reason: "Ghi nhận lỗi tháng 8",
      },
      metadata,
    );
    expect(oldViolation.amount).toBe("50000");
    oldViolationId = oldViolation.id;

    const retired = await retirePenaltyRuleVersion(
      gm,
      versionOneId,
      {
        effectiveTo: "2026-09-01",
        rowVersion: versionOneRowVersion,
        reason: "Kết thúc version 1",
      },
      metadata,
      new Date("2026-08-20T03:00:00.000Z"),
    );
    const draft = await createPenaltyRuleDraft(
      gm,
      {
        ruleSetId: retired.ruleSetId,
        cloneFromVersionId: retired.id,
        reason: "Clone version mới",
      },
      metadata,
    );
    const saved = await updatePenaltyRuleDraft(
      gm,
      draft.id,
      {
        notes: "Tăng mức phạt",
        rowVersion: draft.rowVersion,
        reason: "Cập nhật mức phạt",
        items: draft.items.map((item) => ({
          code: item.code,
          name: item.name,
          description: item.description,
          defaultAmount: "70000",
          isActive: item.isActive,
          displayColor: item.displayColor,
          displayOrder: item.displayOrder,
        })),
      },
      metadata,
    );
    const versionTwo = await publishPenaltyRuleVersion(
      gm,
      saved.id,
      {
        effectiveFrom: "2026-09-01",
        effectiveTo: null,
        rowVersion: saved.rowVersion,
        reason: "Publish version 2",
      },
      metadata,
      new Date("2026-08-20T03:00:00.000Z"),
    );
    const septemberAttendance = await createAttendance(
      gm,
      {
        staffId: liveAId,
        businessDate: "2026-09-02",
        reason: "Attendance tháng 9",
      },
      metadata,
    );
    const newViolation = await createViolation(
      managerA,
      {
        attendanceId: septemberAttendance.id,
        penaltyItemId: versionTwo.items[0]!.id,
        detail: "Đi muộn tháng 9",
        reason: "Ghi nhận lỗi tháng 9",
      },
      metadata,
    );

    const persistedOld = await prisma.violation.findUniqueOrThrow({
      where: { id: oldViolation.id },
    });
    expect(persistedOld.amount).toBe(50000n);
    expect(newViolation.amount).toBe("70000");

    const overlapDraft = await createPenaltyRuleDraft(
      gm,
      {
        ruleSetId: versionTwo.ruleSetId,
        cloneFromVersionId: versionTwo.id,
        reason: "Clone để thử overlap",
      },
      metadata,
    );
    await expect(
      publishPenaltyRuleVersion(
        gm,
        overlapDraft.id,
        {
          effectiveFrom: "2026-09-15",
          effectiveTo: null,
          rowVersion: overlapDraft.rowVersion,
          reason: "Thử publish overlap",
        },
        metadata,
        new Date("2026-08-20T03:00:00.000Z"),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const august = await getAttendanceMonth(managerA, liveAId, "2026-08");
    const day = august.days.find((candidate) => candidate.businessDate === "2026-08-15");
    expect(day?.activePenaltyTotal).toBe("50000");
    expect(august.activePenaltyTotal).toBe("50000");

    const report = await createEmployeeErrorReport(
      gm,
      liveAId,
      "2026-08",
      new Date("2026-08-31T17:00:00.000Z"),
    );
    expect(report.violations[0]?.amount).toBe("50000");
    expect(JSON.stringify(report)).not.toContain("revenue");
    expect(JSON.stringify(report)).not.toContain("9999999");
  });

  it("manager branch A không tạo violation cho attendance branch B", async () => {
    await expect(
      createViolation(
        managerA,
        {
          attendanceId: attendanceBId,
          penaltyItemId: penaltyItemOneId,
          detail: "Thử IDOR",
          reason: "Thử IDOR branch",
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("chặn manager override amount", async () => {
    await expect(
      createViolation(
        managerA,
        {
          attendanceId: attendanceAId,
          penaltyItemId: penaltyItemOneId,
          detail: "Thử override",
          amountOverride: "1",
          overrideReason: "Không có quyền",
          reason: "Thử quyền override",
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("evidence authorization", () => {
  it("presign PUT và chỉ READY sau khi HEAD verify size/type/checksum", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const checksumSha256 = createHash("sha256").update(bytes).digest("base64");
    const presigned = await presignEvidenceUpload(
      gm,
      {
        violationId: oldViolationId,
        originalFileName: "evidence.png",
        mimeType: "image/png",
        sizeBytes: bytes.byteLength,
        checksumSha256,
        reason: "Integration upload evidence",
      },
      metadata,
    );
    const upload = await fetch(presigned.upload.url, {
      method: "PUT",
      headers: presigned.upload.headers,
      body: bytes,
    });
    const uploadError = upload.ok ? "" : await upload.text();
    expect(
      upload.ok,
      `MinIO PUT failed (${upload.status}, signed=${new URL(presigned.upload.url).searchParams.get(
        "X-Amz-SignedHeaders",
      )}): ${uploadError}`,
    ).toBe(true);

    const ready = await completeEvidenceUpload(
      gm,
      presigned.evidence.id,
      { version: presigned.evidence.version },
      metadata,
    );
    expect(ready.status).toBe("READY");

    const view = await getEvidenceView(gm, ready.id);
    const downloaded = await fetch(view.url);
    expect(downloaded.ok).toBe(true);
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes);

    const report = await createEmployeeErrorReport(gm, liveAId, "2026-08");
    expect(report.violations[0]?.evidence[0]?.fileName).toBe("evidence.png");
    expect(report.violations[0]?.evidence[0]?.url).toContain("X-Amz-Signature");
    expect(JSON.stringify(report)).not.toContain("revenue");
  });

  it("không tạo signed GET cho manager khác branch", async () => {
    const violation = await prisma.violation.findFirstOrThrow({
      where: { companyId, branchId: branchAId },
    });
    const evidence = await prisma.evidenceObject.create({
      data: {
        companyId,
        branchId: branchAId,
        violationId: violation.id,
        objectKey: `tests/${runId}/${randomUUID()}.png`,
        originalFileName: "evidence.png",
        mimeType: "image/png",
        sizeBytes: 10n,
        checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        status: "READY",
        createdByUserId: gm.userId,
        uploadedAt: new Date(),
        verifiedAt: new Date(),
      },
    });

    await expect(getEvidenceView(managerB, evidence.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
