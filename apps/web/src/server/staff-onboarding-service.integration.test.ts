import { randomUUID } from "node:crypto";

import { prisma } from "@ald/db";
import type { ActorContext } from "@ald/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { viewStaffIdentityDocument } from "./staff-identity-document-service";
import {
  createStaffWorkSchedule,
  listBranchStaff,
  listStaffWorkSchedules,
  onboardStaff,
  updateStaffProfile,
  updateStaffWorkSchedule,
} from "./staff-onboarding-service";

const runId = randomUUID().slice(0, 8);
const metadata = {
  requestId: `staff-onboarding-${runId}`,
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
} as const;

let companyId: string;
let branchAId: string;
let branchBId: string;
let manager: ActorContext;
let gm: ActorContext;
let staffAId: string;
let staffBId: string;

beforeAll(async () => {
  const company = await prisma.company.create({
    data: {
      name: `Staff onboarding ${runId}`,
      slug: `staff-onboarding-${runId}`,
    },
  });
  companyId = company.id;
  const [branchA, branchB] = await Promise.all([
    prisma.branch.create({
      data: { companyId, code: `A${runId}`, name: "Cơ sở A" },
    }),
    prisma.branch.create({
      data: { companyId, code: `B${runId}`, name: "Cơ sở B" },
    }),
  ]);
  branchAId = branchA.id;
  branchBId = branchB.id;
  const [gmStaff, managerStaff] = await Promise.all([
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `GM${runId}`,
        fullName: "Tổng quản lý",
        jobTitle: "Tổng quản lý",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `TM${runId}`,
        fullName: "Quản lý A",
        jobTitle: "Quản lý đào tạo",
        employmentCategory: "OFFICIAL",
      },
    }),
  ]);
  const [gmUser, managerUser] = await Promise.all([
    prisma.user.create({
      data: {
        companyId,
        staffId: gmStaff.id,
        name: "Tổng quản lý",
        email: `staff-onboarding-gm-${runId}@test.local`,
        username: `staff_onboarding_gm_${runId}`,
        role: "GENERAL_MANAGER",
      },
    }),
    prisma.user.create({
      data: {
        companyId,
        staffId: managerStaff.id,
        name: "Quản lý A",
        email: `staff-onboarding-manager-${runId}@test.local`,
        username: `staff_onboarding_manager_${runId}`,
        role: "TRAINING_MANAGER",
      },
    }),
  ]);
  await prisma.branchAssignment.create({
    data: {
      companyId,
      branchId: branchAId,
      staffId: managerStaff.id,
      assignmentType: "PRIMARY_MANAGER",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
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
    await tx.$executeRawUnsafe(
      'ALTER TABLE "staff_employment_history" DISABLE TRIGGER "staff_employment_history_no_delete"',
    );
    await tx.staffIdentityDocument.deleteMany({ where: { companyId } });
    await tx.staffBankQrDocument.deleteMany({ where: { companyId } });
    await tx.staffWorkSchedule.deleteMany({ where: { companyId } });
    await tx.staffEmploymentHistory.deleteMany({ where: { companyId } });
    await tx.$executeRawUnsafe("SET LOCAL ald.audit_cleanup = 'on'");
    await tx.auditLog.deleteMany({ where: { companyId } });
    await tx.branchAssignment.deleteMany({ where: { companyId } });
    await tx.user.deleteMany({ where: { companyId } });
    await tx.staffMember.deleteMany({ where: { companyId } });
    await tx.branch.deleteMany({ where: { companyId } });
    await tx.company.deleteMany({ where: { id: companyId } });
    await tx.$executeRawUnsafe(
      'ALTER TABLE "staff_employment_history" ENABLE TRIGGER "staff_employment_history_no_delete"',
    );
  });
});

