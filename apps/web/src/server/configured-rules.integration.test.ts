import { randomUUID } from "node:crypto";

import { prisma } from "@ald/db";
import type { ActorContext } from "@ald/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAttendance } from "./attendance-service";
import {
  confirmLevelProposal,
  createConfiguredRuleDraft,
  createConfiguredRuleSet,
  generateLevelProposals,
  listConfiguredRuleSets,
  listActiveConfiguredRules,
  previewConfiguredRuleImpact,
  publishConfiguredRuleVersion,
  updateConfiguredRuleDraft,
} from "./configured-rule-service";

const runId = randomUUID().slice(0, 8);
const metadata = {
  requestId: `configured-rule-${runId}`,
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
} as const;

let companyId: string;
let branchId: string;
let liveOneId: string;
let liveTwoId: string;
let gm: ActorContext;
let manager: ActorContext;
let employee: ActorContext;
let dailyRuleSetId: string;
let publishedDailyId: string;
let draftDailyId: string;
let draftDailyRowVersion: number;

beforeAll(async () => {
  const company = await prisma.company.create({
    data: { name: `Configured ${runId}`, slug: `configured-${runId}` },
  });
  companyId = company.id;
  const branch = await prisma.branch.create({
    data: { companyId, code: "A", name: "Cơ sở A" },
  });
  branchId = branch.id;
  const [gmStaff, managerStaff, liveOne, liveTwo] = await Promise.all([
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: "GM",
        fullName: "GM Rules",
        jobTitle: "Tổng quản lý",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: "TM",
        fullName: "Manager Rules",
        jobTitle: "Quản lý đào tạo",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: "LIVE1",
        fullName: "Live Một",
        jobTitle: "Live",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: "LIVE2",
        fullName: "Live Hai",
        jobTitle: "Live",
        employmentCategory: "OFFICIAL",
      },
    }),
  ]);
  liveOneId = liveOne.id;
  liveTwoId = liveTwo.id;
  const [gmUser, managerUser] = await Promise.all([
    prisma.user.create({
      data: {
        companyId,
        staffId: gmStaff.id,
        name: "GM Rules",
        email: `configured-gm-${runId}@test.local`,
        username: `configured_gm_${runId}`,
        role: "GENERAL_MANAGER",
      },
    }),
    prisma.user.create({
      data: {
        companyId,
        staffId: managerStaff.id,
        name: "Manager Rules",
        email: `configured-manager-${runId}@test.local`,
        username: `configured_manager_${runId}`,
        role: "TRAINING_MANAGER",
      },
    }),
  ]);
  await Promise.all(
    [managerStaff.id, liveOne.id, liveTwo.id].map((staffId, index) =>
      prisma.branchAssignment.create({
        data: {
          companyId,
          branchId,
          staffId,
          assignmentType: index === 0 ? "PRIMARY_MANAGER" : "MEMBER",
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        },
      }),
    ),
  );
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
    userId: managerUser.id,
    companyId,
    staffId: liveOne.id,
    role: "LIVE_EMPLOYEE",
    activeBranchIds: [],
  };

  await Promise.all([
    createAttendance(
      gm,
      {
        staffId: liveOne.id,
        businessDate: "2026-09-10",
        status: "PRESENT",
        workUnits: "1",
        actualLiveMinutes: 300,
        revenueAmount: "1500",
        reason: "Fixture doanh số level cao",
      },
      metadata,
    ),
    createAttendance(
      gm,
      {
        staffId: liveTwo.id,
        businessDate: "2026-09-10",
        status: "PRESENT",
        workUnits: "1",
        actualLiveMinutes: 200,
        revenueAmount: "500",
        reason: "Fixture doanh số level thấp",
      },
      metadata,
    ),
  ]);

  const dailySet = await createConfiguredRuleSet(
    gm,
    {
      name: `Thưởng ngày ${runId}`,
      type: "DAILY_REWARD_TIERS",
      reason: "Tạo fixture thưởng ngày",
    },
    metadata,
  );
  dailyRuleSetId = dailySet.id;
  const savedDaily = await updateConfiguredRuleDraft(
    gm,
    dailySet.versions[0]!.id,
    {
      rowVersion: dailySet.versions[0]!.rowVersion,
      notes: "Version đang hiệu lực",
      reason: "Cấu hình thưởng ngày",
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
            rewardAmount: "100",
            priority: 0,
          },
        ],
      },
    },
    metadata,
  );
  const publishedDaily = await publishConfiguredRuleVersion(
    gm,
    savedDaily.id,
    {
      effectiveFrom: "2026-09-01",
      effectiveTo: "2026-10-01",
      rowVersion: savedDaily.rowVersion,
      reason: "Publish tháng 9",
    },
    metadata,
    new Date("2026-08-20T03:00:00.000Z"),
  );
  publishedDailyId = publishedDaily.id;
  const clonedDaily = await createConfiguredRuleDraft(
    gm,
    {
      ruleSetId: dailyRuleSetId,
      cloneFromVersionId: publishedDaily.id,
      reason: "Clone để preview",
    },
    metadata,
  );
  const changedDaily = await updateConfiguredRuleDraft(
    gm,
    clonedDaily.id,
    {
      rowVersion: clonedDaily.rowVersion,
      notes: "Tăng thưởng",
      reason: "Tăng thưởng để kiểm tra impact",
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
            rewardAmount: "250",
            priority: 0,
          },
        ],
      },
    },
    metadata,
  );
  draftDailyId = changedDaily.id;
  draftDailyRowVersion = changedDaily.rowVersion;

  const monthlySet = await createConfiguredRuleSet(
    gm,
    {
      name: `Level tháng ${runId}`,
      type: "MONTHLY_LEVEL_RULES",
      reason: "Tạo fixture level",
    },
    metadata,
  );
  const savedMonthly = await updateConfiguredRuleDraft(
    gm,
    monthlySet.versions[0]!.id,
    {
      rowVersion: monthlySet.versions[0]!.rowVersion,
      notes: "Level tháng 9",
      reason: "Cấu hình level",
      configuration: {
        kind: "MONTHLY_LEVEL_RULES",
        gapPolicy: "REQUIRE_CONTIGUOUS",
        levels: [
          {
            code: "LOW",
            name: "Level thấp",
            displayOrder: 1,
            minRevenue: "0",
            maxRevenue: "1000",
            minInclusive: true,
            maxInclusive: false,
            monthlyRevenueBonus: "0",
            attendanceBonus: "0",
            achievementBonus: "0",
            retainLevelBonus: "0",
            jumpLevelBonus: "0",
            attendanceMinWorkUnits: null,
            achievementMinLiveMinutes: null,
            jumpMinLevelSteps: 2,
          },
          {
            code: "HIGH",
            name: "Level cao",
            displayOrder: 2,
            minRevenue: "1000",
            maxRevenue: null,
            minInclusive: true,
            maxInclusive: false,
            monthlyRevenueBonus: "1000",
            attendanceBonus: "0",
            achievementBonus: "0",
            retainLevelBonus: "0",
            jumpLevelBonus: "0",
            attendanceMinWorkUnits: null,
            achievementMinLiveMinutes: null,
            jumpMinLevelSteps: 2,
          },
        ],
      },
    },
    metadata,
  );
  await publishConfiguredRuleVersion(
    gm,
    savedMonthly.id,
    {
      effectiveFrom: "2026-09-01",
      effectiveTo: "2026-10-01",
      rowVersion: savedMonthly.rowVersion,
      reason: "Publish level tháng 9",
    },
    metadata,
    new Date("2026-08-20T03:00:00.000Z"),
  );
});

