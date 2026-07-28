import { randomUUID } from "node:crypto";

import {
  automaticPenaltyConditionSchema,
  configuredRuleSchema,
  type AutomaticPenaltyConditionDto,
  type SimpleMonthlyLevelRuleApplyInput,
  type SimplePenaltyRuleApplyInput,
  type SimplePenaltyRuleRowDto,
  type SimpleMonthlyLevelRuleRowDto,
  type SimpleRewardRuleApplyInput,
  type SimpleSalaryRuleApplyInput,
  type SimpleRulesDto,
} from "@ald/contracts";
import { prisma, type Prisma } from "@ald/db";
import {
  DomainError,
  requirePermission,
  toBusinessDateString,
  validateRevenueBands,
  type ActorContext,
} from "@ald/domain";

import { parseBusinessDate } from "./business-date";
import type { RequestMetadata } from "./request-metadata";

type Transaction = Prisma.TransactionClient;
type SimpleRuleType = "DAILY_REWARD_TIERS" | "MONTHLY_LEVEL_RULES" | "PENALTY" | "SALARY_RULES";

const SIMPLE_REASON = "Cập nhật từ màn hình Quy định đơn giản";

const simpleVersionSelect = {
  id: true,
  ruleSetId: true,
  versionNo: true,
  status: true,
  effectiveFrom: true,
  effectiveTo: true,
  configuration: true,
  rowVersion: true,
  publishedAt: true,
  items: {
    where: { archivedAt: null },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      defaultAmount: true,
      reminderPolicy: true,
      metadata: true,
      displayColor: true,
      isActive: true,
      displayOrder: true,
      archivedAt: true,
    },
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
  },
} satisfies Prisma.RuleVersionSelect;

type SimpleVersion = Prisma.RuleVersionGetPayload<{ select: typeof simpleVersionSelect }>;

function auditJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function appendAudit(
  tx: Transaction,
  input: Readonly<{
    actor: ActorContext;
    action: string;
    entityType: "RuleSet" | "RuleVersion";
    entityId: string;
    before?: unknown;
    after?: unknown;
    metadata: RequestMetadata;
  }>,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      companyId: input.actor.companyId,
      actorUserId: input.actor.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      reason: SIMPLE_REASON,
      ...(input.before !== undefined ? { before: auditJson(input.before) } : {}),
      ...(input.after !== undefined ? { after: auditJson(input.after) } : {}),
      requestId: input.metadata.requestId,
      ipAddress: input.metadata.ipAddress,
      userAgent: input.metadata.userAgent,
    },
  });
}

function simpleStatus(
  status: "DRAFT" | "SCHEDULED" | "ACTIVE" | "RETIRED",
): "EMPTY" | "ACTIVE" | "SCHEDULED" | "RETIRED" {
  return status === "DRAFT" ? "EMPTY" : status;
}

function occurrencePolicy(
  value: Prisma.JsonValue | null,
  fallbackCode: string,
): Readonly<{
  penaltyStartsAt: number;
  countingWindow: "CALENDAR_MONTH" | "LIFETIME";
  countingKey: string;
}> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { penaltyStartsAt: 1, countingWindow: "CALENDAR_MONTH", countingKey: fallbackCode };
  }
  const startsAt = value.penaltyStartsAt;
  const countingWindow = value.countingWindow;
  const countingKey = value.countingKey;
  return {
    penaltyStartsAt:
      typeof startsAt === "number" && Number.isInteger(startsAt) && startsAt > 0 ? startsAt : 1,
    countingWindow: countingWindow === "LIFETIME" ? "LIFETIME" : "CALENDAR_MONTH",
    countingKey: typeof countingKey === "string" && countingKey.trim() ? countingKey : fallbackCode,
  };
}

function automaticCondition(value: Prisma.JsonValue | null): AutomaticPenaltyConditionDto {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { type: "MANUAL" };
  }
  const parsed = automaticPenaltyConditionSchema.safeParse(value.automaticCondition);
  return parsed.success ? parsed.data : { type: "MANUAL" };
}

