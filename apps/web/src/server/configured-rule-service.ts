import {
  configuredRuleSchema,
  type ConfiguredRule,
  type ConfiguredRuleComparisonDto,
  type ConfiguredRuleDraftCreateInput,
  type ConfiguredRuleDraftUpdateInput,
  type ConfiguredRuleSetCreateInput,
  type ConfiguredRuleSetDto,
  type ConfiguredRuleType,
  type ConfiguredRuleVersionDto,
  type LevelProposalConfirmInput,
  type LevelProposalDto,
  type LevelProposalGenerateInput,
  type MonthlyLevelConfig,
  type RuleImpactPreviewDto,
  type RuleImpactPreviewInput,
  type PenaltyRulePublishInput,
  type PenaltyRuleRetireInput,
  type PerformanceLevelOptionDto,
} from "@ald/contracts";
import { prisma, type Prisma } from "@ald/db";
import {
  DomainError,
  calculateDailyReward,
  calculateKpiMaximumScore,
  calculateMonthlyLevelResult,
  calculateSalaryProjection,
  compareConfigurationPaths,
  effectiveRuleStatus,
  enumerateBusinessMonth,
  matchRevenueBand,
  requirePermission,
  summarizeMonthlyMetrics,
  toBusinessDateString,
  validateRevenueBands,
  type ActorContext,
} from "@ald/domain";

import { systemAuditReason } from "./audit-service";
import { parseBusinessDate } from "./business-date";
import type { RequestMetadata } from "./request-metadata";
import { enforceSensitiveMutationRateLimit } from "./sensitive-rate-limit";

type Transaction = Prisma.TransactionClient;

const configuredRuleTypes = new Set<ConfiguredRuleType>([
  "DAILY_REWARD_TIERS",
  "MONTHLY_LEVEL_RULES",
  "SALARY_RULES",
  "KPI_TEMPLATE",
]);

const versionSelect = {
  id: true,
  ruleSetId: true,
  versionNo: true,
  status: true,
  effectiveFrom: true,
  effectiveTo: true,
  notes: true,
  configuration: true,
  rowVersion: true,
  clonedFromVersionId: true,
  createdAt: true,
  publishedAt: true,
} satisfies Prisma.RuleVersionSelect;

type VersionRecord = Prisma.RuleVersionGetPayload<{ select: typeof versionSelect }>;

const proposalSelect = {
  id: true,
  sourceMonth: true,
  effectiveFrom: true,
  monthlyRevenue: true,
  status: true,
  version: true,
  decisionReason: true,
  staff: { select: { id: true, staffCode: true, fullName: true } },
  suggestedPerformanceLevel: {
    select: { id: true, code: true, name: true, displayOrder: true },
  },
  confirmedPerformanceLevel: {
    select: { id: true, code: true, name: true, displayOrder: true },
  },
} satisfies Prisma.LevelProposalSelect;

type ProposalRecord = Prisma.LevelProposalGetPayload<{ select: typeof proposalSelect }>;

function auditJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function appendAudit(
  tx: Transaction,
  input: Readonly<{
    actor: ActorContext;
    action: string;
    entityType: string;
    entityId: string;
    reason: string;
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
      reason: input.reason,
      ...(input.before !== undefined ? { before: auditJson(input.before) } : {}),
      ...(input.after !== undefined ? { after: auditJson(input.after) } : {}),
      requestId: input.metadata.requestId,
      ipAddress: input.metadata.ipAddress,
      userAgent: input.metadata.userAgent,
    },
  });
}

function isConfiguredType(value: string): value is ConfiguredRuleType {
  return configuredRuleTypes.has(value as ConfiguredRuleType);
}

function requireConfiguredRuleRead(actor: ActorContext): void {
  requirePermission(actor, "rule:read");
  if (actor.role === "LIVE_EMPLOYEE") {
    throw new DomainError("FORBIDDEN", "Nhân viên không được truy cập cấu hình rule nội bộ.");
  }
}

