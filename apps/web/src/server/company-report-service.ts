import type {
  CompanyMonthlyReportDto,
  CompanyReportQuery,
  CompanyReportTotalsDto,
  ManagerCompanyReportDto,
  ManagerCompanyReportTotalsDto,
  PayrollStatus,
} from "@ald/contracts";
import { prisma } from "@ald/db";
import {
  businessWeekOfMonth,
  DomainError,
  enumerateBusinessMonth,
  enumerateBusinessWeeks,
  requirePermission,
  summarizeMonthlyMetrics,
  toBusinessDateString,
  type ActorContext,
} from "@ald/domain";

import { parseBusinessDate } from "./business-date";

const ZERO_TOTALS: CompanyReportTotalsDto = {
  revenueAmount: "0",
  revenueBonus: "0",
  monthlyBonus: "0",
  baseSalary: "0",
  totalIncome: "0",
  workUnits: "0",
  penalties: "0",
};

const payrollStatusRank: Readonly<Record<PayrollStatus, number>> = {
  DRAFT: 0,
  CALCULATED: 1,
  REVIEWED: 2,
  LOCKED: 3,
  PUBLISHED: 4,
};

export function selectLatestCalculatedPayrollPeriods<
  T extends Readonly<{
    branchId: string;
    revision: number;
    status: PayrollStatus;
  }>,
>(periods: readonly T[]): Map<string, T> {
  const selected = new Map<string, T>();
  for (const period of periods) {
    if (period.status === "DRAFT") continue;
    const current = selected.get(period.branchId);
    if (
      !current ||
      period.revision > current.revision ||
      (period.revision === current.revision &&
        payrollStatusRank[period.status] > payrollStatusRank[current.status])
    ) {
      selected.set(period.branchId, period);
    }
  }
  return selected;
}

export function companyReportMonthBounds(month: string) {
  const days = enumerateBusinessMonth(month);
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) throw new DomainError("VALIDATION_ERROR", "Tháng không hợp lệ.");
  const start = parseBusinessDate(first.businessDate);
  const end = parseBusinessDate(last.businessDate);
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    days,
    start,
    end,
    monthDate: start,
    lastDate: parseBusinessDate(last.businessDate),
  };
}

function addTotals(values: readonly CompanyReportTotalsDto[]): CompanyReportTotalsDto {
  if (values.length === 0) return ZERO_TOTALS;
  const metrics = summarizeMonthlyMetrics(
    values.map((value) => ({
      revenueAmount: value.revenueAmount,
      workUnits: value.workUnits,
      actualLiveMinutes: 0,
      overtimeMinutes: 0,
      penaltyAmount: value.penalties,
    })),
  );
  return {
    revenueAmount: metrics.revenueAmount,
    workUnits: metrics.workUnits,
    penalties: metrics.penaltyAmount,
    revenueBonus: values
      .reduce((total, value) => total + BigInt(value.revenueBonus), 0n)
      .toString(),
    monthlyBonus: values
      .reduce((total, value) => total + BigInt(value.monthlyBonus), 0n)
      .toString(),
    baseSalary: values.reduce((total, value) => total + BigInt(value.baseSalary), 0n).toString(),
    totalIncome: values.reduce((total, value) => total + BigInt(value.totalIncome), 0n).toString(),
  };
}

export function companyReportTotalsEqualBranches(report: CompanyMonthlyReportDto): boolean {
  return (
    JSON.stringify(report.totals) ===
    JSON.stringify(addTotals(report.branches.map((item) => item.totals)))
  );
}

