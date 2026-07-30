import { randomUUID } from "node:crypto";

import { prisma } from "@ald/db";
import type { ActorContext, DomainError } from "@ald/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  calculatePayrollPeriod,
  createPayrollPeriod,
  ensurePayrollPeriod,
  getPayrollPeriod,
  getPayrollPrintData,
  listPayrollBranches,
  listPayrollPeriods,
  lockPayrollPeriod,
  reviewPayrollPeriod,
  savePayrollWorksheet,
  sendPayrollPeriod,
} from "./payroll-service";
import { getPayrollExport, getPayrollExportDownload } from "./payroll-export-service";

const runId = randomUUID().slice(0, 8);
const metadata = {
  requestId: `payroll-${runId}`,
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
} as const;

let companyId: string;
let outsiderCompanyId: string;
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
        baseSalaryAmount: 26_000_000n,
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
      attendanceMachineCode: "00033",
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
  outsiderCompanyId = outsiderCompany.id;
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
        effectiveTo: null,
        configuration: {
          kind: "SALARY_RULES",
          baseSalary: "99000000",
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
        effectiveTo: null,
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
        effectiveTo: null,
        configuration: {
          kind: "MONTHLY_LEVEL_RULES",
          gapPolicy: "REQUIRE_CONTIGUOUS",
          attendanceRequiredDays: 1,
          levels: [
            {
              code: "L1",
              name: "Level 1",
              displayOrder: 1,
              minRevenue: "0",
              maxRevenue: "1000000",
              minInclusive: true,
              maxInclusive: false,
              monthlyRevenueBonus: "0",
              attendanceBonus: "100000",
              achievementBonus: "0",
              retainLevelBonus: "50000",
              jumpLevelBonus: "0",
              attendanceMinWorkUnits: null,
              achievementMinLiveMinutes: null,
              jumpMinLevelSteps: 1,
            },
            {
              code: "L3",
              name: "Level 3",
              displayOrder: 3,
              minRevenue: "0",
              maxRevenue: null,
              minInclusive: true,
              maxInclusive: false,
              monthlyRevenueBonus: "0",
              attendanceBonus: "200000",
              achievementBonus: "300000",
              retainLevelBonus: "100000",
              jumpLevelBonus: "400000",
              attendanceMinWorkUnits: null,
              achievementMinLiveMinutes: null,
              jumpMinLevelSteps: 1,
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
          revenueUnit: "COIN",
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
      penaltyItemCode: penaltyItem.code,
      countingKey: penaltyItem.code,
      occurrenceNo: 1,
      countingWindow: "CALENDAR_MONTH",
      countingPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
      countingPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      penaltyStartsAt: 1,
      snapshottedDefaultAmount: 150000n,
      computedAmount: 150000n,
      isChargeable: true,
      responsibleParty: "VIOLATING_STAFF",
      itemName: penaltyItem.name,
      amount: 150000n,
      detail: "Snapshot phạt",
      createdByUserId: gmUser.id,
    },
  });
  await prisma.attendanceDay.create({
    data: {
      companyId,
      branchId,
      staffId: liveStaff.id,
      businessDate: new Date("2026-06-20T00:00:00.000Z"),
      status: "PRESENT",
      workUnits: "1",
      createdByUserId: gmUser.id,
      updatedByUserId: gmUser.id,
      liveMetric: {
        create: {
          companyId,
          branchId,
          actualLiveMinutes: 300,
          revenueAmount: 500000n,
          revenueUnit: "COIN",
          revenueScale: 1,
        },
      },
    },
  });

  const period = await createPayrollPeriod(gm, { branchId, month: "2026-07" }, metadata);
  periodId = period.id;
});

