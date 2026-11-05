import { randomUUID } from "node:crypto";

import { prisma } from "@ald/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getCurrentRevenueLeaderboard } from "./revenue-leaderboard-service";

const runId = randomUUID().slice(0, 8);
const companyIds: string[] = [];
let companyAId: string;
let companyBId: string;
let branchAId: string;
let branchCId: string;
let branchBId: string;
let userAId: string;
let staffAId: string;
let otherCompanyStaffId: string;

async function createAttendance(input: {
  companyId: string;
  branchId: string;
  staffId: string;
  userId: string;
  businessDate: string;
  revenueAmount: bigint;
  archived?: boolean;
}) {
  const attendance = await prisma.attendanceDay.create({
    data: {
      companyId: input.companyId,
      branchId: input.branchId,
      staffId: input.staffId,
      businessDate: new Date(`${input.businessDate}T00:00:00.000Z`),
      archivedAt: input.archived ? new Date("2026-10-29T00:00:00.000Z") : null,
      createdByUserId: input.userId,
      updatedByUserId: input.userId,
    },
  });
  await prisma.liveDailyMetric.create({
    data: {
      companyId: input.companyId,
      branchId: input.branchId,
      attendanceId: attendance.id,
      actualLiveMinutes: 360,
      revenueAmount: input.revenueAmount,
      revenueUnit: "COIN",
      revenueScale: 1,
    },
  });
}

