import { randomUUID } from "node:crypto";

import { prisma } from "@ald/db";
import { DomainError, type ActorContext } from "@ald/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createAttendance,
  createEmployeeErrorReport,
  getAttendanceFilterOptions,
  getAttendanceMonth,
  reconcileAutomaticViolationsForMonth,
  updateAttendance,
} from "./attendance-service";

const runId = randomUUID().slice(0, 8);
const metadata = {
  requestId: `attendance-${runId}`,
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
} as const;

let companyId: string;
let branchAId: string;
let branchBId: string;
let liveAId: string;
let liveBId: string;
let futureLiveId: string;
let managerStaffId: string;
let gm: ActorContext;
let manager: ActorContext;

beforeAll(async () => {
  const company = await prisma.company.create({
    data: { name: `Attendance ${runId}`, slug: `attendance-${runId}` },
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

  const [gmStaff, managerStaff, liveA, liveB, futureLive] = await Promise.all([
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: "GM",
        fullName: "GM Attendance",
        jobTitle: "Tổng quản lý",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: "TM",
        fullName: "Manager A",
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
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: "LF",
        fullName: "Live Future",
        jobTitle: "Live",
        employmentCategory: "OFFICIAL",
      },
    }),
  ]);
  managerStaffId = managerStaff.id;
  liveAId = liveA.id;
  liveBId = liveB.id;
  futureLiveId = futureLive.id;

  const [gmUser, managerUser] = await Promise.all([
    prisma.user.create({
      data: {
        companyId,
        staffId: gmStaff.id,
        name: "GM Attendance",
        email: `attendance-gm-${runId}@test.local`,
        username: `attendance_gm_${runId}`,
        role: "GENERAL_MANAGER",
      },
    }),
    prisma.user.create({
      data: {
        companyId,
        staffId: managerStaff.id,
        name: "Manager A",
        email: `attendance-manager-${runId}@test.local`,
        username: `attendance_manager_${runId}`,
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
        staffId: liveAId,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
    prisma.branchAssignment.create({
      data: {
        companyId,
        branchId: branchBId,
        staffId: liveBId,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
    prisma.branchAssignment.create({
      data: {
        companyId,
        branchId: branchAId,
        staffId: futureLiveId,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
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
  manager = {
    userId: managerUser.id,
    companyId,
    staffId: managerStaff.id,
    role: "TRAINING_MANAGER",
    activeBranchIds: [branchAId],
  };
});

afterAll(async () => {
  await prisma.$transaction([
    prisma.$executeRawUnsafe("SET LOCAL ald.audit_cleanup = 'on'"),
    prisma.liveDailyMetric.deleteMany({ where: { companyId } }),
    prisma.attendanceDay.deleteMany({ where: { companyId } }),
    prisma.auditLog.deleteMany({ where: { companyId } }),
    prisma.branchAssignment.deleteMany({ where: { companyId } }),
    prisma.session.deleteMany({ where: { user: { companyId } } }),
    prisma.account.deleteMany({ where: { user: { companyId } } }),
    prisma.user.deleteMany({ where: { companyId } }),
    prisma.branch.deleteMany({ where: { companyId } }),
    prisma.staffMember.deleteMany({ where: { companyId } }),
    prisma.company.deleteMany({ where: { id: companyId } }),
  ]);
});

describe("attendance branch scope và quyền vai trò", () => {
  it("lọc cơ sở trước nhân viên và áp dụng assignment effective date", async () => {
    const managerJuly = await getAttendanceFilterOptions(manager, "2026-07");
    expect(managerJuly.branches.map((branch) => branch.id)).toEqual([branchAId]);
    expect(managerJuly.staff.map((person) => person.id)).toContain(liveAId);
    expect(managerJuly.staff.map((person) => person.id)).not.toContain(liveBId);
    expect(managerJuly.staff.map((person) => person.id)).not.toContain(futureLiveId);

    const managerAugust = await getAttendanceFilterOptions(manager, "2026-08", branchAId);
    expect(managerAugust.staff.map((person) => person.id)).toEqual(
      expect.arrayContaining([liveAId, futureLiveId]),
    );

    const gmBranchB = await getAttendanceFilterOptions(gm, "2026-07", branchBId);
    expect(gmBranchB.staff.map((person) => person.id)).toEqual([liveBId]);
  });

  it("giữ nhân viên trong tháng nghỉ việc và ẩn từ tháng kế tiếp", async () => {
    const terminatedStaff = await prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `LT${runId}`,
        fullName: "Live nghỉ giữa tháng",
        jobTitle: "Live",
        joinedDate: new Date("2026-06-10T00:00:00.000Z"),
        terminationDate: new Date("2026-07-15T00:00:00.000Z"),
        employmentCategory: "OFFICIAL",
        employmentStatus: "TERMINATED",
      },
    });
    await prisma.branchAssignment.create({
      data: {
        companyId,
        branchId: branchAId,
        staffId: terminatedStaff.id,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-06-10T00:00:00.000Z"),
        effectiveTo: new Date("2026-08-01T00:00:00.000Z"),
      },
    });

    const july = await getAttendanceFilterOptions(gm, "2026-07", branchAId);
    const august = await getAttendanceFilterOptions(gm, "2026-08", branchAId);
    expect(july.staff.map(({ id }) => id)).toContain(terminatedStaff.id);
    expect(august.staff.map(({ id }) => id)).not.toContain(terminatedStaff.id);
    await expect(getAttendanceMonth(gm, terminatedStaff.id, "2026-07")).resolves.toMatchObject({
      staff: { id: terminatedStaff.id },
    });
    await expect(getAttendanceMonth(gm, terminatedStaff.id, "2026-08")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("không để manager đoán branchId ngoài phạm vi qua API options", async () => {
    await expect(getAttendanceFilterOptions(manager, "2026-07", branchBId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    } satisfies Partial<DomainError>);
  });

  it("không để manager tính lại lỗi tự động chéo cơ sở hoặc cho chính mình", async () => {
    await expect(
      reconcileAutomaticViolationsForMonth(
        manager,
        {
          staffId: liveBId,
          month: "2026-07",
          dryRun: true,
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      reconcileAutomaticViolationsForMonth(
        manager,
        {
          staffId: managerStaffId,
          month: "2026-07",
          dryRun: true,
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("manager branch A không đọc hoặc sửa attendance staff branch B bằng ID trực tiếp", async () => {
    const branchBRecord = await createAttendance(
      gm,
      {
        staffId: liveBId,
        businessDate: "2026-07-21",
        workUnits: "1",
        revenueAmount: "500000",
      },
      metadata,
    );

    await expect(getAttendanceMonth(manager, liveBId, "2026-07")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      updateAttendance(
        manager,
        branchBRecord.id,
        {
          workUnits: "0.5",
          version: branchBRecord.version,
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("GM nhập và sửa được attendance của manager", async () => {
    const created = await createAttendance(
      gm,
      {
        staffId: managerStaffId,
        businessDate: "2026-07-22",
        checkInAt: "2026-07-22T22:00:00+07:00",
        checkOutAt: "2026-07-23T01:00:00+07:00",
        spansNextDay: true,
        workUnits: "1",
      },
      metadata,
    );
    const updated = await updateAttendance(
      gm,
      created.id,
      {
        workUnits: "1.25",
        version: created.version,
      },
      metadata,
    );

    expect(updated.branchId).toBe(branchAId);
    expect(updated.workUnits).toBe("1.25");
    expect(updated.version).toBe(2);

    await expect(
      updateAttendance(
        manager,
        created.id,
        {
          workUnits: "2",
          version: updated.version,
        },
        metadata,
      ),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("manager nhập được nhân viên Live thuộc branch hiện tại", async () => {
    const created = await createAttendance(
      manager,
      {
        staffId: liveAId,
        businessDate: "2026-07-20",
        actualLiveMinutes: 180,
        revenueAmount: "1200000",
      },
      metadata,
    );

    expect(created.branchId).toBe(branchAId);
    expect(created.revenueAmount).toBe("1200000");
  });
});

describe("unique và optimistic concurrency", () => {
  it("một staff/date chỉ có một attendance", async () => {
    await createAttendance(
      gm,
      {
        staffId: liveAId,
        businessDate: "2026-07-23",
      },
      metadata,
    );

    await expect(
      createAttendance(
        gm,
        {
          staffId: liveAId,
          businessDate: "2026-07-23",
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("trả conflict và current record khi version đã cũ", async () => {
    const created = await createAttendance(
      gm,
      {
        staffId: liveAId,
        businessDate: "2026-07-24",
        workUnits: "1",
      },
      metadata,
    );
    const updated = await updateAttendance(
      gm,
      created.id,
      {
        workUnits: "1.5",
        version: created.version,
      },
      metadata,
    );

    await expect(
      updateAttendance(
        gm,
        created.id,
        {
          workUnits: "2",
          version: created.version,
        },
        metadata,
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { current: { version: updated.version, workUnits: "1.5" } },
    });
  });
});

describe("audit, dữ liệu cũ và export an toàn", () => {
  it("cho phép cập nhật lại attendance từng được lưu trữ", async () => {
    const created = await createAttendance(
      gm,
      {
        staffId: liveAId,
        businessDate: "2026-07-25",
        status: "PRESENT",
        revenueAmount: "900000",
      },
      metadata,
    );
    await updateAttendance(
      gm,
      created.id,
      {
        overtimeMinutes: 45,
        version: created.version,
      },
      metadata,
    );
    const archived = await prisma.attendanceDay.update({
      where: { id: created.id },
      data: {
        archivedAt: new Date(),
        version: { increment: 1 },
      },
      select: { archivedAt: true, version: true },
    });
    const restored = await updateAttendance(
      gm,
      created.id,
      {
        overtimeMinutes: 60,
        version: archived.version,
      },
      metadata,
    );

    const audits = await prisma.auditLog.findMany({
      where: {
        companyId,
        entityType: "AttendanceDay",
        entityId: created.id,
      },
      orderBy: { occurredAt: "asc" },
    });
    expect(audits.map(({ action }) => action)).toEqual([
      "attendance.create",
      "attendance.update",
      "attendance.restore-and-update",
    ]);
    expect(audits.every(({ reason }) => reason.startsWith("SYSTEM:"))).toBe(true);
    expect(audits[1]?.before).not.toBeNull();
    expect(audits[1]?.after).not.toBeNull();
    expect(archived.archivedAt).not.toBeNull();
    expect(restored.archivedAt).toBeNull();
    expect(restored.overtimeMinutes).toBe(60);
    expect(await prisma.attendanceDay.count({ where: { id: created.id } })).toBe(1);
  });

  it("employee error report loại doanh số từ truy vấn và DTO server", async () => {
    const report = await createEmployeeErrorReport(
      gm,
      liveAId,
      "2026-07",
      new Date("2026-07-31T17:00:00.000Z"),
    );
    const serialized = JSON.stringify(report);

    expect(report.violations).toEqual([]);
    expect(serialized).not.toContain("revenue");
    expect(serialized).not.toContain("1200000");
  });
});
