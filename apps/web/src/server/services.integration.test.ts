import { randomUUID } from "node:crypto";

import { DomainError, type ActorContext } from "@ald/domain";
import { prisma } from "@ald/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createAssignment,
  createBranch,
  createUserAccount,
  getBranch,
  listBranches,
  listStaff,
  updateBranch,
} from "./services";
import { auth } from "./auth";

const runId = randomUUID().slice(0, 8);
const companyIds: string[] = [];

const metadata = {
  requestId: `integration-${runId}`,
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
} as const;

let gm: ActorContext;
let manager: ActorContext;
let branchAId: string;
let branchBId: string;
let memberAId: string;

beforeAll(async () => {
  const companyA = await prisma.company.create({
    data: { name: `Company A ${runId}`, slug: `company-a-${runId}` },
  });
  const companyB = await prisma.company.create({
    data: { name: `Company B ${runId}`, slug: `company-b-${runId}` },
  });
  companyIds.push(companyA.id, companyB.id);

  const [branchA, branchB] = await Promise.all([
    prisma.branch.create({
      data: { companyId: companyA.id, code: "A", name: "Cơ sở A" },
    }),
    prisma.branch.create({
      data: { companyId: companyB.id, code: "B", name: "Cơ sở B" },
    }),
  ]);
  branchAId = branchA.id;
  branchBId = branchB.id;

  const [gmStaff, managerStaff, memberA, memberB] = await Promise.all([
    prisma.staffMember.create({
      data: {
        companyId: companyA.id,
        staffCode: "GM",
        fullName: "GM Test",
        jobTitle: "Tổng quản lý",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId: companyA.id,
        staffCode: "TM",
        fullName: "Manager A",
        jobTitle: "Quản lý đào tạo",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId: companyA.id,
        staffCode: "A01",
        fullName: "Nhân viên A",
        jobTitle: "Live",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId: companyB.id,
        staffCode: "B01",
        fullName: "Nhân viên B",
        jobTitle: "Live",
        employmentCategory: "OFFICIAL",
      },
    }),
  ]);
  memberAId = memberA.id;

  const [gmUser, managerUser] = await Promise.all([
    prisma.user.create({
      data: {
        companyId: companyA.id,
        staffId: gmStaff.id,
        name: "GM Test",
        email: `gm-${runId}@test.local`,
        username: `gm_${runId}`,
        role: "GENERAL_MANAGER",
      },
    }),
    prisma.user.create({
      data: {
        companyId: companyA.id,
        staffId: managerStaff.id,
        name: "Manager A",
        email: `tm-${runId}@test.local`,
        username: `tm_${runId}`,
        role: "TRAINING_MANAGER",
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
        staffId: memberA.id,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
    prisma.branchAssignment.create({
      data: {
        companyId: companyB.id,
        branchId: branchB.id,
        staffId: memberB.id,
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
});

afterAll(async () => {
  for (const companyId of companyIds) {
    await prisma.$transaction([
      prisma.$executeRawUnsafe("SET LOCAL ald.audit_cleanup = 'on'"),
      prisma.auditLog.deleteMany({ where: { companyId } }),
      prisma.branchAssignment.deleteMany({ where: { companyId } }),
      prisma.session.deleteMany({ where: { user: { companyId } } }),
      prisma.account.deleteMany({ where: { user: { companyId } } }),
      prisma.user.deleteMany({ where: { companyId } }),
      prisma.branch.deleteMany({ where: { companyId } }),
      prisma.staffMember.deleteMany({ where: { companyId } }),
      prisma.company.deleteMany({ where: { id: companyId } }),
    ]);
  }
  await prisma.$disconnect();
});

describe("tenant và branch scope", () => {
  it("manager chỉ liệt kê branch và staff thuộc branch được phân công", async () => {
    const branches = await listBranches(manager);
    const staff = await listStaff(manager, new Date("2026-07-23T03:00:00.000Z"));

    expect(branches.map(({ id }) => id)).toEqual([branchAId]);
    expect(staff.some(({ id }) => id === memberAId)).toBe(true);
    expect(staff.some(({ fullName }) => fullName === "Nhân viên B")).toBe(false);
    expect(staff.every((item) => !("baseSalaryAmount" in item))).toBe(true);
  });

  it("chặn IDOR khi manager truy cập trực tiếp branch ngoài scope", async () => {
    await expect(getBranch(manager, branchBId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("chặn GM company A sửa object của company B", async () => {
    await expect(
      updateBranch(
        gm,
        branchBId,
        { name: "Không được sửa", version: 1, reason: "Integration IDOR test" },
        metadata,
      ),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("chặn khoảng assignment overlap", async () => {
    await expect(
      createAssignment(
        gm,
        {
          staffId: memberAId,
          branchId: branchAId,
          assignmentType: "MEMBER",
          effectiveFrom: "2026-06-01",
          effectiveTo: null,
          reason: "Integration overlap test",
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("audit skeleton", () => {
  it("ghi audit allow-list khi GM tạo branch", async () => {
    const branch = await createBranch(
      gm,
      {
        code: `AUD${runId}`,
        name: "Branch audit",
        reason: "Integration audit test",
      },
      metadata,
    );

    const audit = await prisma.auditLog.findFirst({
      where: {
        companyId: gm.companyId,
        entityType: "Branch",
        entityId: branch.id,
        action: "branch.create",
      },
    });

    expect(audit?.reason).toBe("Integration audit test");
    expect(audit?.before).toBeNull();
    expect(audit?.after).toMatchObject({ code: `AUD${runId}`.toUpperCase() });
  });

  it("GM cấp account Better Auth, đăng nhập username được và không audit password", async () => {
    const password = "Integration-Password-123!";
    const created = await createUserAccount(
      gm,
      {
        email: `created-${runId}@test.local`,
        username: `created_${runId}`,
        password,
        name: "Created User",
        role: "LIVE_EMPLOYEE",
        staffId: null,
        reason: "Integration account provisioning",
      },
      metadata,
    );

    const signIn = await auth.api.signInUsername({
      body: {
        username: `created_${runId}`,
        password,
      },
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "User", entityId: created.id, action: "user.create" },
    });

    expect(signIn.user.id).toBe(created.id);
    expect(JSON.stringify(audit.after)).not.toContain(password);
  });
});
