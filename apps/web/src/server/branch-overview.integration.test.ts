import { randomUUID } from "node:crypto";

import { prisma } from "@ald/db";
import type { ActorContext } from "@ald/domain";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAttendance, getAttendanceMonth } from "./attendance-service";
import { createBranchOverviewWorkbook } from "./branch-overview-export";
import { getBranchMonthlyOverview, updateBranchOverviewCells } from "./branch-overview-service";

const runId = randomUUID().slice(0, 8);
const metadata = {
  requestId: `branch-overview-${runId}`,
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
} as const;

let companyId: string;
let branchAId: string;
let branchBId: string;
let liveAId: string;
let liveBId: string;
let levelId: string;
let firstAttendanceVersion: number;
let managerA: ActorContext;
let gm: ActorContext;

beforeAll(async () => {
  const company = await prisma.company.create({
    data: {
      name: `Overview ${runId}`,
      slug: `overview-${runId}`,
      revenueUnit: "VND",
      revenueScale: 1,
    },
  });
  companyId = company.id;

  const [branchA, branchB] = await Promise.all([
    prisma.branch.create({
      data: { companyId, code: `A-${runId}`, name: "Cơ sở An Toàn" },
    }),
    prisma.branch.create({
      data: { companyId, code: `B-${runId}`, name: "Cơ sở Bí Mật" },
    }),
  ]);
  branchAId = branchA.id;
  branchBId = branchB.id;

  const [gmStaff, managerStaff, liveA, liveB] = await Promise.all([
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `GM-${runId}`,
        fullName: "GM Overview",
        jobTitle: "Tổng quản lý",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `TM-${runId}`,
        fullName: "Manager Overview A",
        jobTitle: "Quản lý đào tạo",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `LA-${runId}`,
        fullName: "Live An Toàn",
        streamingAlias: "ACC-AN-TOAN",
        jobTitle: "Live",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `LB-${runId}`,
        fullName: "NHÂN VIÊN BÍ MẬT",
        streamingAlias: "ACC-BI-MAT",
        jobTitle: "Live",
        employmentCategory: "PROBATION",
      },
    }),
  ]);
  liveAId = liveA.id;
  liveBId = liveB.id;

  const [gmUser, managerUser] = await Promise.all([
    prisma.user.create({
      data: {
        companyId,
        staffId: gmStaff.id,
        name: "GM Overview",
        email: `overview-gm-${runId}@test.local`,
        username: `overview_gm_${runId}`,
        role: "GENERAL_MANAGER",
      },
    }),
    prisma.user.create({
      data: {
        companyId,
        staffId: managerStaff.id,
        name: "Manager Overview A",
        email: `overview-manager-${runId}@test.local`,
        username: `overview_manager_${runId}`,
        role: "TRAINING_MANAGER",
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
    userId: managerUser.id,
    companyId,
    staffId: managerStaff.id,
    role: "TRAINING_MANAGER",
    activeBranchIds: [branchAId],
  };

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
  ]);

  const level = await prisma.performanceLevel.create({
    data: {
      companyId,
      code: `L1-${runId}`,
      name: "Live Xuất Sắc",
      displayOrder: 1,
    },
  });
  levelId = level.id;
  await prisma.levelHistory.create({
    data: {
      companyId,
      staffId: liveAId,
      performanceLevelId: level.id,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      createdByUserId: gm.userId,
    },
  });

  const [attendanceA, attendanceB] = await Promise.all([
    createAttendance(
      gm,
      {
        staffId: liveAId,
        businessDate: "2026-07-01",
        status: "PRESENT",
        workUnits: "1",
        overtimeMinutes: 30,
        actualLiveMinutes: 180,
        revenueAmount: "1200000",
        reason: "Fixture overview branch A",
      },
      metadata,
    ),
    createAttendance(
      gm,
      {
        staffId: liveBId,
        businessDate: "2026-07-01",
        status: "PRESENT",
        workUnits: "1",
        actualLiveMinutes: 999,
        revenueAmount: "987654321",
        reason: "Fixture bí mật branch B",
      },
      metadata,
    ),
  ]);
  firstAttendanceVersion = attendanceA.version;

  const ruleSet = await prisma.ruleSet.create({
    data: {
      companyId,
      name: `Fixture overview ${runId}`,
      createdByUserId: gm.userId,
    },
  });
  const ruleVersion = await prisma.ruleVersion.create({
    data: {
      companyId,
      ruleSetId: ruleSet.id,
      versionNo: 1,
      status: "DRAFT",
      createdByUserId: gm.userId,
    },
  });
  const item = await prisma.penaltyItem.create({
    data: {
      companyId,
      ruleVersionId: ruleVersion.id,
      code: `LATE-${runId}`,
      name: "Đi muộn",
      description: "Fixture tiền phạt overview",
      defaultAmount: 50000n,
    },
  });
  await prisma.violation.create({
    data: {
      companyId,
      branchId: branchAId,
      attendanceId: attendanceA.id,
      staffId: liveAId,
      businessDate: new Date("2026-07-01T00:00:00.000Z"),
      penaltyItemId: item.id,
      ruleVersionId: ruleVersion.id,
      penaltyItemCode: item.code,
      countingKey: item.code,
      occurrenceNo: 1,
      countingWindow: "CALENDAR_MONTH",
      countingPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
      countingPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      penaltyStartsAt: 1,
      snapshottedDefaultAmount: 50000n,
      computedAmount: 50000n,
      isChargeable: true,
      responsibleParty: "VIOLATING_STAFF",
      itemName: item.name,
      amount: 50000n,
      detail: "Đi muộn 10 phút",
      createdByUserId: gm.userId,
    },
  });

  expect(attendanceB.branchId).toBe(branchBId);
});

