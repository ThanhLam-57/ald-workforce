import type {
  PenaltyItemDto,
  PenaltyRuleComparisonDto,
  PenaltyRuleDraftCreateInput,
  PenaltyRuleDraftUpdateInput,
  PenaltyRulePublishInput,
  PenaltyRuleRetireInput,
  PenaltyRuleSetCreateInput,
  PenaltyRuleSetDto,
  PenaltyRuleVersionDto,
} from "@ald/contracts";
import { prisma, type Prisma } from "@ald/db";
import {
  DomainError,
  comparePenaltyItems,
  effectiveRuleStatus,
  requirePermission,
  toBusinessDateString,
  type ActorContext,
} from "@ald/domain";

import { parseBusinessDate } from "./business-date";
import type { RequestMetadata } from "./request-metadata";

type Transaction = Prisma.TransactionClient;

const ruleVersionSelect = {
  id: true,
  ruleSetId: true,
  versionNo: true,
  status: true,
  effectiveFrom: true,
  effectiveTo: true,
  notes: true,
  rowVersion: true,
  clonedFromVersionId: true,
  createdAt: true,
  publishedAt: true,
  items: {
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      defaultAmount: true,
      reminderPolicy: true,
      metadata: true,
      isActive: true,
      displayColor: true,
      displayOrder: true,
    },
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
  },
} satisfies Prisma.RuleVersionSelect;

type RuleVersionRecord = Prisma.RuleVersionGetPayload<{
  select: typeof ruleVersionSelect;
}>;

function auditJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function appendAudit(
  tx: Transaction,
  input: {
    actor: ActorContext;
    action: string;
    entityType: "RuleSet" | "RuleVersion";
    entityId: string;
    reason: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    metadata: RequestMetadata;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      companyId: input.actor.companyId,
      actorUserId: input.actor.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      reason: input.reason,
      ...(input.before ? { before: auditJson(input.before) } : {}),
      ...(input.after ? { after: auditJson(input.after) } : {}),
      requestId: input.metadata.requestId,
      ipAddress: input.metadata.ipAddress,
      userAgent: input.metadata.userAgent,
    },
  });
}

function jsonObject(value: Prisma.JsonValue | null): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function itemDto(item: RuleVersionRecord["items"][number]): PenaltyItemDto {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    description: item.description,
    defaultAmount: item.defaultAmount.toString(),
    reminderPolicy: jsonObject(item.reminderPolicy),
    metadata: jsonObject(item.metadata),
    isActive: item.isActive,
    displayColor: item.displayColor,
    displayOrder: item.displayOrder,
  };
}

function versionDto(version: RuleVersionRecord, businessDate: string): PenaltyRuleVersionDto {
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
    items: version.items.map(itemDto),
  };
}

function versionAuditShape(version: RuleVersionRecord): Record<string, unknown> {
  return {
    ruleSetId: version.ruleSetId,
    versionNo: version.versionNo,
    status: version.status,
    effectiveFrom: version.effectiveFrom?.toISOString().slice(0, 10) ?? null,
    effectiveTo: version.effectiveTo?.toISOString().slice(0, 10) ?? null,
    notes: version.notes,
    rowVersion: version.rowVersion,
    items: version.items.map((item) => ({
      code: item.code,
      name: item.name,
      description: item.description,
      defaultAmount: item.defaultAmount.toString(),
      isActive: item.isActive,
      displayColor: item.displayColor,
      displayOrder: item.displayOrder,
    })),
  };
}

function isConstraintConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (("code" in error && (error.code === "P2002" || error.code === "P2004")) ||
      ("message" in error &&
        typeof error.message === "string" &&
        error.message.includes("rule_versions_no_published_overlap")))
  );
}