function defaultConfiguration(type: ConfiguredRuleType): ConfiguredRule {
  if (type === "DAILY_REWARD_TIERS") {
    return {
      kind: type,
      gapPolicy: "REQUIRE_CONTIGUOUS",
      tiers: [
        {
          code: "ALL",
          name: "Mặc định",
          minRevenue: "0",
          maxRevenue: null,
          minInclusive: true,
          maxInclusive: false,
          rewardAmount: "0",
          priority: 0,
        },
      ],
    };
  }
  if (type === "MONTHLY_LEVEL_RULES") {
    return {
      kind: type,
      gapPolicy: "REQUIRE_CONTIGUOUS",
      levels: [
        {
          code: "L1",
          name: "Level 1",
          displayOrder: 1,
          minRevenue: "0",
          maxRevenue: null,
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
      ],
    };
  }
  if (type === "SALARY_RULES") {
    return {
      kind: type,
      baseSalary: "0",
      standardWorkdays: "26",
      probationSalaryRateBps: 8_500,
      standardDailyMinutes: 480,
      overtime: { multiplierBps: 15_000, eligibleAfterMinutes: 0 },
      attendancePolicy: {
        eligibleStatuses: ["PRESENT"],
        prorateMode: "WORK_UNITS",
        minimumWorkUnitsForFullSalary: null,
        capAtStandardWorkdays: false,
      },
      roundingPolicy: { unit: 1_000, mode: "HALF_UP", applyAt: "COMPONENT" },
    };
  }
  return {
    kind: "KPI_TEMPLATE",
    criteria: [
      {
        code: "GENERAL",
        name: "KPI chung",
        description: "",
        weightBps: 10_000,
        maxScore: 100,
        requiredEvidence: false,
        requiredNote: false,
        displayOrder: 0,
      },
    ],
  };
}

function validateConfiguration(configuration: ConfiguredRule): void {
  if (configuration.kind === "DAILY_REWARD_TIERS") {
    validateRevenueBands(configuration.tiers, configuration.gapPolicy);
    return;
  }
  if (configuration.kind === "MONTHLY_LEVEL_RULES") {
    validateRevenueBands(
      configuration.levels.map((level) => ({ ...level, priority: level.displayOrder })),
      configuration.gapPolicy,
    );
    const orders = new Set<number>();
    for (const level of configuration.levels) {
      if (orders.has(level.displayOrder)) {
        throw new DomainError("VALIDATION_ERROR", `Thứ tự level ${level.displayOrder} bị trùng.`);
      }
      orders.add(level.displayOrder);
    }
    return;
  }
  if (configuration.kind === "SALARY_RULES") {
    if (Number(configuration.standardWorkdays) <= 0) {
      throw new DomainError("VALIDATION_ERROR", "Số ngày công chuẩn phải lớn hơn 0.");
    }
    if (
      new Set(configuration.attendancePolicy.eligibleStatuses).size !==
      configuration.attendancePolicy.eligibleStatuses.length
    ) {
      throw new DomainError("VALIDATION_ERROR", "Trạng thái chấm công được tính lương bị trùng.");
    }
    return;
  }
  const codes = new Set<string>();
  const orders = new Set<number>();
  const weight = configuration.criteria.reduce((total, criterion) => {
    if (codes.has(criterion.code)) {
      throw new DomainError("VALIDATION_ERROR", `Mã KPI ${criterion.code} bị trùng.`);
    }
    if (orders.has(criterion.displayOrder)) {
      throw new DomainError("VALIDATION_ERROR", `Thứ tự KPI ${criterion.displayOrder} bị trùng.`);
    }
    codes.add(criterion.code);
    orders.add(criterion.displayOrder);
    return total + criterion.weightBps;
  }, 0);
  if (weight !== 10_000) {
    throw new DomainError("VALIDATION_ERROR", "Tổng trọng số KPI phải bằng 100%.");
  }
}

function parseConfiguration(
  type: ConfiguredRuleType,
  value: Prisma.JsonValue | null,
): ConfiguredRule {
  const parsed = configuredRuleSchema.safeParse(value);
  if (!parsed.success || parsed.data.kind !== type) {
    throw new DomainError("VALIDATION_ERROR", `Cấu hình ${type} không hợp lệ.`);
  }
  validateConfiguration(parsed.data);
  return parsed.data;
}

function versionDto(
  type: ConfiguredRuleType,
  version: VersionRecord,
  businessDate: string,
): ConfiguredRuleVersionDto {
  const effectiveFrom = version.effectiveFrom?.toISOString().slice(0, 10) ?? null;
  const effectiveTo = version.effectiveTo?.toISOString().slice(0, 10) ?? null;
  return {
    id: version.id,
    ruleSetId: version.ruleSetId,
    versionNo: version.versionNo,
    status: version.status,
    effectiveStatus: effectiveRuleStatus(version.status, businessDate, effectiveFrom, effectiveTo),
    effectiveFrom,
    effectiveTo,
    notes: version.notes,
    rowVersion: version.rowVersion,
    clonedFromVersionId: version.clonedFromVersionId,
    createdAt: version.createdAt.toISOString(),
    publishedAt: version.publishedAt?.toISOString() ?? null,
    configuration: parseConfiguration(type, version.configuration),
  };
}

function versionAuditShape(type: ConfiguredRuleType, version: VersionRecord): unknown {
  return {
    ruleSetId: version.ruleSetId,
    versionNo: version.versionNo,
    status: version.status,
    effectiveFrom: version.effectiveFrom?.toISOString().slice(0, 10) ?? null,
    effectiveTo: version.effectiveTo?.toISOString().slice(0, 10) ?? null,
    notes: version.notes,
    rowVersion: version.rowVersion,
    configuration: parseConfiguration(type, version.configuration),
  };
}

function proposalDto(proposal: ProposalRecord): LevelProposalDto {
  return {
    id: proposal.id,
    sourceMonth: proposal.sourceMonth.toISOString().slice(0, 7),
    effectiveFrom: proposal.effectiveFrom.toISOString().slice(0, 10),
    monthlyRevenue: proposal.monthlyRevenue.toString(),
    status: proposal.status,
    version: proposal.version,
    decisionReason: proposal.decisionReason,
    staff: proposal.staff,
    suggestedLevel: proposal.suggestedPerformanceLevel,
    confirmedLevel: proposal.confirmedPerformanceLevel,
  };
}

function isConstraintConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (("code" in error && (error.code === "P2002" || error.code === "P2004")) ||
      ("message" in error &&
        typeof error.message === "string" &&
        (error.message.includes("rule_versions_no_published_overlap") ||
          error.message.includes("level_history_no_overlap"))))
  );
}

export async function listConfiguredRuleSets(
  actor: ActorContext,
  now = new Date(),
): Promise<readonly ConfiguredRuleSetDto[]> {
  requireConfiguredRuleRead(actor);
  const businessDate = toBusinessDateString(now);
  const date = parseBusinessDate(businessDate);
  const ruleSets = await prisma.ruleSet.findMany({
    where: {
      companyId: actor.companyId,
      type: { not: "PENALTY" },
      managementMode: "VERSIONED",
    },
    select: {
      id: true,
      name: true,
      type: true,
      version: true,
      versions: {
        where:
          actor.role === "GENERAL_MANAGER"
            ? { companyId: actor.companyId }
            : {
                companyId: actor.companyId,
                status: { not: "DRAFT" },
                effectiveFrom: { lte: date },
                OR: [{ effectiveTo: null }, { effectiveTo: { gt: date } }],
              },
        select: versionSelect,
        orderBy: { versionNo: "desc" },
      },
    },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  return ruleSets.flatMap((set) => {
    if (
      !isConfiguredType(set.type) ||
      (actor.role !== "GENERAL_MANAGER" && set.versions.length === 0)
    ) {
      return [];
    }
    const type = set.type;
    return [
      {
        id: set.id,
        name: set.name,
        type,
        version: set.version,
        versions: set.versions.map((version) => versionDto(type, version, businessDate)),
      },
    ];
  });
}

export async function listActiveConfiguredRules(
  actor: ActorContext,
  businessDate: string,
  type?: ConfiguredRuleType,
): Promise<readonly ConfiguredRuleVersionDto[]> {
  requireConfiguredRuleRead(actor);
  const date = parseBusinessDate(businessDate);
  const versions = await prisma.ruleVersion.findMany({
    where: {
      companyId: actor.companyId,
      ruleSet: {
        companyId: actor.companyId,
        type: type ?? { not: "PENALTY" },
        managementMode: "VERSIONED",
      },
      status: { not: "DRAFT" },
      effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: date } }],
    },
    select: { ...versionSelect, ruleSet: { select: { type: true } } },
    orderBy: [{ ruleSetId: "asc" }, { versionNo: "desc" }],
  });
  return versions.flatMap((version) =>
    isConfiguredType(version.ruleSet.type)
      ? [versionDto(version.ruleSet.type, version, businessDate)]
      : [],
  );
}

