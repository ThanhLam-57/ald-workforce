import { randomUUID } from "node:crypto";

import { prisma } from "@ald/db";
import { DomainError, type ActorContext } from "@ald/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createAttendance,
  createEmployeeErrorReport,
  getAttendanceFilterOptions,
  getAttendanceMonth,
  getAttendancePrintData,
  reconcileAutomaticViolationsForMonth,
  saveAttendanceBatch,
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

describe("attendance batch save", () => {
  it("saves all 31 days through one atomic service call", async () => {
    const rows = Array.from({ length: 31 }, (_, index) => ({
      businessDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
      attendanceId: null,
      version: null,
      checkInAt: null,
      checkOutAt: null,
      spansNextDay: false,
      workUnits: "0",
      overtimeMinutes: 0,
      note: null,
      actualLiveMinutes: 0,
      revenueAmount: "0",
    }));

    const saved = await saveAttendanceBatch(
      gm,
      { staffId: futureLiveId, month: "2026-08", rows },
      metadata,
    );

    expect(saved.savedCount).toBe(31);
    expect(saved.createdCount).toBe(31);
    expect(saved.dataset.days.filter((day) => day.attendance !== null)).toHaveLength(31);
  });

  it("lets only the GM override a daily penalty without removing violations", async () => {
    const month = await getAttendanceMonth(gm, futureLiveId, "2026-08");
    const current = month.days[0]!.attendance!;
    const baseRow = {
      businessDate: "2026-08-01",
      attendanceId: current.id,
      version: current.version,
      checkInAt: current.checkInAt,
      checkOutAt: current.checkOutAt,
      spansNextDay: current.spansNextDay,
      workUnits: current.workUnits,
      overtimeMinutes: current.overtimeMinutes,
      note: current.note,
      actualLiveMinutes: current.actualLiveMinutes,
      revenueAmount: current.revenueAmount,
    } as const;

    await expect(
      saveAttendanceBatch(
        manager,
        {
          staffId: futureLiveId,
          month: "2026-08",
          rows: [{ ...baseRow, penaltyOverrideAmount: "1" }],
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const overridden = await saveAttendanceBatch(
      gm,
      {
        staffId: futureLiveId,
        month: "2026-08",
        rows: [{ ...baseRow, penaltyOverrideAmount: "25000" }],
      },
      metadata,
    );
    const overriddenDay = overridden.dataset.days[0]!;
    expect(overriddenDay).toMatchObject({
      calculatedPenaltyTotal: "0",
      activePenaltyTotal: "25000",
      violations: [],
    });
    expect(overriddenDay.attendance?.penaltyOverrideAmount).toBe("25000");

    const printed = await getAttendancePrintData(gm, futureLiveId, "2026-08", metadata);
    expect(printed.rows[0]).toMatchObject({ penaltyAmount: "25000", violationNames: [] });

    const cleared = await saveAttendanceBatch(
      gm,
      {
        staffId: futureLiveId,
        month: "2026-08",
        rows: [
          {
            ...baseRow,
            version: overriddenDay.attendance!.version,
            penaltyOverrideAmount: null,
          },
        ],
      },
      metadata,
    );
    expect(cleared.dataset.days[0]).toMatchObject({
      calculatedPenaltyTotal: "0",
      activePenaltyTotal: "0",
      attendance: { penaltyOverrideAmount: null },
    });
  });

  it("creates and updates multiple days atomically in one batch", async () => {
    const created = await saveAttendanceBatch(
      gm,
      {
        staffId: liveAId,
        month: "2026-07",
        rows: [
          {
            businessDate: "2026-07-26",
            attendanceId: null,
            version: null,
            checkInAt: "2026-07-26T09:00:00+07:00",
            checkOutAt: "2026-07-26T16:00:00+07:00",
            spansNextDay: false,
            workUnits: "1",
            overtimeMinutes: 30,
            note: "Ngày batch thứ nhất",
            actualLiveMinutes: 360,
            revenueAmount: "100000",
          },
          {
            businessDate: "2026-07-27",
            attendanceId: null,
            version: null,
            checkInAt: "2026-07-27T09:05:00+07:00",
            checkOutAt: "2026-07-27T16:05:00+07:00",
            spansNextDay: false,
            workUnits: "0.5",
            overtimeMinutes: 0,
            note: "Ngày batch thứ hai",
            actualLiveMinutes: 300,
            revenueAmount: "50000",
          },
        ],
      },
      metadata,
    );

    expect(created.savedCount).toBe(2);
    expect(created.createdCount).toBe(2);
    expect(created.updatedCount).toBe(0);
    const first = created.dataset.days.find(
      (day) => day.businessDate === "2026-07-26",
    )!.attendance!;
    const second = created.dataset.days.find(
      (day) => day.businessDate === "2026-07-27",
    )!.attendance!;
    expect(first.revenueAmount).toBe("100000");
    expect(second.workUnits).toBe("0.5");

    const updated = await saveAttendanceBatch(
      gm,
      {
        staffId: liveAId,
        month: "2026-07",
        rows: [
          {
            businessDate: "2026-07-26",
            attendanceId: first.id,
            version: first.version,
            checkInAt: first.checkInAt,
            checkOutAt: first.checkOutAt,
            spansNextDay: first.spansNextDay,
            workUnits: "1.25",
            overtimeMinutes: first.overtimeMinutes,
            note: "Đã cập nhật bằng batch",
            actualLiveMinutes: first.actualLiveMinutes,
            revenueAmount: "125000",
          },
          {
            businessDate: "2026-07-27",
            attendanceId: second.id,
            version: second.version,
            checkInAt: second.checkInAt,
            checkOutAt: second.checkOutAt,
            spansNextDay: second.spansNextDay,
            workUnits: second.workUnits,
            overtimeMinutes: second.overtimeMinutes,
            note: second.note,
            actualLiveMinutes: 330,
            revenueAmount: second.revenueAmount,
          },
        ],
      },
      metadata,
    );

    expect(updated.createdCount).toBe(0);
    expect(updated.updatedCount).toBe(2);
    expect(
      updated.dataset.days.find((day) => day.businessDate === "2026-07-26")?.attendance,
    ).toMatchObject({ workUnits: "1.25", revenueAmount: "125000" });
    expect(
      updated.dataset.days.find((day) => day.businessDate === "2026-07-27")?.attendance,
    ).toMatchObject({ actualLiveMinutes: 330 });
  });

  it("rolls back the entire batch when one row has a stale version", async () => {
    const month = await getAttendanceMonth(gm, liveAId, "2026-07");
    const first = month.days.find((day) => day.businessDate === "2026-07-26")!.attendance!;
    const second = month.days.find((day) => day.businessDate === "2026-07-27")!.attendance!;
    await updateAttendance(
      gm,
      first.id,
      { version: first.version, note: "Người khác đã sửa" },
      metadata,
    );

    await expect(
      saveAttendanceBatch(
        gm,
        {
          staffId: liveAId,
          month: "2026-07",
          rows: [
            {
              businessDate: "2026-07-26",
              attendanceId: first.id,
              version: first.version,
              checkInAt: first.checkInAt,
              checkOutAt: first.checkOutAt,
              spansNextDay: first.spansNextDay,
              workUnits: "2",
              overtimeMinutes: first.overtimeMinutes,
              note: "Không được lưu",
              actualLiveMinutes: first.actualLiveMinutes,
              revenueAmount: first.revenueAmount,
            },
            {
              businessDate: "2026-07-27",
              attendanceId: second.id,
              version: second.version,
              checkInAt: second.checkInAt,
              checkOutAt: second.checkOutAt,
              spansNextDay: second.spansNextDay,
              workUnits: "2",
              overtimeMinutes: second.overtimeMinutes,
              note: "Cũng không được lưu",
              actualLiveMinutes: second.actualLiveMinutes,
              revenueAmount: second.revenueAmount,
            },
          ],
        },
        metadata,
      ),
    ).rejects.toMatchObject({
      code: "ATTENDANCE_BATCH_CONFLICT",
      details: {
        conflicts: [expect.objectContaining({ businessDate: "2026-07-26" })],
      },
    });

    const unchanged = await prisma.attendanceDay.findUniqueOrThrow({
      where: { id: second.id },
      select: { version: true, workUnits: true, note: true },
    });
    expect(unchanged.version).toBe(second.version);
    expect(unchanged.workUnits.toString()).toBe(second.workUnits);
    expect(unchanged.note).toBe(second.note);
  });

  it("allows exactly one of two concurrent edits with the same version", async () => {
    const month = await getAttendanceMonth(gm, liveAId, "2026-07");
    const current = month.days.find((day) => day.businessDate === "2026-07-27")!.attendance!;
    const baseRow = {
      businessDate: "2026-07-27",
      attendanceId: current.id,
      version: current.version,
      checkInAt: current.checkInAt,
      checkOutAt: current.checkOutAt,
      spansNextDay: current.spansNextDay,
      workUnits: current.workUnits,
      overtimeMinutes: current.overtimeMinutes,
      actualLiveMinutes: current.actualLiveMinutes,
      revenueAmount: current.revenueAmount,
    } as const;

    const results = await Promise.allSettled([
      saveAttendanceBatch(
        gm,
        {
          staffId: liveAId,
          month: "2026-07",
          rows: [{ ...baseRow, note: "Người sửa A" }],
        },
        metadata,
      ),
      saveAttendanceBatch(
        gm,
        {
          staffId: liveAId,
          month: "2026-07",
          rows: [{ ...baseRow, note: "Người sửa B" }],
        },
        metadata,
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "ATTENDANCE_BATCH_CONFLICT" },
    });
    const persisted = await prisma.attendanceDay.findUniqueOrThrow({
      where: { id: current.id },
      select: { version: true, note: true },
    });
    expect(persisted.version).toBe(current.version + 1);
    expect(["Người sửa A", "Người sửa B"]).toContain(persisted.note);
  });

  it("enforces manager branch scope and prevents manager self-edit", async () => {
    const row = {
      businessDate: "2026-07-28",
      attendanceId: null,
      version: null,
      checkInAt: null,
      checkOutAt: null,
      spansNextDay: false,
      workUnits: "1",
      overtimeMinutes: 0,
      note: null,
      actualLiveMinutes: 360,
      revenueAmount: "100000",
    } as const;

    await expect(
      saveAttendanceBatch(manager, { staffId: liveBId, month: "2026-07", rows: [row] }, metadata),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      saveAttendanceBatch(
        manager,
        { staffId: managerStaffId, month: "2026-07", rows: [row] },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("attendance print data", () => {
  it("uses the same monthly source and calculates totals without private staff fields", async () => {
    const printed = await getAttendancePrintData(
      manager,
      liveAId,
      "2026-07",
      metadata,
      new Date("2026-07-31T17:00:00.000Z"),
    );

    expect(printed.rows).toHaveLength(31);
    expect(printed.rows.find((row) => row.businessDate === "2026-07-26")).toMatchObject({
      workUnits: "1.25",
      revenueAmount: "125000",
      penaltyAmount: "0",
    });
    expect(printed.totals.revenueAmount).not.toBe("0");
    expect(printed.totals.workUnits).not.toBe("0");
    expect(JSON.stringify(printed)).not.toMatch(/citizen|identity|bankAccount|password/i);
  });

  it("does not allow a manager to print another branch", async () => {
    await expect(
      getAttendancePrintData(manager, liveBId, "2026-07", metadata),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
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