afterAll(async () => {
  const companyIds = [companyId, outsiderCompanyId].filter(Boolean);
  if (companyIds.length === 0) return;
  await prisma.$transaction(async (tx) => {
    const guardedTables = [
      ["payroll_download_logs", "payroll_download_logs_no_delete"],
      ["payroll_export_jobs", "payroll_export_jobs_no_delete"],
      ["payroll_lines", "payroll_lines_guard"],
      ["calculation_snapshots", "calculation_snapshots_guard"],
      ["payroll_worksheet_overrides", "payroll_worksheet_overrides_guard"],
      ["payroll_entries", "payroll_entries_guard"],
      ["payroll_adjustments", "payroll_adjustments_guard"],
      ["payroll_periods", "payroll_periods_guard"],
      ["violations", "violations_no_hard_delete"],
      ["penalty_items", "penalty_items_published_immutable"],
      ["rule_versions", "rule_versions_published_immutable"],
      ["level_history", "level_history_no_hard_delete"],
    ] as const;
    for (const [table, trigger] of guardedTables) {
      await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`);
    }
    await tx.$executeRawUnsafe("SET LOCAL ald.audit_cleanup = 'on'");
    await tx.payrollDownloadLog.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.payrollExportJob.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.payrollLine.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.payrollEntry.updateMany({
      where: { companyId: { in: companyIds } },
      data: { currentSnapshotId: null },
    });
    await tx.calculationSnapshot.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.payrollWorksheetOverride.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.payrollAdjustment.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.payrollEntry.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.payrollPeriod.updateMany({
      where: { companyId: { in: companyIds } },
      data: { sourcePeriodId: null },
    });
    await tx.payrollPeriod.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.violation.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.penaltyItem.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.ruleVersion.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.ruleSet.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.levelHistory.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.performanceLevel.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.liveDailyMetric.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.attendanceDay.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.auditLog.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.branchAssignment.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.session.deleteMany({ where: { user: { companyId: { in: companyIds } } } });
    await tx.account.deleteMany({ where: { user: { companyId: { in: companyIds } } } });
    await tx.user.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.staffMember.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.branch.deleteMany({ where: { companyId: { in: companyIds } } });
    await tx.company.deleteMany({ where: { id: { in: companyIds } } });
    for (const [table, trigger] of [...guardedTables].reverse()) {
      await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}"`);
    }
  });
});