function versionAuditShape(version: SimpleVersion | null): Record<string, unknown> | null {
  if (!version) return null;
  return {
    ruleSetId: version.ruleSetId,
    versionNo: version.versionNo,
    status: version.status,
    effectiveFrom: version.effectiveFrom?.toISOString().slice(0, 10) ?? null,
    effectiveTo: version.effectiveTo?.toISOString().slice(0, 10) ?? null,
    rowVersion: version.rowVersion,
    configuration: version.configuration,
    items: version.items.map((item) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      description: item.description,
      defaultAmount: item.defaultAmount.toString(),
      reminderPolicy: item.reminderPolicy,
      metadata: item.metadata,
      displayColor: item.displayColor,
      isActive: item.isActive,
      displayOrder: item.displayOrder,
    })),
  };
}

async function findCurrentSimpleVersion(
  companyId: string,
  type: SimpleRuleType,
): Promise<SimpleVersion | null> {
  return prisma.ruleVersion.findFirst({
    where: {
      companyId,
      isSimpleCurrent: true,
      supersededAt: null,
      ruleSet: {
        companyId,
        type,
        managementMode: "SIMPLE_MUTABLE",
      },
    },
    select: simpleVersionSelect,
  });
}

async function findReadableMonthlyVersion(companyId: string): Promise<SimpleVersion | null> {
  const simple = await findCurrentSimpleVersion(companyId, "MONTHLY_LEVEL_RULES");
  if (simple) return simple;
  return prisma.ruleVersion.findFirst({
    where: {
      companyId,
      status: { not: "DRAFT" },
      ruleSet: {
        companyId,
        type: "MONTHLY_LEVEL_RULES",
        managementMode: "VERSIONED",
      },
    },
    orderBy: [{ effectiveFrom: "desc" }, { versionNo: "desc" }],
    select: simpleVersionSelect,
  });
}

export async function activateDueSimpleRules(companyId: string, now = new Date()): Promise<void> {
  const today = parseBusinessDate(toBusinessDateString(now));
  await prisma.ruleVersion.updateMany({
    where: {
      companyId,
      isSimpleCurrent: true,
      supersededAt: null,
      status: "SCHEDULED",
      effectiveFrom: { lte: today },
      ruleSet: {
        companyId,
        managementMode: "SIMPLE_MUTABLE",
      },
    },
    data: {
      status: "ACTIVE",
      rowVersion: { increment: 1 },
    },
  });
}

