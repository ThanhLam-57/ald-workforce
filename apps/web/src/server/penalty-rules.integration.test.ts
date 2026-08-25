import { createHash, randomUUID } from "node:crypto";

import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "@ald/db";
import type { ActorContext } from "@ald/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createAttendance,
  createEmployeeErrorReport,
  getAttendanceMonth,
  getAttendancePrintData,
  updateAttendance,
} from "./attendance-service";
import {
  createPenaltyRuleDraft,
  createPenaltyRuleSet,
  listActivePenaltyVersions,
  publishPenaltyRuleVersion,
  retirePenaltyRuleVersion,
  updatePenaltyRuleDraft,
} from "./penalty-rule-service";
import { applySimplePenaltyRules } from "./simple-rule-service";
import {
  cancelViolation,
  completeEvidenceUpload,
  createViolation,
  getEvidenceView,
  presignEvidenceUpload,
  uploadEvidenceObject,
} from "./violation-service";

const runId = randomUUID().slice(0, 8);
const metadata = {
  requestId: `penalty-${runId}`,
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
} as const;

function evidenceUploadRequest(
  bytes: Uint8Array,
  headers: Readonly<Record<string, string>>,
): Request {
  return new Request("http://localhost/api/evidence/upload", {
    method: "PUT",
    headers,
    body: bytes,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

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
let septemberAttendanceId: string;
let versionOneId: string;
let versionOneRowVersion: number;
let penaltyItemOneId: string;
let versionedPenaltyItemId: string;
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
      },
      metadata,
    ),
    createAttendance(
      gm,
      {
        staffId: liveBId,
        businessDate: "2026-08-15",
        status: "PRESENT",
      },
      metadata,
    ),
  ]);
  attendanceAId = attendanceA.id;
  attendanceBId = attendanceB.id;

  const ruleSet = await createPenaltyRuleSet(gm, { name: `Quy định Live ${runId}` }, metadata);
  const draft = ruleSet.versions[0]!;
  const saved = await updatePenaltyRuleDraft(
    gm,
    draft.id,
    {
      notes: "Version đầu",
      rowVersion: draft.rowVersion,
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
    },
    metadata,
    new Date("2026-07-20T03:00:00.000Z"),
  );
  versionOneId = published.id;
  versionOneRowVersion = published.rowVersion;
  versionedPenaltyItemId = published.items[0]!.id;
  const simplePenalty = await applySimplePenaltyRules(
    gm,
    {
      effectiveFrom: "2026-08-01",
      items: [
        {
          code: "LATE_SIMPLE",
          name: "Đi muộn",
          description: "Nhân viên bắt đầu Live muộn.",
          defaultAmount: "50000",
          reminderCount: 0,
          countingWindow: "CALENDAR_MONTH",
          displayColor: "#EF4444",
          isActive: true,
        },
      ],
    },
    metadata,
    new Date("2026-08-01T03:00:00.000Z"),
  );
  penaltyItemOneId = (
    await prisma.penaltyItem.findFirstOrThrow({
      where: {
        companyId,
        code: simplePenalty.items[0]!.code,
        archivedAt: null,
        ruleVersion: { isSimpleCurrent: true },
      },
      select: { id: true },
    })
  ).id;
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
    await tx.$executeRawUnsafe("SET LOCAL ald.audit_cleanup = 'on'");
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
          items: [],
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(
      prisma.penaltyItem.update({
        where: { id: versionedPenaltyItemId },
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
      },
      metadata,
      new Date("2026-08-20T03:00:00.000Z"),
    );
    const draft = await createPenaltyRuleDraft(
      gm,
      {
        ruleSetId: retired.ruleSetId,
        cloneFromVersionId: retired.id,
      },
      metadata,
    );
    const saved = await updatePenaltyRuleDraft(
      gm,
      draft.id,
      {
        notes: "Tăng mức phạt",
        rowVersion: draft.rowVersion,
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
      },
      metadata,
      new Date("2026-08-20T03:00:00.000Z"),
    );
    await applySimplePenaltyRules(
      gm,
      {
        effectiveFrom: "2026-09-01",
        items: [
          {
            code: "LATE_SIMPLE",
            name: "Đi muộn",
            description: "Nhân viên bắt đầu Live muộn.",
            defaultAmount: "70000",
            reminderCount: 0,
            countingWindow: "CALENDAR_MONTH",
            displayColor: "#EF4444",
            isActive: true,
          },
        ],
      },
      metadata,
      new Date("2026-09-01T03:00:00.000Z"),
    );
    const septemberPenaltyItem = await prisma.penaltyItem.findFirstOrThrow({
      where: {
        companyId,
        code: "LATE_SIMPLE",
        archivedAt: null,
        ruleVersion: { isSimpleCurrent: true },
      },
      select: { id: true },
    });
    const septemberAttendance = await createAttendance(
      gm,
      {
        staffId: liveAId,
        businessDate: "2026-09-02",
      },
      metadata,
    );
    septemberAttendanceId = septemberAttendance.id;
    const newViolation = await createViolation(
      managerA,
      {
        attendanceId: septemberAttendance.id,
        penaltyItemId: septemberPenaltyItem.id,
        detail: "Đi muộn tháng 9",
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
        },
        metadata,
        new Date("2026-08-20T03:00:00.000Z"),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const august = await getAttendanceMonth(managerA, liveAId, "2026-08");
    const day = august.days.find((candidate) => candidate.businessDate === "2026-08-15");
    expect(day?.activePenaltyTotal).toBe("50000");
    expect(august.activePenaltyTotal).toBe("50000");

    await updateAttendance(
      gm,
      day!.attendance!.id,
      {
        version: day!.attendance!.version,
        penaltyOverrideAmount: "20000",
      },
      metadata,
    );
    const overriddenAugust = await getAttendanceMonth(managerA, liveAId, "2026-08");
    const overriddenDay = overriddenAugust.days.find(
      (candidate) => candidate.businessDate === "2026-08-15",
    );
    expect(overriddenDay).toMatchObject({
      calculatedPenaltyTotal: "50000",
      activePenaltyTotal: "20000",
      violations: [expect.objectContaining({ itemName: oldViolation.itemName, status: "ACTIVE" })],
    });
    expect(overriddenAugust.activePenaltyTotal).toBe("20000");

    const printed = await getAttendancePrintData(
      managerA,
      liveAId,
      "2026-08",
      metadata,
      new Date("2026-08-31T17:00:00.000Z"),
    );
    expect(printed.rows.find((row) => row.businessDate === "2026-08-15")).toMatchObject({
      violationNames: [oldViolation.itemName],
      penaltyAmount: "20000",
    });
    expect(printed.totals.penaltyAmount).toBe("20000");

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
          attendanceId: septemberAttendanceId,
          penaltyItemId: penaltyItemOneId,
          detail: "Thử override",
          amountOverride: "1",
          overrideReason: "Không có quyền",
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
      },
      metadata,
    );
    expect(presigned.upload.url).toBe(`/api/evidence/${presigned.evidence.id}/upload`);
    const ready = await uploadEvidenceObject(
      gm,
      presigned.evidence.id,
      evidenceUploadRequest(bytes, presigned.upload.headers),
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

  it("khi tạo lượt mới chỉ reject PENDING và không xóa metadata READY", async () => {
    const ready = await prisma.evidenceObject.create({
      data: {
        companyId,
        branchId: branchAId,
        violationId: oldViolationId,
        objectKey: `tests/${runId}/${randomUUID()}-ready.png`,
        originalFileName: "ready.png",
        mimeType: "image/png",
        sizeBytes: 8n,
        checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        status: "READY",
        createdByUserId: gm.userId,
        uploadedAt: new Date(),
        verifiedAt: new Date(),
      },
    });
    const pending = await prisma.evidenceObject.create({
      data: {
        companyId,
        branchId: branchAId,
        violationId: oldViolationId,
        objectKey: `tests/${runId}/${randomUUID()}-pending.png`,
        originalFileName: "pending.png",
        mimeType: "image/png",
        sizeBytes: 8n,
        checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        createdByUserId: gm.userId,
      },
    });

    const replacement = await presignEvidenceUpload(
      gm,
      {
        violationId: oldViolationId,
        originalFileName: "replacement.png",
        mimeType: "image/png",
        sizeBytes: 8,
        checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      },
      metadata,
    );

    await expect(
      prisma.evidenceObject.findUniqueOrThrow({ where: { id: ready.id } }),
    ).resolves.toMatchObject({ status: "READY", version: ready.version });
    await expect(
      prisma.evidenceObject.findUniqueOrThrow({ where: { id: pending.id } }),
    ).resolves.toMatchObject({
      status: "REJECTED",
      version: pending.version + 1,
      rejectionReason: "Được thay thế bởi yêu cầu tải evidence mới.",
    });
    await expect(
      prisma.evidenceObject.findUniqueOrThrow({ where: { id: replacement.evidence.id } }),
    ).resolves.toMatchObject({ status: "PENDING_UPLOAD" });
    await expect(
      prisma.auditLog.count({
        where: {
          companyId,
          entityType: "EvidenceObject",
          entityId: pending.id,
          action: "evidence.reject",
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({
        where: {
          companyId,
          entityType: "EvidenceObject",
          entityId: ready.id,
          action: "evidence.reject",
        },
      }),
    ).resolves.toBe(0);
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

  it("không cho manager khác branch upload vào evidence dù biết ID", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const presigned = await presignEvidenceUpload(
      gm,
      {
        violationId: oldViolationId,
        originalFileName: "cross-branch.png",
        mimeType: "image/png",
        sizeBytes: bytes.byteLength,
        checksumSha256: createHash("sha256").update(bytes).digest("base64"),
      },
      metadata,
    );

    await expect(
      uploadEvidenceObject(
        managerB,
        presigned.evidence.id,
        evidenceUploadRequest(bytes, presigned.upload.headers),
        metadata,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      prisma.evidenceObject.findUniqueOrThrow({ where: { id: presigned.evidence.id } }),
    ).resolves.toMatchObject({ status: "PENDING_UPLOAD", version: presigned.evidence.version });
  });

  it("reject metadata PENDING khi HEAD không tìm thấy object", async () => {
    const presigned = await presignEvidenceUpload(
      gm,
      {
        violationId: oldViolationId,
        originalFileName: "missing-object.png",
        mimeType: "image/png",
        sizeBytes: 8,
        checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      },
      metadata,
    );

    await expect(
      completeEvidenceUpload(
        gm,
        presigned.evidence.id,
        { version: presigned.evidence.version },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      prisma.evidenceObject.findUniqueOrThrow({ where: { id: presigned.evidence.id } }),
    ).resolves.toMatchObject({
      status: "REJECTED",
      version: presigned.evidence.version + 1,
      rejectionReason: "Object evidence không tồn tại hoặc metadata file không khớp yêu cầu.",
    });
  });

  it("không upload evidence mới sau khi violation đã bị hủy", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const presigned = await presignEvidenceUpload(
      gm,
      {
        violationId: oldViolationId,
        originalFileName: "cancelled-violation.png",
        mimeType: "image/png",
        sizeBytes: bytes.byteLength,
        checksumSha256: createHash("sha256").update(bytes).digest("base64"),
      },
      metadata,
    );
    const violation = await prisma.violation.findUniqueOrThrow({ where: { id: oldViolationId } });
    const cancelled = await cancelViolation(
      gm,
      violation.id,
      { version: violation.version },
      metadata,
    );
    expect(
      cancelled.evidence.find((evidence) => evidence.id === presigned.evidence.id),
    ).toMatchObject({
      status: "REJECTED",
      version: presigned.evidence.version + 1,
    });

    await expect(
      uploadEvidenceObject(
        gm,
        presigned.evidence.id,
        evidenceUploadRequest(bytes, presigned.upload.headers),
        metadata,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      prisma.evidenceObject.findUniqueOrThrow({ where: { id: presigned.evidence.id } }),
    ).resolves.toMatchObject({
      status: "REJECTED",
      version: presigned.evidence.version + 1,
      rejectionReason: "Vi phạm đã bị hủy trước khi evidence hoàn tất.",
    });

    const latePending = await prisma.evidenceObject.create({
      data: {
        companyId,
        branchId: branchAId,
        violationId: oldViolationId,
        objectKey: `tests/${runId}/${randomUUID()}-late.png`,
        originalFileName: "late.png",
        mimeType: "image/png",
        sizeBytes: BigInt(bytes.byteLength),
        checksumSha256: createHash("sha256").update(bytes).digest("base64"),
        createdByUserId: gm.userId,
      },
    });
    const idempotent = await cancelViolation(
      gm,
      violation.id,
      { version: cancelled.version },
      metadata,
    );
    expect(idempotent.evidence.find((evidence) => evidence.id === latePending.id)).toMatchObject({
      status: "REJECTED",
      version: latePending.version + 1,
    });
    await expect(
      presignEvidenceUpload(
        gm,
        {
          violationId: oldViolationId,
          originalFileName: "after-cancel.png",
          mimeType: "image/png",
          sizeBytes: bytes.byteLength,
          checksumSha256: createHash("sha256").update(bytes).digest("base64"),
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
