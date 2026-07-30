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
  transferAssignment,
  terminateStaff,
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
