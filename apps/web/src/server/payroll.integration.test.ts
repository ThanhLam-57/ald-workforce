import { randomUUID } from "node:crypto";

import { prisma } from "@ald/db";
import type { ActorContext, DomainError } from "@ald/domain";
import { beforeAll, describe, expect, it } from "vitest";

import {
  calculatePayrollPeriod,
  createPayrollAdjustment,
  createPayrollPeriod,
  getPayrollPeriod,
  listPayrollPeriods,
  lockPayrollPeriod,
  publishPayrollPeriod,
  reviewPayrollPeriod,
} from "./payroll-service";
import { getPayrollExport, getPayrollExportDownload } from "./payroll-export-service";

const runId = randomUUID().slice(0, 8);
const metadata = {
  requestId: `payroll-${runId}`,
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
} as const;

let companyId: string;
let branchId: string;
let liveId: string;
let periodId: string;
let gm: ActorContext;
let manager: ActorContext;
let employee: ActorContext;
let outsider: ActorContext;

beforeAll(async () => {
  process.env.S3_ENDPOINT ??= "http://127.0.0.1:9000";
  process.env.S3_REGION ??= "us-east-1";
  process.env.S3_BUCKET ??= "ald-private";
  process.env.S3_ACCESS_KEY ??= "ald_minio";
  process.env.S3_SECRET_KEY ??= "ald_minio_local_password";
  process.env.S3_FORCE_PATH_STYLE ??= "true";
  const company = await prisma.company.create({
    data: {
      name: `Payroll ${runId}`,
      slug: `payroll-${runId}`,
      selfServiceEnabled: true,
    },
  });
  companyId = company.id;
  const branch = await prisma.branch.create({
    data: { companyId, code: "A", name: "Cơ sở Payroll" },
  });
  branchId = branch.id;
  const [gmStaff, managerStaff, liveStaff] = await Promise.all([
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: "GM",
        fullName: "GM Payroll",
        jobTitle: "Tổng quản lý",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: "TM",
        fullName: "Manager Payroll",
        jobTitle: "Quản lý đào tạo",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: "LIVE",
        fullName: "Live Payroll",
        streamingAlias: "payroll-demo",
        jobTitle: "Nhân viên Live",
        employmentCategory: "OFFICIAL",
      },
    }),
  ]);
  liveId = liveStaff.id;
  const [gmUser, managerUser, employeeUser] = await Promise.all([
    prisma.user.create({
      data: {
        companyId,
        staffId: gmStaff.id,
        name: "GM Payroll",
        email: `payroll-gm-${runId}@test.local`,
        username: `payroll_gm_${runId}`,
        role: "GENERAL_MANAGER",
      },
    }),
    prisma.user.create({
      data: {
        companyId,
        staffId: managerStaff.id,
        name: "TM Payroll",
        email: `payroll-tm-${runId}@test.local`,
        username: `payroll_tm_${runId}`,
        role: "TRAINING_MANAGER",
      },
    }),
    prisma.user.create({
      data: {
        companyId,
        staffId: liveStaff.id,
        name: "Live Payroll",
        email: `payroll-live-${runId}@test.local`,
        username: `payroll_live_${runId}`,
        role: "LIVE_EMPLOYEE",
      },
    }),
  ]);
  await prisma.branchAssignment.create({
    data: {
      companyId,
      branchId,
      staffId: liveStaff.id,
      assignmentType: "MEMBER",
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
    activeBranchIds: [branchId],
  };
  employee = {
    userId: employeeUser.id,
    companyId,
    staffId: liveStaff.id,
    role: "LIVE_EMPLOYEE",
    activeBranchIds: [],
  };
  const outsiderCompany = await prisma.company.create({
    data: { name: `Outsider ${runId}`, slug: `payroll-outsider-${runId}` },
  });
  const outsiderUser = await prisma.user.create({
    data: {
      companyId: outsiderCompany.id,
      name: "Outsider",
      email: `payroll-outsider-${runId}@test.local`,
      username: `payroll_outsider_${runId}`,
      role: "GENERAL_MANAGER",
    },
  });
  outsider = {
    userId: outsiderUser.id,
    companyId: outsiderCompany.id,
    staffId: null,
    role: "GENERAL_MANAGER",
    activeBranchIds: [],
  };

  const [salarySet, dailySet, monthlySet, penaltySet] = await Promise.all(
    [
      ["SALARY_RULES", "Lương"],
      ["DAILY_REWARD_TIERS", "Thưởng ngày"],
      ["MONTHLY_LEVEL_RULES", "Thưởng tháng"],
      ["PENALTY", "Phạt"],
    ].map(([type, name]) =>
      prisma.ruleSet.create({
        data: {
          companyId,
          type: type as "SALARY_RULES" | "DAILY_REWARD_TIERS" | "MONTHLY_LEVEL_RULES" | "PENALTY",
          name: `${name} ${runId}`,
          createdByUserId: gmUser.id,
        },
      }),
    ),
  );
  const ruleVersions = await Promise.all([
    prisma.ruleVersion.create({
      data: {
        companyId,
        ruleSetId: salarySet!.id,
        versionNo: 1,
        status: "ACTIVE",
        effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-08-01T00:00:00.000Z"),
        configuration: {
          kind: "SALARY_RULES",
          baseSalary: "26000000",
          standardWorkdays: "26",
          standardDailyMinutes: 480,
          overtime: { multiplierBps: 15000, eligibleAfterMinutes: 0 },
          attendancePolicy: {
            eligibleStatuses: ["PRESENT"],
            prorateMode: "WORK_UNITS",
            minimumWorkUnitsForFullSalary: null,
            capAtStandardWorkdays: true,
          },
          roundingPolicy: { unit: 1, mode: "HALF_UP", applyAt: "COMPONENT" },
        },
        createdByUserId: gmUser.id,
        publishedByUserId: gmUser.id,
        publishedAt: new Date(),
      },
    }),
    prisma.ruleVersion.create({
      data: {
        companyId,
        ruleSetId: dailySet!.id,
        versionNo: 1,
        status: "ACTIVE",
        effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-08-01T00:00:00.000Z"),
        configuration: {
          kind: "DAILY_REWARD_TIERS",
          gapPolicy: "REQUIRE_CONTIGUOUS",
          tiers: [
            {
              code: "ALL",
              name: "Tất cả",
              minRevenue: "0",
              maxRevenue: null,
              minInclusive: true,
              maxInclusive: false,
              rewardAmount: "100000",
              priority: 0,
            },
          ],
        },
        createdByUserId: gmUser.id,
        publishedByUserId: gmUser.id,
        publishedAt: new Date(),
      },
    }),
    prisma.ruleVersion.create({
      data: {
        companyId,
        ruleSetId: monthlySet!.id,
        versionNo: 1,
        status: "ACTIVE",
        effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-08-01T00:00:00.000Z"),
        configuration: {
          kind: "MONTHLY_LEVEL_RULES",
          gapPolicy: "REQUIRE_CONTIGUOUS",
          levels: [
            {
              code: "L3",
              name: "Level 3",
              displayOrder: 3,
              minRevenue: "0",
              maxRevenue: null,
              minInclusive: true,
              maxInclusive: false,
              monthlyRevenueBonus: "500000",
              attendanceBonus: "200000",
              achievementBonus: "300000",
              retainLevelBonus: "100000",
              jumpLevelBonus: "400000",
              attendanceMinWorkUnits: "0.5",
              achievementMinLiveMinutes: 300,
              jumpMinLevelSteps: 2,
            },
          ],
        },
        createdByUserId: gmUser.id,
        publishedByUserId: gmUser.id,
        publishedAt: new Date(),
      },
    }),
    prisma.ruleVersion.create({
      data: {
        companyId,
        ruleSetId: penaltySet!.id,
        versionNo: 1,
        status: "DRAFT",
        createdByUserId: gmUser.id,
      },
    }),
  ]);
  const penaltyVersion = ruleVersions[3]!;
  const penaltyItem = await prisma.penaltyItem.create({
    data: {
      companyId,
      ruleVersionId: penaltyVersion.id,
      code: "LATE",
      name: "Đi muộn",
      description: "Đi muộn",
      defaultAmount: 150000n,
    },
  });
  await prisma.ruleVersion.update({
    where: { id: penaltyVersion.id },
    data: {
      status: "ACTIVE",
      effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-08-01T00:00:00.000Z"),
      publishedByUserId: gmUser.id,
      publishedAt: new Date(),
    },
  });
  const level = await prisma.performanceLevel.create({
    data: { companyId, code: "L3", name: "Level 3", displayOrder: 3 },
  });
  await prisma.levelHistory.create({
    data: {
      companyId,
      staffId: liveStaff.id,
      performanceLevelId: level.id,
      effectiveFrom: new Date("2026-07-15T00:00:00.000Z"),
      createdByUserId: gmUser.id,
    },
  });
  const attendance = await prisma.attendanceDay.create({
    data: {
      companyId,
      branchId,
      staffId: liveStaff.id,
      businessDate: new Date("2026-07-20T00:00:00.000Z"),
      status: "PRESENT",
      workUnits: "0.5",
      overtimeMinutes: 60,
      createdByUserId: gmUser.id,
      updatedByUserId: gmUser.id,
      liveMetric: {
        create: {
          companyId,
          branchId,
          actualLiveMinutes: 300,
          revenueAmount: 1000000n,
          revenueUnit: "VND",
          revenueScale: 1,
        },
      },
    },
  });
  await prisma.violation.create({
    data: {
      companyId,
      branchId,
      attendanceId: attendance.id,
      staffId: liveStaff.id,
      businessDate: attendance.businessDate,
      penaltyItemId: penaltyItem.id,
      ruleVersionId: penaltyVersion.id,
      itemName: penaltyItem.name,
      amount: 150000n,
      detail: "Snapshot phạt",
      createdByUserId: gmUser.id,
    },
  });

  const period = await createPayrollPeriod(
    gm,
    { branchId, month: "2026-07", reason: "Tạo kỳ test" },
    metadata,
  );
  periodId = period.id;
});

