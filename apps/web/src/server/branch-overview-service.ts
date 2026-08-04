import type {
  BranchMonthlyOverviewDto,
  BranchOverviewBatchUpdateInput,
  BranchOverviewCellResultDto,
  BranchOverviewQuery,
} from "@ald/contracts";
import { prisma, type Prisma } from "@ald/db";
import {
  DomainError,
  effectivePenaltyAmount,
  enumerateBusinessMonth,
  enumerateBusinessWeeks,
  requirePermission,
  summarizeMonthlyMetrics,
  type ActorContext,
} from "@ald/domain";

import { createAttendance, updateAttendance } from "./attendance-service";
import { parseBusinessDate } from "./business-date";
import type { RequestMetadata } from "./request-metadata";

const ZERO_TOTALS = {
  revenueAmount: "0",
  workUnits: "0",
  actualLiveMinutes: 0,
  overtimeMinutes: 0,
  penaltyAmount: "0",
} as const;

function monthBounds(month: string) {
  const days = enumerateBusinessMonth(month);
  const weekByDate = new Map(
    enumerateBusinessWeeks(month).flatMap((week) =>
      week.dates.map((businessDate) => [businessDate, week.weekNo] as const),
    ),
  );
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) {
    throw new DomainError("VALIDATION_ERROR", "Tháng không hợp lệ.");
  }
  const start = parseBusinessDate(first.businessDate);
  const end = parseBusinessDate(last.businessDate);
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    days: days.map((day) => ({
      ...day,
      weekOfMonth: weekByDate.get(day.businessDate)!,
    })),
    start,
    end,
    levelDate: parseBusinessDate(last.businessDate),
  };
}

async function resolveBranch(actor: ActorContext, branchId: string) {
  requirePermission(actor, "branch-overview:read");
  if (actor.role === "TRAINING_MANAGER" && !actor.activeBranchIds.includes(branchId)) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy cơ sở trong phạm vi.");
  }
  const branch = await prisma.branch.findFirst({
    where: {
      id: branchId,
      companyId: actor.companyId,
      ...(actor.role === "TRAINING_MANAGER" ? { isActive: true } : {}),
    },
    select: {
      id: true,
      code: true,
      name: true,
      company: {
        select: {
          revenueUnit: true,
          revenueScale: true,
        },
      },
    },
  });
  if (!branch) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy cơ sở trong phạm vi.");
  }
  return branch;
}