describe("phân quyền thêm nhân viên, ca làm và CCCD", () => {
  it("manager thêm nhân viên Live đúng cơ sở mà không được nhập lương hoặc tạo tài khoản", async () => {
    const created = await onboardStaff(
      manager,
      {
        branchId: branchAId,
        attendanceMachineCode: "001",
        staffCode: `LIVEA${runId}`,
        fullName: "Nhân viên Live A",
        streamingAlias: "live-a",
        email: `live-a-${runId}@test.local`,
        phone: "0900000000",
        citizenIdNumber: "001111111111",
        bankAccountNumber: "SECRET-ACCOUNT-001",
        bankName: "Ngân hàng A",
        jobTitle: "Nhân viên Live",
        joinedDate: "2026-07-01",
        officialDate: null,
        employmentCategory: "PROBATION",
        initialSchedule: {
          name: "Ca sáng",
          scheduledStartMinutes: 540,
          scheduledEndMinutes: 900,
          spansNextDay: false,
          requiredLiveMinutes: 360,
        },
      },
      metadata,
    );
    staffAId = created.id;
    expect(created.branch.id).toBe(branchAId);
    expect(created.currentSchedule).toMatchObject({
      scheduledStartMinutes: 540,
      requiredLiveMinutes: 360,
    });
    expect(created.attendanceMachineCode).toBe("001");
    expect(created).not.toHaveProperty("baseSalaryAmount");
    expect(created).not.toHaveProperty("user");
    const stored = await prisma.staffMember.findUniqueOrThrow({
      where: { id: created.id },
      select: { baseSalaryAmount: true, user: true },
    });
    expect(stored.baseSalaryAmount).toBe(0n);
    expect(stored.user).toBeNull();
    expect((await listBranchStaff(gm)).find(({ id }) => id === created.id)).toHaveProperty(
      "baseSalaryAmount",
      "0",
    );
    const [employmentHistoryCount, assignmentCount, scheduleCount] = await Promise.all([
      prisma.staffEmploymentHistory.count({ where: { staffId: created.id } }),
      prisma.branchAssignment.count({
        where: {
          staffId: created.id,
          branchId: branchAId,
          assignmentType: "MEMBER",
        },
      }),
      prisma.staffWorkSchedule.count({ where: { staffId: created.id } }),
    ]);
    expect({ employmentHistoryCount, assignmentCount, scheduleCount }).toEqual({
      employmentHistoryCount: 1,
      assignmentCount: 1,
      scheduleCount: 1,
    });
    const onboardAudit = await prisma.auditLog.findFirstOrThrow({
      where: { companyId, entityId: created.id, action: "staff.onboard" },
      orderBy: { occurredAt: "desc" },
    });
    const onboardAfter = onboardAudit.after as Record<string, unknown>;
    expect(onboardAfter).toMatchObject({
      staffCode: `LIVEA${runId}`.toUpperCase(),
      citizenIdNumber: { redacted: true, present: true },
      bankAccountNumber: { redacted: true, present: true },
      assignment: {
        branchId: branchAId,
        attendanceMachineCode: "001",
        effectiveFrom: "2026-07-01",
        effectiveTo: null,
      },
    });
    expect(JSON.stringify(onboardAfter)).not.toContain("001111111111");
    expect(JSON.stringify(onboardAfter)).not.toContain("SECRET-ACCOUNT-001");
    expect(JSON.stringify(onboardAfter)).not.toContain("objectKey");
  });

  it("không cho manager lách UI để nhập lương cơ bản khi onboard", async () => {
    await expect(
      onboardStaff(
        manager,
        {
          branchId: branchAId,
          attendanceMachineCode: "SALARY-BLOCKED",
          staffCode: `SALARYBLOCK${runId}`,
          fullName: "Nhân viên bị chặn lương",
          jobTitle: "Nhân viên Live",
          joinedDate: "2026-07-01",
          officialDate: null,
          employmentCategory: "PROBATION",
          baseSalaryAmount: "9000000",
          initialSchedule: {
            name: "Ca sáng",
            scheduledStartMinutes: 540,
            scheduledEndMinutes: 900,
            spansNextDay: false,
            requiredLiveMinutes: 360,
          },
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("không cho trùng mã máy chấm công trong cùng cơ sở và khoảng hiệu lực", async () => {
    await expect(
      onboardStaff(
        manager,
        {
          branchId: branchAId,
          attendanceMachineCode: "001",
          staffCode: `DUP${runId}`,
          fullName: "Nhân viên trùng mã máy",
          streamingAlias: null,
          jobTitle: "Nhân viên Live",
          joinedDate: "2026-07-02",
          officialDate: null,
          employmentCategory: "PROBATION",
          initialSchedule: {
            name: "Ca sáng",
            scheduledStartMinutes: 540,
            scheduledEndMinutes: 900,
            spansNextDay: false,
            requiredLiveMinutes: 360,
          },
        },
        metadata,
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: {
        fieldErrors: {
          attendanceMachineCode: [
            "Mã máy chấm công đã được dùng trong cơ sở ở khoảng thời gian này.",
          ],
        },
      },
    });
  });

  it("manager sửa hồ sơ và mã máy trong đúng cơ sở bằng optimistic lock", async () => {
    const before = (await listBranchStaff(manager)).find(({ id }) => id === staffAId);
    expect(before).toBeDefined();
    const updated = await updateStaffProfile(
      manager,
      staffAId,
      {
        tiktokChannelId: "@KenhMoi",
        citizenIdNumber: "001234567890",
        bankName: "Ngân hàng thử nghiệm",
        bankAccountNumber: "ABC-12345",
        attendanceMachineCode: "A_002",
        assignmentId: before!.assignmentId,
        assignmentVersion: before!.assignmentVersion,
        version: before!.version,
      },
      metadata,
      new Date("2026-07-10T03:00:00.000Z"),
    );
    expect(updated).toMatchObject({
      tiktokChannelId: "kenhmoi",
      citizenIdNumber: "001234567890",
      attendanceMachineCode: "A_002",
    });
    expect(updated).not.toHaveProperty("baseSalaryAmount");
    expect(updated.assignmentId).not.toBe(before!.assignmentId);
    expect(
      await prisma.branchAssignment.findMany({
        where: {
          companyId,
          staffId: staffAId,
          branchId: branchAId,
          assignmentType: "MEMBER",
        },
        orderBy: { effectiveFrom: "asc" },
        select: {
          id: true,
          attendanceMachineCode: true,
          effectiveFrom: true,
          effectiveTo: true,
        },
      }),
    ).toMatchObject([
      {
        id: before!.assignmentId,
        attendanceMachineCode: "001",
        effectiveTo: new Date("2026-07-10T00:00:00.000Z"),
      },
      {
        id: updated.assignmentId,
        attendanceMachineCode: "A_002",
        effectiveFrom: new Date("2026-07-10T00:00:00.000Z"),
      },
    ]);
    const profileAudit = await prisma.auditLog.findFirstOrThrow({
      where: { companyId, entityId: staffAId, action: "staff.profile.update" },
      orderBy: { occurredAt: "desc" },
    });
    const profileBefore = profileAudit.before as Record<string, unknown>;
    const profileAfter = profileAudit.after as Record<string, unknown>;
    expect(profileBefore).toMatchObject({
      citizenIdNumber: { redacted: true, present: true },
      assignment: {
        assignmentId: before!.assignmentId,
        attendanceMachineCode: "001",
        effectiveFrom: "2026-07-01",
        effectiveTo: null,
      },
    });
    expect(profileAfter).toMatchObject({
      citizenIdNumber: { redacted: true, present: true },
      changedFields: expect.arrayContaining([
        "citizenIdNumber",
        "attendanceMachineCode",
        "bankAccountNumber",
      ]),
      assignment: {
        assignmentId: updated.assignmentId,
        attendanceMachineCode: "A_002",
        effectiveFrom: "2026-07-10",
        effectiveTo: null,
      },
    });
    expect(JSON.stringify({ profileBefore, profileAfter })).not.toContain("001234567890");
    expect(JSON.stringify({ profileBefore, profileAfter })).not.toContain("ABC-12345");

    const cleared = await updateStaffProfile(
      manager,
      staffAId,
      {
        citizenIdNumber: null,
        bankAccountNumber: null,
        assignmentId: updated.assignmentId,
        assignmentVersion: updated.assignmentVersion,
        version: updated.version,
      },
      metadata,
      new Date("2026-07-10T03:00:00.000Z"),
    );
    expect(cleared.citizenIdNumber).toBeNull();
    expect(cleared.bankAccountNumber).toBeNull();

    const unchanged = await updateStaffProfile(
      manager,
      staffAId,
      {
        assignmentId: cleared.assignmentId,
        assignmentVersion: cleared.assignmentVersion,
        version: cleared.version,
      },
      metadata,
      new Date("2026-07-10T03:00:00.000Z"),
    );
    expect(unchanged.version).toBe(cleared.version);
    expect(unchanged.assignmentVersion).toBe(cleared.assignmentVersion);

    await expect(
      updateStaffProfile(
        manager,
        staffAId,
        {
          fullName: "Không được sửa nhầm assignment",
          assignmentId: before!.assignmentId,
          assignmentVersion: before!.assignmentVersion,
          version: cleared.version,
        },
        metadata,
        new Date("2026-07-10T03:00:00.000Z"),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("chỉ GM được cập nhật và nhận lương cơ bản trong DTO", async () => {
    const managerView = (await listBranchStaff(manager)).find(({ id }) => id === staffAId)!;
    await expect(
      updateStaffProfile(
        manager,
        staffAId,
        {
          assignmentId: managerView.assignmentId,
          assignmentVersion: managerView.assignmentVersion,
          version: managerView.version,
          baseSalaryAmount: "8000000",
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const gmView = (await listBranchStaff(gm)).find(({ id }) => id === staffAId)!;
    const updated = await updateStaffProfile(
      gm,
      staffAId,
      {
        assignmentId: gmView.assignmentId,
        assignmentVersion: gmView.assignmentVersion,
        version: gmView.version,
        baseSalaryAmount: "8000000",
      },
      metadata,
    );
    expect(updated.baseSalaryAmount).toBe("8000000");
    expect((await listBranchStaff(manager)).find(({ id }) => id === staffAId)).not.toHaveProperty(
      "baseSalaryAmount",
    );
  });

  it("hồ sơ legacy null ngày gia nhập và mã máy vẫn nhập được mã giữ số 0 đầu", async () => {
    const legacy = await prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `LEGACY${runId}`,
        fullName: "Nhân viên legacy",
        jobTitle: "Nhân viên Live",
        employmentCategory: "PROBATION",
        joinedDate: null,
      },
    });
    const assignment = await prisma.branchAssignment.create({
      data: {
        companyId,
        branchId: branchAId,
        staffId: legacy.id,
        assignmentType: "MEMBER",
        attendanceMachineCode: null,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    const updated = await updateStaffProfile(
      manager,
      legacy.id,
      {
        attendanceMachineCode: "00033",
        assignmentId: assignment.id,
        assignmentVersion: assignment.version,
        version: legacy.version,
      },
      metadata,
      new Date("2026-07-10T03:00:00.000Z"),
    );

    expect(updated).toMatchObject({
      joinedDate: null,
      attendanceMachineCode: "00033",
    });
    expect(
      await prisma.branchAssignment.findFirstOrThrow({
        where: {
          companyId,
          staffId: legacy.id,
          effectiveFrom: new Date("2026-07-10T00:00:00.000Z"),
        },
        select: { attendanceMachineCode: true },
      }),
    ).toEqual({ attendanceMachineCode: "00033" });
  });

  it("manager không thể thêm hoặc đọc nhân viên ở cơ sở khác bằng ID trực tiếp", async () => {
    await expect(
      onboardStaff(
        manager,
        {
          branchId: branchBId,
          attendanceMachineCode: "001",
          staffCode: `DENY${runId}`,
          fullName: "Không được tạo",
          streamingAlias: null,
          jobTitle: "Nhân viên Live",
          joinedDate: "2026-07-01",
          officialDate: null,
          employmentCategory: "PROBATION",
          initialSchedule: {
            name: "Ca B",
            scheduledStartMinutes: 540,
            scheduledEndMinutes: 900,
            spansNextDay: false,
            requiredLiveMinutes: 360,
          },
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const createdByGm = await onboardStaff(
      gm,
      {
        branchId: branchBId,
        attendanceMachineCode: "001",
        staffCode: `LIVEB${runId}`,
        fullName: "Nhân viên Live B",
        streamingAlias: null,
        jobTitle: "Nhân viên Live",
        joinedDate: "2026-07-01",
        officialDate: "2026-07-15",
        employmentCategory: "OFFICIAL",
        initialSchedule: {
          name: "Ca B",
          scheduledStartMinutes: 600,
          scheduledEndMinutes: 960,
          spansNextDay: false,
          requiredLiveMinutes: 330,
        },
      },
      metadata,
    );
    staffBId = createdByGm.id;

    expect((await listBranchStaff(manager)).map(({ id }) => id)).not.toContain(staffBId);
    await expect(listStaffWorkSchedules(manager, staffBId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("manager không có cơ sở hiệu lực không thể thêm nhân viên", async () => {
    await expect(
      onboardStaff(
        { ...manager, activeBranchIds: [] },
        {
          branchId: branchAId,
          attendanceMachineCode: "001",
          staffCode: `NOSCOPE${runId}`,
          fullName: "Không có phạm vi",
          streamingAlias: null,
          jobTitle: "Nhân viên Live",
          joinedDate: "2026-07-01",
          officialDate: null,
          employmentCategory: "PROBATION",
          initialSchedule: {
            name: "Ca sáng",
            scheduledStartMinutes: 540,
            scheduledEndMinutes: 900,
            spansNextDay: false,
            requiredLiveMinutes: 360,
          },
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lưu ca theo khoảng hiệu lực và không cho trùng ngày bắt đầu", async () => {
    const created = await createStaffWorkSchedule(
      manager,
      staffAId,
      {
        name: "Ca chiều",
        scheduledStartMinutes: 780,
        scheduledEndMinutes: 1_140,
        spansNextDay: false,
        requiredLiveMinutes: 345,
        effectiveFrom: "2026-07-15",
        effectiveTo: null,
      },
      metadata,
    );
    expect(created.effectiveFrom).toBe("2026-07-15");
    const schedules = await listStaffWorkSchedules(manager, staffAId);
    expect(schedules).toHaveLength(2);
    expect(schedules[1]).toMatchObject({ effectiveTo: "2026-07-15" });

    const edited = await updateStaffWorkSchedule(
      manager,
      staffAId,
      created.id,
      {
        name: "Ca chiều đã sửa",
        scheduledStartMinutes: 780,
        scheduledEndMinutes: 1_140,
        spansNextDay: false,
        requiredLiveMinutes: 330,
        effectiveFrom: "2026-07-15",
        effectiveTo: null,
        version: created.version,
      },
      metadata,
    );
    expect(edited).toMatchObject({
      name: "Ca chiều đã sửa",
      requiredLiveMinutes: 330,
      version: created.version + 1,
    });

    await expect(
      createStaffWorkSchedule(
        manager,
        staffAId,
        {
          name: "Ca bị trùng",
          scheduledStartMinutes: 600,
          scheduledEndMinutes: 960,
          spansNextDay: false,
          requiredLiveMinutes: 300,
          effectiveFrom: "2026-07-15",
          effectiveTo: null,
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("chặn link CCCD trước khi gọi object storage nếu nhân viên ngoài cơ sở", async () => {
    const document = await prisma.staffIdentityDocument.create({
      data: {
        companyId,
        branchId: branchBId,
        staffId: staffBId,
        side: "CITIZEN_ID_FRONT",
        objectKey: `tests/${runId}/front.jpg`,
        originalFileName: "front.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 100n,
        checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        status: "READY",
        uploadedAt: new Date(),
        verifiedAt: new Date(),
        createdByUserId: gm.userId,
      },
    });
    await expect(
      viewStaffIdentityDocument(manager, staffBId, document.id, metadata),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("GM chỉ thấy nhân viên đã nghỉ khi bật danh sách ẩn", async () => {
    const former = await prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `FORMER${runId}`,
        fullName: "Nhân viên đã nghỉ",
        jobTitle: "Nhân viên Live",
        employmentCategory: "OFFICIAL",
        employmentStatus: "TERMINATED",
        terminationDate: new Date("2025-12-15T00:00:00.000Z"),
      },
    });
    await prisma.branchAssignment.create({
      data: {
        companyId,
        staffId: former.id,
        branchId: branchAId,
        assignmentType: "MEMBER",
        attendanceMachineCode: "FORMER-001",
        effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    expect((await listBranchStaff(gm)).map(({ id }) => id)).not.toContain(former.id);
    expect(
      (await listBranchStaff(gm, new Date(), true)).find(({ id }) => id === former.id),
    ).toMatchObject({
      employmentStatus: "TERMINATED",
      terminationDate: "2025-12-15",
      attendanceMachineCode: "FORMER-001",
    });
    expect((await listBranchStaff(manager, new Date(), true)).map(({ id }) => id)).not.toContain(
      former.id,
    );
  });

  it("thu hồi quyền của quản lý cũ khi assignment hiện hành chuyển sang cơ sở khác", async () => {
    const effectiveDate = new Date().toISOString().slice(0, 10);
    const effectiveAt = new Date(`${effectiveDate}T00:00:00.000Z`);
    const document = await prisma.staffIdentityDocument.create({
      data: {
        companyId,
        branchId: branchAId,
        staffId: staffAId,
        side: "CITIZEN_ID_BACK",
        objectKey: `tests/${runId}/transferred-back.jpg`,
        originalFileName: "transferred-back.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 100n,
        checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        status: "READY",
        uploadedAt: new Date(),
        verifiedAt: new Date(),
        createdByUserId: gm.userId,
      },
    });
    await prisma.$transaction(async (tx) => {
      await tx.branchAssignment.updateMany({
        where: {
          companyId,
          staffId: staffAId,
          branchId: branchAId,
          assignmentType: "MEMBER",
          effectiveTo: null,
        },
        data: { effectiveTo: effectiveAt },
      });
      await tx.branchAssignment.create({
        data: {
          companyId,
          staffId: staffAId,
          branchId: branchBId,
          assignmentType: "MEMBER",
          attendanceMachineCode: "TRANSFER-B-001",
          effectiveFrom: effectiveAt,
        },
      });
    });

    expect((await listBranchStaff(gm)).find(({ id }) => id === staffAId)).toMatchObject({
      staffCode: `LIVEA${runId}`.toUpperCase(),
      attendanceMachineCode: "TRANSFER-B-001",
      branch: { id: branchBId },
    });
    expect((await listBranchStaff(manager)).map(({ id }) => id)).not.toContain(staffAId);
    await expect(listStaffWorkSchedules(manager, staffAId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      viewStaffIdentityDocument(manager, staffAId, document.id, metadata),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
