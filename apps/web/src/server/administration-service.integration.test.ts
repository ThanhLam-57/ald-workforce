import { randomUUID } from "node:crypto";

import {
  adminAssignmentListQuerySchema,
  adminBranchListQuerySchema,
  adminStaffListQuerySchema,
  adminUserListQuerySchema,
} from "@ald/contracts";
import { prisma } from "@ald/db";
import type { ActorContext } from "@ald/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  archiveStaff,
  createAssignment,
  createStaff,
  restoreStaff,
  transferAssignment,
  terminateStaff,
  updateAssignment,
  updateBranch,
  updateStaff,
  updateUserAccount,
} from "./services";
import {
  listAdminAssignments,
  listAdminBranches,
  listAdminStaff,
  listAdminUsers,
} from "./administration-service";

const runId = randomUUID().slice(0, 8);
const companyIds: string[] = [];
let gm: ActorContext;
let manager: ActorContext;
let branchAId: string;
let branchCId: string;
let memberId: string;
const metadata = {
  requestId: `administration-${runId}`,
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
} as const;

beforeAll(async () => {
  const [companyA, companyB] = await Promise.all([
    prisma.company.create({
      data: { name: `Admin A ${runId}`, slug: `admin-a-${runId}` },
    }),
    prisma.company.create({
      data: { name: `Admin B ${runId}`, slug: `admin-b-${runId}` },
    }),
  ]);
  companyIds.push(companyA.id, companyB.id);

  const [branchA, branchA2, branchC, branchB] = await Promise.all([
    prisma.branch.create({
      data: { companyId: companyA.id, code: "ADM-A", name: "Cơ sở Alpha" },
    }),
    prisma.branch.create({
      data: { companyId: companyA.id, code: "ADM-Z", name: "Cơ sở Zeta", isActive: false },
    }),
    prisma.branch.create({
      data: { companyId: companyA.id, code: "ADM-C", name: "Cơ sở Chuyển" },
    }),
    prisma.branch.create({
      data: { companyId: companyB.id, code: "OTHER", name: "Không được lộ" },
    }),
  ]);
  branchAId = branchA.id;
  branchCId = branchC.id;

  const [gmStaff, managerStaff, member, otherMember] = await Promise.all([
    prisma.staffMember.create({
      data: {
        companyId: companyA.id,
        staffCode: "GM-ADM",
        fullName: "GM Admin",
        jobTitle: "Tổng quản lý",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId: companyA.id,
        staffCode: "TM-ADM",
        fullName: "Manager Admin",
        jobTitle: "Quản lý đào tạo",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId: companyA.id,
        staffCode: "LIVE-ADM",
        fullName: "Nhân viên Admin",
        streamingAlias: "admin-live",
        jobTitle: "Live",
        baseSalaryAmount: 15_000_000n,
        employmentCategory: "PROBATION",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId: companyB.id,
        staffCode: "OTHER",
        fullName: "Nhân viên công ty khác",
        jobTitle: "Live",
        employmentCategory: "OFFICIAL",
      },
    }),
  ]);
  memberId = member.id;

  const [gmUser, managerUser] = await Promise.all([
    prisma.user.create({
      data: {
        companyId: companyA.id,
        staffId: gmStaff.id,
        name: "GM Admin",
        email: `gm-admin-${runId}@test.local`,
        username: `gm_admin_${runId}`,
        role: "GENERAL_MANAGER",
      },
    }),
    prisma.user.create({
      data: {
        companyId: companyA.id,
        staffId: managerStaff.id,
        name: "Manager Admin",
        email: `manager-admin-${runId}@test.local`,
        username: `manager_admin_${runId}`,
        role: "TRAINING_MANAGER",
      },
    }),
    prisma.user.create({
      data: {
        companyId: companyA.id,
        staffId: member.id,
        name: "Live Admin",
        email: `live-admin-${runId}@test.local`,
        username: `live_admin_${runId}`,
        role: "LIVE_EMPLOYEE",
      },
    }),
  ]);

  await Promise.all([
    prisma.branchAssignment.create({
      data: {
        companyId: companyA.id,
        branchId: branchA.id,
        staffId: managerStaff.id,
        assignmentType: "PRIMARY_MANAGER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
    prisma.branchAssignment.create({
      data: {
        companyId: companyA.id,
        branchId: branchA.id,
        staffId: member.id,
        assignmentType: "MEMBER",
        attendanceMachineCode: "MAY-A-01",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
    prisma.branchAssignment.create({
      data: {
        companyId: companyB.id,
        branchId: branchB.id,
        staffId: otherMember.id,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
  ]);

  await Promise.all([
    prisma.branchAssignment.create({
      data: {
        companyId: companyA.id,
        branchId: branchC.id,
        staffId: member.id,
        assignmentType: "MEMBER",
        attendanceMachineCode: "MAY-C-OLD",
        effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
    prisma.staffWorkSchedule.create({
      data: {
        companyId: companyA.id,
        branchId: branchC.id,
        staffId: member.id,
        name: "Ca cũ",
        scheduledStartMinutes: 8 * 60,
        scheduledEndMinutes: 14 * 60,
        requiredLiveMinutes: 5 * 60 + 30,
        effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-01-01T00:00:00.000Z"),
        createdByUserId: gmUser.id,
      },
    }),
    prisma.staffWorkSchedule.create({
      data: {
        companyId: companyA.id,
        branchId: branchA.id,
        staffId: member.id,
        name: "Ca hiện tại",
        scheduledStartMinutes: 9 * 60,
        scheduledEndMinutes: 15 * 60,
        requiredLiveMinutes: 6 * 60,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        createdByUserId: gmUser.id,
      },
    }),
    prisma.staffIdentityDocument.create({
      data: {
        companyId: companyA.id,
        branchId: branchA.id,
        staffId: member.id,
        side: "CITIZEN_ID_FRONT",
        objectKey: `tests/${runId}/identity/front-ready.webp`,
        originalFileName: "cccd-truoc.webp",
        mimeType: "image/webp",
        sizeBytes: 1024n,
        checksumSha256: "front-ready-checksum",
        status: "READY",
        uploadedAt: new Date("2026-01-02T00:00:00.000Z"),
        verifiedAt: new Date("2026-01-02T00:00:00.000Z"),
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        createdByUserId: gmUser.id,
      },
    }),
    prisma.staffIdentityDocument.create({
      data: {
        companyId: companyA.id,
        branchId: branchA.id,
        staffId: member.id,
        side: "CITIZEN_ID_FRONT",
        objectKey: `tests/${runId}/identity/front-pending.webp`,
        originalFileName: "cccd-truoc-moi.webp",
        mimeType: "image/webp",
        sizeBytes: 2048n,
        checksumSha256: "front-pending-checksum",
        status: "PENDING_UPLOAD",
        createdAt: new Date("2026-02-02T00:00:00.000Z"),
        createdByUserId: gmUser.id,
      },
    }),
    prisma.staffIdentityDocument.create({
      data: {
        companyId: companyA.id,
        branchId: branchA.id,
        staffId: member.id,
        side: "CITIZEN_ID_BACK",
        objectKey: `tests/${runId}/identity/back-rejected.png`,
        originalFileName: "cccd-sau.png",
        mimeType: "image/png",
        sizeBytes: 3072n,
        checksumSha256: "back-rejected-checksum",
        status: "REJECTED",
        rejectedAt: new Date("2026-02-03T00:00:00.000Z"),
        rejectionReason: "Fixture test",
        createdAt: new Date("2026-02-03T00:00:00.000Z"),
        createdByUserId: gmUser.id,
      },
    }),
    prisma.staffBankQrDocument.create({
      data: {
        companyId: companyA.id,
        branchId: branchA.id,
        staffId: member.id,
        objectKey: `tests/${runId}/bank/qr-ready.png`,
        originalFileName: "qr-ngan-hang.png",
        mimeType: "image/png",
        sizeBytes: 4096n,
        checksumSha256: "qr-ready-checksum",
        status: "READY",
        uploadedAt: new Date("2026-01-04T00:00:00.000Z"),
        verifiedAt: new Date("2026-01-04T00:00:00.000Z"),
        createdAt: new Date("2026-01-04T00:00:00.000Z"),
        createdByUserId: gmUser.id,
      },
    }),
    prisma.staffBankQrDocument.create({
      data: {
        companyId: companyA.id,
        branchId: branchA.id,
        staffId: member.id,
        objectKey: `tests/${runId}/bank/qr-pending.png`,
        originalFileName: "qr-ngan-hang-moi.png",
        mimeType: "image/png",
        sizeBytes: 5120n,
        checksumSha256: "qr-pending-checksum",
        status: "PENDING_UPLOAD",
        createdAt: new Date("2026-02-04T00:00:00.000Z"),
        createdByUserId: gmUser.id,
      },
    }),
  ]);

  gm = {
    userId: gmUser.id,
    companyId: companyA.id,
    staffId: gmStaff.id,
    role: "GENERAL_MANAGER",
    activeBranchIds: [],
  };
  manager = {
    userId: managerUser.id,
    companyId: companyA.id,
    staffId: managerStaff.id,
    role: "TRAINING_MANAGER",
    activeBranchIds: [branchA.id],
  };

  expect(branchA2.isActive).toBe(false);
});

afterAll(async () => {
  for (const companyId of companyIds) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ald.audit_cleanup = 'on'");
      await tx.$executeRawUnsafe(
        'ALTER TABLE "staff_employment_history" DISABLE TRIGGER "staff_employment_history_no_delete"',
      );
      await tx.auditLog.deleteMany({ where: { companyId } });
      await tx.staffBankQrDocument.deleteMany({ where: { companyId } });
      await tx.staffIdentityDocument.deleteMany({ where: { companyId } });
      await tx.staffWorkSchedule.deleteMany({ where: { companyId } });
      await tx.branchAssignment.deleteMany({ where: { companyId } });
      await tx.staffEmploymentHistory.deleteMany({ where: { companyId } });
      await tx.session.deleteMany({ where: { user: { companyId } } });
      await tx.account.deleteMany({ where: { user: { companyId } } });
      await tx.user.deleteMany({ where: { companyId } });
      await tx.levelHistory.deleteMany({ where: { companyId } });
      await tx.staffMember.deleteMany({ where: { companyId } });
      await tx.branch.deleteMany({ where: { companyId } });
      await tx.company.deleteMany({ where: { id: companyId } });
      await tx.$executeRawUnsafe(
        'ALTER TABLE "staff_employment_history" ENABLE TRIGGER "staff_employment_history_no_delete"',
      );
    });
  }
  await prisma.$disconnect();
});

describe("administration list projection", () => {
  const now = new Date("2026-07-24T03:00:00.000Z");

  it("scope theo company, phân trang và tổng hợp branch không N+1", async () => {
    const result = await listAdminBranches(
      gm,
      adminBranchListQuerySchema.parse({ pageSize: 1, search: "Alpha" }),
      now,
    );

    expect(result).toMatchObject({ page: 1, pageSize: 1, total: 1 });
    expect(result.items[0]).toMatchObject({
      id: branchAId,
      activeStaffCount: 1,
      activeManagerCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain("Không được lộ");

    const defaultBranches = await listAdminBranches(
      gm,
      adminBranchListQuerySchema.parse({ pageSize: 100 }),
      now,
    );
    const inactiveBranches = await listAdminBranches(
      gm,
      adminBranchListQuerySchema.parse({ status: "INACTIVE" }),
      now,
    );
    expect(defaultBranches.items.some(({ code }) => code === "ADM-Z")).toBe(false);
    expect(inactiveBranches.items.map(({ code }) => code)).toContain("ADM-Z");
  });

  it("lọc staff theo branch/account và trả DTO allow-list", async () => {
    const result = await listAdminStaff(
      gm,
      adminStaffListQuerySchema.parse({
        branchId: branchAId,
        account: "LINKED",
        search: "admin-live",
      }),
      now,
    );

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: memberId,
      baseSalaryAmount: "15000000",
      employmentCategory: "PROBATION",
      user: { active: true },
      currentSchedule: {
        name: "Ca hiện tại",
        scheduledStartMinutes: 540,
        scheduledEndMinutes: 900,
        requiredLiveMinutes: 360,
      },
      bankQrDocument: {
        originalFileName: "qr-ngan-hang.png",
        status: "READY",
        sizeBytes: "4096",
      },
    });
    const item = result.items[0]!;
    expect(item.currentAssignments).toEqual([
      expect.objectContaining({
        branchId: branchAId,
        attendanceMachineCode: "MAY-A-01",
      }),
    ]);
    expect(item.assignmentHistory).toEqual([
      expect.objectContaining({
        branchId: branchAId,
        attendanceMachineCode: "MAY-A-01",
        status: "CURRENT",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
      }),
      expect.objectContaining({
        branchId: branchCId,
        attendanceMachineCode: "MAY-C-OLD",
        status: "ENDED",
        effectiveFrom: "2025-01-01",
        effectiveTo: "2026-01-01",
      }),
    ]);
    expect(item.scheduleHistory.map(({ name }) => name)).toEqual(["Ca hiện tại", "Ca cũ"]);
    expect(item.identityDocuments).toEqual([
      expect.objectContaining({
        side: "CITIZEN_ID_FRONT",
        originalFileName: "cccd-truoc.webp",
        status: "READY",
        sizeBytes: "1024",
      }),
      expect.objectContaining({
        side: "CITIZEN_ID_BACK",
        originalFileName: "cccd-sau.png",
        status: "REJECTED",
        sizeBytes: "3072",
      }),
    ]);
    const serialized = JSON.stringify(item);
    expect(serialized).not.toMatch(
      /objectKey|checksumSha256|signedUrl|bucket|front-ready-checksum|qr-ready-checksum/i,
    );
  });

  it("liệt kê assignment và user mà không expose secret", async () => {
    const assignments = await listAdminAssignments(
      gm,
      adminAssignmentListQuerySchema.parse({ status: "CURRENT", branchId: branchAId }),
      now,
    );
    const users = await listAdminUsers(
      gm,
      adminUserListQuerySchema.parse({ search: "live_admin" }),
    );

    expect(assignments.total).toBe(2);
    expect(assignments.items.every((item) => item.status === "CURRENT")).toBe(true);
    expect(users.total).toBe(1);
    expect(JSON.stringify(users)).not.toMatch(/"(password|token|credential|session)"/i);
  });

  it("chặn manager ở service dù biết trực tiếp filter/id", async () => {
    await expect(
      listAdminBranches(manager, adminBranchListQuerySchema.parse({}), now),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      listAdminStaff(manager, adminStaffListQuerySchema.parse({ branchId: branchAId }), now),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      listAdminAssignments(manager, adminAssignmentListQuerySchema.parse({}), now),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listAdminUsers(manager, adminUserListQuerySchema.parse({}))).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
  });
});

describe("administration state transitions", () => {
  const now = new Date("2026-07-24T03:00:00.000Z");

  it("chặn deactivate branch còn phân công và audit deactivate/reactivate", async () => {
    await expect(
      updateBranch(gm, branchAId, { isActive: false, version: 1 }, metadata, now),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const inactive = await updateBranch(
      gm,
      branchCId,
      { isActive: false, version: 1 },
      metadata,
      now,
    );
    const active = await updateBranch(
      gm,
      branchCId,
      { isActive: true, version: inactive.version },
      metadata,
      now,
    );
    const actions = await prisma.auditLog.findMany({
      where: { entityId: branchCId },
      orderBy: { occurredAt: "asc" },
      select: { action: true },
    });

    expect(active.isActive).toBe(true);
    expect(actions.map(({ action }) => action)).toEqual(["branch.deactivate", "branch.reactivate"]);
  });

  it("ghi StaffEmploymentHistory theo ngày hiệu lực và archive mềm", async () => {
    const staff = await createStaff(
      gm,
      {
        staffCode: `HIS${runId}`,
        fullName: "Nhân viên lịch sử",
        tiktokChannelId: "kenh-lich-su",
        email: `history-${runId}@test.local`,
        citizenIdNumber: "001222222222",
        bankAccountNumber: "SECRET-HISTORY-ACCOUNT",
        bankName: "Ngân hàng lịch sử",
        permanentAddress: "Địa chỉ lịch sử",
        jobTitle: "Live",
        baseSalaryAmount: "12000000",
        joinedDate: "2026-07-01",
        employmentCategory: "PROBATION",
      },
      metadata,
    );
    const initialHistory = await prisma.staffEmploymentHistory.findFirstOrThrow({
      where: { staffId: staff.id },
      orderBy: { effectiveFrom: "asc" },
    });
    const transitionDate = new Date(initialHistory.effectiveFrom);
    transitionDate.setUTCDate(transitionDate.getUTCDate() + 1);
    const transitionBusinessDate = transitionDate.toISOString().slice(0, 10);
    await expect(
      updateStaff(
        gm,
        staff.id,
        {
          joinedDate: "2026-07-02",
          officialDate: "2026-07-01",
          version: staff.version,
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const updated = await updateStaff(
      gm,
      staff.id,
      {
        employmentCategory: "OFFICIAL",
        baseSalaryAmount: "18000000",
        officialDate: transitionBusinessDate,
        effectiveFrom: transitionBusinessDate,
        version: staff.version,
      },
      metadata,
      new Date(`${transitionBusinessDate}T03:00:00.000Z`),
    );
    const terminated = await terminateStaff(
      gm,
      staff.id,
      {
        terminationDate: transitionBusinessDate,
        version: updated.version,
      },
      metadata,
      new Date(`${transitionBusinessDate}T03:00:00.000Z`),
    );
    const archived = await archiveStaff(
      gm,
      staff.id,
      { version: terminated.version },
      metadata,
      new Date(`${transitionBusinessDate}T03:00:00.000Z`),
    );
    const histories = await prisma.staffEmploymentHistory.findMany({
      where: { staffId: staff.id },
      orderBy: { effectiveFrom: "asc" },
    });

    expect(histories).toHaveLength(2);
    expect(histories[0]?.effectiveTo?.toISOString().slice(0, 10)).toBe(transitionBusinessDate);
    expect(histories[1]).toMatchObject({
      employmentCategory: "OFFICIAL",
      employmentStatus: "TERMINATED",
    });
    expect(terminated.baseSalaryAmount).toBe("18000000");
    expect(terminated.joinedDate).toBe("2026-07-01");
    expect(terminated.officialDate).toBe(transitionBusinessDate);
    expect(terminated.terminationDate).toBe(transitionBusinessDate);
    await expect(
      prisma.staffMember.findUniqueOrThrow({
        where: { id: staff.id },
        select: { baseSalaryAmount: true, joinedDate: true, officialDate: true },
      }),
    ).resolves.toMatchObject({ baseSalaryAmount: 18_000_000n });
    expect(archived.archivedAt).toBeTruthy();
    const [createAudit, updateAudit] = await Promise.all([
      prisma.auditLog.findFirstOrThrow({
        where: { companyId: gm.companyId, entityId: staff.id, action: "staff.create" },
      }),
      prisma.auditLog.findFirstOrThrow({
        where: { companyId: gm.companyId, entityId: staff.id, action: "staff.status-change" },
      }),
    ]);
    expect(createAudit.after).toMatchObject({
      tiktokChannelId: "kenh-lich-su",
      email: `history-${runId}@test.local`,
      citizenIdNumber: { redacted: true, present: true },
      bankAccountNumber: { redacted: true, present: true },
      permanentAddress: "Địa chỉ lịch sử",
    });
    expect(updateAudit.before).toMatchObject({
      citizenIdNumber: { redacted: true, present: true },
      bankAccountNumber: { redacted: true, present: true },
      baseSalaryAmount: "12000000",
    });
    expect(updateAudit.after).toMatchObject({
      baseSalaryAmount: "18000000",
      changedFields: expect.arrayContaining([
        "employmentCategory",
        "baseSalaryAmount",
        "officialDate",
      ]),
    });
    const serializedAudit = JSON.stringify({ create: createAudit.after, update: updateAudit.after });
    expect(serializedAudit).not.toContain("001222222222");
    expect(serializedAudit).not.toContain("SECRET-HISTORY-ACCOUNT");
    expect(serializedAudit).not.toContain("objectKey");

    const defaultStaff = await listAdminStaff(
      gm,
      adminStaffListQuerySchema.parse({ search: `HIS${runId}` }),
      now,
    );
    const hiddenStaff = await listAdminStaff(
      gm,
      adminStaffListQuerySchema.parse({ search: `HIS${runId}`, showHidden: "true" }),
      now,
    );
    expect(defaultStaff.total).toBe(0);
    expect(hiddenStaff.items[0]).toMatchObject({
      employmentStatus: "TERMINATED",
      terminationDate: transitionBusinessDate,
    });
  });

  it("cho nghỉ việc đóng assignment vào tháng kế tiếp và thu hồi tài khoản", async () => {
    const staff = await createStaff(
      gm,
      {
        staffCode: `OFF${runId}`,
        fullName: "Nhân viên nghỉ việc",
        jobTitle: "Live",
        joinedDate: "2026-06-01",
        employmentCategory: "OFFICIAL",
        officialDate: "2026-06-01",
      },
      metadata,
    );
    const assignment = await prisma.branchAssignment.create({
      data: {
        companyId: gm.companyId,
        branchId: branchAId,
        staffId: staff.id,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
      },
    });
    const user = await prisma.user.create({
      data: {
        companyId: gm.companyId,
        staffId: staff.id,
        name: staff.fullName,
        email: `terminated-${runId}@test.local`,
        username: `terminated_${runId}`,
        role: "LIVE_EMPLOYEE",
      },
    });
    await prisma.session.create({
      data: {
        userId: user.id,
        token: `terminated-session-${runId}`,
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      },
    });

    const terminated = await terminateStaff(
      gm,
      staff.id,
      {
        terminationDate: "2026-07-15",
        version: staff.version,
      },
      metadata,
      now,
    );
    const [storedAssignment, storedUser, sessionCount, audit] = await Promise.all([
      prisma.branchAssignment.findUniqueOrThrow({ where: { id: assignment.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      prisma.session.count({ where: { userId: user.id } }),
      prisma.auditLog.findFirst({
        where: { entityId: staff.id, action: "staff.terminate" },
      }),
    ]);

    expect(terminated).toMatchObject({
      employmentStatus: "TERMINATED",
      terminationDate: "2026-07-15",
    });
    expect(storedAssignment.effectiveTo?.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(storedUser.active).toBe(false);
    expect(sessionCount).toBe(0);
    expect(audit?.reason).toBe("SYSTEM:STAFF_TERMINATED_FROM_UI");
  });

  it("hoàn tác nghỉ việc khôi phục lịch sử, phân công và trạng thái tài khoản một cách có audit", async () => {
    const staff = await createStaff(
      gm,
      {
        staffCode: `UNDO${runId}`,
        fullName: "Nhân viên hoàn tác nghỉ việc",
        jobTitle: "Live",
        joinedDate: "2026-06-01",
        employmentCategory: "OFFICIAL",
        officialDate: "2026-06-01",
      },
      metadata,
    );
    const initialHistory = await prisma.staffEmploymentHistory.findFirstOrThrow({
      where: { companyId: gm.companyId, staffId: staff.id },
    });
    await prisma.staffEmploymentHistory.update({
      where: { id: initialHistory.id },
      data: { effectiveTo: new Date("2026-09-01T00:00:00.000Z") },
    });
    const futureHistory = await prisma.staffEmploymentHistory.create({
      data: {
        companyId: gm.companyId,
        staffId: staff.id,
        employmentStatus: "ON_LEAVE",
        employmentCategory: "OFFICIAL",
        effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
        createdByUserId: gm.userId,
      },
    });
    const [currentAssignment, futureAssignment, user] = await Promise.all([
      prisma.branchAssignment.create({
        data: {
          companyId: gm.companyId,
          branchId: branchAId,
          staffId: staff.id,
          assignmentType: "MEMBER",
          attendanceMachineCode: `UNDO-${runId}`.toUpperCase(),
          effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
          effectiveTo: new Date("2026-09-01T00:00:00.000Z"),
        },
      }),
      prisma.branchAssignment.create({
        data: {
          companyId: gm.companyId,
          branchId: branchCId,
          staffId: staff.id,
          assignmentType: "MEMBER",
          attendanceMachineCode: `UNDO-F-${runId}`.toUpperCase(),
          effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
        },
      }),
      prisma.user.create({
        data: {
          companyId: gm.companyId,
          staffId: staff.id,
          name: staff.fullName,
          email: `undo-termination-${runId}@test.local`,
          username: `undo_termination_${runId}`,
          role: "LIVE_EMPLOYEE",
        },
      }),
    ]);
    await prisma.session.create({
      data: {
        userId: user.id,
        token: `undo-termination-session-${runId}`,
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      },
    });

    const now = new Date("2026-07-24T03:00:00.000Z");
    const terminated = await terminateStaff(
      gm,
      staff.id,
      { terminationDate: "2026-07-15", version: staff.version },
      metadata,
      now,
    );
    await expect(
      restoreStaff(
        manager,
        staff.id,
        { version: terminated.version, reason: "Không được phép hoàn tác." },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      restoreStaff(
        gm,
        staff.id,
        { version: terminated.version + 1, reason: "Kiểm tra optimistic lock." },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const reason = "Tổng quản lý đã bấm nhầm thao tác cho nghỉ việc.";
    const restored = await restoreStaff(
      gm,
      staff.id,
      { version: terminated.version, reason },
      metadata,
    );
    const [storedCurrentAssignment, storedFutureAssignment, storedUser, sessionCount, histories] =
      await Promise.all([
        prisma.branchAssignment.findUniqueOrThrow({ where: { id: currentAssignment.id } }),
        prisma.branchAssignment.findUniqueOrThrow({ where: { id: futureAssignment.id } }),
        prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
        prisma.session.count({ where: { userId: user.id } }),
        prisma.staffEmploymentHistory.findMany({
          where: { companyId: gm.companyId, staffId: staff.id },
          orderBy: { effectiveFrom: "asc" },
        }),
      ]);

    expect(restored).toMatchObject({
      employmentStatus: "ACTIVE",
      terminationDate: null,
      version: terminated.version + 1,
    });
    expect(storedCurrentAssignment).toMatchObject({
      effectiveTo: new Date("2026-09-01T00:00:00.000Z"),
      version: currentAssignment.version + 2,
    });
    expect(storedFutureAssignment).toMatchObject({
      archivedAt: null,
      version: futureAssignment.version + 2,
    });
    expect(storedUser).toMatchObject({ active: true, version: user.version + 2 });
    expect(sessionCount).toBe(0);
    expect(histories.map(({ employmentStatus }) => employmentStatus)).toEqual([
      "ACTIVE",
      "ACTIVE",
      "ON_LEAVE",
    ]);
    expect(histories[0]?.effectiveTo).toEqual(new Date("2026-07-15T00:00:00.000Z"));
    expect(histories[1]?.effectiveFrom).toEqual(new Date("2026-07-15T00:00:00.000Z"));
    expect(histories[1]?.effectiveTo).toEqual(new Date("2026-09-01T00:00:00.000Z"));
    expect(histories[2]).toMatchObject({
      id: futureHistory.id,
      effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
    });

    const [terminationAudit, restoreAudit] = await Promise.all([
      prisma.auditLog.findFirstOrThrow({
        where: { companyId: gm.companyId, entityId: staff.id, action: "staff.terminate" },
        orderBy: { occurredAt: "desc" },
      }),
      prisma.auditLog.findFirstOrThrow({
        where: {
          companyId: gm.companyId,
          entityId: staff.id,
          action: "staff.termination.restore",
        },
        orderBy: { occurredAt: "desc" },
      }),
    ]);
    expect(terminationAudit.before).toMatchObject({
      terminationRecovery: {
        schemaVersion: 1,
        previousEmploymentStatus: "ACTIVE",
        endedAssignments: [expect.objectContaining({ id: currentAssignment.id })],
        archivedFutureAssignments: [expect.objectContaining({ id: futureAssignment.id })],
        linkedUser: expect.objectContaining({ id: user.id, active: true }),
      },
    });
    expect(restoreAudit).toMatchObject({ reason });
    expect(restoreAudit.after).toMatchObject({
      recoveryMetadataAvailable: true,
      restoredAssignments: 1,
      restoredFutureAssignments: 1,
      restoredUserId: user.id,
      sessionsRestored: false,
    });
    await expect(
      restoreStaff(
        gm,
        staff.id,
        { version: restored.version, reason: "Không thể hoàn tác hai lần." },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("từ chối dữ liệu nghỉ việc cũ thiếu recovery snapshot mà không thay đổi side effect", async () => {
    const staff = await createStaff(
      gm,
      {
        staffCode: `LEGUNDO${runId}`,
        fullName: "Nhân viên hoàn tác dữ liệu cũ",
        jobTitle: "Live",
        joinedDate: "2026-06-01",
        employmentCategory: "OFFICIAL",
        officialDate: "2026-06-01",
      },
      metadata,
    );
    const initialHistory = await prisma.staffEmploymentHistory.findFirstOrThrow({
      where: { companyId: gm.companyId, staffId: staff.id },
    });
    const [currentAssignment, futureAssignment, user] = await Promise.all([
      prisma.branchAssignment.create({
        data: {
          companyId: gm.companyId,
          branchId: branchAId,
          staffId: staff.id,
          assignmentType: "MEMBER",
          attendanceMachineCode: `LEGUNDO-${runId}`.toUpperCase(),
          effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
          effectiveTo: new Date("2026-09-01T00:00:00.000Z"),
        },
      }),
      prisma.branchAssignment.create({
        data: {
          companyId: gm.companyId,
          branchId: branchCId,
          staffId: staff.id,
          assignmentType: "MEMBER",
          attendanceMachineCode: `LEGUNDO-F-${runId}`.toUpperCase(),
          effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
        },
      }),
      prisma.user.create({
        data: {
          companyId: gm.companyId,
          staffId: staff.id,
          name: staff.fullName,
          email: `legacy-undo-${runId}@test.local`,
          username: `legacy_undo_${runId}`,
          role: "LIVE_EMPLOYEE",
        },
      }),
    ]);
    const terminated = await prisma.staffMember.update({
      where: { id: staff.id },
      data: {
        employmentStatus: "TERMINATED",
        terminationDate: new Date("2026-07-15T00:00:00.000Z"),
        version: { increment: 1 },
      },
    });
    await Promise.all([
      prisma.staffEmploymentHistory.update({
        where: { id: initialHistory.id },
        data: {
          effectiveTo: new Date("2026-07-15T00:00:00.000Z"),
          version: { increment: 1 },
        },
      }),
      prisma.staffEmploymentHistory.create({
        data: {
          companyId: gm.companyId,
          staffId: staff.id,
          employmentStatus: "TERMINATED",
          employmentCategory: "OFFICIAL",
          effectiveFrom: new Date("2026-07-15T00:00:00.000Z"),
          createdByUserId: gm.userId,
        },
      }),
      prisma.branchAssignment.update({
        where: { id: currentAssignment.id },
        data: {
          effectiveTo: new Date("2026-08-01T00:00:00.000Z"),
          version: { increment: 1 },
        },
      }),
      prisma.branchAssignment.update({
        where: { id: futureAssignment.id },
        data: { archivedAt: new Date("2026-07-24T03:00:00.000Z"), version: { increment: 1 } },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { active: false, version: { increment: 1 } },
      }),
    ]);
    const legacyAudit = await prisma.auditLog.create({
      data: {
        companyId: gm.companyId,
        branchId: branchAId,
        actorUserId: gm.userId,
        action: "staff.terminate",
        entityType: "StaffMember",
        entityId: staff.id,
        reason: "SYSTEM:STAFF_TERMINATED_FROM_UI",
        before: { employmentStatus: "ACTIVE" },
        after: {
          employmentStatus: "TERMINATED",
          terminationDate: "2026-07-15",
          assignmentCutoff: "2026-08-01",
          endedAssignments: 1,
          cancelledFutureAssignments: 1,
          disabledUserId: user.id,
          sessionsRevoked: true,
        },
        requestId: metadata.requestId,
      },
    });

    await expect(
      restoreStaff(
        gm,
        staff.id,
        {
          version: terminated.version,
          reason: "Khôi phục thao tác nghỉ việc được ghi trước khi có recovery snapshot.",
        },
        metadata,
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("bản chụp khôi phục đầy đủ"),
    });
    await prisma.auditLog.create({
      data: {
        companyId: gm.companyId,
        branchId: branchAId,
        actorUserId: gm.userId,
        action: "staff.terminate",
        entityType: "StaffMember",
        entityId: staff.id,
        reason: "SYSTEM:STAFF_TERMINATED_FROM_UI",
        before: {
          employmentStatus: "ACTIVE",
          terminationRecovery: { schemaVersion: 1, terminationDate: "không-hợp-lệ" },
        },
        after: {
          employmentStatus: "TERMINATED",
          terminationDate: "2026-07-15",
          assignmentCutoff: "2026-08-01",
          endedAssignments: 1,
          cancelledFutureAssignments: 1,
          disabledUserId: user.id,
          sessionsRevoked: true,
        },
        requestId: metadata.requestId,
        occurredAt: new Date(legacyAudit.occurredAt.getTime() + 1_000),
      },
    });
    await expect(
      restoreStaff(
        gm,
        staff.id,
        {
          version: terminated.version,
          reason: "Không được hoàn tác từ recovery snapshot bị lỗi.",
        },
        metadata,
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("bản chụp khôi phục đầy đủ"),
    });
    const [unchangedStaff, unchangedCurrentAssignment, unchangedFutureAssignment, unchangedUser] =
      await Promise.all([
        prisma.staffMember.findUniqueOrThrow({ where: { id: staff.id } }),
        prisma.branchAssignment.findUniqueOrThrow({ where: { id: currentAssignment.id } }),
        prisma.branchAssignment.findUniqueOrThrow({ where: { id: futureAssignment.id } }),
        prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      ]);
    const [histories, restoreAuditCount] = await Promise.all([
      prisma.staffEmploymentHistory.findMany({
        where: { companyId: gm.companyId, staffId: staff.id },
        orderBy: { effectiveFrom: "asc" },
      }),
      prisma.auditLog.count({
        where: {
          companyId: gm.companyId,
          entityId: staff.id,
          action: "staff.termination.restore",
        },
      }),
    ]);

    expect(unchangedStaff).toMatchObject({
      employmentStatus: "TERMINATED",
      terminationDate: new Date("2026-07-15T00:00:00.000Z"),
      version: terminated.version,
    });
    expect(unchangedCurrentAssignment).toMatchObject({
      effectiveTo: new Date("2026-08-01T00:00:00.000Z"),
      version: currentAssignment.version + 1,
    });
    expect(unchangedFutureAssignment).toMatchObject({
      archivedAt: new Date("2026-07-24T03:00:00.000Z"),
      version: futureAssignment.version + 1,
    });
    expect(unchangedUser).toMatchObject({ active: false, version: user.version + 1 });
    expect(histories.map(({ employmentStatus }) => employmentStatus)).toEqual([
      "ACTIVE",
      "TERMINATED",
    ]);
    expect(histories.map(({ effectiveFrom }) => effectiveFrom)).toEqual([
      new Date("2026-06-01T00:00:00.000Z"),
      new Date("2026-07-15T00:00:00.000Z"),
    ]);
    expect(histories[0]?.effectiveTo).toEqual(new Date("2026-07-15T00:00:00.000Z"));
    expect(histories[1]?.effectiveTo).toBeNull();
    expect(restoreAuditCount).toBe(0);
  });

  it("từ chối hoàn tác khi ngày nghỉ hiện tại không khớp recovery snapshot", async () => {
    const staff = await createStaff(
      gm,
      {
        staffCode: `MISUNDO${runId}`,
        fullName: "Nhân viên sai ngày hoàn tác",
        jobTitle: "Live",
        joinedDate: "2026-06-01",
        employmentCategory: "OFFICIAL",
        officialDate: "2026-06-01",
      },
      metadata,
    );
    const now = new Date("2026-07-24T03:00:00.000Z");
    const terminated = await terminateStaff(
      gm,
      staff.id,
      { terminationDate: "2026-07-15", version: staff.version },
      metadata,
      now,
    );
    const changed = await prisma.staffMember.update({
      where: { id: staff.id },
      data: { terminationDate: new Date("2026-07-16T00:00:00.000Z") },
    });
    const historiesBefore = await prisma.staffEmploymentHistory.findMany({
      where: { companyId: gm.companyId, staffId: staff.id },
      orderBy: { effectiveFrom: "asc" },
      select: {
        id: true,
        employmentStatus: true,
        effectiveFrom: true,
        effectiveTo: true,
        version: true,
      },
    });

    await expect(
      restoreStaff(
        gm,
        staff.id,
        { version: terminated.version, reason: "Kiểm tra ngày nghỉ không khớp." },
        metadata,
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("Ngày nghỉ việc đã thay đổi"),
    });

    const [staffAfter, historiesAfter, restoreAuditCount] = await Promise.all([
      prisma.staffMember.findUniqueOrThrow({ where: { id: staff.id } }),
      prisma.staffEmploymentHistory.findMany({
        where: { companyId: gm.companyId, staffId: staff.id },
        orderBy: { effectiveFrom: "asc" },
        select: {
          id: true,
          employmentStatus: true,
          effectiveFrom: true,
          effectiveTo: true,
          version: true,
        },
      }),
      prisma.auditLog.count({
        where: {
          companyId: gm.companyId,
          entityId: staff.id,
          action: "staff.termination.restore",
        },
      }),
    ]);
    expect(staffAfter).toMatchObject({
      employmentStatus: "TERMINATED",
      terminationDate: changed.terminationDate,
      version: changed.version,
    });
    expect(historiesAfter).toEqual(historiesBefore);
    expect(restoreAuditCount).toBe(0);
  });

  it("chặn assignment vào branch inactive hoặc staff terminated", async () => {
    const inactiveBranch = await prisma.branch.findFirstOrThrow({
      where: { companyId: gm.companyId, code: "ADM-Z" },
    });
    const terminatedStaff = await prisma.staffMember.create({
      data: {
        companyId: gm.companyId,
        staffCode: `TERM${runId}`,
        fullName: "Đã nghỉ",
        jobTitle: "Live",
        employmentCategory: "OFFICIAL",
        employmentStatus: "TERMINATED",
      },
    });
    await expect(
      createAssignment(
        gm,
        {
          staffId: memberId,
          branchId: inactiveBranch.id,
          assignmentType: "SECONDARY_MANAGER",
          effectiveFrom: "2026-08-01",
          effectiveTo: null,
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      createAssignment(
        gm,
        {
          staffId: terminatedStaff.id,
          branchId: branchCId,
          assignmentType: "MEMBER",
          attendanceMachineCode: "TERMINATED-001",
          effectiveFrom: "2026-08-01",
          effectiveTo: null,
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("hiện phân công đã ẩn và cho GM kích hoạt lại bằng ngày kết thúc mới", async () => {
    const staff = await prisma.staffMember.create({
      data: {
        companyId: gm.companyId,
        staffCode: `REACT${runId}`,
        fullName: "Quản lý cần gia hạn",
        jobTitle: "Quản lý đào tạo",
        employmentCategory: "OFFICIAL",
      },
    });
    const ended = await prisma.branchAssignment.create({
      data: {
        companyId: gm.companyId,
        branchId: branchCId,
        staffId: staff.id,
        assignmentType: "PRIMARY_MANAGER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-07-01T00:00:00.000Z"),
      },
    });

    const defaultList = await listAdminAssignments(
      gm,
      adminAssignmentListQuerySchema.parse({ staffId: staff.id }),
      now,
    );
    const hiddenList = await listAdminAssignments(
      gm,
      adminAssignmentListQuerySchema.parse({ staffId: staff.id, showHidden: "true" }),
      now,
    );

    expect(defaultList.total).toBe(0);
    expect(hiddenList.items).toEqual([
      expect.objectContaining({ id: ended.id, status: "ENDED", effectiveTo: "2026-07-01" }),
    ]);

    const reactivated = await updateAssignment(
      gm,
      ended.id,
      { effectiveTo: "2026-09-01", version: ended.version },
      metadata,
      now,
    );
    const currentList = await listAdminAssignments(
      gm,
      adminAssignmentListQuerySchema.parse({
        staffId: staff.id,
        assignmentType: "PRIMARY_MANAGER",
        status: "CURRENT",
      }),
      now,
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: ended.id, action: "assignment.reactivate" },
    });

    expect(reactivated.effectiveTo?.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(reactivated.version).toBe(ended.version + 1);
    expect(currentList.items).toEqual([
      expect.objectContaining({ id: ended.id, status: "CURRENT", effectiveTo: "2026-09-01" }),
    ]);
    expect(audit.reason).toBe("SYSTEM:ASSIGNMENT_REACTIVATED_FROM_UI");
    await expect(
      updateAssignment(
        manager,
        ended.id,
        { effectiveTo: null, version: reactivated.version },
        metadata,
        now,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("chặn kích hoạt lại khi khoảng mới trùng phân công quản lý kế tiếp", async () => {
    const staff = await prisma.staffMember.create({
      data: {
        companyId: gm.companyId,
        staffCode: `OVER${runId}`,
        fullName: "Quản lý có lịch kế tiếp",
        jobTitle: "Quản lý đào tạo",
        employmentCategory: "OFFICIAL",
      },
    });
    const ended = await prisma.branchAssignment.create({
      data: {
        companyId: gm.companyId,
        branchId: branchAId,
        staffId: staff.id,
        assignmentType: "PRIMARY_MANAGER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-07-01T00:00:00.000Z"),
      },
    });
    await prisma.branchAssignment.create({
      data: {
        companyId: gm.companyId,
        branchId: branchCId,
        staffId: staff.id,
        assignmentType: "PRIMARY_MANAGER",
        effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      },
    });

    await expect(
      updateAssignment(gm, ended.id, { effectiveTo: null, version: ended.version }, metadata, now),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      prisma.branchAssignment.findUniqueOrThrow({ where: { id: ended.id } }),
    ).resolves.toMatchObject({
      version: ended.version,
      effectiveTo: new Date("2026-07-01T00:00:00.000Z"),
    });
  });

  it("transfer đóng khoảng cũ, tạo khoảng mới và audit cả hai record", async () => {
    const staff = await prisma.staffMember.create({
      data: {
        companyId: gm.companyId,
        staffCode: `MOVE${runId}`,
        fullName: "Nhân viên chuyển cơ sở",
        jobTitle: "Live",
        employmentCategory: "OFFICIAL",
      },
    });
    const original = await prisma.branchAssignment.create({
      data: {
        companyId: gm.companyId,
        branchId: branchAId,
        staffId: staff.id,
        assignmentType: "MEMBER",
        attendanceMachineCode: "MOVE-A-001",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    const transferred = await transferAssignment(
      gm,
      original.id,
      {
        targetBranchId: branchCId,
        attendanceMachineCode: "MOVE-C-001",
        effectiveFrom: "2026-08-01",
        version: original.version,
      },
      metadata,
    );
    const previous = await prisma.branchAssignment.findUniqueOrThrow({
      where: { id: original.id },
    });
    const auditActions = await prisma.auditLog.findMany({
      where: {
        entityId: { in: [original.id, transferred.assignment.id] },
      },
      orderBy: { occurredAt: "asc" },
      select: { action: true, before: true, after: true },
    });

    expect(previous.effectiveTo?.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(previous.attendanceMachineCode).toBe("MOVE-A-001");
    expect(transferred.assignment).toMatchObject({
      branchId: branchCId,
      staffId: staff.id,
      attendanceMachineCode: "MOVE-C-001",
    });
    const replacementStaff = await prisma.staffMember.create({
      data: {
        companyId: gm.companyId,
        staffCode: `REUSE${runId}`,
        fullName: "Nhân viên dùng lại mã máy",
        jobTitle: "Live",
        employmentCategory: "OFFICIAL",
      },
    });
    const reused = await prisma.branchAssignment.create({
      data: {
        companyId: gm.companyId,
        branchId: branchAId,
        staffId: replacementStaff.id,
        assignmentType: "MEMBER",
        attendanceMachineCode: "MOVE-A-001",
        effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      },
    });
    expect(reused.attendanceMachineCode).toBe("MOVE-A-001");
    expect(auditActions.map(({ action }) => action)).toEqual([
      "assignment.transfer",
      "assignment.transfer.target",
    ]);
    expect(auditActions[0]).toMatchObject({
      before: {
        assignmentId: original.id,
        branchId: branchAId,
        staffId: staff.id,
        attendanceMachineCode: "MOVE-A-001",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
      },
      after: {
        assignmentId: original.id,
        branchId: branchAId,
        staffId: staff.id,
        attendanceMachineCode: "MOVE-A-001",
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-08-01",
      },
    });
    expect(auditActions[1]).toMatchObject({
      after: {
        assignmentId: transferred.assignment.id,
        branchId: branchCId,
        staffId: staff.id,
        attendanceMachineCode: "MOVE-C-001",
        effectiveFrom: "2026-08-01",
        effectiveTo: null,
      },
    });
  });

  it("chặn GM cuối cùng và thu hồi session khi vô hiệu hóa user", async () => {
    const gmRecord = await prisma.user.findUniqueOrThrow({ where: { id: gm.userId } });
    const alternateActor = { ...gm, userId: manager.userId };
    await expect(
      updateUserAccount(
        alternateActor,
        gm.userId,
        {
          active: false,
          version: gmRecord.version,
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await prisma.user.create({
      data: {
        companyId: gm.companyId,
        name: "GM dự phòng",
        email: `backup-gm-${runId}@test.local`,
        username: `backup_gm_${runId}`,
        role: "GENERAL_MANAGER",
      },
    });
    const target = await prisma.user.create({
      data: {
        companyId: gm.companyId,
        name: "Tài khoản vô hiệu",
        email: `disable-${runId}@test.local`,
        username: `disable_${runId}`,
        role: "LIVE_EMPLOYEE",
      },
    });
    await prisma.session.create({
      data: {
        userId: target.id,
        token: `session-${runId}`,
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      },
    });
    const updated = await updateUserAccount(
      gm,
      target.id,
      {
        active: false,
        version: target.version,
      },
      metadata,
    );

    expect(updated.active).toBe(false);
    expect(await prisma.session.count({ where: { userId: target.id } })).toBe(0);
    await expect(
      updateUserAccount(
        gm,
        target.id,
        {
          active: true,
          version: target.version,
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