export async function getSimpleRules(
  actor: ActorContext,
  now = new Date(),
): Promise<SimpleRulesDto> {
  requirePermission(actor, "rule:read");
  await activateDueSimpleRules(actor.companyId, now);
  const loadedVersions = await Promise.all([
    findCurrentSimpleVersion(actor.companyId, "DAILY_REWARD_TIERS"),
    findCurrentSimpleVersion(actor.companyId, "PENALTY"),
    findCurrentSimpleVersion(actor.companyId, "SALARY_RULES"),
    findReadableMonthlyVersion(actor.companyId),
  ]);
  const today = toBusinessDateString(now);
  const readableVersion = (version: SimpleVersion | null): SimpleVersion | null => {
    if (actor.role === "GENERAL_MANAGER" || !version) return version;
    const effectiveFrom = version.effectiveFrom?.toISOString().slice(0, 10) ?? null;
    return version.status === "ACTIVE" && effectiveFrom && effectiveFrom <= today ? version : null;
  };
  const [rewardVersion, penaltyVersion, salaryVersion, monthlyLevelVersion] =
    loadedVersions.map(readableVersion);

  const reward = (() => {
    if (!rewardVersion) {
      return {
        status: "EMPTY" as const,
        effectiveFrom: null,
        tiers: [],
      };
    }
    const configuration = configuredRuleSchema.safeParse(rewardVersion.configuration);
    if (!configuration.success || configuration.data.kind !== "DAILY_REWARD_TIERS") {
      throw new DomainError("VALIDATION_ERROR", "Bộ thưởng ngày hiện tại không hợp lệ.");
    }
    return {
      status: simpleStatus(rewardVersion.status),
      effectiveFrom: rewardVersion.effectiveFrom?.toISOString().slice(0, 10) ?? null,
      tiers: [...configuration.data.tiers]
        .sort((left, right) => {
          const leftValue = BigInt(left.minRevenue);
          const rightValue = BigInt(right.minRevenue);
          return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
        })
        .map((tier) => ({
          thresholdAmount: tier.minRevenue,
          rewardAmount: tier.rewardAmount,
        })),
    };
  })();

  const penalty = penaltyVersion
    ? {
        status: simpleStatus(penaltyVersion.status),
        effectiveFrom: penaltyVersion.effectiveFrom?.toISOString().slice(0, 10) ?? null,
        items: penaltyVersion.items.flatMap((item): readonly SimplePenaltyRuleRowDto[] => {
          const policy = occurrencePolicy(item.reminderPolicy, item.code);
          const condition = automaticCondition(item.metadata);
          if (
            actor.role === "TRAINING_MANAGER" &&
            condition.type !== "MANUAL" &&
            condition.branchId !== null &&
            !actor.activeBranchIds.includes(condition.branchId)
          ) {
            return [];
          }
          return [
            {
              code: item.code,
              name: item.name,
              description: item.description,
              defaultAmount: item.defaultAmount.toString(),
              reminderCount: Math.max(policy.penaltyStartsAt - 1, 0),
              countingWindow: policy.countingWindow,
              displayColor: item.displayColor,
              isActive: item.isActive,
              automaticCondition: condition,
            },
          ];
        }),
      }
    : {
        status: "EMPTY" as const,
        effectiveFrom: null,
        items: [],
      };

  const salary = (() => {
    if (!salaryVersion) {
      return {
        status: "EMPTY" as const,
        effectiveFrom: null,
        standardDaysOffPerMonth: null,
        probationSalaryRateBps: 8_500,
        standardDailyMinutes: null,
        overtimeMultiplierBps: null,
        roundingUnit: null,
        roundingMode: null,
      };
    }
    const configuration = configuredRuleSchema.safeParse(salaryVersion.configuration);
    if (!configuration.success || configuration.data.kind !== "SALARY_RULES") {
      throw new DomainError("VALIDATION_ERROR", "Quy định lương hiện tại không hợp lệ.");
    }
    return {
      status: simpleStatus(salaryVersion.status),
      effectiveFrom: salaryVersion.effectiveFrom?.toISOString().slice(0, 10) ?? null,
      standardDaysOffPerMonth: configuration.data.standardDaysOffPerMonth ?? null,
      probationSalaryRateBps: configuration.data.probationSalaryRateBps ?? 8_500,
      standardDailyMinutes: configuration.data.standardDailyMinutes,
      overtimeMultiplierBps: configuration.data.overtime.multiplierBps,
      roundingUnit: configuration.data.roundingPolicy.unit,
      roundingMode: configuration.data.roundingPolicy.mode,
    };
  })();

  const monthlyLevel = (() => {
    if (!monthlyLevelVersion) {
      return {
        status: "EMPTY" as const,
        effectiveFrom: null,
        attendanceRequiredDays: 26,
        levels: [],
      };
    }
    const configuration = configuredRuleSchema.safeParse(monthlyLevelVersion.configuration);
    if (!configuration.success || configuration.data.kind !== "MONTHLY_LEVEL_RULES") {
      throw new DomainError("VALIDATION_ERROR", "Bộ thưởng tháng hiện tại không hợp lệ.");
    }
    return {
      status: simpleStatus(monthlyLevelVersion.status),
      effectiveFrom: monthlyLevelVersion.effectiveFrom?.toISOString().slice(0, 10) ?? null,
      attendanceRequiredDays: configuration.data.attendanceRequiredDays ?? 26,
      levels: [...configuration.data.levels]
        .sort((left, right) => left.displayOrder - right.displayOrder)
        .map(
          (level): SimpleMonthlyLevelRuleRowDto => ({
            code: level.code,
            name: level.name,
            displayOrder: level.displayOrder,
            monthlyCoinThreshold: level.minRevenue,
            attendanceBonus: level.attendanceBonus,
            achievementBonus: level.achievementBonus,
            retainLevelBonus: level.retainLevelBonus,
            jumpLevelBonus: level.jumpLevelBonus,
          }),
        ),
    };
  })();

  return { reward, penalty, salary, monthlyLevel };
}