export async function listPenaltyRuleSets(
  actor: ActorContext,
  now = new Date(),
): Promise<readonly PenaltyRuleSetDto[]> {
  requirePermission(actor, "rule:read");
  const businessDate = toBusinessDateString(now);
  const date = parseBusinessDate(businessDate);
  const ruleSets = await prisma.ruleSet.findMany({
    where: { companyId: actor.companyId, type: "PENALTY" },
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
        select: ruleVersionSelect,
        orderBy: { versionNo: "desc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return ruleSets
    .filter((ruleSet) => actor.role === "GENERAL_MANAGER" || ruleSet.versions.length > 0)
    .map((ruleSet) => ({
      id: ruleSet.id,
      name: ruleSet.name,
      type: "PENALTY" as const,
      version: ruleSet.version,
      versions: ruleSet.versions.map((version) => versionDto(version, businessDate)),
    }));
}

export async function listActivePenaltyVersions(
  actor: ActorContext,
  businessDate: string,
): Promise<readonly PenaltyRuleVersionDto[]> {
  requirePermission(actor, "rule:read");
  const date = parseBusinessDate(businessDate);
  const versions = await prisma.ruleVersion.findMany({
    where: {
      companyId: actor.companyId,
      ruleSet: { type: "PENALTY" },
      status: { not: "DRAFT" },
      effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: date } }],
    },
    select: ruleVersionSelect,
    orderBy: [{ ruleSetId: "asc" }, { versionNo: "desc" }],
  });
  return versions.map((version) => versionDto(version, businessDate));
}

export async function createPenaltyRuleSet(
  actor: ActorContext,
  input: PenaltyRuleSetCreateInput,
  metadata: RequestMetadata,
): Promise<PenaltyRuleSetDto> {
  requirePermission(actor, "rule:write");
  return prisma.$transaction(async (tx) => {
    const ruleSet = await tx.ruleSet.create({
      data: {
        companyId: actor.companyId,
        type: "PENALTY",
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
        createdByUserId: actor.userId,
      },
      select: ruleVersionSelect,
    });
    await appendAudit(tx, {
      actor,
      action: "rule_set.create",
      entityType: "RuleSet",
      entityId: ruleSet.id,
      reason: input.reason,
      after: {
        name: ruleSet.name,
        type: ruleSet.type,
        initialVersionId: version.id,
      },
      metadata,
    });
    return {
      id: ruleSet.id,
      name: ruleSet.name,
      type: "PENALTY" as const,
      version: ruleSet.version,
      versions: [versionDto(version, toBusinessDateString(new Date()))],
    };
  });
}

export async function createPenaltyRuleDraft(
  actor: ActorContext,
  input: PenaltyRuleDraftCreateInput,
  metadata: RequestMetadata,
): Promise<PenaltyRuleVersionDto> {
  requirePermission(actor, "rule:write");
  return prisma.$transaction(async (tx) => {
    const ruleSet = await tx.ruleSet.findFirst({
      where: {
        id: input.ruleSetId,
        companyId: actor.companyId,
        type: "PENALTY",
      },
    });
    if (!ruleSet) {
      throw new DomainError("NOT_FOUND", "Không tìm thấy bộ rule phạt.");
    }
    await tx.ruleSet.update({
      where: { id: ruleSet.id },
      data: { version: { increment: 1 } },
    });

    const source = input.cloneFromVersionId
      ? await tx.ruleVersion.findFirst({
          where: {
            id: input.cloneFromVersionId,
            ruleSetId: ruleSet.id,
            companyId: actor.companyId,
          },
          select: ruleVersionSelect,
        })
      : null;
    if (input.cloneFromVersionId && !source) {
      throw new DomainError("NOT_FOUND", "Không tìm thấy version nguồn để clone.");
    }
    const latest = await tx.ruleVersion.aggregate({
      where: { ruleSetId: ruleSet.id },
      _max: { versionNo: true },
    });
    const created = await tx.ruleVersion.create({
      data: {
        companyId: actor.companyId,
        ruleSetId: ruleSet.id,
        versionNo: (latest._max.versionNo ?? 0) + 1,
        status: "DRAFT",
        notes: input.notes ?? source?.notes ?? null,
        clonedFromVersionId: source?.id ?? null,
        createdByUserId: actor.userId,
        ...(source
          ? {
              items: {
                create: source.items.map((item) => ({
                  companyId: actor.companyId,
                  code: item.code,
                  name: item.name,
                  description: item.description,
                  defaultAmount: item.defaultAmount,
                  ...(item.reminderPolicy !== null
                    ? { reminderPolicy: item.reminderPolicy as Prisma.InputJsonValue }
                    : {}),
                  ...(item.metadata !== null
                    ? { metadata: item.metadata as Prisma.InputJsonValue }
                    : {}),
                  isActive: item.isActive,
                  displayColor: item.displayColor,
                  displayOrder: item.displayOrder,
                })),
              },
            }
          : {}),
      },
      select: ruleVersionSelect,
    });
    await appendAudit(tx, {
      actor,
      action: "rule_version.clone_draft",
      entityType: "RuleVersion",
      entityId: created.id,
      reason: input.reason,
      after: versionAuditShape(created),
      metadata,
    });
    return versionDto(created, toBusinessDateString(new Date()));
  });
}