describe("payroll lifecycle, snapshot và authorization", () => {
  it("calculates golden totals and recalculates idempotently", async () => {
    const calculated = await calculatePayrollPeriod(
      gm,
      periodId,
      { version: 1, reason: "Tính lương lần đầu" },
      metadata,
    );
    expect(calculated.status).toBe("CALCULATED");
    expect(calculated.entries).toHaveLength(1);
    expect(calculated.entries[0]!.totalIncome).toBe("1737500");
    expect(calculated.entries[0]!.workUnits).toBe("0.5");
    expect(calculated.entries[0]!.penalties).toBe("150000");

    const unchanged = await calculatePayrollPeriod(
      gm,
      periodId,
      { version: calculated.version, reason: "Tính lại không đổi input" },
      metadata,
    );
    expect(unchanged.version).toBe(calculated.version);
    expect(unchanged.latestCalculationNo).toBe(calculated.latestCalculationNo);
    expect(unchanged.entries[0]!.calculationHash).toBe(calculated.entries[0]!.calculationHash);
  });

  it("denies training-manager and cross-company IDOR access", async () => {
    await expect(getPayrollPeriod(manager, periodId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    } satisfies Partial<DomainError>);
    await expect(getPayrollPeriod(outsider, periodId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    } satisfies Partial<DomainError>);
    await expect(listPayrollPeriods(manager, { branchId, month: "2026-07" })).rejects.toMatchObject(
      { code: "FORBIDDEN" } satisfies Partial<DomainError>,
    );
  });

  it("locks immutably, creates a correction revision and only exposes published own payslip", async () => {
    let period = await getPayrollPeriod(gm, periodId);
    await expect(getPayrollPeriod(employee, periodId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    } satisfies Partial<DomainError>);
    period = await reviewPayrollPeriod(
      gm,
      periodId,
      { version: period.version, reason: "Review test" },
      metadata,
    );
    period = await lockPayrollPeriod(
      gm,
      periodId,
      { version: period.version, reason: "Lock test" },
      metadata,
    );
    const lockedHash = period.entries[0]!.calculationHash;
    await expect(
      calculatePayrollPeriod(
        gm,
        periodId,
        { version: period.version, reason: "Không được tính kỳ khóa" },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" } satisfies Partial<DomainError>);
    await expect(
      prisma.payrollEntry.update({
        where: { id: period.entries[0]!.id },
        data: { totalIncome: 1n },
      }),
    ).rejects.toThrow(/immutable/i);

    const revision = await createPayrollAdjustment(
      gm,
      periodId,
      {
        staffId: liveId,
        type: "CORRECTION",
        amount: "50000",
        reason: "Điều chỉnh sau khóa",
        periodVersion: period.version,
      },
      metadata,
    );
    expect(revision.revision).toBe(2);
    expect(revision.status).toBe("DRAFT");
    expect(revision.sourcePeriodId).toBe(periodId);
    expect((await getPayrollPeriod(gm, periodId)).entries[0]!.calculationHash).toBe(lockedHash);

    period = await publishPayrollPeriod(
      gm,
      periodId,
      { version: period.version, reason: "Publish payslip" },
      metadata,
    );
    const ownPayslip = await getPayrollPeriod(employee, periodId);
    expect(ownPayslip.status).toBe("PUBLISHED");
    expect(ownPayslip.entries).toHaveLength(1);
    expect(ownPayslip.entries[0]!.staff.id).toBe(liveId);
    expect(ownPayslip.entries[0]).not.toHaveProperty("revenueAmount");
    expect(ownPayslip.entries[0]!.dailyRows[0]).not.toHaveProperty("revenueAmount");
    expect(
      ownPayslip.entries[0]!.lines.some((line) =>
        JSON.stringify(line.calculationDetails).toLowerCase().includes("revenue"),
      ),
    ).toBe(false);

    const exportJob = await prisma.payrollExportJob.create({
      data: {
        companyId,
        branchId,
        payrollPeriodId: periodId,
        staffId: liveId,
        kind: "PAYSLIP_PDF",
        status: "COMPLETED",
        progress: 100,
        objectKey: `${companyId}/payroll/test.pdf`,
        fileName: "phieu-luong-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1000n,
        checksumSha256: "test",
        requestedByUserId: employee.userId,
        requestReason: "Kiểm thử download",
        completedAt: new Date(),
      },
    });
    await expect(getPayrollExport(manager, exportJob.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    } satisfies Partial<DomainError>);
    const download = await getPayrollExportDownload(employee, exportJob.id, metadata);
    expect(download.url).toContain("X-Amz-Signature");
    expect(
      await prisma.payrollDownloadLog.count({
        where: { exportJobId: exportJob.id, downloadedByUserId: employee.userId },
      }),
    ).toBe(1);
  });
});