async function resolveSimpleRuleSet(
  tx: Transaction,
  actor: ActorContext,
  type: SimpleRuleType,
  name: string,
  metadata: RequestMetadata,
) {
  const lockKey = `simple-rule-set:${actor.companyId}:${type}`;
  await tx.$queryRaw`
    SELECT 1::integer AS "locked"
    FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
  `;
  const existing = await tx.ruleSet.findFirst({
    where: {
      companyId: actor.companyId,
      type,
      managementMode: "SIMPLE_MUTABLE",
    },
  });
  if (existing) {
    await tx.$queryRaw`
      SELECT id
      FROM "rule_sets"
      WHERE id = ${existing.id}::uuid
      FOR UPDATE
    `;
    return existing;
  }

  const created = await tx.ruleSet.create({
    data: {
      companyId: actor.companyId,
      type,
      managementMode: "SIMPLE_MUTABLE",
      name,
      createdByUserId: actor.userId,
    },
  });
  await appendAudit(tx, {
    actor,
    action: "simple_rule_set.create",
    entityType: "RuleSet",
    entityId: created.id,
    after: { type, managementMode: "SIMPLE_MUTABLE", name },
    metadata,
  });
  return created;
}

async function currentVersionInTransaction(
  tx: Transaction,
  actor: ActorContext,
  ruleSetId: string,
): Promise<SimpleVersion | null> {
  return tx.ruleVersion.findFirst({
    where: {
      companyId: actor.companyId,
      ruleSetId,
      isSimpleCurrent: true,
      supersededAt: null,
    },
    select: simpleVersionSelect,
  });
}

function normalizedRewardConfiguration(input: SimpleRewardRuleApplyInput) {
  const tiers = [...input.tiers]
    .map((tier) => ({
      thresholdAmount: BigInt(tier.thresholdAmount).toString(),
      rewardAmount: BigInt(tier.rewardAmount).toString(),
    }))
    .sort((left, right) => {
      const leftValue = BigInt(left.thresholdAmount);
      const rightValue = BigInt(right.thresholdAmount);
      return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    });
  const configuration = {
    kind: "DAILY_REWARD_TIERS" as const,
    gapPolicy: "ALLOW_GAPS" as const,
    tiers: tiers.map((tier, index) => ({
      code: `MOC_${index + 1}`,
      name: `Từ ${new Intl.NumberFormat("vi-VN").format(BigInt(tier.thresholdAmount))} xu`,
      minRevenue: tier.thresholdAmount,
      maxRevenue: tiers[index + 1]?.thresholdAmount ?? null,
      minInclusive: true,
      maxInclusive: false,
      rewardAmount: tier.rewardAmount,
      priority: index,
    })),
  };
  validateRevenueBands(configuration.tiers, configuration.gapPolicy);
  return { tiers, configuration };
}

