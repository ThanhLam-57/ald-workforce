import type { CompanyDashboardDto, CompanyDashboardQuery, PayrollStatus } from "@ald/contracts";
import { prisma } from "@ald/db";
import {
  DomainError,
  enumerateBusinessMonth,
  requirePermission,
  toBusinessDateString,
  type ActorContext,
} from "@ald/domain";

import { companyReportMonthBounds, getCompanyMonthlyReport } from "./company-report-service";

export async function getCompanyDashboard(
  actor: ActorContext,
  query: CompanyDashboardQuery,
  now = new Date(),
): Promise<CompanyDashboardDto> {
  requirePermission(actor, "company-dashboard:read");
  if (actor.role !== "GENERAL_MANAGER") {
    throw new DomainError("FORBIDDEN", "Chỉ Tổng quản lý được xem dashboard công ty.");
  }
  const report = await getCompanyMonthlyReport(actor, query, now);
  const bounds = companyReportMonthBounds(query.month);
  const branchIds = report.branches.map((item) => item.branch.id);
  const [assignments, attendance, periods, upcomingRules] = await Promise.all([
    branchIds.length === 0
      ? []
      : prisma.branchAssignment.findMany({
          where: {
            companyId: actor.companyId,
            branchId: { in: branchIds },
            assignmentType: "MEMBER",
            archivedAt: null,
            effectiveFrom: { lt: bounds.end },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: bounds.start } }],
          },
          select: { branchId: true, staffId: true, effectiveFrom: true, effectiveTo: true },
        }),
    branchIds.length === 0
      ? []
      : prisma.attendanceDay.findMany({
          where: {
            companyId: actor.companyId,
            branchId: { in: branchIds },
            businessDate: { gte: bounds.start, lt: bounds.end },
            archivedAt: null,
          },
          select: { branchId: true, staffId: true, businessDate: true },
        }),
    branchIds.length === 0
      ? []
      : prisma.payrollPeriod.findMany({
          where: {
            companyId: actor.companyId,
            branchId: { in: branchIds },
            month: bounds.monthDate,
          },
          select: { branchId: true, status: true, revision: true },
          orderBy: { revision: "desc" },
        }),
    (() => {
      const from = new Date(`${toBusinessDateString(now)}T00:00:00.000Z`);
      const to = new Date(from);
      to.setUTCDate(to.getUTCDate() + 30);
      return prisma.ruleVersion.findMany({
        where: {
          companyId: actor.companyId,
          status: { not: "DRAFT" },
          effectiveFrom: { gt: from, lte: to },
        },
        select: {
          id: true,
          versionNo: true,
          effectiveFrom: true,
          ruleSet: { select: { name: true, type: true } },
        },
        orderBy: { effectiveFrom: "asc" },
        take: 20,
      });
    })(),
  ]);
  const latestPeriodByBranch = new Map<
    string,
    Readonly<{ status: PayrollStatus; revision: number }>
  >();
  for (const period of periods) {
    if (!latestPeriodByBranch.has(period.branchId)) {
      latestPeriodByBranch.set(period.branchId, period);
    }
  }
  const attendanceKeys = new Set(
    attendance.map(
      (row) => `${row.branchId}:${row.staffId}:${row.businessDate.toISOString().slice(0, 10)}`,
    ),
  );
  const currentDate = toBusinessDateString(now);
  const days =
    query.month > currentDate.slice(0, 7)
      ? []
      : enumerateBusinessMonth(query.month).filter(
          (day) => query.month < currentDate.slice(0, 7) || day.businessDate <= currentDate,
        );
  const missingByBranch = new Map<string, number>();
  for (const assignment of assignments) {
    const from = assignment.effectiveFrom.toISOString().slice(0, 10);
    const to = assignment.effectiveTo?.toISOString().slice(0, 10) ?? null;
    for (const day of days) {
      if (
        day.businessDate >= from &&
        (!to || day.businessDate < to) &&
        !attendanceKeys.has(`${assignment.branchId}:${assignment.staffId}:${day.businessDate}`)
      ) {
        missingByBranch.set(
          assignment.branchId,
          (missingByBranch.get(assignment.branchId) ?? 0) + 1,
        );
      }
    }
  }
  const branches = report.branches.map((item) => {
    const latest = latestPeriodByBranch.get(item.branch.id);
    return {
      id: item.branch.id,
      code: item.branch.code,
      name: item.branch.name,
      revenueAmount: item.totals.revenueAmount,
      workUnits: item.totals.workUnits,
      penalties: item.totals.penalties,
      payrollTotal: item.totals.totalIncome,
      missingAttendance: missingByBranch.get(item.branch.id) ?? 0,
      payrollStatus: latest?.status ?? null,
    };
  });
  return {
    month: query.month,
    totals: {
      revenueAmount: report.totals.revenueAmount,
      workUnits: report.totals.workUnits,
      penalties: report.totals.penalties,
      payrollTotal: report.totals.totalIncome,
      missingAttendance: branches.reduce((total, branch) => total + branch.missingAttendance, 0),
      unreviewedPayroll: [...latestPeriodByBranch.values()].filter((period) =>
        ["DRAFT", "CALCULATED"].includes(period.status),
      ).length,
    },
    branches,
    upcomingRules: upcomingRules.flatMap((rule) =>
      rule.effectiveFrom
        ? [
            {
              id: rule.id,
              type: rule.ruleSet.type,
              ruleSetName: rule.ruleSet.name,
              versionNo: rule.versionNo,
              effectiveFrom: rule.effectiveFrom.toISOString().slice(0, 10),
            },
          ]
        : [],
    ),
  };
}
