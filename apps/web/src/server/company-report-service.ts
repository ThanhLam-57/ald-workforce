import type {
  CompanyMonthlyReportDto,
  CompanyReportQuery,
  CompanyReportTotalsDto,
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
          orderBy: [{ branchId: "asc" }, { staff: { staffCode: "asc" } }],
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
                penalties: true,
                totalIncome: true,
              },
            },
          },
        }),
  ]);
  const selectedPeriodByBranch = new Map<string, (typeof payrollPeriods)[number]>();
  for (const period of payrollPeriods) {
    const current = selectedPeriodByBranch.get(period.branchId);
    if (
      !current ||
      payrollStatusRank[period.status] > payrollStatusRank[current.status] ||
      (period.status === current.status && period.revision > current.revision)
    ) {
      selectedPeriodByBranch.set(period.branchId, period);
    }
  }
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
          penalties: (payroll?.penalties ?? penalties).toString(),
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