export async function applySimpleRewardRules(
  actor: ActorContext,
  input: SimpleRewardRuleApplyInput,
  metadata: RequestMetadata,
  now = new Date(),
): Promise<SimpleRulesDto["reward"]> {
  requirePermission(actor, "rule:write");
  const businessDate = toBusinessDateString(now);
  const effectiveFrom = parseBusinessDate(input.effectiveFrom);
  const { tiers, configuration } = normalizedRewardConfiguration(input);
  const status = input.effectiveFrom > businessDate ? "SCHEDULED" : "ACTIVE";

  return prisma.$transaction(async (tx) => {
    const ruleSet = await resolveSimpleRuleSet(
      tx,
      actor,
      "DAILY_REWARD_TIERS",
      "Thưởng xu theo ngày",
      metadata,
    );
    const before = await currentVersionInTransaction(tx, actor, ruleSet.id);
    const version = before
      ? await tx.ruleVersion.update({
          where: { id: before.id },
          data: {
            status,
            effectiveFrom,
            effectiveTo: null,
            configuration: configuration as Prisma.InputJsonValue,
            notes: SIMPLE_REASON,
            publishedByUserId: actor.userId,
            publishedAt: now,
            rowVersion: { increment: 1 },
          },
          select: simpleVersionSelect,
        })
      : await tx.ruleVersion.create({
          data: {
            companyId: actor.companyId,
            ruleSetId: ruleSet.id,
            versionNo: 1,
            status,
            effectiveFrom,
            effectiveTo: null,
            isSimpleCurrent: true,
            configuration: configuration as Prisma.InputJsonValue,
            notes: SIMPLE_REASON,
            createdByUserId: actor.userId,
            publishedByUserId: actor.userId,
            publishedAt: now,
          },
          select: simpleVersionSelect,
        });
    await tx.ruleSet.update({
      where: { id: ruleSet.id },
      data: { version: { increment: 1 } },
    });
    await appendAudit(tx, {
      actor,
      action: before ? "simple_reward_rules.overwrite" : "simple_reward_rules.apply",
      entityType: "RuleVersion",
      entityId: version.id,
      before: versionAuditShape(before),
      after: versionAuditShape(version),
      metadata,
    });
    return {
      status,
      effectiveFrom: input.effectiveFrom,
      tiers,
    };
  });
}

function normalizedMonthlyLevelConfiguration(input: SimpleMonthlyLevelRuleApplyInput) {
  const usedCodes = new Set<string>();
  const rows = input.levels.map((level, index): SimpleMonthlyLevelRuleRowDto => {
    let code = level.code ?? `BAC_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    while (usedCodes.has(code)) {
      code = `BAC_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    }
    usedCodes.add(code);
    return {
      code,
      name: level.name,
      displayOrder: index + 1,
      monthlyCoinThreshold: BigInt(level.monthlyCoinThreshold).toString(),
      attendanceBonus: BigInt(level.attendanceBonus).toString(),
      achievementBonus: BigInt(level.achievementBonus).toString(),
      retainLevelBonus: BigInt(level.retainLevelBonus).toString(),
      jumpLevelBonus: BigInt(level.jumpLevelBonus).toString(),
    };
  });
  const configuration = {
    kind: "MONTHLY_LEVEL_RULES" as const,
    gapPolicy: "ALLOW_GAPS" as const,
    attendanceRequiredDays: input.attendanceRequiredDays,
    levels: rows.map((level, index) => ({
      code: level.code,
      name: level.name,
      displayOrder: level.displayOrder,
      minRevenue: level.monthlyCoinThreshold,
      maxRevenue: rows[index + 1]?.monthlyCoinThreshold ?? null,
      minInclusive: true,
      maxInclusive: false,
      monthlyRevenueBonus: "0",
      attendanceBonus: level.attendanceBonus,
      achievementBonus: level.achievementBonus,
      retainLevelBonus: level.retainLevelBonus,
      jumpLevelBonus: level.jumpLevelBonus,
      attendanceMinWorkUnits: null,
      achievementMinLiveMinutes: null,
      jumpMinLevelSteps: 1,
    })),
  };
  validateRevenueBands(
    configuration.levels.map((level) => ({ ...level, priority: level.displayOrder })),
    configuration.gapPolicy,
  );
  return { rows, configuration };
}

