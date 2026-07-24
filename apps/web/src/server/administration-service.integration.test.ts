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
let memberId: string;

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

  const [branchA, branchA2, branchB] = await Promise.all([
    prisma.branch.create({
      data: { companyId: companyA.id, code: "ADM-A", name: "Cơ sở Alpha" },
    }),
    prisma.branch.create({
      data: { companyId: companyA.id, code: "ADM-Z", name: "Cơ sở Zeta", isActive: false },
    }),
    prisma.branch.create({
      data: { companyId: companyB.id, code: "OTHER", name: "Không được lộ" },
    }),
  ]);
  branchAId = branchA.id;

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
    await prisma.$transaction([
      prisma.$executeRawUnsafe("SET LOCAL ald.audit_cleanup = 'on'"),
      prisma.auditLog.deleteMany({ where: { companyId } }),
      prisma.branchAssignment.deleteMany({ where: { companyId } }),
      prisma.staffEmploymentHistory.deleteMany({ where: { companyId } }),
      prisma.session.deleteMany({ where: { user: { companyId } } }),
      prisma.account.deleteMany({ where: { user: { companyId } } }),
      prisma.user.deleteMany({ where: { companyId } }),
      prisma.levelHistory.deleteMany({ where: { companyId } }),
      prisma.staffMember.deleteMany({ where: { companyId } }),
      prisma.branch.deleteMany({ where: { companyId } }),
      prisma.company.deleteMany({ where: { id: companyId } }),
    ]);
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
      employmentCategory: "PROBATION",
      user: { active: true },
    });
    expect(result.items[0]?.currentAssignments[0]?.branchId).toBe(branchAId);
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
