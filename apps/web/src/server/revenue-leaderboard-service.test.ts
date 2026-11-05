import { describe, expect, it, vi } from "vitest";

import {
  getCurrentRevenueLeaderboard,
  maskRevenueLeaderboardName,
  revenueLeaderboardMonthBounds,
  type RevenueLeaderboardDataSource,
  type RevenueLeaderboardUnavailableError,
} from "./revenue-leaderboard-service";

function assignmentRecord(input: {
  staffId: string;
  staffCode: string;
  fullName: string;
  streamingAlias: string | null;
  branchCode: string;
  branchName: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}) {
  const branchId = `branch-${input.branchCode}`;
  return {
    companyId: "company-1",
    branchId,
    effectiveFrom: new Date(`${input.effectiveFrom ?? "2026-10-01"}T00:00:00.000Z`),
    effectiveTo: input.effectiveTo ? new Date(`${input.effectiveTo}T00:00:00.000Z`) : null,
    staff: {
      id: input.staffId,
      companyId: "company-1",
      staffCode: input.staffCode,
      fullName: input.fullName,
      streamingAlias: input.streamingAlias,
    },
    branch: {
      id: branchId,
      companyId: "company-1",
      code: input.branchCode,
      name: input.branchName,
    },
  };
}

function attendanceRecord(input: {
  staffId: string;
  branchCode: string;
  businessDate: string;
  revenueAmount: bigint | null;
  revenueUnit?: string;
}) {
  const branchId = `branch-${input.branchCode}`;
  return {
    companyId: "company-1",
    branchId,
    staffId: input.staffId,
    businessDate: new Date(`${input.businessDate}T00:00:00.000Z`),
    liveMetric:
      input.revenueAmount === null
        ? null
        : {
            companyId: "company-1",
            branchId,
            revenueAmount: input.revenueAmount,
            revenueUnit: input.revenueUnit ?? "COIN",
            revenueScale: 1,
          },
  };
}

function createDataSource(
  overrides: Partial<RevenueLeaderboardDataSource> = {},
): RevenueLeaderboardDataSource {
  return {
    findCompany: vi.fn(async () => ({
      id: "company-1",
      timezone: "Asia/Ho_Chi_Minh",
      revenueUnit: "COIN",
      revenueScale: 1,
    })),
    listEligibleAssignments: vi.fn(async () => []),
    listAttendanceRevenue: vi.fn(async () => []),
    ...overrides,
  };
}

describe("revenue leaderboard business month", () => {
  it("switches month at midnight in Asia/Ho_Chi_Minh, not at UTC midnight", () => {
    expect(revenueLeaderboardMonthBounds(new Date("2026-09-30T16:59:59.999Z")).month).toBe(
      "2026-09",
    );
    expect(revenueLeaderboardMonthBounds(new Date("2026-09-30T17:00:00.000Z")).month).toBe(
      "2026-10",
    );
  });
});

describe("revenue leaderboard public names", () => {
  it("masks every part of a Vietnamese name deterministically", () => {
    expect(maskRevenueLeaderboardName("  Ngô   Thu Hoài ")).toBe("N** T** H***");
    expect(maskRevenueLeaderboardName("A")).toBe("A*");
  });
});