export async function applySimpleMonthlyLevelRules(
  actor: ActorContext,
  input: SimpleMonthlyLevelRuleApplyInput,
  metadata: RequestMetadata,
  now = new Date(),
): Promise<SimpleRulesDto["monthlyLevel"]> {
  requirePermission(actor, "rule:write");
  const businessDate = toBusinessDateString(now);
  const effectiveFrom = parseBusinessDate(input.effectiveFrom);
  const status = input.effectiveFrom > businessDate ? "SCHEDULED" : "ACTIVE";
  const { rows, configuration } = normalizedMonthlyLevelConfiguration(input);

  return prisma.$transaction(async (tx) => {
    const ruleSet = await resolveSimpleRuleSet(
      tx,
      actor,
      "MONTHLY_LEVEL_RULES",
      "Thưởng tháng và cấp bậc",
      metadata,
    );
    const before = await currentVersionInTransaction(tx, actor, ruleSet.id);
    const version = before
      ? await tx.ruleVersion.update({
          where: { id: before.id },
          data: {
            status,
            effectiveFrom,
            effectiveTo: null,
            configuration: configuration as Prisma.InputJsonValue,
            notes: SIMPLE_REASON,
            publishedByUserId: actor.userId,
            publishedAt: now,
            rowVersion: { increment: 1 },
          },
          select: simpleVersionSelect,
        })
      : await tx.ruleVersion.create({
          data: {
            companyId: actor.companyId,
            ruleSetId: ruleSet.id,
            versionNo: 1,
            status,
            effectiveFrom,
            effectiveTo: null,
            isSimpleCurrent: true,
            configuration: configuration as Prisma.InputJsonValue,
            notes: SIMPLE_REASON,
            createdByUserId: actor.userId,
            publishedByUserId: actor.userId,
            publishedAt: now,
          },
          select: simpleVersionSelect,
        });
    await tx.ruleSet.update({
      where: { id: ruleSet.id },
      data: { version: { increment: 1 } },
    });
    await appendAudit(tx, {
      actor,
      action: before ? "simple_monthly_level_rules.overwrite" : "simple_monthly_level_rules.apply",
      entityType: "RuleVersion",
      entityId: version.id,
      before: versionAuditShape(before),
      after: versionAuditShape(version),
      metadata,
    });
    return {
      status,
      effectiveFrom: input.effectiveFrom,
      attendanceRequiredDays: input.attendanceRequiredDays,
      levels: rows,
    };
  });
}

export async function applySimpleSalaryRules(
  actor: ActorContext,
  input: SimpleSalaryRuleApplyInput,
  metadata: RequestMetadata,
  now = new Date(),
): Promise<SimpleRulesDto["salary"]> {
  requirePermission(actor, "rule:write");
  const businessDate = toBusinessDateString(now);
  const effectiveFrom = parseBusinessDate(input.effectiveFrom);
  const status = input.effectiveFrom > businessDate ? "SCHEDULED" : "ACTIVE";
  const configuration = {
    kind: "SALARY_RULES" as const,
    baseSalary: "0",
    standardWorkdays: "1",
    standardDaysOffPerMonth: input.standardDaysOffPerMonth,
    probationSalaryRateBps: input.probationSalaryRateBps,
    standardDailyMinutes: input.standardDailyMinutes,
    overtime: {
      multiplierBps: input.overtimeMultiplierBps,
      eligibleAfterMinutes: 0,
    },
    attendancePolicy: {
      eligibleStatuses: ["PRESENT"] as const,
      prorateMode: "WORK_UNITS" as const,
      minimumWorkUnitsForFullSalary: null,
      capAtStandardWorkdays: true,
    },
    roundingPolicy: {
      unit: input.roundingUnit,
      mode: input.roundingMode,
      applyAt: "COMPONENT" as const,
    },
  };

  return prisma.$transaction(async (tx) => {
    const ruleSet = await resolveSimpleRuleSet(
      tx,
      actor,
      "SALARY_RULES",
      "Quy định lương",
      metadata,
    );
    const before = await currentVersionInTransaction(tx, actor, ruleSet.id);
    const version = before
      ? await tx.ruleVersion.update({
          where: { id: before.id },
          data: {
            status,
            effectiveFrom,
            effectiveTo: null,
            configuration: configuration as Prisma.InputJsonValue,
            notes: SIMPLE_REASON,
            publishedByUserId: actor.userId,
            publishedAt: now,
            rowVersion: { increment: 1 },
          },
          select: simpleVersionSelect,
        })
      : await tx.ruleVersion.create({
          data: {
            companyId: actor.companyId,
            ruleSetId: ruleSet.id,
            versionNo: 1,
            status,
            effectiveFrom,
            effectiveTo: null,
            isSimpleCurrent: true,
            configuration: configuration as Prisma.InputJsonValue,
            notes: SIMPLE_REASON,
            createdByUserId: actor.userId,
            publishedByUserId: actor.userId,
            publishedAt: now,
          },
          select: simpleVersionSelect,
        });
    await tx.ruleSet.update({
      where: { id: ruleSet.id },
      data: { version: { increment: 1 } },
    });
    await appendAudit(tx, {
      actor,
      action: before ? "simple_salary_rules.overwrite" : "simple_salary_rules.apply",
      entityType: "RuleVersion",
      entityId: version.id,
      before: versionAuditShape(before),
      after: versionAuditShape(version),
      metadata,
    });
    return {
      status,
      effectiveFrom: input.effectiveFrom,
      standardDaysOffPerMonth: input.standardDaysOffPerMonth,
      probationSalaryRateBps: input.probationSalaryRateBps,
      standardDailyMinutes: input.standardDailyMinutes,
      overtimeMultiplierBps: input.overtimeMultiplierBps,
      roundingUnit: input.roundingUnit,
      roundingMode: input.roundingMode,
    };
  });
}