beforeAll(async () => {
  const [companyA, companyB] = await Promise.all([
    prisma.company.create({
      data: {
        name: `Leaderboard A ${runId}`,
        slug: `leaderboard-a-${runId}`,
        timezone: "Asia/Ho_Chi_Minh",
        revenueUnit: "COIN",
        revenueScale: 1,
      },
    }),
    prisma.company.create({
      data: {
        name: `Leaderboard B ${runId}`,
        slug: `leaderboard-b-${runId}`,
        timezone: "Asia/Ho_Chi_Minh",
        revenueUnit: "COIN",
        revenueScale: 1,
      },
    }),
  ]);
  companyAId = companyA.id;
  companyBId = companyB.id;
  companyIds.push(companyA.id, companyB.id);

  const [branchA, branchC, branchB] = await Promise.all([
    prisma.branch.create({
      data: { companyId: companyA.id, code: `A-${runId}`, name: "Cơ sở A" },
    }),
    prisma.branch.create({
      data: { companyId: companyA.id, code: `C-${runId}`, name: "Cơ sở C" },
    }),
    prisma.branch.create({
      data: { companyId: companyB.id, code: `B-${runId}`, name: "Cơ sở B" },
    }),
  ]);
  branchAId = branchA.id;
  branchCId = branchC.id;
  branchBId = branchB.id;

  const [
    gmAStaff,
    gmBStaff,
    staffA,
    staffB,
    zeroStaff,
    midMonthLeaver,
    formerStaff,
    archivedStaff,
    otherStaff,
  ] = await Promise.all([
    prisma.staffMember.create({
      data: {
        companyId: companyA.id,
        staffCode: `GM-A-${runId}`,
        fullName: "GM A",
        jobTitle: "Tổng quản lý",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId: companyB.id,
        staffCode: `GM-B-${runId}`,
        fullName: "GM B",
        jobTitle: "Tổng quản lý",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId: companyA.id,
        staffCode: `A01-${runId}`,
        fullName: "Nguyễn An",
        streamingAlias: "An Live",
        email: `private-a-${runId}@example.com`,
        phone: "0900000000",
        citizenIdNumber: `1234${runId.replace(/[^0-9]/g, "").padEnd(8, "0")}`.slice(0, 12),
        bankAccountNumber: "PRIVATEBANK123",
        baseSalaryAmount: 10_000_000n,
        jobTitle: "Live",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId: companyA.id,
        staffCode: `B01-${runId}`,
        fullName: "Trần Bình",
        jobTitle: "Live",
        employmentCategory: "OFFICIAL",
        joinedDate: new Date("2026-10-15T00:00:00.000Z"),
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId: companyA.id,
        staffCode: `C01-${runId}`,
        fullName: "Lê Chi",
        jobTitle: "Live",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId: companyA.id,
        staffCode: `D01-${runId}`,
        fullName: "Phạm Dũng",
        jobTitle: "Live",
        employmentCategory: "OFFICIAL",
        employmentStatus: "TERMINATED",
        terminationDate: new Date("2026-10-20T00:00:00.000Z"),
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId: companyA.id,
        staffCode: `E01-${runId}`,
        fullName: "Võ Em",
        jobTitle: "Live",
        employmentCategory: "OFFICIAL",
        employmentStatus: "TERMINATED",
        terminationDate: new Date("2026-09-30T00:00:00.000Z"),
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId: companyA.id,
        staffCode: `F01-${runId}`,
        fullName: "Đỗ Phương",
        jobTitle: "Live",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId: companyB.id,
        staffCode: `X01-${runId}`,
        fullName: "Công ty khác",
        jobTitle: "Live",
        employmentCategory: "OFFICIAL",
      },
    }),
  ]);
  staffAId = staffA.id;
  otherCompanyStaffId = otherStaff.id;

  const [userA, userB] = await Promise.all([
    prisma.user.create({
      data: {
        companyId: companyA.id,
        staffId: gmAStaff.id,
        name: "GM A",
        email: `leaderboard-gm-a-${runId}@test.local`,
        username: `leaderboard_gm_a_${runId}`,
        role: "GENERAL_MANAGER",
      },
    }),
    prisma.user.create({
      data: {
        companyId: companyB.id,
        staffId: gmBStaff.id,
        name: "GM B",
        email: `leaderboard-gm-b-${runId}@test.local`,
        username: `leaderboard_gm_b_${runId}`,
        role: "GENERAL_MANAGER",
      },
    }),
  ]);
  userAId = userA.id;

  await prisma.branchAssignment.createMany({
    data: [
      {
        companyId: companyA.id,
        branchId: branchA.id,
        staffId: staffA.id,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-10-15T00:00:00.000Z"),
      },
      {
        companyId: companyA.id,
        branchId: branchC.id,
        staffId: staffA.id,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-10-15T00:00:00.000Z"),
      },
      {
        companyId: companyA.id,
        branchId: branchA.id,
        staffId: staffB.id,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-10-15T00:00:00.000Z"),
      },
      {
        companyId: companyA.id,
        branchId: branchA.id,
        staffId: zeroStaff.id,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        companyId: companyA.id,
        branchId: branchA.id,
        staffId: midMonthLeaver.id,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-10-20T00:00:00.000Z"),
      },
      {
        companyId: companyA.id,
        branchId: branchA.id,
        staffId: formerStaff.id,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-10-01T00:00:00.000Z"),
      },
      {
        companyId: companyA.id,
        branchId: branchA.id,
        staffId: archivedStaff.id,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        archivedAt: new Date("2026-10-05T00:00:00.000Z"),
      },
      {
        companyId: companyB.id,
        branchId: branchB.id,
        staffId: otherStaff.id,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    ],
  });

  await Promise.all([
    createAttendance({
      companyId: companyA.id,
      branchId: branchA.id,
      staffId: staffA.id,
      userId: userA.id,
      businessDate: "2026-10-05",
      revenueAmount: 4_611_686_018_427_387_903n,
    }),
    createAttendance({
      companyId: companyA.id,
      branchId: branchC.id,
      staffId: staffA.id,
      userId: userA.id,
      businessDate: "2026-10-20",
      revenueAmount: 4_611_686_018_427_387_904n,
    }),
    createAttendance({
      companyId: companyA.id,
      branchId: branchA.id,
      staffId: staffB.id,
      userId: userA.id,
      businessDate: "2026-10-14",
      revenueAmount: 999n,
    }),
    createAttendance({
      companyId: companyA.id,
      branchId: branchA.id,
      staffId: staffB.id,
      userId: userA.id,
      businessDate: "2026-10-15",
      revenueAmount: 9_223_372_036_854_775_807n,
    }),
    createAttendance({
      companyId: companyA.id,
      branchId: branchA.id,
      staffId: zeroStaff.id,
      userId: userA.id,
      businessDate: "2026-10-12",
      revenueAmount: 999n,
      archived: true,
    }),
    createAttendance({
      companyId: companyA.id,
      branchId: branchA.id,
      staffId: midMonthLeaver.id,
      userId: userA.id,
      businessDate: "2026-10-10",
      revenueAmount: 50n,
    }),
    createAttendance({
      companyId: companyA.id,
      branchId: branchA.id,
      staffId: midMonthLeaver.id,
      userId: userA.id,
      businessDate: "2026-10-20",
      revenueAmount: 999n,
    }),
    createAttendance({
      companyId: companyA.id,
      branchId: branchA.id,
      staffId: formerStaff.id,
      userId: userA.id,
      businessDate: "2026-10-03",
      revenueAmount: 5_000n,
    }),
    createAttendance({
      companyId: companyB.id,
      branchId: branchB.id,
      staffId: otherStaff.id,
      userId: userB.id,
      businessDate: "2026-10-08",
      revenueAmount: 8_000n,
    }),
  ]);
});

afterAll(async () => {
  await prisma.$transaction(async (tx) => {
    await tx.liveDailyMetric.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.attendanceDay.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.branchAssignment.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.session.deleteMany({ where: { user: { companyId: { in: companyIds } } } });
    await tx.account.deleteMany({ where: { user: { companyId: { in: companyIds } } } });
    await tx.user.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.staffMember.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.branch.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.company.deleteMany({ where: { id: { in: companyIds } } });
  });
  await prisma.$disconnect();
});

describe("revenue leaderboard tenant and month scope", () => {
  it("returns only overlapping members, handles transfers and archives, and excludes other tenants", async () => {
    const result = await getCurrentRevenueLeaderboard(companyAId, {
      now: new Date("2026-09-30T17:00:00.000Z"),
    });

    expect(result.month).toBe("2026-10");
    expect(result.totalEmployees).toBe(4);
    expect(result.items.map((item) => [item.rank, item.staffCode, item.revenue])).toEqual([
      [1, `A01-${runId}`, "9223372036854775807"],
      [1, `B01-${runId}`, "9223372036854775807"],
      [2, `D01-${runId}`, "50"],
      [3, `C01-${runId}`, "0"],
    ]);
    expect(result.items[0]?.branches).toEqual([
      { code: `A-${runId}`, name: "Cơ sở A" },
      { code: `C-${runId}`, name: "Cơ sở C" },
    ]);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(staffAId);
    expect(serialized).not.toContain(otherCompanyStaffId);
    expect(serialized).not.toContain(`private-a-${runId}@example.com`);
    expect(serialized).not.toContain("0900000000");
    expect(serialized).not.toContain("PRIVATEBANK123");
    expect(serialized).not.toContain("10000000");
  });

  it("does not expose another company when the configured company changes", async () => {
    const result = await getCurrentRevenueLeaderboard(companyBId, {
      now: new Date("2026-10-08T05:00:00.000Z"),
    });

    expect(result.totalEmployees).toBe(1);
    expect(result.items[0]).toMatchObject({
      staffCode: `X01-${runId}`,
      revenue: "8000",
    });
    expect(result.items.some((item) => item.staffCode === `A01-${runId}`)).toBe(false);
  });

  it("fails closed when duplicated tenant columns disagree across related records", async () => {
    const mismatchedAssignment = await prisma.branchAssignment.create({
      data: {
        companyId: companyAId,
        branchId: branchAId,
        staffId: otherCompanyStaffId,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
      },
    });
    try {
      await expect(
        getCurrentRevenueLeaderboard(companyAId, {
          now: new Date("2026-10-28T08:30:00.000Z"),
        }),
      ).rejects.toMatchObject({ reason: "TENANT_SCOPE_MISMATCH" });
    } finally {
      await prisma.branchAssignment.delete({ where: { id: mismatchedAssignment.id } });
    }

    const attendance = await prisma.attendanceDay.create({
      data: {
        companyId: companyAId,
        branchId: branchCId,
        staffId: staffAId,
        businessDate: new Date("2026-10-25T00:00:00.000Z"),
        createdByUserId: userAId,
        updatedByUserId: userAId,
      },
    });
    const mismatchedMetric = await prisma.liveDailyMetric.create({
      data: {
        companyId: companyBId,
        branchId: branchBId,
        attendanceId: attendance.id,
        revenueAmount: 1_000n,
        actualLiveMinutes: 360,
        revenueUnit: "COIN",
        revenueScale: 1,
      },
    });
    try {
      await expect(
        getCurrentRevenueLeaderboard(companyAId, {
          now: new Date("2026-10-28T08:30:00.000Z"),
        }),
      ).rejects.toMatchObject({ reason: "TENANT_SCOPE_MISMATCH" });
    } finally {
      await prisma.liveDailyMetric.delete({ where: { id: mismatchedMetric.id } });
      await prisma.attendanceDay.delete({ where: { id: attendance.id } });
    }
  });
});