export async function getBranchMonthlyOverview(
  actor: ActorContext,
  query: BranchOverviewQuery,
): Promise<BranchMonthlyOverviewDto> {
  requirePermission(actor, "branch-overview:read");
  const { days, start, end, levelDate } = monthBounds(query.month);
  const branch = await resolveBranch(actor, query.branchId);

  const levelAtMonthEnd: Prisma.LevelHistoryWhereInput = {
    effectiveFrom: { lte: levelDate },
    OR: [{ effectiveTo: null }, { effectiveTo: { gt: levelDate } }],
  };
  const [staff, levels] = await Promise.all([
    prisma.staffMember.findMany({
      where: {
        companyId: actor.companyId,
        archivedAt: null,
        assignments: {
          some: {
            companyId: actor.companyId,
            branchId: branch.id,
            assignmentType: "MEMBER",
            archivedAt: null,
            effectiveFrom: { lt: end },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: start } }],
          },
        },
        OR: [{ user: { is: null } }, { user: { is: { role: "LIVE_EMPLOYEE" } } }],
        ...(query.employmentStatus ? { employmentStatus: query.employmentStatus } : {}),
        ...(query.employmentCategory ? { employmentCategory: query.employmentCategory } : {}),
        ...(query.levelId
          ? {
              levelHistories: {
                some: {
                  companyId: actor.companyId,
                  performanceLevelId: query.levelId,
                  ...levelAtMonthEnd,
                },
              },
            }
          : {}),
        ...(query.search
          ? {
              AND: [
                {
                  OR: [
                    {
                      fullName: {
                        contains: query.search,
                        mode: "insensitive" as const,
                      },
                    },
                    {
                      staffCode: {
                        contains: query.search,
                        mode: "insensitive" as const,
                      },
                    },
                    {
                      streamingAlias: {
                        contains: query.search,
                        mode: "insensitive" as const,
                      },
                    },
                    {
                      assignments: {
                        some: {
                          branchId: branch.id,
                          attendanceMachineCode: {
                            contains: query.search,
                            mode: "insensitive" as const,
                          },
                          effectiveFrom: { lt: end },
                          OR: [{ effectiveTo: null }, { effectiveTo: { gt: start } }],
                        },
                      },
                    },
                  ],
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        staffCode: true,
        fullName: true,
        streamingAlias: true,
        employmentCategory: true,
        employmentStatus: true,
        assignments: {
          where: {
            branchId: branch.id,
            assignmentType: "MEMBER",
            archivedAt: null,
            effectiveFrom: { lt: end },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: start } }],
          },
          orderBy: { effectiveFrom: "desc" },
          take: 1,
          select: { attendanceMachineCode: true },
        },
        levelHistories: {
          where: {
            companyId: actor.companyId,
            ...levelAtMonthEnd,
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
      orderBy: [{ staffCode: "asc" }, { fullName: "asc" }],
    }),
    prisma.performanceLevel.findMany({
      where: { companyId: actor.companyId },
      select: { id: true, code: true, name: true },
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
    }),
  ]);

  const staffIds = staff.map((person) => person.id);
  const attendance =
    staffIds.length === 0
      ? []
      : await prisma.attendanceDay.findMany({
          where: {
            companyId: actor.companyId,
            branchId: branch.id,
            staffId: { in: staffIds },
            businessDate: { gte: start, lt: end },
          },
          select: {
            id: true,
            staffId: true,
            businessDate: true,
            status: true,
            version: true,
            archivedAt: true,
            workUnits: true,
            overtimeMinutes: true,
            penaltyOverrideAmount: true,
            liveMetric: {
              select: {
                actualLiveMinutes: true,
                revenueAmount: true,
              },
            },
            violations: {
              where: {
                companyId: actor.companyId,
                branchId: branch.id,
                status: "ACTIVE",
              },
              select: { amount: true },
            },
          },
          orderBy: [{ staffId: "asc" }, { businessDate: "asc" }],
        });

  const attendanceByStaffDate = new Map(
    attendance.map((record) => [
      `${record.staffId}:${record.businessDate.toISOString().slice(0, 10)}`,
      record,
    ]),
  );
  const rows = staff.map((person) => {
    const rowDays = days.map((day) => {
      const record = attendanceByStaffDate.get(`${person.id}:${day.businessDate}`);
      return {
        ...day,
        attendanceId: record?.id ?? null,
        version: record?.version ?? null,
        archivedAt: record?.archivedAt?.toISOString() ?? null,
        status: record?.status ?? null,
        revenueAmount: record?.liveMetric?.revenueAmount.toString() ?? "0",
        actualLiveMinutes: record?.liveMetric?.actualLiveMinutes ?? 0,
        workUnits: record?.workUnits.toString() ?? "0",
        overtimeMinutes: record?.overtimeMinutes ?? 0,
        penaltyAmount: record
          ? effectivePenaltyAmount(
              record.violations
                .reduce((total, violation) => total + violation.amount, 0n)
                .toString(),
              record.penaltyOverrideAmount?.toString(),
            )
          : "0",
      };
    });
    return {
      staff: {
        id: person.id,
        staffCode: person.staffCode,
        attendanceMachineCode: person.assignments[0]?.attendanceMachineCode ?? null,
        fullName: person.fullName,
        streamingAlias: person.streamingAlias,
        employmentCategory: person.employmentCategory,
        employmentStatus: person.employmentStatus,
        performanceLevel: person.levelHistories[0]?.performanceLevel ?? null,
      },
      days: rowDays,
      totals: summarizeMonthlyMetrics(rowDays),
    };
  });

  return {
    month: query.month,
    branch: {
      id: branch.id,
      code: branch.code,
      name: branch.name,
    },
    revenueConfig: {
      unit: branch.company.revenueUnit,
      scale: branch.company.revenueScale,
    },
    calendar: days,
    levels,
    rows,
    totals:
      rows.length === 0 ? ZERO_TOTALS : summarizeMonthlyMetrics(rows.map((row) => row.totals)),
  };
}

export async function updateBranchOverviewCells(
  actor: ActorContext,
  input: BranchOverviewBatchUpdateInput,
  metadata: RequestMetadata,
): Promise<readonly BranchOverviewCellResultDto[]> {
  requirePermission(actor, "branch-overview:write");
  const branch = await resolveBranch(actor, input.branchId);
  const keys = new Set<string>();
  for (const edit of input.edits) {
    const key = `${edit.staffId}:${edit.businessDate}`;
    if (keys.has(key)) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Một batch không được cập nhật trùng nhân viên/ngày.",
      );
    }
    keys.add(key);
  }

  const existingRecords = await prisma.attendanceDay.findMany({
    where: {
      companyId: actor.companyId,
      branchId: branch.id,
      OR: input.edits.map((edit) => ({
        staffId: edit.staffId,
        businessDate: parseBusinessDate(edit.businessDate),
      })),
    },
    select: {
      id: true,
      staffId: true,
      businessDate: true,
    },
  });
  const existingByKey = new Map(
    existingRecords.map((record) => [
      `${record.staffId}:${record.businessDate.toISOString().slice(0, 10)}`,
      record,
    ]),
  );

  const results: BranchOverviewCellResultDto[] = [];
  for (const edit of input.edits) {
    const key = `${edit.staffId}:${edit.businessDate}`;
    const existing = existingByKey.get(key);
    try {
      const attendance = existing
        ? await updateAttendance(
            actor,
            existing.id,
            {
              version: edit.version ?? 0,
              ...(edit.revenueAmount !== undefined ? { revenueAmount: edit.revenueAmount } : {}),
              ...(edit.actualLiveMinutes !== undefined
                ? { actualLiveMinutes: edit.actualLiveMinutes }
                : {}),
              ...(edit.workUnits !== undefined ? { workUnits: edit.workUnits } : {}),
              ...(edit.overtimeMinutes !== undefined
                ? { overtimeMinutes: edit.overtimeMinutes }
                : {}),
            },
            metadata,
          )
        : await createAttendance(
            actor,
            {
              staffId: edit.staffId,
              businessDate: edit.businessDate,
              ...(edit.revenueAmount !== undefined ? { revenueAmount: edit.revenueAmount } : {}),
              ...(edit.actualLiveMinutes !== undefined
                ? { actualLiveMinutes: edit.actualLiveMinutes }
                : {}),
              ...(edit.workUnits !== undefined ? { workUnits: edit.workUnits } : {}),
              ...(edit.overtimeMinutes !== undefined
                ? { overtimeMinutes: edit.overtimeMinutes }
                : {}),
            },
            metadata,
            branch.id,
          );
      results.push({
        clientId: edit.clientId,
        status: "SAVED",
        attendance,
        message: null,
      });
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      results.push({
        clientId: edit.clientId,
        status: error.code === "CONFLICT" ? "CONFLICT" : "ERROR",
        attendance:
          error.details?.current &&
          typeof error.details.current === "object" &&
          "id" in error.details.current
            ? (error.details.current as BranchOverviewCellResultDto["attendance"])
            : null,
        message: error.message,
      });
    }
  }
  return results;
}