export async function getCompanyMonthlyReport(
  actor: ActorContext,
  query: CompanyReportQuery,
  generatedAt = new Date(),
): Promise<CompanyMonthlyReportDto> {
  requirePermission(actor, "company-report:read");
  if (actor.role !== "GENERAL_MANAGER") {
    throw new DomainError("FORBIDDEN", "Chỉ Tổng quản lý được xem báo cáo công ty.");
  }
  const bounds = companyReportMonthBounds(query.month);
  const branches = await prisma.branch.findMany({
    where: {
      companyId: actor.companyId,
      ...(query.branchId ? { id: query.branchId } : {}),
    },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
  if (query.branchId && branches.length === 0) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy cơ sở trong công ty.");
  }
  const branchIds = branches.map((branch) => branch.id);
  const assignments =
    branchIds.length === 0
      ? []
      : await prisma.branchAssignment.findMany({
          where: {
            companyId: actor.companyId,
            branchId: { in: branchIds },
            assignmentType: "MEMBER",
            archivedAt: null,
            effectiveFrom: { lt: bounds.end },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: bounds.start } }],
          },
          select: {
            branchId: true,
            attendanceMachineCode: true,
            staff: {
              select: {
                id: true,
                staffCode: true,
                fullName: true,
                employmentStatus: true,
                employmentCategory: true,
                employmentHistories: {
                  where: {
                    effectiveFrom: { lte: bounds.lastDate },
                    OR: [{ effectiveTo: null }, { effectiveTo: { gt: bounds.lastDate } }],
                  },
                  orderBy: { effectiveFrom: "desc" },
                  take: 1,
                },
                levelHistories: {
                  where: {
                    effectiveFrom: { lte: bounds.lastDate },
                    OR: [{ effectiveTo: null }, { effectiveTo: { gt: bounds.lastDate } }],
                  },
                  select: {
                    performanceLevel: {
                      select: { id: true, code: true, name: true },
                    },
                  },
                  orderBy: { effectiveFrom: "desc" },
                  take: 1,
                },
              },
            },
          },
          orderBy: [
            { branchId: "asc" },
            { staff: { staffCode: "asc" } },
            { effectiveFrom: "asc" },
          ],
        });
  const uniquePairs = new Map(
    assignments.map((assignment) => [`${assignment.branchId}:${assignment.staff.id}`, assignment]),
  );
  const scopedAssignments = [...uniquePairs.values()].filter((assignment) => {
    const employment = assignment.staff.employmentHistories[0] ?? assignment.staff;
    const level = assignment.staff.levelHistories[0]?.performanceLevel ?? null;
    return (
      (!query.employmentStatus || employment.employmentStatus === query.employmentStatus) &&
      (!query.employmentCategory || employment.employmentCategory === query.employmentCategory) &&
      (!query.levelId || level?.id === query.levelId)
    );
  });
  const staffIds = [...new Set(scopedAssignments.map((assignment) => assignment.staff.id))];
  const [attendance, payrollPeriods] = await Promise.all([
    staffIds.length === 0
      ? []
      : prisma.attendanceDay.findMany({
          where: {
            companyId: actor.companyId,
            branchId: { in: branchIds },
            staffId: { in: staffIds },
            businessDate: { gte: bounds.start, lt: bounds.end },
            archivedAt: null,
          },
          select: {
            branchId: true,
            staffId: true,
            businessDate: true,
            workUnits: true,
            liveMetric: { select: { revenueAmount: true } },
            violations: {
              where: { status: "ACTIVE" },
              select: { amount: true },
            },
          },
        }),
    branchIds.length === 0
      ? []
      : prisma.payrollPeriod.findMany({
          where: {
            companyId: actor.companyId,
            branchId: { in: branchIds },
            month: bounds.monthDate,
            status: { not: "DRAFT" },
          },
          select: {
            id: true,
            branchId: true,
            status: true,
            revision: true,
            entries: {
              where: { included: true, currentSnapshotId: { not: null } },
              select: {
                staffId: true,
                baseSalary: true,
                dailyRevenueBonus: true,
                monthlyRevenueBonus: true,
                attendanceBonus: true,
                achievementBonus: true,
                levelBonus: true,
                totalIncome: true,
              },
            },
          },
        }),
  ]);
  const selectedPeriodByBranch = selectLatestCalculatedPayrollPeriods(payrollPeriods);
  const attendanceByPair = new Map<string, typeof attendance>();
  const trend = new Map(bounds.days.map((day) => [day.businessDate, 0n]));
  for (const row of attendance) {
    const key = `${row.branchId}:${row.staffId}`;
    const current = attendanceByPair.get(key) ?? [];
    current.push(row);
    attendanceByPair.set(key, current);
    const date = row.businessDate.toISOString().slice(0, 10);
    trend.set(date, (trend.get(date) ?? 0n) + (row.liveMetric?.revenueAmount ?? 0n));
  }
  const reportBranches = branches.flatMap((branch) => {
    const period = selectedPeriodByBranch.get(branch.id);
    const payrollByStaff = new Map(period?.entries.map((entry) => [entry.staffId, entry]) ?? []);
    const rows = scopedAssignments
      .filter((assignment) => assignment.branchId === branch.id)
      .map((assignment) => {
        const employment = assignment.staff.employmentHistories[0] ?? assignment.staff;
        const records = attendanceByPair.get(`${branch.id}:${assignment.staff.id}`) ?? [];
        const weeklyRevenue = new Map<number, bigint>();
        let workUnits = "0";
        let revenueAmount = 0n;
        let penalties = 0n;
        if (records.length > 0) {
          const metrics = summarizeMonthlyMetrics(
            records.map((record) => ({
              revenueAmount: (record.liveMetric?.revenueAmount ?? 0n).toString(),
              workUnits: record.workUnits.toString(),
              actualLiveMinutes: 0,
              overtimeMinutes: 0,
              penaltyAmount: record.violations
                .reduce((total, violation) => total + violation.amount, 0n)
                .toString(),
            })),
          );
          workUnits = metrics.workUnits;
          revenueAmount = BigInt(metrics.revenueAmount);
          penalties = BigInt(metrics.penaltyAmount);
          for (const record of records) {
            const weekNo = businessWeekOfMonth(record.businessDate.toISOString().slice(0, 10));
            weeklyRevenue.set(
              weekNo,
              (weeklyRevenue.get(weekNo) ?? 0n) + (record.liveMetric?.revenueAmount ?? 0n),
            );
          }
        }
        const payroll = payrollByStaff.get(assignment.staff.id);
        const totals: CompanyReportTotalsDto = {
          revenueAmount: revenueAmount.toString(),
          workUnits,
          // Penalty is an operational metric and must follow currently ACTIVE violations.
          // Payroll remains a historical snapshot and may still contain a cancelled old penalty.
          penalties: penalties.toString(),
          revenueBonus: (payroll?.dailyRevenueBonus ?? 0n).toString(),
          monthlyBonus: payroll
            ? (
                payroll.monthlyRevenueBonus +
                payroll.attendanceBonus +
                payroll.achievementBonus +
                payroll.levelBonus
              ).toString()
            : "0",
          baseSalary: (payroll?.baseSalary ?? 0n).toString(),
          totalIncome: (payroll?.totalIncome ?? 0n).toString(),
        };
        return {
          staff: {
            id: assignment.staff.id,
            staffCode: assignment.staff.staffCode,
            attendanceMachineCode: assignment.attendanceMachineCode,
            fullName: assignment.staff.fullName,
            employmentCategory: employment.employmentCategory,
            employmentStatus: employment.employmentStatus,
            performanceLevel: assignment.staff.levelHistories[0]?.performanceLevel ?? null,
          },
          weeks: enumerateBusinessWeeks(query.month).map((week) => ({
            weekNo: week.weekNo,
            revenueAmount: (weeklyRevenue.get(week.weekNo) ?? 0n).toString(),
          })),
          payrollStatus: period?.status ?? null,
          payrollRevision: period?.revision ?? null,
          totals,
        };
      });
    if (rows.length === 0 && query.branchId === undefined) return [];
    return [
      {
        branch,
        payrollStatus: period?.status ?? null,
        payrollRevision: period?.revision ?? null,
        staff: rows,
        totals: addTotals(rows.map((row) => row.totals)),
      },
    ];
  });
  const totals = addTotals(reportBranches.map((branch) => branch.totals));
  const employeeRevenue = new Map<string, { label: string; value: bigint }>();
  for (const branch of reportBranches) {
    for (const row of branch.staff) {
      const current = employeeRevenue.get(row.staff.id) ?? {
        label: `${row.staff.staffCode} - ${row.staff.fullName}`,
        value: 0n,
      };
      current.value += BigInt(row.totals.revenueAmount);
      employeeRevenue.set(row.staff.id, current);
    }
  }
  return {
    month: query.month,
    generatedAt: generatedAt.toISOString(),
    weeks: enumerateBusinessWeeks(query.month).map(({ weekNo, from, to }) => ({
      weekNo,
      from,
      to,
    })),
    branches: reportBranches,
    totals,
    charts: {
      revenueByBranch: reportBranches.map((item) => ({
        id: item.branch.id,
        label: item.branch.code,
        value: item.totals.revenueAmount,
      })),
      revenueByEmployee: [...employeeRevenue.entries()]
        .map(([id, item]) => ({ id, label: item.label, value: item.value.toString() }))
        .sort((left, right) => {
          const leftValue = BigInt(left.value);
          const rightValue = BigInt(right.value);
          return leftValue === rightValue ? 0 : leftValue > rightValue ? -1 : 1;
        })
        .slice(0, 20),
      revenueTrend: [...trend.entries()].map(([businessDate, value]) => ({
        businessDate,
        value: value.toString(),
      })),
      bonusPenalty: reportBranches.map((item) => ({
        label: item.branch.code,
        bonus: (BigInt(item.totals.revenueBonus) + BigInt(item.totals.monthlyBonus)).toString(),
        penalty: item.totals.penalties,
      })),
    },
  };
}