export async function createConfiguredRuleSet(
  actor: ActorContext,
  input: ConfiguredRuleSetCreateInput,
  metadata: RequestMetadata,
): Promise<ConfiguredRuleSetDto> {
  requirePermission(actor, "rule:write");
  const configuration = defaultConfiguration(input.type);
  return prisma.$transaction(async (tx) => {
    const ruleSet = await tx.ruleSet.create({
      data: {
        companyId: actor.companyId,
        type: input.type,
        managementMode: "VERSIONED",
        name: input.name,
        createdByUserId: actor.userId,
      },
    });
    const version = await tx.ruleVersion.create({
      data: {
        companyId: actor.companyId,
        ruleSetId: ruleSet.id,
        versionNo: 1,
        status: "DRAFT",
        configuration: auditJson(configuration),
        createdByUserId: actor.userId,
      },
      select: versionSelect,
    });
    await appendAudit(tx, {
      actor,
      action: "configured_rule_set.create",
      entityType: "RuleSet",
      entityId: ruleSet.id,
      reason: systemAuditReason("CONFIGURED_RULE_SET_CREATED"),
      after: { name: ruleSet.name, type: ruleSet.type, initialVersionId: version.id },
      metadata,
    });
    return {
      id: ruleSet.id,
      name: ruleSet.name,
      type: input.type,
      version: ruleSet.version,
      versions: [versionDto(input.type, version, toBusinessDateString(new Date()))],
    };
  });
}

export async function createConfiguredRuleDraft(
  actor: ActorContext,
  input: ConfiguredRuleDraftCreateInput,
  metadata: RequestMetadata,
): Promise<ConfiguredRuleVersionDto> {
  requirePermission(actor, "rule:write");
  await enforceSensitiveMutationRateLimit(actor, "configured-rule.publish", {
    windowSeconds: 300,
    maxAttempts: 10,
  });
  return prisma.$transaction(async (tx) => {
    const ruleSet = await tx.ruleSet.findFirst({
      where: {
        id: input.ruleSetId,
        companyId: actor.companyId,
        type: { not: "PENALTY" },
        managementMode: "VERSIONED",
      },
    });
    if (!ruleSet || !isConfiguredType(ruleSet.type)) {
      throw new DomainError("NOT_FOUND", "Không tìm thấy bộ rule cấu hình.");
    }
    const source = input.cloneFromVersionId
      ? await tx.ruleVersion.findFirst({
          where: {
            id: input.cloneFromVersionId,
            ruleSetId: ruleSet.id,
            companyId: actor.companyId,
          },
          select: versionSelect,
        })
      : null;
    if (input.cloneFromVersionId && !source) {
      throw new DomainError("NOT_FOUND", "Không tìm thấy version nguồn để clone.");
    }
    const latest = await tx.ruleVersion.aggregate({
      where: { ruleSetId: ruleSet.id },
      _max: { versionNo: true },
    });
    const configuration = source
      ? parseConfiguration(ruleSet.type, source.configuration)
      : defaultConfiguration(ruleSet.type);
    const created = await tx.ruleVersion.create({
      data: {
        companyId: actor.companyId,
        ruleSetId: ruleSet.id,
        versionNo: (latest._max.versionNo ?? 0) + 1,
        notes: input.notes ?? source?.notes ?? null,
        configuration: auditJson(configuration),
        clonedFromVersionId: source?.id ?? null,
        createdByUserId: actor.userId,
      },
      select: versionSelect,
    });
    await tx.ruleSet.update({
      where: { id: ruleSet.id },
      data: { version: { increment: 1 } },
    });
    await appendAudit(tx, {
      actor,
      action: "configured_rule_version.clone_draft",
      entityType: "RuleVersion",
      entityId: created.id,
      reason: systemAuditReason("CONFIGURED_RULE_VERSION_CLONED_TO_DRAFT"),
      after: versionAuditShape(ruleSet.type, created),
      metadata,
    });
    return versionDto(ruleSet.type, created, toBusinessDateString(new Date()));
  });
}