describe("payroll lifecycle, snapshot và authorization", () => {
  it("calculates golden totals and recalculates idempotently", async () => {
    const calculated = await calculatePayrollPeriod(gm, periodId, { version: 1 }, metadata);
    expect(calculated.status).toBe("CALCULATED");
    expect(calculated.entries).toHaveLength(1);
    expect(calculated.entries[0]!.totalIncome).toBe("1537500");
    expect(calculated.entries[0]!.workUnits).toBe("0.5");
    expect(calculated.entries[0]!.penalties).toBe("150000");
    expect(calculated.entries[0]!.staff).toMatchObject({
      staffCode: "LIVE",
      attendanceMachineCode: "00033",
      attendanceMachineCodeIntervals: [
        expect.objectContaining({
          attendanceMachineCode: "00033",
          effectiveFrom: "2026-01-01",
        }),
      ],
    });
    expect(calculated.entries[0]!.monthlyLevel).toMatchObject({
      workedDayCount: 1,
      attendanceRequiredDays: 1,
      previousMonthCoins: "500000",
      previousMonthCoinsSource: "ATTENDANCE_LIVE",
      previousLevelCode: "L1",
      currentMonthCoins: "1000000",
      currentLevelCode: "L3",
      transition: "JUMP",
    });
    expect(calculated.entries[0]).toMatchObject({
      attendanceBonus: "200000",
      achievementBonus: "300000",
      levelBonus: "400000",
    });
    const snapshot = await prisma.calculationSnapshot.findFirstOrThrow({
      where: { payrollEntryId: calculated.entries[0]!.id },
      orderBy: { calculationNo: "desc" },
      select: { inputs: true, outputs: true },
    });
    expect((snapshot.inputs as unknown as { baseSalaryAmount: string }).baseSalaryAmount).toBe(
      "26000000",
    );
      expect(snapshot.inputs).toMatchObject({
        period: {
          branchId,
        },
        staffIdentity: {
          staffCode: "LIVE",
        attendanceMachineCodeIntervals: [
          expect.objectContaining({ attendanceMachineCode: "00033" }),
        ],
      },
    });
    expect(
      (snapshot.outputs as unknown as { components: { baseSalary: string } }).components.baseSalary,
    ).toBe("26000000");

    const unchanged = await calculatePayrollPeriod(
      gm,
      periodId,
      { version: calculated.version },
      metadata,
    );
    expect(unchanged.version).toBe(calculated.version);
    expect(unchanged.latestCalculationNo).toBe(calculated.latestCalculationNo);
    expect(unchanged.entries[0]!.calculationHash).toBe(calculated.entries[0]!.calculationHash);

    await prisma.branchAssignment.updateMany({
      where: { companyId, branchId, staffId: liveId, assignmentType: "MEMBER" },
      data: { attendanceMachineCode: "99999" },
    });
    expect((await getPayrollPeriod(gm, periodId)).entries[0]!.staff.attendanceMachineCode).toBe(
      "00033",
    );
    await prisma.branchAssignment.updateMany({
      where: { companyId, branchId, staffId: liveId, assignmentType: "MEMBER" },
      data: { attendanceMachineCode: "00033" },
    });
  });

  it("snapshots and recalculates the 85/100 employment salary split", async () => {
    const branch = await prisma.branch.create({
      data: {
        companyId,
        code: `EMP${runId.slice(0, 4)}`,
        name: "Cơ sở ngày chính thức",
      },
    });
    const staff = await prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `EMP${runId.slice(0, 4)}`,
        fullName: "Nhân viên chuyển chính thức",
        jobTitle: "Nhân viên Live",
        baseSalaryAmount: 26_000_000n,
        joinedDate: new Date("2026-07-01T00:00:00.000Z"),
        officialDate: new Date("2026-07-02T00:00:00.000Z"),
        employmentCategory: "OFFICIAL",
      },
    });
    await prisma.branchAssignment.create({
      data: {
        companyId,
        branchId: branch.id,
        staffId: staff.id,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
      },
    });
    await Promise.all(
      (
        [
          ["2026-07-01", "0.5"],
          ["2026-07-02", "1"],
        ] as const
      ).map(([businessDate, workUnits]) =>
        prisma.attendanceDay.create({
          data: {
            companyId,
            branchId: branch.id,
            staffId: staff.id,
            businessDate: new Date(`${businessDate}T00:00:00.000Z`),
            status: "PRESENT",
            workUnits,
            createdByUserId: gm.userId,
            updatedByUserId: gm.userId,
          },
        }),
      ),
    );
    let period = await ensurePayrollPeriod(
      gm,
      {
        branchId: branch.id,
        month: "2026-07",
      },
      metadata,
    );
    period = await calculatePayrollPeriod(gm, period.id, { version: period.version }, metadata);
    expect(period.entries[0]).toMatchObject({
      proratedSalary: "1425000",
      employmentSalary: {
        joinedDate: "2026-07-01",
        officialDate: "2026-07-02",
        probationSalaryRateBps: 8_500,
        probationWorkUnits: "0.5",
        officialWorkUnits: "1",
        probationSalaryAmount: "425000",
        officialSalaryAmount: "1000000",
      },
    });
    const firstHash = period.entries[0]!.calculationHash;
    const firstSnapshot = await prisma.calculationSnapshot.findFirstOrThrow({
      where: { payrollEntryId: period.entries[0]!.id, calculationNo: 1 },
      select: { inputs: true, outputs: true },
    });
    expect(firstSnapshot.inputs).toMatchObject({
      employment: {
        joinedDate: "2026-07-01",
        officialDate: "2026-07-02",
        category: "OFFICIAL",
      },
      salaryRule: { configuration: { probationSalaryRateBps: 8_500 } },
    });

    await prisma.staffMember.update({
      where: { id: staff.id },
      data: { officialDate: new Date("2026-07-01T00:00:00.000Z") },
    });
    const recalculated = await calculatePayrollPeriod(
      gm,
      period.id,
      { version: period.version },
      metadata,
    );
    expect(recalculated.entries[0]).toMatchObject({
      proratedSalary: "1500000",
      employmentSalary: {
        officialDate: "2026-07-01",
        probationWorkUnits: "0",
        officialWorkUnits: "1.5",
      },
    });
    expect(recalculated.entries[0]!.calculationHash).not.toBe(firstHash);
    expect(firstSnapshot.outputs).toMatchObject({
      employmentSalary: {
        officialDate: "2026-07-02",
        calculatedProratedSalary: "1425000",
      },
    });

    const reviewed = await reviewPayrollPeriod(
      gm,
      recalculated.id,
      { version: recalculated.version },
      metadata,
    );
    const locked = await lockPayrollPeriod(
      gm,
      reviewed.id,
      { version: reviewed.version },
      metadata,
    );
    await prisma.staffMember.update({
      where: { id: staff.id },
      data: { officialDate: new Date("2026-07-03T00:00:00.000Z") },
    });
    await expect(
      calculatePayrollPeriod(gm, locked.id, { version: locked.version }, metadata),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const stillLocked = await getPayrollPeriod(gm, locked.id);
    expect(stillLocked).toMatchObject({
      status: "LOCKED",
      entries: [
        {
          calculationHash: recalculated.entries[0]!.calculationHash,
          employmentSalary: {
            officialDate: "2026-07-01",
            calculatedProratedSalary: "1500000",
          },
        },
      ],
    });
  });

  it("uses a manual previous-month coin baseline only until real attendance data exists", async () => {
    const branch = await prisma.branch.create({
      data: { companyId, code: `M${runId.slice(0, 4)}`, name: "Cơ sở baseline xu" },
    });
    const staff = await prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `BASE${runId.slice(0, 4)}`,
        fullName: "Nhân viên baseline xu",
        jobTitle: "Nhân viên Live",
        employmentCategory: "OFFICIAL",
        baseSalaryAmount: 26_000_000n,
      },
    });
    await prisma.branchAssignment.create({
      data: {
        companyId,
        branchId: branch.id,
        staffId: staff.id,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
      },
    });
    await prisma.attendanceDay.create({
      data: {
        companyId,
        branchId: branch.id,
        staffId: staff.id,
        businessDate: new Date("2026-07-10T00:00:00.000Z"),
        status: "PRESENT",
        workUnits: "1",
        createdByUserId: gm.userId,
        updatedByUserId: gm.userId,
        liveMetric: {
          create: {
            companyId,
            branchId: branch.id,
            actualLiveMinutes: 60,
            revenueAmount: 1_000_000n,
            revenueUnit: "COIN",
            revenueScale: 1,
          },
        },
      },
    });
    let baselinePeriod = await ensurePayrollPeriod(
      gm,
      { branchId: branch.id, month: "2026-07" },
      metadata,
    );
    baselinePeriod = await calculatePayrollPeriod(
      gm,
      baselinePeriod.id,
      { version: baselinePeriod.version },
      metadata,
    );
    expect(baselinePeriod.entries[0]!.monthlyLevel.previousMonthCoinsSource).toBe("NONE");

    baselinePeriod = await savePayrollWorksheet(
      gm,
      baselinePeriod.id,
      {
        staffId: staff.id,
        periodVersion: baselinePeriod.version,
        overrideVersion: null,
        standardDaysOffOverride: null,
        values: {
          previousMonthCoins: "500000",
          days: [],
          components: {},
        },
      },
      metadata,
    );
    expect(baselinePeriod.entries[0]!.monthlyLevel).toMatchObject({
      previousMonthCoins: "500000",
      previousMonthCoinsSource: "MANUAL_BASELINE",
      previousLevelCode: "L1",
      currentLevelCode: "L3",
      transition: "JUMP",
    });

    await prisma.attendanceDay.create({
      data: {
        companyId,
        branchId: branch.id,
        staffId: staff.id,
        businessDate: new Date("2026-06-10T00:00:00.000Z"),
        status: "PRESENT",
        workUnits: "1",
        createdByUserId: gm.userId,
        updatedByUserId: gm.userId,
        liveMetric: {
          create: {
            companyId,
            branchId: branch.id,
            actualLiveMinutes: 60,
            revenueAmount: 1_000_000n,
            revenueUnit: "COIN",
            revenueScale: 1,
          },
        },
      },
    });
    const synchronized = await calculatePayrollPeriod(
      gm,
      baselinePeriod.id,
      {
        version: baselinePeriod.version,
      },
      metadata,
    );
    expect(synchronized.entries[0]!.monthlyLevel).toMatchObject({
      previousMonthCoins: "1000000",
      previousMonthCoinsSource: "ATTENDANCE_LIVE",
      previousLevelCode: "L3",
      currentLevelCode: "L3",
      transition: "RETAIN",
    });
    expect(synchronized.entries[0]!.worksheetOverride?.values.previousMonthCoins).toBe("500000");

    const sent = await sendPayrollPeriod(
      gm,
      synchronized.id,
      { version: synchronized.version },
      metadata,
    );
    await prisma.attendanceDay.create({
      data: {
        companyId,
        branchId: branch.id,
        staffId: staff.id,
        businessDate: new Date("2026-08-10T00:00:00.000Z"),
        status: "PRESENT",
        workUnits: "1",
        createdByUserId: gm.userId,
        updatedByUserId: gm.userId,
        liveMetric: {
          create: {
            companyId,
            branchId: branch.id,
            actualLiveMinutes: 60,
            revenueAmount: 1_000_000n,
            revenueUnit: "COIN",
            revenueScale: 1,
          },
        },
      },
    });
    let august = await ensurePayrollPeriod(gm, { branchId: branch.id, month: "2026-08" }, metadata);
    august = await calculatePayrollPeriod(gm, august.id, { version: august.version }, metadata);
    expect(sent.status).toBe("PUBLISHED");
    expect(august.entries[0]!.monthlyLevel).toMatchObject({
      previousMonthCoins: "1000000",
      previousMonthCoinsSource: "PUBLISHED_PAYROLL",
      previousLevelCode: "L3",
    });
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

  it("in trực tiếp chỉ đọc dữ liệu đã lưu, có audit và giữ payroll scope", async () => {
    const printable = await getPayrollPrintData(gm, periodId, liveId, metadata);
    expect(printable.entry?.staff.id).toBe(liveId);
    expect(printable.period.entries.length).toBeGreaterThan(0);
    await expect(getPayrollPrintData(manager, periodId, liveId, metadata)).rejects.toMatchObject({
      code: "FORBIDDEN",
    } satisfies Partial<DomainError>);
    await expect(getPayrollPrintData(outsider, periodId, liveId, metadata)).rejects.toMatchObject({
      code: "NOT_FOUND",
    } satisfies Partial<DomainError>);
    await expect(
      prisma.auditLog.findFirst({
        where: {
          companyId,
          entityId: periodId,
          action: "PAYROLL_PAYSLIP_PRINT",
        },
      }),
    ).resolves.toMatchObject({ reason: "SYSTEM:PAYROLL_PAYSLIP_PRINT" });
  });

  it("tính kỳ nghỉ việc cuối cùng nhưng loại nhân viên khỏi kỳ tháng kế tiếp", async () => {
    const branch = await prisma.branch.create({
      data: {
        companyId,
        code: `TERM-${runId}`,
        name: "Cơ sở kiểm tra nghỉ việc",
      },
    });
    const staff = await prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `TERM-${runId}`,
        fullName: "Nhân viên nghỉ tháng 7",
        jobTitle: "Live",
        joinedDate: new Date("2026-06-01T00:00:00.000Z"),
        terminationDate: new Date("2026-07-15T00:00:00.000Z"),
        employmentCategory: "OFFICIAL",
        employmentStatus: "TERMINATED",
        baseSalaryAmount: 7_000_000n,
      },
    });
    await prisma.branchAssignment.create({
      data: {
        companyId,
        branchId: branch.id,
        staffId: staff.id,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
      },
    });

    let july = await createPayrollPeriod(gm, { branchId: branch.id, month: "2026-07" }, metadata);
    july = await calculatePayrollPeriod(gm, july.id, { version: july.version }, metadata);
    const august = await createPayrollPeriod(
      gm,
      { branchId: branch.id, month: "2026-08" },
      metadata,
    );

    expect(july.entries.map((item) => item.staff.id)).toContain(staff.id);
    await expect(
      calculatePayrollPeriod(gm, august.id, { version: august.version }, metadata),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("ignores legacy manager payroll flags; GM saves overrides without mutating source data", async () => {
    const payrollManager: ActorContext = { ...manager, canManagePayroll: true };
    await expect(listPayrollBranches(payrollManager)).rejects.toMatchObject({
      code: "FORBIDDEN",
    } satisfies Partial<DomainError>);
    expect(await listPayrollBranches(gm)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: branchId })]),
    );

    const beforeAttendance = await prisma.attendanceDay.findFirstOrThrow({
      where: { companyId, branchId, staffId: liveId },
      select: {
        workUnits: true,
        overtimeMinutes: true,
        liveMetric: { select: { revenueAmount: true } },
        violations: { select: { amount: true } },
      },
    });
    await prisma.branchAssignment.updateMany({
      where: { companyId, branchId, staffId: liveId },
      data: {
        effectiveTo: new Date("2026-08-01T00:00:00.000Z"),
        archivedAt: new Date("2026-08-02T00:00:00.000Z"),
      },
    });
    const current = await getPayrollPeriod(gm, periodId);
    const saved = await savePayrollWorksheet(
      gm,
      periodId,
      {
        staffId: liveId,
        periodVersion: current.version,
        overrideVersion: null,
        standardDaysOffOverride: 5,
        values: {
          baseSalaryAmount: "7000000",
          days: [
            {
              businessDate: "2026-07-20",
              workUnits: "3.5",
              dailyRevenueBonus: "0",
              penalties: "0",
            },
          ],
          components: { otherBonus: "-50000" },
        },
      },
      metadata,
    );

    expect(saved.entries[0]).toMatchObject({
      sourceBaseSalary: "26000000",
      baseSalary: "7000000",
      workUnits: "3.5",
      proratedSalary: "942308",
      dailyRevenueBonus: "0",
      penalties: "0",
      otherBonus: "-50000",
    });
    expect(saved.standardDaysOff).toMatchObject({
      ruleValue: null,
      overrideValue: 5,
      appliedValue: 5,
      daysInMonth: 31,
      standardPayableDays: 26,
    });
    expect(saved.entries[0]!.dailyRows[0]!.overriddenFields).toEqual(
      expect.arrayContaining(["workUnits", "dailyRevenueBonus", "penalties"]),
    );
    expect(
      await prisma.attendanceDay.findFirstOrThrow({
        where: { companyId, branchId, staffId: liveId },
        select: {
          workUnits: true,
          overtimeMinutes: true,
          liveMetric: { select: { revenueAmount: true } },
          violations: { select: { amount: true } },
        },
      }),
    ).toEqual(beforeAttendance);

    await expect(
      savePayrollWorksheet(
        gm,
        periodId,
        {
          staffId: liveId,
          periodVersion: current.version,
          overrideVersion: null,
          standardDaysOffOverride: 5,
          values: { days: [], components: {} },
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" } satisfies Partial<DomainError>);

    const reset = await savePayrollWorksheet(
      gm,
      saved.id,
      {
        staffId: liveId,
        periodVersion: saved.version,
        overrideVersion: saved.entries[0]!.worksheetOverride!.version,
        standardDaysOffOverride: null,
        values: { days: [], components: {} },
      },
      metadata,
    );
    expect(reset.entries[0]).toMatchObject({
      baseSalary: "26000000",
      workUnits: "0.5",
      dailyRevenueBonus: "100000",
      penalties: "150000",
    });

    const permittedExportJob = await prisma.payrollExportJob.create({
      data: {
        companyId,
        branchId,
        payrollPeriodId: reset.id,
        staffId: liveId,
        kind: "PAYSLIP_XLSX",
        status: "QUEUED",
        progress: 0,
        requestedByUserId: gm.userId,
        requestReason: "Kiểm thử quyền export Payroll",
      },
    });
    expect((await getPayrollExport(gm, permittedExportJob.id)).staffId).toBe(liveId);

    const firstEnsure = await ensurePayrollPeriod(gm, { branchId, month: "2026-08" }, metadata);
    const secondEnsure = await ensurePayrollPeriod(gm, { branchId, month: "2026-08" }, metadata);
    expect(secondEnsure.id).toBe(firstEnsure.id);
    expect(
      await prisma.payrollPeriod.count({
        where: { companyId, branchId, month: new Date("2026-08-01T00:00:00.000Z") },
      }),
    ).toBe(1);
  });

  it("sends payslips, edits a sent period through a hidden revision and keeps published history", async () => {
    let period = await getPayrollPeriod(gm, periodId);
    await expect(getPayrollPeriod(employee, periodId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    } satisfies Partial<DomainError>);
    period = await sendPayrollPeriod(gm, periodId, { version: period.version }, metadata);
    expect(period.status).toBe("PUBLISHED");
    const publishedHash = period.entries[0]!.calculationHash;
    const firstPublishedIncome = period.entries[0]!.totalIncome;
    await expect(
      calculatePayrollPeriod(gm, periodId, { version: period.version }, metadata),
    ).rejects.toMatchObject({ code: "CONFLICT" } satisfies Partial<DomainError>);
    await expect(
      prisma.payrollEntry.update({
        where: { id: period.entries[0]!.id },
        data: { totalIncome: 1n },
      }),
    ).rejects.toThrow(/immutable/i);

    const revision = await savePayrollWorksheet(
      gm,
      periodId,
      {
        staffId: liveId,
        periodVersion: period.version,
        overrideVersion: period.entries[0]!.worksheetOverride?.version ?? null,
        standardDaysOffOverride: 5,
        values: {
          ...(period.entries[0]!.worksheetOverride?.values ?? { days: [], components: {} }),
          components: {
            ...(period.entries[0]!.worksheetOverride?.values.components ?? {}),
            achievementBonus: "123456",
          },
        },
      },
      metadata,
    );
    expect(revision.revision).toBe(2);
    expect(revision.status).toBe("CALCULATED");
    expect(revision.sourcePeriodId).toBe(periodId);
    expect((await getPayrollPeriod(gm, periodId)).entries[0]!.calculationHash).toBe(publishedHash);

    const oldPublishedPayslip = await getPayrollPeriod(employee, periodId);
    expect(oldPublishedPayslip.entries[0]!.totalIncome).toBe(firstPublishedIncome);
    const resent = await sendPayrollPeriod(
      gm,
      revision.id,
      { version: revision.version },
      metadata,
    );
    expect(resent.status).toBe("PUBLISHED");
    const ownPayslip = await getPayrollPeriod(employee, resent.id);
    expect(ownPayslip.status).toBe("PUBLISHED");
    expect(ownPayslip.entries).toHaveLength(1);
    expect(ownPayslip.entries[0]!.staff.id).toBe(liveId);
    expect(ownPayslip.entries[0]).not.toHaveProperty("revenueAmount");
    expect(ownPayslip.entries[0]).not.toHaveProperty("currentMonthCoins");
    expect(ownPayslip.entries[0]!.monthlyLevel).not.toHaveProperty("currentMonthCoins");
    expect(ownPayslip.entries[0]!.monthlyLevel).not.toHaveProperty("previousMonthCoins");
    expect(ownPayslip.entries[0]!.dailyRows[0]).not.toHaveProperty("revenueAmount");
    expect(ownPayslip.entries[0]!.dailyRows[0]).not.toHaveProperty("dailyCoins");
    expect(ownPayslip.entries[0]!.dailyRows[0]).not.toHaveProperty("rewardThresholdAmount");
    expect(ownPayslip.entries[0]!.dailyRows[0]!.source).not.toHaveProperty("rewardThresholdAmount");
    expect(ownPayslip.entries[0]!.worksheetOverride).toBeNull();
    expect(
      ownPayslip.entries[0]!.lines.some((line) =>
        /revenue|coin/.test(JSON.stringify(line.calculationDetails).toLowerCase()),
      ),
    ).toBe(false);

    const exportJob = await prisma.payrollExportJob.create({
      data: {
        companyId,
        branchId,
        payrollPeriodId: resent.id,
        staffId: liveId,
        kind: "PAYSLIP_PDF",
        status: "COMPLETED",
        progress: 100,
        objectKey: `${companyId}/payroll/resent-test.pdf`,
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