function normalizePenaltyItems(input: SimplePenaltyRuleApplyInput) {
  const usedCodes = new Set<string>();
  return input.items.map((item): SimplePenaltyRuleRowDto => {
    let code = item.code ?? `LOI_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    while (usedCodes.has(code)) code = `LOI_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    usedCodes.add(code);
    return {
      code,
      name: item.name,
      description: item.description,
      defaultAmount: BigInt(item.defaultAmount).toString(),
      reminderCount: item.reminderCount,
      countingWindow: item.countingWindow,
      displayColor: item.displayColor,
      isActive: item.isActive,
      automaticCondition: item.automaticCondition ?? { type: "MANUAL" },
    };
  });
}

function penaltyItemData(item: SimplePenaltyRuleRowDto, displayOrder: number) {
  return {
    code: item.code,
    name: item.name,
    description: item.description,
    defaultAmount: BigInt(item.defaultAmount),
    reminderPolicy: {
      mode: "FROM_OCCURRENCE",
      penaltyStartsAt: item.reminderCount + 1,
      countingWindow: item.countingWindow,
      amountMode: "FIXED_PER_OCCURRENCE",
      countingKey: item.code,
      responsibleParty: "VIOLATING_STAFF",
    },
    metadata: {
      automaticCondition: item.automaticCondition,
    },
    isActive: item.isActive,
    archivedAt: null,
    displayColor: item.displayColor,
    displayOrder,
  } satisfies Prisma.PenaltyItemUpdateInput;
}

