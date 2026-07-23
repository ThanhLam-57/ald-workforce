import { randomUUID } from "node:crypto";

import { prisma } from "@ald/db";
import type { ActorContext, DomainError } from "@ald/domain";
import { beforeAll, describe, expect, it } from "vitest";

import { getCompanyDashboard } from "./company-dashboard-service";
import {
  companyReportTotalsEqualBranches,
  getCompanyMonthlyReport,
} from "./company-report-service";
import {
  createManagerKpiEvaluation,
  getManagerKpiSetting,
  listManagerKpiEvaluations,
  publishManagerKpiEvaluation,
  updateManagerKpiEvaluation,
  updateManagerKpiSetting,
} from "./manager-kpi-service";

const runId = randomUUID().slice(0, 8);
const month = "2026-09";
const metadata = {
  requestId: `company-intelligence-${runId}`,
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
} as const;

let companyId: string;
let branchAId: string;
let branchBId: string;
let managerStaffId: string;
let gm: ActorContext;
let manager: ActorContext;
let employee: ActorContext;

beforeAll(async () => {
  const company = await prisma.company.create({
    data: { name: `Company report ${runId}`, slug: `company-report-${runId}` },
  });
  companyId = company.id;
  const [branchA, branchB] = await Promise.all([
    prisma.branch.create({
      data: { companyId, code: "A", name: "Cơ sở A" },
    }),
    prisma.branch.create({
      data: { companyId, code: "B", name: "Cơ sở B", isActive: false },
    }),
  ]);
  branchAId = branchA.id;
  branchBId = branchB.id;
  const [gmStaff, managerStaff, activeStaff, formerStaff] = await Promise.all([
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: "GM",
        fullName: "GM Report",
        jobTitle: "Tổng quản lý",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: "TM",
        fullName: "Manager Report",
        jobTitle: "Quản lý đào tạo",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: "LIVE-A",
        fullName: "Live A",
        jobTitle: "Nhân viên Live",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: "FORMER-B",
        fullName: "Nhân viên đã nghỉ B",
        jobTitle: "Nhân viên Live",
        employmentCategory: "PROBATION",
        employmentStatus: "TERMINATED",
        archivedAt: new Date("2026-09-16T00:00:00.000Z"),
      },
    }),
  ]);
  managerStaffId = managerStaff.id;
  const [gmUser, managerUser, employeeUser] = await Promise.all([
    prisma.user.create({
      data: {
        companyId,
        staffId: gmStaff.id,
        name: "GM Report",
        email: `company-gm-${runId}@test.local`,
        username: `company_gm_${runId}`,
        role: "GENERAL_MANAGER",
      },
    }),
    prisma.user.create({
      data: {
        companyId,
        staffId: managerStaff.id,
        name: "Manager Report",
        email: `company-tm-${runId}@test.local`,
        username: `company_tm_${runId}`,
        role: "TRAINING_MANAGER",
      },
    }),
    prisma.user.create({
      data: {
        companyId,
        staffId: activeStaff.id,
        name: "Live A",
        email: `company-live-${runId}@test.local`,
        username: `company_live_${runId}`,
        role: "LIVE_EMPLOYEE",
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
    activeBranchIds: [branchA.id],
  };
  employee = {
    userId: employeeUser.id,
    companyId,
    staffId: activeStaff.id,
    role: "LIVE_EMPLOYEE",
    activeBranchIds: [],
  };
  await prisma.branchAssignment.createMany({
    data: [
      {
        companyId,
        branchId: branchA.id,
        staffId: managerStaff.id,
        assignmentType: "PRIMARY_MANAGER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        companyId,
        branchId: branchA.id,
        staffId: activeStaff.id,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        companyId,
        branchId: branchB.id,
        staffId: formerStaff.id,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-09-16T00:00:00.000Z"),
      },
    ],
  });
  await prisma.staffEmploymentHistory.createMany({
    data: [
      {
        companyId,
        staffId: activeStaff.id,
        employmentStatus: "ACTIVE",
        employmentCategory: "OFFICIAL",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        companyId,
        staffId: formerStaff.id,
        employmentStatus: "ACTIVE",
        employmentCategory: "PROBATION",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-09-16T00:00:00.000Z"),
      },
      {
        companyId,
        staffId: formerStaff.id,
        employmentStatus: "TERMINATED",
        employmentCategory: "PROBATION",
        effectiveFrom: new Date("2026-09-16T00:00:00.000Z"),
      },
      {
        companyId,
        staffId: managerStaff.id,
        employmentStatus: "ACTIVE",
        employmentCategory: "OFFICIAL",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    ],
  });
  await Promise.all([
    prisma.attendanceDay.create({
      data: {
        companyId,
        branchId: branchA.id,
        staffId: activeStaff.id,
        businessDate: new Date("2026-09-07T00:00:00.000Z"),
        status: "PRESENT",
        workUnits: "1",
        createdByUserId: gm.userId,
        updatedByUserId: gm.userId,
        liveMetric: {
          create: {
            companyId,
            branchId: branchA.id,
            actualLiveMinutes: 300,
            revenueAmount: 1000n,
            revenueUnit: "VND",
            revenueScale: 1,
          },
        },
      },
    }),
    prisma.attendanceDay.create({
      data: {
        companyId,
        branchId: branchB.id,
        staffId: formerStaff.id,
        businessDate: new Date("2026-09-01T00:00:00.000Z"),
        status: "PRESENT",
        workUnits: "0.5",
        createdByUserId: gm.userId,
        updatedByUserId: gm.userId,
        liveMetric: {
          create: {
            companyId,
            branchId: branchB.id,
            actualLiveMinutes: 200,
            revenueAmount: 2000n,
            revenueUnit: "VND",
            revenueScale: 1,
          },
        },
      },
    }),
    prisma.attendanceDay.create({
      data: {
        companyId,
        branchId: branchA.id,
        staffId: managerStaff.id,
        businessDate: new Date("2026-09-02T00:00:00.000Z"),
        status: "PRESENT",
        workUnits: "1",
        createdByUserId: gm.userId,
        updatedByUserId: gm.userId,
      },
    }),
  ]);
  const ruleSet = await prisma.ruleSet.create({
    data: {
      companyId,
      type: "KPI_TEMPLATE",
      name: "KPI Manager",
      createdByUserId: gm.userId,
    },
  });
  await prisma.ruleVersion.create({
    data: {
      companyId,
      ruleSetId: ruleSet.id,
      versionNo: 1,
      status: "ACTIVE",
      effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-10-01T00:00:00.000Z"),
      configuration: {
        kind: "KPI_TEMPLATE",
        criteria: [
          {
            code: "QUALITY",
            name: "Chất lượng đào tạo",
            description: "Chất lượng đầu ra",
            weightBps: 5000,
            maxScore: 100,
            requiredEvidence: true,
            requiredNote: true,
            displayOrder: 1,
          },
          {
            code: "PROCESS",
            name: "Tuân thủ quy trình",
            description: "Tuân thủ vận hành",
            weightBps: 5000,
            maxScore: 100,
            requiredEvidence: false,
            requiredNote: false,
            displayOrder: 2,
          },
        ],
      },
      createdByUserId: gm.userId,
      publishedByUserId: gm.userId,
      publishedAt: new Date(),
    },
  });
});

describe("company report and GM dashboard", () => {
  it("reconciles company totals to branches and preserves historical assignments", async () => {
    const report = await getCompanyMonthlyReport(gm, { month });

    expect(report.totals.revenueAmount).toBe("3000");
    expect(report.totals.workUnits).toBe("1.5");
    expect(companyReportTotalsEqualBranches(report)).toBe(true);
    expect(
      report.branches.find((branch) => branch.branch.id === branchBId)?.staff[0]?.staff,
    ).toMatchObject({
      staffCode: "FORMER-B",
      employmentStatus: "TERMINATED",
    });
    const formerOnly = await getCompanyMonthlyReport(gm, {
      month,
      employmentStatus: "TERMINATED",
    });
    expect(formerOnly.branches.flatMap((branch) => branch.staff)).toHaveLength(1);
    expect(formerOnly.totals.revenueAmount).toBe("2000");
  });

  it("provides branch drill-down and denies non-GM company access", async () => {
    const dashboard = await getCompanyDashboard(gm, { month }, new Date("2026-10-02T00:00:00Z"));

    expect(dashboard.branches).toHaveLength(2);
    expect(dashboard.totals.revenueAmount).toBe("3000");
    expect(dashboard.branches.find((branch) => branch.id === branchAId)?.revenueAmount).toBe(
      "1000",
    );
    await expect(getCompanyMonthlyReport(manager, { month })).rejects.toMatchObject({
      code: "FORBIDDEN",
    } satisfies Partial<DomainError>);
    await expect(getCompanyDashboard(employee, { month })).rejects.toMatchObject({
      code: "FORBIDDEN",
    } satisfies Partial<DomainError>);
  });
});

describe("manager KPI", () => {
  it("enforces draft/published access, effective template and immutable publish", async () => {
    let evaluation = await createManagerKpiEvaluation(
      gm,
      {
        managerStaffId,
        month,
        notes: "Draft KPI",
        reason: "Tạo KPI integration",
      },
      metadata,
    );
    expect(evaluation.attendance.workUnits).toBe("1");
    await expect(listManagerKpiEvaluations(manager, { month })).rejects.toMatchObject({
      code: "FORBIDDEN",
    } satisfies Partial<DomainError>);

    evaluation = await updateManagerKpiEvaluation(
      gm,
      evaluation.id,
      {
        version: evaluation.version,
        notes: "Đã chấm",
        reason: "Chấm KPI integration",
        criteria: [
          {
            code: "QUALITY",
            score: "80",
            note: "Đạt chất lượng",
            evidence: "Tài liệu nội bộ QA-01",
          },
          {
            code: "PROCESS",
            score: "60",
            note: null,
            evidence: null,
          },
        ],
      },
      metadata,
    );
    expect(evaluation.totalScore).toBe("70");
    evaluation = await publishManagerKpiEvaluation(
      gm,
      evaluation.id,
      { version: evaluation.version, reason: "Publish KPI integration" },
      metadata,
    );
    expect(evaluation.status).toBe("PUBLISHED");
    const setting = await getManagerKpiSetting(gm);
    await updateManagerKpiSetting(
      gm,
      {
        enabled: true,
        version: setting.version,
        reason: "Bật KPI self-service integration",
      },
      metadata,
    );
    const own = await listManagerKpiEvaluations(manager, { month });
    expect(own).toHaveLength(1);
    expect(own[0]?.manager.id).toBe(managerStaffId);
    await expect(
      prisma.managerKpiCriterionLine.update({
        where: { id: evaluation.criteria[0]!.id },
        data: { score: "1" },
      }),
    ).rejects.toThrow(/immutable/i);
  });
});