afterAll(async () => {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'ALTER TABLE "level_proposals" DISABLE TRIGGER "level_proposals_no_hard_delete"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "level_history" DISABLE TRIGGER "level_history_no_hard_delete"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "rule_versions" DISABLE TRIGGER "rule_versions_published_immutable"',
    );
    await tx.levelProposal.deleteMany({ where: { companyId } });
    await tx.levelHistory.deleteMany({ where: { companyId } });
    await tx.performanceLevel.deleteMany({ where: { companyId } });
    await tx.ruleVersion.deleteMany({ where: { companyId } });
    await tx.ruleSet.deleteMany({ where: { companyId } });
    await tx.liveDailyMetric.deleteMany({ where: { companyId } });
    await tx.attendanceDay.deleteMany({ where: { companyId } });
    await tx.$executeRawUnsafe("SET LOCAL ald.audit_cleanup = 'on'");
    await tx.auditLog.deleteMany({ where: { companyId } });
    await tx.branchAssignment.deleteMany({ where: { companyId } });
    await tx.session.deleteMany({ where: { user: { companyId } } });
    await tx.account.deleteMany({ where: { user: { companyId } } });
    await tx.user.deleteMany({ where: { companyId } });
    await tx.branch.deleteMany({ where: { companyId } });
    await tx.staffMember.deleteMany({ where: { companyId } });
    await tx.company.deleteMany({ where: { id: companyId } });
    await tx.$executeRawUnsafe(
      'ALTER TABLE "rule_versions" ENABLE TRIGGER "rule_versions_published_immutable"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "level_history" ENABLE TRIGGER "level_history_no_hard_delete"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "level_proposals" ENABLE TRIGGER "level_proposals_no_hard_delete"',
    );
  });
});

