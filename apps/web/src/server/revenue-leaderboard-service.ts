import type { RevenueLeaderboardDataDto } from "@ald/contracts";
import { prisma } from "@ald/db";
import { enumerateBusinessMonth, toBusinessDateString } from "@ald/domain";

import { parseBusinessDate } from "./business-date";

const BUSINESS_TIMEZONE = "Asia/Ho_Chi_Minh" as const;

type LeaderboardCompanyRecord = Readonly<{
  id: string;
  timezone: string;
  revenueUnit: string;
  revenueScale: number;
}>;

type LeaderboardAssignmentRecord = Readonly<{
  companyId: string;
  branchId: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  staff: Readonly<{
    id: string;
    companyId: string;
    staffCode: string;
    fullName: string;
    streamingAlias: string | null;
  }>;
  branch: Readonly<{
    id: string;
    companyId: string;
    code: string;
    name: string;
  }>;
}>;

type LeaderboardAttendanceRecord = Readonly<{
  companyId: string;
  branchId: string;
  staffId: string;
  businessDate: Date;
  liveMetric: Readonly<{
    companyId: string;
    branchId: string;
    revenueAmount: bigint;
    revenueUnit: string;
    revenueScale: number;
  }> | null;
}>;

type LeaderboardMonthBounds = Readonly<{
  month: string;
  start: Date;
  end: Date;
}>;

export type RevenueLeaderboardDataSource = Readonly<{
  findCompany(companyId: string): Promise<LeaderboardCompanyRecord | null>;
  listEligibleAssignments(input: {
    companyId: string;
    start: Date;
    end: Date;
  }): Promise<readonly LeaderboardAssignmentRecord[]>;
  listAttendanceRevenue(input: {
    companyId: string;
    staffIds: readonly string[];
    start: Date;
    end: Date;
  }): Promise<readonly LeaderboardAttendanceRecord[]>;
}>;

type RevenueLeaderboardUnavailableReason =
  | "COMPANY_NOT_FOUND"
  | "UNSUPPORTED_COMPANY_CONFIGURATION"
  | "TENANT_SCOPE_MISMATCH"
  | "INCONSISTENT_METRIC_CONFIGURATION"
  | "INVALID_REVENUE";

export class RevenueLeaderboardUnavailableError extends Error {
  readonly reason: RevenueLeaderboardUnavailableReason;

  constructor(reason: RevenueLeaderboardUnavailableReason) {
    super("Revenue leaderboard is unavailable.");
    this.name = "RevenueLeaderboardUnavailableError";
    this.reason = reason;
  }
}

const prismaRevenueLeaderboardDataSource: RevenueLeaderboardDataSource = {
  findCompany: (companyId) =>
    prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        timezone: true,
        revenueUnit: true,
        revenueScale: true,
      },
    }),
  listEligibleAssignments: ({ companyId, start, end }) =>
    prisma.branchAssignment.findMany({
      where: {
        companyId,
        assignmentType: "MEMBER",
        archivedAt: null,
        effectiveFrom: { lt: end },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: start } }],
      },
      select: {
        companyId: true,
        branchId: true,
        effectiveFrom: true,
        effectiveTo: true,
        staff: {
          select: {
            id: true,
            companyId: true,
            staffCode: true,
            fullName: true,
            streamingAlias: true,
          },
        },
        branch: {
          select: {
            id: true,
            companyId: true,
            code: true,
            name: true,
          },
        },
      },
      orderBy: [
        { staff: { staffCode: "asc" } },
        { branch: { code: "asc" } },
        { effectiveFrom: "asc" },
      ],
    }),
  listAttendanceRevenue: ({ companyId, staffIds, start, end }) =>
    prisma.attendanceDay.findMany({
      where: {
        companyId,
        staffId: { in: [...staffIds] },
        businessDate: { gte: start, lt: end },
        archivedAt: null,
      },
      select: {
        companyId: true,
        branchId: true,
        staffId: true,
        businessDate: true,
        liveMetric: {
          select: {
            companyId: true,
            branchId: true,
            revenueAmount: true,
            revenueUnit: true,
            revenueScale: true,
          },
        },
      },
      orderBy: [{ staffId: "asc" }, { businessDate: "asc" }],
    }),
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeDisplayText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function maskNamePart(value: string): string {
  const characters = Array.from(value);
  const visible = characters[0];
  if (!visible) return "";
  return `${visible}${"*".repeat(Math.min(Math.max(characters.length - 1, 1), 3))}`;
}

export function maskRevenueLeaderboardName(fullName: string): string {
  return normalizeDisplayText(fullName).split(" ").filter(Boolean).map(maskNamePart).join(" ");
}

export function revenueLeaderboardMonthBounds(now: Date): LeaderboardMonthBounds {
  const month = toBusinessDateString(now, BUSINESS_TIMEZONE).slice(0, 7);
  const days = enumerateBusinessMonth(month);
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) {
    throw new RevenueLeaderboardUnavailableError("UNSUPPORTED_COMPANY_CONFIGURATION");
  }

  const start = parseBusinessDate(first.businessDate);
  const end = parseBusinessDate(last.businessDate);
  end.setUTCDate(end.getUTCDate() + 1);
  return { month, start, end };
}