export async function updateConfiguredRuleDraft(
  actor: ActorContext,
  id: string,
  input: ConfiguredRuleDraftUpdateInput,
  metadata: RequestMetadata,
): Promise<ConfiguredRuleVersionDto> {
  requirePermission(actor, "rule:write");
  await enforceSensitiveMutationRateLimit(actor, "configured-rule.retire", {
    windowSeconds: 300,
    maxAttempts: 10,
  });
  validateConfiguration(input.configuration);
  return prisma.$transaction(async (tx) => {
    const before = await tx.ruleVersion.findFirst({
      where: {
        id,
        companyId: actor.companyId,
        ruleSet: {
          companyId: actor.companyId,
          managementMode: "VERSIONED",
        },
      },
      select: { ...versionSelect, ruleSet: { select: { type: true } } },
    });
    if (!before || !isConfiguredType(before.ruleSet.type)) {
      throw new DomainError("NOT_FOUND", "Không tìm thấy rule version.");
    }
    if (before.status !== "DRAFT") {
      throw new DomainError(
        "CONFLICT",
        "Version đã publish là bất biến; hãy clone thành draft mới.",
      );
    }
    if (input.configuration.kind !== before.ruleSet.type) {
      throw new DomainError("VALIDATION_ERROR", "Loại cấu hình không khớp với bộ rule.");
    }
    const result = await tx.ruleVersion.updateMany({
      where: {
        id,
        companyId: actor.companyId,
        status: "DRAFT",
        rowVersion: input.rowVersion,
      },
      data: {
        notes: input.notes,
        configuration: auditJson(input.configuration),
        rowVersion: { increment: 1 },
      },
    });
    if (result.count !== 1) {
      throw new DomainError("CONFLICT", "Draft đã được cập nhật bởi người khác.");
    }
    const after = await tx.ruleVersion.findUniqueOrThrow({
      where: { id },
      select: versionSelect,
    });
    await appendAudit(tx, {
      actor,
      action: "configured_rule_version.update_draft",
      entityType: "RuleVersion",
      entityId: id,
      reason: systemAuditReason("CONFIGURED_RULE_DRAFT_UPDATED"),
      before: versionAuditShape(before.ruleSet.type, before),
      after: versionAuditShape(before.ruleSet.type, after),
      metadata,
    });
    return versionDto(before.ruleSet.type, after, toBusinessDateString(new Date()));
  });
}

async function syncPerformanceLevels(
  tx: Transaction,
  actor: ActorContext,
  configuration: MonthlyLevelConfig,
  reason: string,
  metadata: RequestMetadata,
): Promise<void> {
  for (const level of configuration.levels) {
    const before = await tx.performanceLevel.findUnique({
      where: { companyId_code: { companyId: actor.companyId, code: level.code } },
    });
    const after = await tx.performanceLevel.upsert({
      where: { companyId_code: { companyId: actor.companyId, code: level.code } },
      create: {
        companyId: actor.companyId,
        code: level.code,
        name: level.name,
        displayOrder: level.displayOrder,
      },
      update: { name: level.name, displayOrder: level.displayOrder, isActive: true },
    });
    await appendAudit(tx, {
      actor,
      action: "performance_level.sync_from_rule",
      entityType: "PerformanceLevel",
      entityId: after.id,
      reason,
      before: before
        ? { code: before.code, name: before.name, displayOrder: before.displayOrder }
        : undefined,
      after: { code: after.code, name: after.name, displayOrder: after.displayOrder },
      metadata,
    });
  }
}

export async function publishConfiguredRuleVersion(
  actor: ActorContext,
  id: string,
  input: PenaltyRulePublishInput,
  metadata: RequestMetadata,
  now = new Date(),
): Promise<ConfiguredRuleVersionDto> {
  requirePermission(actor, "rule:write");
  const businessDate = toBusinessDateString(now);
  const effectiveFrom = parseBusinessDate(input.effectiveFrom);
  const effectiveTo = input.effectiveTo ? parseBusinessDate(input.effectiveTo) : null;
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.ruleVersion.findFirst({
        where: {
          id,
          companyId: actor.companyId,
          ruleSet: {
            companyId: actor.companyId,
            managementMode: "VERSIONED",
          },
        },
        select: { ...versionSelect, ruleSet: { select: { type: true } } },
      });
      if (!before || !isConfiguredType(before.ruleSet.type)) {
        throw new DomainError("NOT_FOUND", "Không tìm thấy rule version.");
      }
      if (before.status !== "DRAFT") {
        throw new DomainError("CONFLICT", "Chỉ draft mới có thể publish.");
      }
      const configuration = parseConfiguration(before.ruleSet.type, before.configuration);
      const overlap = await tx.ruleVersion.findFirst({
        where: {
          companyId: actor.companyId,
          ruleSetId: before.ruleSetId,
          id: { not: id },
          status: { not: "DRAFT" },
          ...(effectiveTo ? { effectiveFrom: { lt: effectiveTo } } : {}),
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
        },
        select: { versionNo: true },
      });
      if (overlap) {
        throw new DomainError(
          "CONFLICT",
          `Khoảng hiệu lực overlap với version ${overlap.versionNo}.`,
        );
      }
      const result = await tx.ruleVersion.updateMany({
        where: {
          id,
          companyId: actor.companyId,
          status: "DRAFT",
          rowVersion: input.rowVersion,
        },
        data: {
          status: input.effectiveFrom > businessDate ? "SCHEDULED" : "ACTIVE",
          effectiveFrom,
          effectiveTo,
          publishedByUserId: actor.userId,
          publishedAt: now,
          rowVersion: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        throw new DomainError("CONFLICT", "Draft đã được cập nhật bởi người khác.");
      }
      if (configuration.kind === "MONTHLY_LEVEL_RULES") {
        await syncPerformanceLevels(
          tx,
          actor,
          configuration,
          systemAuditReason("PERFORMANCE_LEVELS_SYNCED_FROM_PUBLISHED_RULE"),
          metadata,
        );
      }
      const after = await tx.ruleVersion.findUniqueOrThrow({
        where: { id },
        select: versionSelect,
      });
      await appendAudit(tx, {
        actor,
        action: "configured_rule_version.publish",
        entityType: "RuleVersion",
        entityId: id,
        reason: systemAuditReason("CONFIGURED_RULE_VERSION_PUBLISHED"),
        before: versionAuditShape(before.ruleSet.type, before),
        after: versionAuditShape(before.ruleSet.type, after),
        metadata,
      });
      return versionDto(before.ruleSet.type, after, businessDate);
    });
  } catch (error) {
    if (isConstraintConflict(error)) {
      throw new DomainError("CONFLICT", "Khoảng hiệu lực overlap với version đã publish.");
    }
    throw error;
  }
}