afterAll(async () => {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'ALTER TABLE "violations" DISABLE TRIGGER "violations_no_hard_delete"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "level_history" DISABLE TRIGGER "level_history_no_hard_delete"',
    );

    await tx.violation.deleteMany({ where: { companyId } });
    await tx.penaltyItem.deleteMany({ where: { companyId } });
    await tx.ruleVersion.deleteMany({ where: { companyId } });
    await tx.ruleSet.deleteMany({ where: { companyId } });
    await tx.levelHistory.deleteMany({ where: { companyId } });
    await tx.performanceLevel.deleteMany({ where: { companyId } });
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
      'ALTER TABLE "level_history" ENABLE TRIGGER "level_history_no_hard_delete"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "violations" ENABLE TRIGGER "violations_no_hard_delete"',
    );
  });
});

describe("branch monthly overview projection", () => {
  it("đọc đúng 31 ngày, tuần 5, hồ sơ và tổng khớp employee detail", async () => {
    const [overview, detail] = await Promise.all([
      getBranchMonthlyOverview(managerA, {
        branchId: branchAId,
        month: "2026-07",
      }),
      getAttendanceMonth(managerA, liveAId, "2026-07"),
    ]);

    expect(overview.calendar).toHaveLength(31);
    expect(overview.calendar.at(-1)?.weekOfMonth).toBe(5);
    expect(
      overview.calendar
        .filter((day) => day.weekOfMonth === 1)
        .map((day) => day.businessDate),
    ).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
    ]);
    expect(
      overview.calendar
        .filter((day) => day.weekOfMonth === 5)
        .map((day) => day.businessDate),
    ).toEqual([
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
    ]);
    expect(overview.rows).toHaveLength(1);
    expect(overview.rows[0]?.staff).toMatchObject({
      fullName: "Live An Toàn",
      streamingAlias: "ACC-AN-TOAN",
      performanceLevel: { id: levelId, name: "Live Xuất Sắc" },
    });
    expect(overview.rows[0]?.totals).toEqual({
      revenueAmount: "1200000",
      workUnits: "1",
      actualLiveMinutes: 180,
      overtimeMinutes: 30,
      penaltyAmount: "50000",
    });
    expect(overview.totals.penaltyAmount).toBe(detail.activePenaltyTotal);
    expect(overview.rows[0]?.days[0]).toMatchObject({
      revenueAmount: detail.days[0]?.attendance?.revenueAmount,
      actualLiveMinutes: detail.days[0]?.attendance?.actualLiveMinutes,
      workUnits: detail.days[0]?.attendance?.workUnits,
      overtimeMinutes: detail.days[0]?.attendance?.overtimeMinutes,
    });
  });

  it("hỗ trợ tuần lịch thứ 6 và không đưa ngày tháng khác vào calendar", async () => {
    const overview = await getBranchMonthlyOverview(managerA, {
      branchId: branchAId,
      month: "2026-08",
    });

    expect(overview.calendar.at(-1)).toMatchObject({
      businessDate: "2026-08-31",
      weekOfMonth: 6,
    });
    expect(overview.calendar.every((day) => day.businessDate.startsWith("2026-08"))).toBe(true);
  });

  it("lọc theo alias, trạng thái, loại nhân sự và level tại cuối tháng", async () => {
    const overview = await getBranchMonthlyOverview(managerA, {
      branchId: branchAId,
      month: "2026-07",
      search: "ACC-AN",
      employmentStatus: "ACTIVE",
      employmentCategory: "OFFICIAL",
      levelId,
    });
    expect(overview.rows.map((row) => row.staff.id)).toEqual([liveAId]);
  });

  it("không cho overlap hoặc hard-delete lịch sử level", async () => {
    const history = await prisma.levelHistory.findFirstOrThrow({
      where: { companyId, staffId: liveAId },
    });
    await expect(
      prisma.levelHistory.create({
        data: {
          companyId,
          staffId: liveAId,
          performanceLevelId: levelId,
          effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
          createdByUserId: gm.userId,
        },
      }),
    ).rejects.toThrow();
    await expect(prisma.levelHistory.delete({ where: { id: history.id } })).rejects.toThrow(
      /cannot be hard deleted/i,
    );
  });
});