function displayNameFor(staff: LeaderboardAssignmentRecord["staff"]): string {
  const alias = staff.streamingAlias ? normalizeDisplayText(staff.streamingAlias) : "";
  if (alias) return alias;
  return maskRevenueLeaderboardName(staff.fullName) || staff.staffCode;
}

export async function getCurrentRevenueLeaderboard(
  companyId: string,
  options: Readonly<{
    now?: Date;
    dataSource?: RevenueLeaderboardDataSource;
  }> = {},
): Promise<RevenueLeaderboardDataDto> {
  const now = options.now ?? new Date();
  const dataSource = options.dataSource ?? prismaRevenueLeaderboardDataSource;
  const company = await dataSource.findCompany(companyId);
  if (!company) throw new RevenueLeaderboardUnavailableError("COMPANY_NOT_FOUND");
  if (company.id !== companyId) {
    throw new RevenueLeaderboardUnavailableError("TENANT_SCOPE_MISMATCH");
  }
  if (
    company.timezone !== BUSINESS_TIMEZONE ||
    company.revenueUnit !== "COIN" ||
    company.revenueScale !== 1
  ) {
    throw new RevenueLeaderboardUnavailableError("UNSUPPORTED_COMPANY_CONFIGURATION");
  }

  const bounds = revenueLeaderboardMonthBounds(now);
  const assignments = await dataSource.listEligibleAssignments({
    companyId,
    start: bounds.start,
    end: bounds.end,
  });
  const staffById = new Map<
    string,
    {
      staffCode: string;
      displayName: string;
      branches: Map<string, { code: string; name: string }>;
      intervals: Array<{
        branchId: string;
        effectiveFrom: Date;
        effectiveTo: Date | null;
      }>;
    }
  >();

  for (const assignment of assignments) {
    if (
      assignment.companyId !== companyId ||
      assignment.staff.companyId !== companyId ||
      assignment.branch.companyId !== companyId ||
      assignment.branch.id !== assignment.branchId
    ) {
      throw new RevenueLeaderboardUnavailableError("TENANT_SCOPE_MISMATCH");
    }
    const current = staffById.get(assignment.staff.id) ?? {
      staffCode: assignment.staff.staffCode,
      displayName: displayNameFor(assignment.staff),
      branches: new Map<string, { code: string; name: string }>(),
      intervals: [],
    };
    current.branches.set(assignment.branch.id, {
      code: assignment.branch.code,
      name: assignment.branch.name,
    });
    current.intervals.push({
      branchId: assignment.branchId,
      effectiveFrom: assignment.effectiveFrom,
      effectiveTo: assignment.effectiveTo,
    });
    staffById.set(assignment.staff.id, current);
  }

  const staffIds = [...staffById.keys()];
  const attendance =
    staffIds.length === 0
      ? []
      : await dataSource.listAttendanceRevenue({
          companyId,
          staffIds,
          start: bounds.start,
          end: bounds.end,
        });
  const revenueByStaffId = new Map(staffIds.map((staffId) => [staffId, 0n]));

  for (const day of attendance) {
    if (day.companyId !== companyId) {
      throw new RevenueLeaderboardUnavailableError("TENANT_SCOPE_MISMATCH");
    }
    const staff = staffById.get(day.staffId);
    if (!staff) continue;
    const belongsToMemberInterval = staff.intervals.some(
      (interval) =>
        interval.branchId === day.branchId &&
        interval.effectiveFrom <= day.businessDate &&
        (interval.effectiveTo === null || day.businessDate < interval.effectiveTo),
    );
    if (!belongsToMemberInterval) continue;
    const metric = day.liveMetric;
    if (!metric) continue;
    if (metric.companyId !== companyId || metric.branchId !== day.branchId) {
      throw new RevenueLeaderboardUnavailableError("TENANT_SCOPE_MISMATCH");
    }
    if (metric.revenueUnit !== "COIN" || metric.revenueScale !== 1) {
      throw new RevenueLeaderboardUnavailableError("INCONSISTENT_METRIC_CONFIGURATION");
    }
    if (metric.revenueAmount < 0n) {
      throw new RevenueLeaderboardUnavailableError("INVALID_REVENUE");
    }
    revenueByStaffId.set(
      day.staffId,
      (revenueByStaffId.get(day.staffId) ?? 0n) + metric.revenueAmount,
    );
  }

  const ranked = [...staffById.entries()]
    .map(([staffId, staff]) => ({
      staffId,
      staff,
      revenue: revenueByStaffId.get(staffId) ?? 0n,
    }))
    .sort((left, right) => {
      if (left.revenue !== right.revenue) return left.revenue > right.revenue ? -1 : 1;
      return compareText(left.staff.staffCode, right.staff.staffCode);
    });

  let rank = 0;
  let previousRevenue: bigint | null = null;
  const items = ranked.map((entry) => {
    if (previousRevenue === null || entry.revenue !== previousRevenue) rank += 1;
    previousRevenue = entry.revenue;
    return {
      rank,
      staffCode: entry.staff.staffCode,
      displayName: entry.staff.displayName,
      branches: [...entry.staff.branches.values()].sort((left, right) =>
        compareText(left.code, right.code),
      ),
      revenue: entry.revenue.toString(),
    };
  });

  return {
    month: bounds.month,
    timezone: BUSINESS_TIMEZONE,
    unit: "COIN",
    generatedAt: now.toISOString(),
    totalEmployees: items.length,
    items,
  };
}