export async function retireConfiguredRuleVersion(
  actor: ActorContext,
  id: string,
  input: PenaltyRuleRetireInput,
  metadata: RequestMetadata,
  now = new Date(),
): Promise<ConfiguredRuleVersionDto> {
  requirePermission(actor, "rule:write");
  const effectiveTo = parseBusinessDate(input.effectiveTo);
  return prisma.$transaction(async (tx) => {
    const before = await tx.ruleVersion.findFirst({
      where: {
        id,
        companyId: actor.companyId,
        ruleSet: {
          companyId: actor.companyId,
          managementMode: "VERSIONED",
        },
      },
      select: { ...versionSelect, ruleSet: { select: { type: true } } },
    });
    if (!before || !isConfiguredType(before.ruleSet.type)) {
      throw new DomainError("NOT_FOUND", "Không tìm thấy rule version.");
    }
    if ((before.status !== "ACTIVE" && before.status !== "SCHEDULED") || !before.effectiveFrom) {
      throw new DomainError("CONFLICT", "Version không ở trạng thái có thể retire.");
    }
    if (
      effectiveTo <= before.effectiveFrom ||
      (before.effectiveTo && effectiveTo > before.effectiveTo)
    ) {
      throw new DomainError("VALIDATION_ERROR", "Ngày retire nằm ngoài khoảng hiệu lực.");
    }
    const result = await tx.ruleVersion.updateMany({
      where: {
        id,
        companyId: actor.companyId,
        status: { in: ["ACTIVE", "SCHEDULED"] },
        rowVersion: input.rowVersion,
      },
      data: { status: "RETIRED", effectiveTo, rowVersion: { increment: 1 } },
    });
    if (result.count !== 1) {
      throw new DomainError("CONFLICT", "Version đã được cập nhật bởi người khác.");
    }
    const after = await tx.ruleVersion.findUniqueOrThrow({
      where: { id },
      select: versionSelect,
    });
    await appendAudit(tx, {
      actor,
      action: "configured_rule_version.retire",
      entityType: "RuleVersion",
      entityId: id,
      reason: systemAuditReason("CONFIGURED_RULE_VERSION_RETIRED"),
      before: versionAuditShape(before.ruleSet.type, before),
      after: versionAuditShape(before.ruleSet.type, after),
      metadata,
    });
    return versionDto(before.ruleSet.type, after, toBusinessDateString(now));
  });
}

export async function compareConfiguredRuleVersions(
  actor: ActorContext,
  fromVersionId: string,
  toVersionId: string,
): Promise<ConfiguredRuleComparisonDto> {
  requirePermission(actor, "rule:write");
  const versions = await prisma.ruleVersion.findMany({
    where: {
      companyId: actor.companyId,
      id: { in: [fromVersionId, toVersionId] },
      ruleSet: {
        companyId: actor.companyId,
        managementMode: "VERSIONED",
      },
    },
    select: { ...versionSelect, ruleSet: { select: { type: true } } },
  });
  const from = versions.find((version) => version.id === fromVersionId);
  const to = versions.find((version) => version.id === toVersionId);
  if (
    !from ||
    !to ||
    from.ruleSetId !== to.ruleSetId ||
    !isConfiguredType(from.ruleSet.type) ||
    from.ruleSet.type !== to.ruleSet.type
  ) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy hai version trong cùng bộ rule.");
  }
  return {
    fromVersionId,
    toVersionId,
    changedPaths: compareConfigurationPaths(
      parseConfiguration(from.ruleSet.type, from.configuration),
      parseConfiguration(from.ruleSet.type, to.configuration),
    ),
  };
}

function monthBounds(month: string): Readonly<{
  first: string;
  last: string;
  after: string;
  firstDate: Date;
  afterDate: Date;
}> {
  const days = enumerateBusinessMonth(month);
  const first = days[0]!.businessDate;
  const last = days[days.length - 1]!.businessDate;
  const afterDate = new Date(`${last}T00:00:00.000Z`);
  afterDate.setUTCDate(afterDate.getUTCDate() + 1);
  return {
    first,
    last,
    after: afterDate.toISOString().slice(0, 10),
    firstDate: parseBusinessDate(first),
    afterDate,
  };
}