export async function updatePenaltyRuleDraft(
  actor: ActorContext,
  id: string,
  input: PenaltyRuleDraftUpdateInput,
  metadata: RequestMetadata,
): Promise<PenaltyRuleVersionDto> {
  requirePermission(actor, "rule:write");
  return prisma.$transaction(async (tx) => {
    const before = await tx.ruleVersion.findFirst({
      where: { id, companyId: actor.companyId },
      select: ruleVersionSelect,
    });
    if (!before) {
      throw new DomainError("NOT_FOUND", "Không tìm thấy rule version.");
    }
    if (before.status !== "DRAFT") {
      throw new DomainError(
        "CONFLICT",
        "Version đã publish là bất biến; hãy clone thành draft mới.",
      );
    }
    const updated = await tx.ruleVersion.updateMany({
      where: {
        id,
        companyId: actor.companyId,
        status: "DRAFT",
        rowVersion: input.rowVersion,
      },
      data: {
        notes: input.notes,
        rowVersion: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new DomainError("CONFLICT", "Draft đã được cập nhật bởi người khác.");
    }

    await tx.penaltyItem.deleteMany({ where: { ruleVersionId: id } });
    if (input.items.length > 0) {
      await tx.penaltyItem.createMany({
        data: input.items.map((item) => ({
          companyId: actor.companyId,
          ruleVersionId: id,
          code: item.code,
          name: item.name,
          description: item.description,
          defaultAmount: BigInt(item.defaultAmount),
          ...(item.reminderPolicy !== undefined && item.reminderPolicy !== null
            ? { reminderPolicy: item.reminderPolicy as Prisma.InputJsonValue }
            : {}),
          ...(item.metadata !== undefined && item.metadata !== null
            ? { metadata: item.metadata as Prisma.InputJsonValue }
            : {}),
          isActive: item.isActive,
          displayColor: item.displayColor,
          displayOrder: item.displayOrder,
        })),
      });
    }
    const after = await tx.ruleVersion.findUniqueOrThrow({
      where: { id },
      select: ruleVersionSelect,
    });
    await appendAudit(tx, {
      actor,
      action: "rule_version.update_draft",
      entityType: "RuleVersion",
      entityId: id,
      reason: input.reason,
      before: versionAuditShape(before),
      after: versionAuditShape(after),
      metadata,
    });
    return versionDto(after, toBusinessDateString(new Date()));
  });
}

export async function publishPenaltyRuleVersion(
  actor: ActorContext,
  id: string,
  input: PenaltyRulePublishInput,
  metadata: RequestMetadata,
  now = new Date(),
): Promise<PenaltyRuleVersionDto> {
  requirePermission(actor, "rule:write");
  const businessDate = toBusinessDateString(now);
  const effectiveFrom = parseBusinessDate(input.effectiveFrom);
  const effectiveTo = input.effectiveTo ? parseBusinessDate(input.effectiveTo) : null;

  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.ruleVersion.findFirst({
        where: { id, companyId: actor.companyId },
        select: ruleVersionSelect,
      });
      if (!before) {
        throw new DomainError("NOT_FOUND", "Không tìm thấy rule version.");
      }
      if (before.status !== "DRAFT") {
        throw new DomainError("CONFLICT", "Chỉ draft mới có thể publish.");
      }
      if (!before.items.some((item) => item.isActive)) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "Rule version phải có ít nhất một penalty item đang hoạt động.",
        );
      }

      const overlap = await tx.ruleVersion.findFirst({
        where: {
          companyId: actor.companyId,
          ruleSetId: before.ruleSetId,
          id: { not: id },
          status: { not: "DRAFT" },
          ...(effectiveTo ? { effectiveFrom: { lt: effectiveTo } } : {}),
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
        },
        select: { id: true, versionNo: true },
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
      const after = await tx.ruleVersion.findUniqueOrThrow({
        where: { id },
        select: ruleVersionSelect,
      });
      await appendAudit(tx, {
        actor,
        action: "rule_version.publish",
        entityType: "RuleVersion",
        entityId: id,
        reason: input.reason,
        before: versionAuditShape(before),
        after: versionAuditShape(after),
        metadata,
      });
      return versionDto(after, businessDate);
    });
  } catch (error) {
    if (isConstraintConflict(error)) {
      throw new DomainError("CONFLICT", "Khoảng hiệu lực overlap với version đã publish.");
    }
    throw error;
  }
}