describe("current revenue leaderboard", () => {
  it("aggregates in fixed batch calls, keeps zero revenue, dedupes branches, and dense-ranks ties", async () => {
    const listEligibleAssignments = vi.fn(async () => [
      assignmentRecord({
        staffId: "staff-a",
        staffCode: "A01",
        fullName: "Nguyễn An",
        streamingAlias: "An Live",
        branchCode: "B",
        branchName: "Cơ sở B",
      }),
      assignmentRecord({
        staffId: "staff-a",
        staffCode: "A01",
        fullName: "Nguyễn An",
        streamingAlias: "An Live",
        branchCode: "A",
        branchName: "Cơ sở A",
      }),
      assignmentRecord({
        staffId: "staff-a",
        staffCode: "A01",
        fullName: "Nguyễn An",
        streamingAlias: "An Live",
        branchCode: "A",
        branchName: "Cơ sở A",
      }),
      assignmentRecord({
        staffId: "staff-b",
        staffCode: "B01",
        fullName: "Trần Bình",
        streamingAlias: null,
        branchCode: "A",
        branchName: "Cơ sở A",
        effectiveFrom: "2026-10-15",
      }),
      assignmentRecord({
        staffId: "staff-c",
        staffCode: "C01",
        fullName: "",
        streamingAlias: null,
        branchCode: "C",
        branchName: "Cơ sở C",
      }),
    ]);
    const listAttendanceRevenue = vi.fn(async () => [
      attendanceRecord({
        staffId: "staff-a",
        branchCode: "A",
        businessDate: "2026-10-05",
        revenueAmount: 100n,
      }),
      attendanceRecord({
        staffId: "staff-a",
        branchCode: "B",
        businessDate: "2026-10-20",
        revenueAmount: 50n,
      }),
      attendanceRecord({
        staffId: "staff-b",
        branchCode: "A",
        businessDate: "2026-10-14",
        revenueAmount: 999n,
      }),
      attendanceRecord({
        staffId: "staff-b",
        branchCode: "A",
        businessDate: "2026-10-15",
        revenueAmount: 150n,
      }),
      attendanceRecord({
        staffId: "staff-c",
        branchCode: "C",
        businessDate: "2026-10-10",
        revenueAmount: null,
      }),
    ]);
    const dataSource = createDataSource({ listEligibleAssignments, listAttendanceRevenue });

    const result = await getCurrentRevenueLeaderboard("company-1", {
      now: new Date("2026-10-28T08:30:00.000Z"),
      dataSource,
    });

    expect(result.items).toEqual([
      {
        rank: 1,
        staffCode: "A01",
        displayName: "An Live",
        branches: [
          { code: "A", name: "Cơ sở A" },
          { code: "B", name: "Cơ sở B" },
        ],
        revenue: "150",
      },
      {
        rank: 1,
        staffCode: "B01",
        displayName: "T*** B***",
        branches: [{ code: "A", name: "Cơ sở A" }],
        revenue: "150",
      },
      {
        rank: 2,
        staffCode: "C01",
        displayName: "C01",
        branches: [{ code: "C", name: "Cơ sở C" }],
        revenue: "0",
      },
    ]);
    expect(listEligibleAssignments).toHaveBeenCalledOnce();
    expect(listAttendanceRevenue).toHaveBeenCalledOnce();
    expect(dataSource.findCompany).toHaveBeenCalledOnce();
  });

  it("preserves revenue near the PostgreSQL bigint limit without number conversion", async () => {
    const dataSource = createDataSource({
      listEligibleAssignments: vi.fn(async () => [
        assignmentRecord({
          staffId: "staff-a",
          staffCode: "A01",
          fullName: "Nguyễn An",
          streamingAlias: "An",
          branchCode: "A",
          branchName: "Cơ sở A",
        }),
      ]),
      listAttendanceRevenue: vi.fn(async () => [
        attendanceRecord({
          staffId: "staff-a",
          branchCode: "A",
          businessDate: "2026-10-10",
          revenueAmount: 9_223_372_036_854_775_807n,
        }),
      ]),
    });

    const result = await getCurrentRevenueLeaderboard("company-1", { dataSource });

    expect(result.items[0]?.revenue).toBe("9223372036854775807");
  });

  it("fails closed for unsupported company or inconsistent metric configuration", async () => {
    const unsupportedCompany = createDataSource({
      findCompany: vi.fn(async () => ({
        id: "company-1",
        timezone: "Asia/Ho_Chi_Minh",
        revenueUnit: "VND",
        revenueScale: 1,
      })),
    });
    await expect(
      getCurrentRevenueLeaderboard("company-1", { dataSource: unsupportedCompany }),
    ).rejects.toMatchObject({
      reason: "UNSUPPORTED_COMPANY_CONFIGURATION",
    } satisfies Partial<RevenueLeaderboardUnavailableError>);

    const inconsistentMetric = createDataSource({
      listEligibleAssignments: vi.fn(async () => [
        assignmentRecord({
          staffId: "staff-a",
          staffCode: "A01",
          fullName: "Nguyễn An",
          streamingAlias: "An",
          branchCode: "A",
          branchName: "Cơ sở A",
        }),
      ]),
      listAttendanceRevenue: vi.fn(async () => [
        attendanceRecord({
          staffId: "staff-a",
          branchCode: "A",
          businessDate: "2026-10-10",
          revenueAmount: 100n,
          revenueUnit: "VND",
        }),
      ]),
    });
    await expect(
      getCurrentRevenueLeaderboard("company-1", { dataSource: inconsistentMetric }),
    ).rejects.toMatchObject({
      reason: "INCONSISTENT_METRIC_CONFIGURATION",
    } satisfies Partial<RevenueLeaderboardUnavailableError>);
  });
});