function addDecimalValues(values: readonly string[]): string {
  const hundredths = values.reduce((total, value) => {
    const [whole, fraction = ""] = value.split(".");
    return total + BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  }, 0n);
  const whole = hundredths / 100n;
  const fraction = (hundredths % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function subtractValues(left: string, right: string, decimal: boolean): string {
  if (!decimal) return (BigInt(left) - BigInt(right)).toString();
  const toHundredths = (value: string): bigint => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  };
  const result = toHundredths(left) - toHundredths(right);
  const sign = result < 0n ? "-" : "";
  const absolute = result < 0n ? -result : result;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

type PreviewStaff = Prisma.StaffMemberGetPayload<{
  select: {
    id: true;
    staffCode: true;
    fullName: true;
    baseSalaryAmount: true;
    user: { select: { role: true } };
    attendanceDays: {
      select: {
        businessDate: true;
        status: true;
        workUnits: true;
        overtimeMinutes: true;
        liveMetric: { select: { revenueAmount: true; actualLiveMinutes: true } };
      };
    };
    levelHistories: {
      select: {
        effectiveFrom: true;
        effectiveTo: true;
        performanceLevel: { select: { code: true; displayOrder: true } };
      };
    };
  };
}>;

function evaluateConfiguration(
  configuration: ConfiguredRule,
  staff: PreviewStaff,
  month: string,
): Readonly<{
  value: string;
  details: Readonly<Record<string, string | number | boolean | null>>;
}> {
  if (configuration.kind === "DAILY_REWARD_TIERS") {
    const amount = staff.attendanceDays.reduce(
      (total, row) =>
        total +
        BigInt(
          calculateDailyReward(
            row.liveMetric?.revenueAmount.toString() ?? "0",
            configuration.tiers,
          ),
        ),
      0n,
    );
    return { value: amount.toString(), details: { attendanceDays: staff.attendanceDays.length } };
  }
  const totals = summarizeMonthlyMetrics(
    staff.attendanceDays.map((row) => ({
      revenueAmount: row.liveMetric?.revenueAmount.toString() ?? "0",
      workUnits: row.workUnits.toString(),
      actualLiveMinutes: row.liveMetric?.actualLiveMinutes ?? 0,
      overtimeMinutes: row.overtimeMinutes,
      penaltyAmount: "0",
    })),
  );
  if (configuration.kind === "MONTHLY_LEVEL_RULES") {
    const current = staff.levelHistories.find(
      (history) =>
        history.effectiveFrom.toISOString().slice(0, 7) <= month &&
        (!history.effectiveTo || history.effectiveTo.toISOString().slice(0, 7) > month),
    );
    const result = calculateMonthlyLevelResult(
      {
        monthlyCoins: totals.revenueAmount,
        workedDayCount: staff.attendanceDays.filter(
          (row) => row.status === "PRESENT" && Number(row.workUnits.toString()) > 0,
        ).length,
        attendanceRequiredDays: configuration.attendanceRequiredDays ?? 26,
        previousLevelCode: current?.performanceLevel.code ?? null,
        previousLevelOrder: current?.performanceLevel.displayOrder ?? null,
      },
      configuration.levels,
    );
    return {
      value: result.amount,
      details: {
        suggestedLevel: result.suggestedLevel?.code ?? null,
        attendanceEligible: result.attendanceEligible,
        achievementEligible: result.achievementEligible,
        transition: result.transition,
      },
    };
  }
  if (configuration.kind === "SALARY_RULES") {
    const { standardDaysOffPerMonth, ...salaryConfiguration } = configuration;
    const result = calculateSalaryProjection(
      {
        ...salaryConfiguration,
        probationSalaryRateBps: salaryConfiguration.probationSalaryRateBps ?? 8_500,
        ...(standardDaysOffPerMonth === undefined ? {} : { standardDaysOffPerMonth }),
        baseSalary: staff.baseSalaryAmount.toString(),
      },
      staff.attendanceDays.map((row) => ({
        status: row.status,
        workUnits: row.workUnits.toString(),
        overtimeMinutes: row.overtimeMinutes,
      })),
    );
    return {
      value: result.totalAmount,
      details: {
        baseSalaryAmount: result.baseSalaryAmount,
        overtimeAmount: result.overtimeAmount,
      },
    };
  }
  return {
    value: calculateKpiMaximumScore(configuration.criteria),
    details: { criteriaCount: configuration.criteria.length },
  };
}

export async function previewConfiguredRuleImpact(
  actor: ActorContext,
  input: RuleImpactPreviewInput,
): Promise<RuleImpactPreviewDto> {
  requirePermission(actor, "rule:write");
  const bounds = monthBounds(input.month);
  const draft = await prisma.ruleVersion.findFirst({
    where: {
      id: input.ruleVersionId,
      companyId: actor.companyId,
      ruleSet: {
        companyId: actor.companyId,
        managementMode: "VERSIONED",
      },
    },
    select: { ...versionSelect, ruleSet: { select: { type: true } } },
  });
  if (!draft || draft.status !== "DRAFT" || !isConfiguredType(draft.ruleSet.type)) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy draft rule để preview.");
  }
  const draftConfiguration = parseConfiguration(draft.ruleSet.type, draft.configuration);
  const baseline = await prisma.ruleVersion.findFirst({
    where: {
      companyId: actor.companyId,
      ruleSetId: draft.ruleSetId,
      status: { not: "DRAFT" },
      effectiveFrom: { lt: bounds.afterDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: bounds.firstDate } }],
    },
    select: versionSelect,
    orderBy: { effectiveFrom: "desc" },
  });
  const baselineConfiguration = baseline
    ? parseConfiguration(draft.ruleSet.type, baseline.configuration)
    : null;
  const staff = await prisma.staffMember.findMany({
    where: {
      companyId: actor.companyId,
      archivedAt: null,
      employmentStatus: { not: "TERMINATED" },
      ...(draft.ruleSet.type === "KPI_TEMPLATE"
        ? { user: { role: "TRAINING_MANAGER", active: true } }
        : draft.ruleSet.type === "DAILY_REWARD_TIERS" ||
            draft.ruleSet.type === "MONTHLY_LEVEL_RULES"
          ? {
              OR: [{ user: null }, { user: { role: "LIVE_EMPLOYEE", active: true } }],
            }
          : {}),
    },
    select: {
      id: true,
      staffCode: true,
      fullName: true,
      baseSalaryAmount: true,
      user: { select: { role: true } },
      attendanceDays: {
        where: {
          companyId: actor.companyId,
          businessDate: { gte: bounds.firstDate, lt: bounds.afterDate },
          archivedAt: null,
        },
        select: {
          businessDate: true,
          status: true,
          workUnits: true,
          overtimeMinutes: true,
          liveMetric: { select: { revenueAmount: true, actualLiveMinutes: true } },
        },
      },
      levelHistories: {
        where: {
          companyId: actor.companyId,
          effectiveFrom: { lt: bounds.afterDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: bounds.firstDate } }],
        },
        select: {
          effectiveFrom: true,
          effectiveTo: true,
          performanceLevel: { select: { code: true, displayOrder: true } },
        },
      },
    },
    orderBy: [{ staffCode: "asc" }],
  });
  const decimal = draft.ruleSet.type === "KPI_TEMPLATE";
  const rows = staff.map((person) => {
    const baselineResult = baselineConfiguration
      ? evaluateConfiguration(baselineConfiguration, person, input.month)
      : { value: "0", details: {} };
    const draftResult = evaluateConfiguration(draftConfiguration, person, input.month);
    return {
      staffId: person.id,
      staffCode: person.staffCode,
      fullName: person.fullName,
      baselineValue: baselineResult.value,
      draftValue: draftResult.value,
      delta: subtractValues(draftResult.value, baselineResult.value, decimal),
      details: draftResult.details,
    };
  });
  const baselineTotal = decimal
    ? addDecimalValues(rows.map((row) => row.baselineValue))
    : rows.reduce((total, row) => total + BigInt(row.baselineValue), 0n).toString();
  const draftTotal = decimal
    ? addDecimalValues(rows.map((row) => row.draftValue))
    : rows.reduce((total, row) => total + BigInt(row.draftValue), 0n).toString();
  return {
    ruleVersionId: draft.id,
    baselineVersionId: baseline?.id ?? null,
    month: input.month,
    metric: decimal ? "MAX_KPI_SCORE" : "PROJECTED_AMOUNT_VND",
    rows,
    totals: {
      baselineValue: baselineTotal,
      draftValue: draftTotal,
      delta: subtractValues(draftTotal, baselineTotal, decimal),
    },
  };
}