describe("configured rule lifecycle and permissions", () => {
  it("uses inclusive effectiveFrom and exclusive effectiveTo", async () => {
    expect(
      (await listActiveConfiguredRules(gm, "2026-08-31", "DAILY_REWARD_TIERS")).map(
        (version) => version.id,
      ),
    ).not.toContain(publishedDailyId);
    expect(
      (await listActiveConfiguredRules(gm, "2026-09-01", "DAILY_REWARD_TIERS")).map(
        (version) => version.id,
      ),
    ).toContain(publishedDailyId);
    expect(
      (await listActiveConfiguredRules(gm, "2026-10-01", "DAILY_REWARD_TIERS")).map(
        (version) => version.id,
      ),
    ).not.toContain(publishedDailyId);
  });

  it("allows manager read-only access to active rules", async () => {
    const visible = await listConfiguredRuleSets(manager, new Date("2026-09-15T03:00:00.000Z"));
    expect(
      visible.flatMap((set) => set.versions).every((version) => version.status !== "DRAFT"),
    ).toBe(true);
    await expect(
      createConfiguredRuleSet(
        manager,
        {
          name: "Không được tạo",
          type: "SALARY_RULES",
          reason: "Kiểm tra quyền",
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      listConfiguredRuleSets(employee, new Date("2026-09-15T03:00:00.000Z")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps published configuration immutable in application and database", async () => {
    await expect(
      updateConfiguredRuleDraft(
        gm,
        publishedDailyId,
        {
          rowVersion: 2,
          notes: null,
          reason: "Không được sửa published",
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
                rewardAmount: "999",
                priority: 0,
              },
            ],
          },
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(
      prisma.ruleVersion.update({
        where: { id: publishedDailyId },
        data: { configuration: { kind: "DAILY_REWARD_TIERS", tiers: [] } },
      }),
    ).rejects.toThrow(/immutable/i);
  });

  it("rejects an overlapping publish interval", async () => {
    await expect(
      publishConfiguredRuleVersion(
        gm,
        draftDailyId,
        {
          effectiveFrom: "2026-09-15",
          effectiveTo: "2026-10-15",
          rowVersion: draftDailyRowVersion,
          reason: "Khoảng overlap để kiểm tra",
        },
        metadata,
        new Date("2026-08-20T03:00:00.000Z"),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("impact preview and level history", () => {
  it("previews historical impact without mutating business data", async () => {
    const before = {
      attendance: await prisma.attendanceDay.count({ where: { companyId } }),
      history: await prisma.levelHistory.count({ where: { companyId } }),
      proposal: await prisma.levelProposal.count({ where: { companyId } }),
      audit: await prisma.auditLog.count({ where: { companyId } }),
    };
    const preview = await previewConfiguredRuleImpact(gm, {
      ruleVersionId: draftDailyId,
      month: "2026-09",
    });
    const after = {
      attendance: await prisma.attendanceDay.count({ where: { companyId } }),
      history: await prisma.levelHistory.count({ where: { companyId } }),
      proposal: await prisma.levelProposal.count({ where: { companyId } }),
      audit: await prisma.auditLog.count({ where: { companyId } }),
    };

    expect(preview.baselineVersionId).toBe(publishedDailyId);
    expect(preview.rows.find((row) => row.staffId === liveOneId)?.delta).toBe("150");
    expect(after).toEqual(before);
  });

  it("confirms and overrides suggestions with level effective next month", async () => {
    const proposals = await generateLevelProposals(
      gm,
      { month: "2026-09", reason: "Tạo đề xuất tháng 9" },
      metadata,
    );
    const liveOne = proposals.find((proposal) => proposal.staff.id === liveOneId)!;
    const liveTwo = proposals.find((proposal) => proposal.staff.id === liveTwoId)!;
    expect(liveOne.suggestedLevel.code).toBe("HIGH");
    expect(liveTwo.suggestedLevel.code).toBe("LOW");

    const confirmed = await confirmLevelProposal(
      gm,
      liveOne.id,
      { version: liveOne.version, reason: "Xác nhận theo rule" },
      metadata,
    );
    const overridden = await confirmLevelProposal(
      gm,
      liveTwo.id,
      {
        version: liveTwo.version,
        performanceLevelId: liveOne.suggestedLevel.id,
        reason: "Override theo đánh giá GM",
      },
      metadata,
    );

    expect(confirmed.status).toBe("CONFIRMED");
    expect(overridden.status).toBe("OVERRIDDEN");
    const histories = await prisma.levelHistory.findMany({
      where: { companyId, staffId: { in: [liveOneId, liveTwoId] } },
      include: { performanceLevel: true },
      orderBy: { staffId: "asc" },
    });
    expect(histories).toHaveLength(2);
    expect(
      histories.every(
        (history) => history.effectiveFrom.toISOString().slice(0, 10) === "2026-10-01",
      ),
    ).toBe(true);
    expect(histories.every((history) => history.performanceLevel.code === "HIGH")).toBe(true);
  });
});