export async function retirePenaltyRuleVersion(
  actor: ActorContext,
  id: string,
  input: PenaltyRuleRetireInput,
  metadata: RequestMetadata,
  now = new Date(),
): Promise<PenaltyRuleVersionDto> {
  requirePermission(actor, "rule:write");
  const effectiveTo = parseBusinessDate(input.effectiveTo);
  return prisma.$transaction(async (tx) => {
    const before = await tx.ruleVersion.findFirst({
      where: { id, companyId: actor.companyId },
      select: ruleVersionSelect,
    });
    if (!before) {
      throw new DomainError("NOT_FOUND", "Không tìm thấy rule version.");
    }
    if ((before.status !== "ACTIVE" && before.status !== "SCHEDULED") || !before.effectiveFrom) {
      throw new DomainError("CONFLICT", "Version không ở trạng thái có thể retire.");
    }
    if (
      effectiveTo <= before.effectiveFrom ||
      (before.effectiveTo && effectiveTo > before.effectiveTo)
    ) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Ngày retire phải sau effectiveFrom và không vượt effectiveTo hiện tại.",
      );
    }

    const result = await tx.ruleVersion.updateMany({
      where: {
        id,
        companyId: actor.companyId,
        status: { in: ["ACTIVE", "SCHEDULED"] },
        rowVersion: input.rowVersion,
      },
      data: {
        status: "RETIRED",
        effectiveTo,
        rowVersion: { increment: 1 },
      },
    });
    if (result.count !== 1) {
      throw new DomainError("CONFLICT", "Version đã được cập nhật bởi người khác.");
    }
    const after = await tx.ruleVersion.findUniqueOrThrow({
      where: { id },
      select: ruleVersionSelect,
    });
    await appendAudit(tx, {
      actor,
      action: "rule_version.retire",
      entityType: "RuleVersion",
      entityId: id,
      reason: input.reason,
      before: versionAuditShape(before),
      after: versionAuditShape(after),
      metadata,
    });
    return versionDto(after, toBusinessDateString(now));
  });
}

export async function comparePenaltyRuleVersions(
  actor: ActorContext,
  fromVersionId: string,
  toVersionId: string,
): Promise<PenaltyRuleComparisonDto> {
  requirePermission(actor, "rule:write");
  const versions = await prisma.ruleVersion.findMany({
    where: {
      companyId: actor.companyId,
      id: { in: [fromVersionId, toVersionId] },
    },
    select: ruleVersionSelect,
  });
  const from = versions.find((version) => version.id === fromVersionId);
  const to = versions.find((version) => version.id === toVersionId);
  if (!from || !to || from.ruleSetId !== to.ruleSetId) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy hai version cùng rule set.");
  }
  const comparison = comparePenaltyItems(
    from.items.map((item) => ({
      ...itemDto(item),
      defaultAmount: item.defaultAmount.toString(),
    })),
    to.items.map((item) => ({
      ...itemDto(item),
      defaultAmount: item.defaultAmount.toString(),
    })),
  );
  return {
    fromVersionId,
    toVersionId,
    ...comparison,
  };
}