export async function listLevelProposals(
  actor: ActorContext,
  month: string,
): Promise<readonly LevelProposalDto[]> {
  requirePermission(actor, "rule:write");
  const bounds = monthBounds(month);
  const proposals = await prisma.levelProposal.findMany({
    where: { companyId: actor.companyId, sourceMonth: bounds.firstDate },
    select: proposalSelect,
    orderBy: { staff: { staffCode: "asc" } },
  });
  return proposals.map(proposalDto);
}

export async function listPerformanceLevelOptions(
  actor: ActorContext,
): Promise<readonly PerformanceLevelOptionDto[]> {
  requirePermission(actor, "rule:write");
  return prisma.performanceLevel.findMany({
    where: { companyId: actor.companyId, isActive: true },
    select: { id: true, code: true, name: true, displayOrder: true },
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
  });
}

export async function generateLevelProposals(
  actor: ActorContext,
  input: LevelProposalGenerateInput,
  metadata: RequestMetadata,
): Promise<readonly LevelProposalDto[]> {
  requirePermission(actor, "rule:write");
  const bounds = monthBounds(input.month);
  const versions = await prisma.ruleVersion.findMany({
    where: {
      companyId: actor.companyId,
      ruleSet: {
        companyId: actor.companyId,
        type: "MONTHLY_LEVEL_RULES",
        managementMode: "VERSIONED",
      },
      status: { not: "DRAFT" },
      effectiveFrom: { lte: parseBusinessDate(bounds.last) },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: parseBusinessDate(bounds.last) } }],
    },
    select: versionSelect,
  });
  if (versions.length !== 1) {
    throw new DomainError(
      "CONFLICT",
      versions.length === 0
        ? "Không có rule level đang hiệu lực ở cuối tháng."
        : "Có nhiều bộ rule level cùng hiệu lực; cần retire bớt trước khi tạo đề xuất.",
    );
  }
  const ruleVersion = versions[0]!;
  const configuration = parseConfiguration(
    "MONTHLY_LEVEL_RULES",
    ruleVersion.configuration,
  ) as MonthlyLevelConfig;
  const levelCatalog = await prisma.performanceLevel.findMany({
    where: {
      companyId: actor.companyId,
      code: { in: configuration.levels.map((level) => level.code) },
    },
  });
  const catalogByCode = new Map(levelCatalog.map((level) => [level.code, level]));
  const staff = await prisma.staffMember.findMany({
    where: {
      companyId: actor.companyId,
      archivedAt: null,
      employmentStatus: { not: "TERMINATED" },
      OR: [{ user: null }, { user: { role: "LIVE_EMPLOYEE", active: true } }],
    },
    select: {
      id: true,
      attendanceDays: {
        where: {
          companyId: actor.companyId,
          businessDate: { gte: bounds.firstDate, lt: bounds.afterDate },
          archivedAt: null,
        },
        select: { liveMetric: { select: { revenueAmount: true } } },
      },
    },
  });

  await prisma.$transaction(async (tx) => {
    const existingStaffIds = new Set(
      (
        await tx.levelProposal.findMany({
          where: { companyId: actor.companyId, sourceMonth: bounds.firstDate },
          select: { staffId: true },
        })
      ).map((proposal) => proposal.staffId),
    );
    for (const person of staff) {
      const revenue = person.attendanceDays
        .reduce((total, row) => total + (row.liveMetric?.revenueAmount ?? 0n), 0n)
        .toString();
      const matched = matchRevenueBand(
        revenue,
        configuration.levels.map((level) => ({
          ...level,
          priority: level.displayOrder,
        })),
      );
      if (!matched) continue;
      const catalog = catalogByCode.get(matched.code);
      if (!catalog) {
        throw new DomainError(
          "CONFLICT",
          `Level ${matched.code} chưa được đồng bộ; hãy publish lại rule.`,
        );
      }
      if (existingStaffIds.has(person.id)) continue;
      const created = await tx.levelProposal.create({
        data: {
          companyId: actor.companyId,
          staffId: person.id,
          sourceMonth: bounds.firstDate,
          effectiveFrom: parseBusinessDate(bounds.after),
          ruleVersionId: ruleVersion.id,
          suggestedPerformanceLevelId: catalog.id,
          monthlyRevenue: BigInt(revenue),
        },
      });
      await appendAudit(tx, {
        actor,
        action: "level_proposal.generate",
        entityType: "LevelProposal",
        entityId: created.id,
        reason: systemAuditReason("LEVEL_PROPOSAL_GENERATED"),
        after: {
          sourceMonth: input.month,
          effectiveFrom: bounds.after,
          staffId: person.id,
          ruleVersionId: ruleVersion.id,
          suggestedLevelCode: catalog.code,
          monthlyRevenue: revenue,
        },
        metadata,
      });
      existingStaffIds.add(person.id);
    }
  });
  return listLevelProposals(actor, input.month);
}