function managerReportTotals(
  values: readonly Readonly<{
    revenueAmount: string;
    workUnits: string;
    actualLiveMinutes: number;
    overtimeMinutes: number;
    penalties: string;
    missingAttendance: number;
  }>[],
): ManagerCompanyReportTotalsDto {
  if (values.length === 0) {
    return {
      revenueAmount: "0",
      workUnits: "0",
      actualLiveMinutes: 0,
      overtimeMinutes: 0,
      penalties: "0",
      missingAttendance: 0,
    };
  }
  const metrics = summarizeMonthlyMetrics(
    values.map((value) => ({
      revenueAmount: value.revenueAmount,
      workUnits: value.workUnits,
      actualLiveMinutes: value.actualLiveMinutes,
      overtimeMinutes: value.overtimeMinutes,
      penaltyAmount: value.penalties,
    })),
  );
  return {
    revenueAmount: metrics.revenueAmount,
    workUnits: metrics.workUnits,
    actualLiveMinutes: metrics.actualLiveMinutes,
    overtimeMinutes: metrics.overtimeMinutes,
    penalties: metrics.penaltyAmount,
    missingAttendance: values.reduce((total, value) => total + value.missingAttendance, 0),
  };
}

export async function getManagerCompanyReport(
  actor: ActorContext,
  query: CompanyReportQuery,
  generatedAt = new Date(),
): Promise<ManagerCompanyReportDto> {
  requirePermission(actor, "company-report:read");
  if (actor.role !== "TRAINING_MANAGER") {
    throw new DomainError("FORBIDDEN", "Báo cáo này chỉ dành cho quản lý đào tạo.");
  }
  if (query.branchId && !actor.activeBranchIds.includes(query.branchId)) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy cơ sở trong phạm vi.");
  }

  const bounds = companyReportMonthBounds(query.month);
  const branchIds = query.branchId ? [query.branchId] : [...actor.activeBranchIds];
  const branches =
    branchIds.length === 0
      ? []
      : await prisma.branch.findMany({
          where: {
            companyId: actor.companyId,
            id: { in: branchIds },
            isActive: true,
          },
          select: { id: true, code: true, name: true },
          orderBy: { code: "asc" },
        });
  if (query.branchId && branches.length === 0) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy cơ sở trong phạm vi.");
  }

  const scopedBranchIds = branches.map((branch) => branch.id);
  const assignments =
    scopedBranchIds.length === 0
      ? []
      : await prisma.branchAssignment.findMany({
          where: {
            companyId: actor.companyId,
            branchId: { in: scopedBranchIds },
            assignmentType: "MEMBER",
            archivedAt: null,
            effectiveFrom: { lt: bounds.end },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: bounds.start } }],
          },
          select: {
            branchId: true,
            effectiveFrom: true,
            effectiveTo: true,
            attendanceMachineCode: true,
            staff: {
              select: {
                id: true,
                staffCode: true,
                fullName: true,
                employmentStatus: true,
                employmentCategory: true,
                user: { select: { role: true } },
                employmentHistories: {
                  where: {
                    effectiveFrom: { lte: bounds.lastDate },
                    OR: [{ effectiveTo: null }, { effectiveTo: { gt: bounds.lastDate } }],
                  },
                  orderBy: { effectiveFrom: "desc" },
                  take: 1,
                },
                levelHistories: {
                  where: {
                    effectiveFrom: { lte: bounds.lastDate },
                    OR: [{ effectiveTo: null }, { effectiveTo: { gt: bounds.lastDate } }],
                  },
                  select: {
                    performanceLevel: {
                      select: { id: true, code: true, name: true },
                    },
                  },
                  orderBy: { effectiveFrom: "desc" },
                  take: 1,
                },
              },
            },
          },
          orderBy: [
            { branchId: "asc" },
            { staff: { staffCode: "asc" } },
            { effectiveFrom: "asc" },
          ],
        });

  const assignmentsByPair = new Map<string, typeof assignments>();
  for (const assignment of assignments) {
    if (assignment.staff.user && assignment.staff.user.role !== "LIVE_EMPLOYEE") continue;
    const employment = assignment.staff.employmentHistories[0] ?? assignment.staff;
    const level = assignment.staff.levelHistories[0]?.performanceLevel ?? null;
    if (
      (query.employmentStatus && employment.employmentStatus !== query.employmentStatus) ||
      (query.employmentCategory && employment.employmentCategory !== query.employmentCategory) ||
      (query.levelId && level?.id !== query.levelId)
    ) {
      continue;
    }
    const key = `${assignment.branchId}:${assignment.staff.id}`;
    const current = assignmentsByPair.get(key) ?? [];
    current.push(assignment);
    assignmentsByPair.set(key, current);
  }

  const staffIds = [
    ...new Set(
      [...assignmentsByPair.values()].flatMap((items) =>
        items.map((assignment) => assignment.staff.id),
      ),
    ),
  ];
  const attendance =
    staffIds.length === 0
      ? []
      : await prisma.attendanceDay.findMany({
          where: {
            companyId: actor.companyId,
            branchId: { in: scopedBranchIds },
            staffId: { in: staffIds },
            businessDate: { gte: bounds.start, lt: bounds.end },
            archivedAt: null,
          },
          select: {
            branchId: true,
            staffId: true,
            businessDate: true,
            workUnits: true,
            overtimeMinutes: true,
            liveMetric: {
              select: { revenueAmount: true, actualLiveMinutes: true },
            },
            violations: {
              where: { status: "ACTIVE" },
              select: { amount: true },
            },
          },
        });
  const attendanceByPair = new Map<string, typeof attendance>();
  const attendanceKeys = new Set<string>();
  const trend = new Map(bounds.days.map((day) => [day.businessDate, 0n]));
  for (const record of attendance) {
    const pair = `${record.branchId}:${record.staffId}`;
    if (!assignmentsByPair.has(pair)) continue;
    const current = attendanceByPair.get(pair) ?? [];
    current.push(record);
    attendanceByPair.set(pair, current);
    const date = record.businessDate.toISOString().slice(0, 10);
    attendanceKeys.add(`${pair}:${date}`);
    trend.set(date, (trend.get(date) ?? 0n) + (record.liveMetric?.revenueAmount ?? 0n));
  }

  const currentDate = toBusinessDateString(generatedAt);
  const missingDays =
    query.month > currentDate.slice(0, 7)
      ? []
      : bounds.days.filter(
          (day) => query.month < currentDate.slice(0, 7) || day.businessDate <= currentDate,
        );
  const reportBranches = branches.map((branch) => {
    const staff = [...assignmentsByPair.entries()]
      .filter(([key]) => key.startsWith(`${branch.id}:`))
      .map(([key, pairAssignments]) => {
        const assignment = pairAssignments[0]!;
        const person = assignment.staff;
        const employment = person.employmentHistories[0] ?? person;
        const records = attendanceByPair.get(key) ?? [];
        const weeklyRevenue = new Map<number, bigint>();
        for (const record of records) {
          const weekNo = businessWeekOfMonth(record.businessDate.toISOString().slice(0, 10));
          weeklyRevenue.set(
            weekNo,
            (weeklyRevenue.get(weekNo) ?? 0n) + (record.liveMetric?.revenueAmount ?? 0n),
          );
        }
        const metrics =
          records.length === 0
            ? {
                revenueAmount: "0",
                workUnits: "0",
                actualLiveMinutes: 0,
                overtimeMinutes: 0,
                penaltyAmount: "0",
              }
            : summarizeMonthlyMetrics(
                records.map((record) => ({
                  revenueAmount: (record.liveMetric?.revenueAmount ?? 0n).toString(),
                  workUnits: record.workUnits.toString(),
                  actualLiveMinutes: record.liveMetric?.actualLiveMinutes ?? 0,
                  overtimeMinutes: record.overtimeMinutes,
                  penaltyAmount: record.violations
                    .reduce((total, violation) => total + violation.amount, 0n)
                    .toString(),
                })),
              );
        const missingAttendance = missingDays.filter((day) => {
          const date = day.businessDate;
          const assigned = pairAssignments.some((item) => {
            const from = item.effectiveFrom.toISOString().slice(0, 10);
            const to = item.effectiveTo?.toISOString().slice(0, 10) ?? null;
            return date >= from && (!to || date < to);
          });
          return assigned && !attendanceKeys.has(`${key}:${date}`);
        }).length;
        return {
          staff: {
            id: person.id,
            staffCode: person.staffCode,
            attendanceMachineCode: pairAssignments.at(-1)?.attendanceMachineCode ?? null,
            fullName: person.fullName,
            employmentCategory: employment.employmentCategory,
            employmentStatus: employment.employmentStatus,
            performanceLevel: person.levelHistories[0]?.performanceLevel ?? null,
          },
          weeks: enumerateBusinessWeeks(query.month).map((week) => ({
            weekNo: week.weekNo,
            revenueAmount: (weeklyRevenue.get(week.weekNo) ?? 0n).toString(),
          })),
          totals: {
            revenueAmount: metrics.revenueAmount,
            workUnits: metrics.workUnits,
            actualLiveMinutes: metrics.actualLiveMinutes,
            overtimeMinutes: metrics.overtimeMinutes,
            penalties: metrics.penaltyAmount,
            missingAttendance,
          },
        };
      });
    return {
      branch,
      staff,
      totals: managerReportTotals(staff.map((row) => row.totals)),
    };
  });

  const employeeRevenue = reportBranches
    .flatMap((branch) =>
      branch.staff.map((row) => ({
        id: row.staff.id,
        label: `${row.staff.staffCode} - ${row.staff.fullName}`,
        value: row.totals.revenueAmount,
      })),
    )
    .sort((left, right) => {
      const leftValue = BigInt(left.value);
      const rightValue = BigInt(right.value);
      return leftValue === rightValue ? 0 : leftValue > rightValue ? -1 : 1;
    })
    .slice(0, 20);

  return {
    month: query.month,
    generatedAt: generatedAt.toISOString(),
    weeks: enumerateBusinessWeeks(query.month).map(({ weekNo, from, to }) => ({
      weekNo,
      from,
      to,
    })),
    branches: reportBranches,
    totals: managerReportTotals(reportBranches.map((branch) => branch.totals)),
    charts: {
      revenueByBranch: reportBranches.map((branch) => ({
        id: branch.branch.id,
        label: branch.branch.code,
        value: branch.totals.revenueAmount,
      })),
      revenueByEmployee: employeeRevenue,
      revenueTrend: [...trend.entries()].map(([businessDate, value]) => ({
        businessDate,
        value: value.toString(),
      })),
      penaltiesByBranch: reportBranches.map((branch) => ({
        id: branch.branch.id,
        label: branch.branch.code,
        value: branch.totals.penalties,
      })),
    },
  };
}