export async function applySimplePenaltyRules(
  actor: ActorContext,
  input: SimplePenaltyRuleApplyInput,
  metadata: RequestMetadata,
  now = new Date(),
): Promise<SimpleRulesDto["penalty"]> {
  requirePermission(actor, "rule:write");
  const businessDate = toBusinessDateString(now);
  const effectiveFrom = parseBusinessDate(input.effectiveFrom);
  const items = normalizePenaltyItems(input);
  if (!items.some((item) => item.isActive)) {
    throw new DomainError("VALIDATION_ERROR", "Cần ít nhất một lỗi đang áp dụng.");
  }
  const automaticScopes = new Set<string>();
  for (const item of items) {
    if (!item.isActive || item.automaticCondition.type === "MANUAL") continue;
    const scopeKey = `${item.automaticCondition.type}:${item.automaticCondition.branchId ?? "ALL_BRANCHES"}`;
    if (automaticScopes.has(scopeKey)) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Mỗi loại kiểm tra tự động chỉ được có một rule đang dùng trong cùng phạm vi.",
      );
    }
    automaticScopes.add(scopeKey);
  }
  const scopedBranchIds = [
    ...new Set(
      items.flatMap((item) =>
        item.automaticCondition.type !== "MANUAL" && item.automaticCondition.branchId
          ? [item.automaticCondition.branchId]
          : [],
      ),
    ),
  ];
  if (scopedBranchIds.length > 0) {
    const validBranchCount = await prisma.branch.count({
      where: {
        companyId: actor.companyId,
        id: { in: scopedBranchIds },
      },
    });
    if (validBranchCount !== scopedBranchIds.length) {
      throw new DomainError("VALIDATION_ERROR", "Cơ sở áp dụng không thuộc công ty hiện tại.");
    }
  }
  const status = input.effectiveFrom > businessDate ? "SCHEDULED" : "ACTIVE";

  return prisma.$transaction(async (tx) => {
    const ruleSet = await resolveSimpleRuleSet(tx, actor, "PENALTY", "Quy định vi phạm", metadata);
    const before = await currentVersionInTransaction(tx, actor, ruleSet.id);
    const version = before
      ? await tx.ruleVersion.update({
          where: { id: before.id },
          data: {
            status,
            effectiveFrom,
            effectiveTo: null,
            notes: SIMPLE_REASON,
            publishedByUserId: actor.userId,
            publishedAt: now,
            rowVersion: { increment: 1 },
          },
          select: { id: true },
        })
      : await tx.ruleVersion.create({
          data: {
            companyId: actor.companyId,
            ruleSetId: ruleSet.id,
            versionNo: 1,
            status,
            effectiveFrom,
            effectiveTo: null,
            isSimpleCurrent: true,
            notes: SIMPLE_REASON,
            createdByUserId: actor.userId,
            publishedByUserId: actor.userId,
            publishedAt: now,
          },
          select: { id: true },
        });

    const storedItems = await tx.penaltyItem.findMany({
      where: {
        companyId: actor.companyId,
        ruleVersionId: version.id,
      },
      select: { id: true, code: true },
    });
    const storedByCode = new Map(storedItems.map((item) => [item.code, item]));
    const submittedCodes = new Set(items.map((item) => item.code));

    for (const [index, item] of items.entries()) {
      const existing = storedByCode.get(item.code);
      const data = penaltyItemData(item, index + 1);
      if (existing) {
        await tx.penaltyItem.update({
          where: { id: existing.id },
          data,
        });
      } else {
        await tx.penaltyItem.create({
          data: {
            companyId: actor.companyId,
            ruleVersionId: version.id,
            ...data,
          },
        });
      }
    }

    const removedItems = storedItems.filter((item) => !submittedCodes.has(item.code));
    if (removedItems.length > 0) {
      const referenced = await tx.violation.groupBy({
        by: ["penaltyItemId"],
        where: {
          companyId: actor.companyId,
          penaltyItemId: { in: removedItems.map((item) => item.id) },
        },
        _count: { _all: true },
      });
      const referencedIds = new Set(referenced.map((item) => item.penaltyItemId));
      const archiveIds = removedItems
        .filter((item) => referencedIds.has(item.id))
        .map((item) => item.id);
      const deleteIds = removedItems
        .filter((item) => !referencedIds.has(item.id))
        .map((item) => item.id);
      if (archiveIds.length > 0) {
        await tx.penaltyItem.updateMany({
          where: {
            companyId: actor.companyId,
            ruleVersionId: version.id,
            id: { in: archiveIds },
          },
          data: {
            archivedAt: now,
            isActive: false,
          },
        });
      }
      if (deleteIds.length > 0) {
        await tx.penaltyItem.deleteMany({
          where: {
            companyId: actor.companyId,
            ruleVersionId: version.id,
            id: { in: deleteIds },
          },
        });
      }
    }

    await tx.ruleSet.update({
      where: { id: ruleSet.id },
      data: { version: { increment: 1 } },
    });
    const after = await tx.ruleVersion.findUniqueOrThrow({
      where: { id: version.id },
      select: simpleVersionSelect,
    });
    await appendAudit(tx, {
      actor,
      action: before ? "simple_penalty_rules.overwrite" : "simple_penalty_rules.apply",
      entityType: "RuleVersion",
      entityId: version.id,
      before: versionAuditShape(before),
      after: versionAuditShape(after),
      metadata,
    });
    return {
      status,
      effectiveFrom: input.effectiveFrom,
      items,
    };
  });
}