export async function confirmLevelProposal(
  actor: ActorContext,
  id: string,
  input: LevelProposalConfirmInput,
  metadata: RequestMetadata,
  now = new Date(),
): Promise<LevelProposalDto> {
  requirePermission(actor, "rule:write");
  try {
    return await prisma.$transaction(async (tx) => {
      const proposal = await tx.levelProposal.findFirst({
        where: { id, companyId: actor.companyId },
        include: { suggestedPerformanceLevel: true },
      });
      if (!proposal) {
        throw new DomainError("NOT_FOUND", "Không tìm thấy đề xuất level.");
      }
      if (proposal.status !== "PENDING") {
        throw new DomainError("CONFLICT", "Đề xuất level đã được quyết định.");
      }
      const targetId = input.performanceLevelId ?? proposal.suggestedPerformanceLevelId;
      const target = await tx.performanceLevel.findFirst({
        where: { id: targetId, companyId: actor.companyId, isActive: true },
      });
      if (!target) {
        throw new DomainError("NOT_FOUND", "Không tìm thấy level xác nhận.");
      }
      const current = await tx.levelHistory.findFirst({
        where: {
          companyId: actor.companyId,
          staffId: proposal.staffId,
          effectiveFrom: { lte: proposal.effectiveFrom },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: proposal.effectiveFrom } }],
        },
        include: { performanceLevel: true },
        orderBy: { effectiveFrom: "desc" },
      });
      if (
        current &&
        current.effectiveFrom.getTime() === proposal.effectiveFrom.getTime() &&
        current.performanceLevelId !== target.id
      ) {
        throw new DomainError("CONFLICT", "Đã có lịch sử level khác bắt đầu đúng tháng hiệu lực.");
      }
      if (!current || current.performanceLevelId !== target.id) {
        const next = await tx.levelHistory.findFirst({
          where: {
            companyId: actor.companyId,
            staffId: proposal.staffId,
            effectiveFrom: { gt: proposal.effectiveFrom },
          },
          orderBy: { effectiveFrom: "asc" },
        });
        if (current) {
          const closed = await tx.levelHistory.update({
            where: { id: current.id },
            data: { effectiveTo: proposal.effectiveFrom, version: { increment: 1 } },
          });
          await appendAudit(tx, {
            actor,
            action: "level_history.close_for_proposal",
            entityType: "LevelHistory",
            entityId: current.id,
            reason: systemAuditReason("LEVEL_HISTORY_CLOSED_FOR_PROPOSAL"),
            before: {
              levelCode: current.performanceLevel.code,
              effectiveFrom: current.effectiveFrom.toISOString().slice(0, 10),
              effectiveTo: current.effectiveTo?.toISOString().slice(0, 10) ?? null,
              version: current.version,
            },
            after: {
              levelCode: current.performanceLevel.code,
              effectiveFrom: current.effectiveFrom.toISOString().slice(0, 10),
              effectiveTo: closed.effectiveTo?.toISOString().slice(0, 10) ?? null,
              version: closed.version,
            },
            metadata,
          });
        }
        const history = await tx.levelHistory.create({
          data: {
            companyId: actor.companyId,
            staffId: proposal.staffId,
            performanceLevelId: target.id,
            effectiveFrom: proposal.effectiveFrom,
            effectiveTo: next?.effectiveFrom ?? null,
            createdByUserId: actor.userId,
          },
        });
        await appendAudit(tx, {
          actor,
          action: "level_history.create_from_proposal",
          entityType: "LevelHistory",
          entityId: history.id,
          reason: systemAuditReason("LEVEL_HISTORY_CREATED_FROM_PROPOSAL"),
          before: current
            ? {
                levelCode: current.performanceLevel.code,
                effectiveFrom: current.effectiveFrom.toISOString().slice(0, 10),
                effectiveTo: proposal.effectiveFrom.toISOString().slice(0, 10),
              }
            : undefined,
          after: {
            levelCode: target.code,
            effectiveFrom: proposal.effectiveFrom.toISOString().slice(0, 10),
            effectiveTo: next?.effectiveFrom.toISOString().slice(0, 10) ?? null,
          },
          metadata,
        });
      }
      const status =
        target.id === proposal.suggestedPerformanceLevelId ? "CONFIRMED" : "OVERRIDDEN";
      const updated = await tx.levelProposal.updateMany({
        where: {
          id,
          companyId: actor.companyId,
          status: "PENDING",
          version: input.version,
        },
        data: {
          status,
          confirmedPerformanceLevelId: target.id,
          decisionReason: systemAuditReason(
            status === "OVERRIDDEN"
              ? "LEVEL_PROPOSAL_OVERRIDDEN"
              : "LEVEL_PROPOSAL_CONFIRMED",
          ),
          decidedByUserId: actor.userId,
          decidedAt: now,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new DomainError("CONFLICT", "Đề xuất đã được cập nhật bởi người khác.");
      }
      await appendAudit(tx, {
        actor,
        action: status === "OVERRIDDEN" ? "level_proposal.override" : "level_proposal.confirm",
        entityType: "LevelProposal",
        entityId: id,
        reason: systemAuditReason(
          status === "OVERRIDDEN"
            ? "LEVEL_PROPOSAL_OVERRIDDEN"
            : "LEVEL_PROPOSAL_CONFIRMED",
        ),
        before: {
          status: proposal.status,
          suggestedLevelCode: proposal.suggestedPerformanceLevel.code,
          version: proposal.version,
        },
        after: { status, confirmedLevelCode: target.code, version: proposal.version + 1 },
        metadata,
      });
      return proposalDto(
        await tx.levelProposal.findUniqueOrThrow({ where: { id }, select: proposalSelect }),
      );
    });
  } catch (error) {
    if (isConstraintConflict(error)) {
      throw new DomainError("CONFLICT", "Lịch sử level bị overlap với kỳ đã có.");
    }
    throw error;
  }
}