describe("branch overview write-through và optimistic lock", () => {
  it("edit grid cập nhật attendance/live metric nguồn và employee sheet", async () => {
    const [result] = await updateBranchOverviewCells(
      gm,
      {
        branchId: branchAId,
        reason: "Sửa từ grid tổng quan",
        edits: [
          {
            clientId: "edit-existing",
            staffId: liveAId,
            businessDate: "2026-07-01",
            version: firstAttendanceVersion,
            revenueAmount: "2000000",
            actualLiveMinutes: 240,
          },
        ],
      },
      metadata,
    );
    expect(result?.status).toBe("SAVED");
    firstAttendanceVersion = result?.attendance?.version ?? firstAttendanceVersion;

    const detail = await getAttendanceMonth(managerA, liveAId, "2026-07");
    expect(detail.days[0]?.attendance).toMatchObject({
      revenueAmount: "2000000",
      actualLiveMinutes: 240,
    });
  });

  it("tạo ngày nguồn khi ô trống và trả conflict với version cũ", async () => {
    const [created] = await updateBranchOverviewCells(
      gm,
      {
        branchId: branchAId,
        reason: "Paste ô mới từ grid",
        edits: [
          {
            clientId: "create-day",
            staffId: liveAId,
            businessDate: "2026-07-02",
            version: null,
            revenueAmount: "300000",
            actualLiveMinutes: 60,
          },
        ],
      },
      metadata,
    );
    expect(created?.status).toBe("SAVED");
    expect(created?.attendance?.branchId).toBe(branchAId);

    const [conflict] = await updateBranchOverviewCells(
      gm,
      {
        branchId: branchAId,
        reason: "Thử stale version",
        edits: [
          {
            clientId: "stale",
            staffId: liveAId,
            businessDate: "2026-07-01",
            version: firstAttendanceVersion - 1,
            revenueAmount: "1",
          },
        ],
      },
      metadata,
    );
    expect(conflict).toMatchObject({
      clientId: "stale",
      status: "CONFLICT",
      attendance: { version: firstAttendanceVersion },
    });
  });
});

describe("branch scope và XLSX export", () => {
  it("manager chỉ được đọc branch A và không được sửa từ grid tổng quan", async () => {
    await expect(
      updateBranchOverviewCells(
        managerA,
        {
          branchId: branchAId,
          reason: "Thử sửa grid chỉ xem",
          edits: [
            {
              clientId: "read-only",
              staffId: liveAId,
              businessDate: "2026-07-01",
              version: firstAttendanceVersion,
              revenueAmount: "1",
            },
          ],
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("manager không đọc/sửa branch B bằng branchId query/body trực tiếp; GM đọc được", async () => {
    await expect(
      getBranchMonthlyOverview(managerA, {
        branchId: branchBId,
        month: "2026-07",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      updateBranchOverviewCells(
        managerA,
        {
          branchId: branchBId,
          reason: "Thử IDOR branch B",
          edits: [
            {
              clientId: "idor",
              staffId: liveBId,
              businessDate: "2026-07-01",
              version: 1,
              revenueAmount: "1",
            },
          ],
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const gmOverview = await getBranchMonthlyOverview(gm, {
      branchId: branchBId,
      month: "2026-07",
    });
    expect(gmOverview.rows[0]?.staff.id).toBe(liveBId);
  });

  it("workbook chỉ chứa projection đã scope của branch A", async () => {
    const overview = await getBranchMonthlyOverview(managerA, {
      branchId: branchAId,
      month: "2026-07",
    });
    const buffer = await createBranchOverviewWorkbook(overview);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
    const sheet = workbook.getWorksheet("Tổng quan cơ sở");
    const serialized = JSON.stringify(
      sheet?.getSheetValues().map((row) => (Array.isArray(row) ? row.slice(1) : row)),
    );

    expect(serialized).toContain("Live An Toàn");
    expect(serialized).toContain("ACC-AN-TOAN");
    expect(serialized).not.toContain("NHÂN VIÊN BÍ MẬT");
    expect(serialized).not.toContain("987654321");
    expect(sheet?.views[0]).toMatchObject({ state: "frozen", xSplit: 6, ySplit: 6 });
  });

  it("query attendance sử dụng composite index theo company/branch/date/staff", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'attendance_days'
    `;
    expect(indexes.map(({ indexname }) => indexname)).toContain(
      "attendance_days_company_branch_date_staff_idx",
    );
  });
});
