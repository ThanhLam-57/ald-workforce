import { randomUUID } from "node:crypto";

import type {
  AutomaticPenaltyConditionDto,
  AutomaticViolationReconcileSummaryDto,
  EvidenceCompleteInput,
  EvidenceDto,
  EvidencePresignInput,
  ViolationCancelInput,
  ViolationCreateInput,
  ViolationDto,
  ViolationPreviewDto,
} from "@ald/contracts";
import { automaticPenaltyConditionSchema } from "@ald/contracts";
import { prisma, type Prisma } from "@ald/db";
import {
  calculatePenaltyOccurrence,
  DomainError,
  evaluateAutomaticPenalty,
  formatDurationForRule,
  penaltyCountingPeriod,
  requirePermission,
  type ActorContext,
  type PenaltyOccurrencePolicy,
} from "@ald/domain";

import { parseBusinessDate } from "./business-date";
import {
  createEvidenceUploadUrl,
  createEvidenceViewUrl,
  verifyEvidenceObject,
} from "./object-storage";
import { appendSecureAudit } from "./audit-service";
import type { RequestMetadata } from "./request-metadata";
import { activateDueSimpleRules } from "./simple-rule-service";

type Transaction = Prisma.TransactionClient;

export const violationSelect = {
  id: true,
  branchId: true,
  attendanceId: true,
  businessDate: true,
  penaltyItemId: true,
  ruleVersionId: true,
  penaltyItemCode: true,
  countingKey: true,
  occurrenceNo: true,
  countingWindow: true,
  countingPeriodStart: true,
  countingPeriodEnd: true,
  penaltyStartsAt: true,
  snapshottedDefaultAmount: true,
  computedAmount: true,
  isChargeable: true,
  responsibleParty: true,
  itemName: true,
  amount: true,
  detail: true,
  note: true,
  overrideReason: true,
  status: true,
  origin: true,
  automaticKey: true,
  automaticSnapshot: true,
  version: true,
  penaltyItem: {
    select: {
      displayColor: true,
    },
  },
  evidenceObjects: {
    select: {
      id: true,
      originalFileName: true,
      mimeType: true,
      sizeBytes: true,
      checksumSha256: true,
      status: true,
      version: true,
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.ViolationSelect;

type ViolationRecord = Prisma.ViolationGetPayload<{ select: typeof violationSelect }>;

function evidenceDto(evidence: ViolationRecord["evidenceObjects"][number]): EvidenceDto {
  return {
    id: evidence.id,
    originalFileName: evidence.originalFileName,
    mimeType: evidence.mimeType as EvidenceDto["mimeType"],
    sizeBytes: evidence.sizeBytes.toString(),
    checksumSha256: evidence.checksumSha256,
    status: evidence.status,
    version: evidence.version,
  };
}

export function toViolationDto(violation: ViolationRecord): ViolationDto {
  const automaticSnapshot =
    typeof violation.automaticSnapshot === "object" &&
    violation.automaticSnapshot !== null &&
    !Array.isArray(violation.automaticSnapshot)
      ? (violation.automaticSnapshot as Readonly<Record<string, unknown>>)
      : null;
  return {
    id: violation.id,
    attendanceId: violation.attendanceId,
    businessDate: violation.businessDate.toISOString().slice(0, 10),
    penaltyItemId: violation.penaltyItemId,
    ruleVersionId: violation.ruleVersionId,
    penaltyItemCode: violation.penaltyItemCode,
    occurrenceNo: violation.occurrenceNo,
    penaltyStartsAt: violation.penaltyStartsAt,
    countingWindow: violation.countingWindow as ViolationDto["countingWindow"],
    computedAmount: violation.computedAmount.toString(),
    isChargeable: violation.isChargeable,
    responsibleParty: violation.responsibleParty as ViolationDto["responsibleParty"],
    itemName: violation.itemName,
    amount: violation.amount.toString(),
    detail: violation.detail,
    note: violation.note,
    overrideReason: violation.overrideReason,
    status: violation.status,
    origin: violation.origin,
    automaticKey: violation.automaticKey,
    automaticSnapshot,
    version: violation.version,
    displayColor: violation.penaltyItem.displayColor,
    evidence: violation.evidenceObjects.map(evidenceDto),
  };
}

function auditJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function appendAudit(
  tx: Transaction,
  input: {
    actor: ActorContext;
    action: string;
    entityType: "Violation" | "EvidenceObject";
    entityId: string;
    reason: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    metadata: RequestMetadata;
  },
): Promise<void> {
  const branchId = input.after?.branchId ?? input.before?.branchId;
  await tx.auditLog.create({
    data: {
      companyId: input.actor.companyId,
      ...(typeof branchId === "string" ? { branchId } : {}),
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

function violationAuditShape(violation: ViolationRecord): Record<string, unknown> {
  return {
    branchId: violation.branchId,
    attendanceId: violation.attendanceId,
    businessDate: violation.businessDate.toISOString().slice(0, 10),
    penaltyItemId: violation.penaltyItemId,
    ruleVersionId: violation.ruleVersionId,
    penaltyItemCode: violation.penaltyItemCode,
    countingKey: violation.countingKey,
    occurrenceNo: violation.occurrenceNo,
    countingWindow: violation.countingWindow,
    countingPeriodStart: violation.countingPeriodStart.toISOString().slice(0, 10),
    countingPeriodEnd: violation.countingPeriodEnd?.toISOString().slice(0, 10) ?? null,
    penaltyStartsAt: violation.penaltyStartsAt,
    snapshottedDefaultAmount: violation.snapshottedDefaultAmount.toString(),
    computedAmount: violation.computedAmount.toString(),
    isChargeable: violation.isChargeable,
    responsibleParty: violation.responsibleParty,
    itemName: violation.itemName,
    amount: violation.amount.toString(),
    detail: violation.detail,
    note: violation.note,
    overrideReason: violation.overrideReason,
    status: violation.status,
    origin: violation.origin,
    automaticKey: violation.automaticKey,
    automaticSnapshot: violation.automaticSnapshot,
    version: violation.version,
  };
}

async function authorizeAttendance(actor: ActorContext, attendanceId: string, mutation: boolean) {
  const attendance = await prisma.attendanceDay.findFirst({
    where: {
      id: attendanceId,
      companyId: actor.companyId,
    },
    select: {
      id: true,
      companyId: true,
      branchId: true,
      staffId: true,
      businessDate: true,
      archivedAt: true,
      staff: {
        select: {
          user: { select: { role: true } },
        },
      },
    },
  });
  if (!attendance) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy attendance trong phạm vi.");
  }
  if (actor.role === "TRAINING_MANAGER") {
    const isLiveEmployee = !attendance.staff.user || attendance.staff.user.role === "LIVE_EMPLOYEE";
    if (
      !isLiveEmployee ||
      !actor.activeBranchIds.includes(attendance.branchId) ||
      (mutation && actor.staffId === attendance.staffId)
    ) {
      throw new DomainError("NOT_FOUND", "Không tìm thấy attendance trong phạm vi.");
    }
  }
  return attendance;
}

async function authorizeViolation(actor: ActorContext, violationId: string, mutation: boolean) {
  const violation = await prisma.violation.findFirst({
    where: { id: violationId, companyId: actor.companyId },
    select: {
      id: true,
      attendanceId: true,
      branchId: true,
      status: true,
      version: true,
    },
  });
  if (!violation) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy vi phạm.");
  }
  await authorizeAttendance(actor, violation.attendanceId, mutation);
  if (actor.role === "TRAINING_MANAGER" && !actor.activeBranchIds.includes(violation.branchId)) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy vi phạm.");
  }
  return violation;
}

function resolveOccurrencePolicy(
  value: Prisma.JsonValue | null,
  fallbackCode: string,
): PenaltyOccurrencePolicy {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      penaltyStartsAt: 1,
      countingWindow: "CALENDAR_MONTH",
      countingKey: fallbackCode,
    };
  }
  const penaltyStartsAt = value.penaltyStartsAt;
  const countingWindow = value.countingWindow;
  const countingKey = value.countingKey;
  return {
    penaltyStartsAt:
      typeof penaltyStartsAt === "number" &&
      Number.isInteger(penaltyStartsAt) &&
      penaltyStartsAt > 0
        ? penaltyStartsAt
        : 1,
    countingWindow: countingWindow === "LIFETIME" ? "LIFETIME" : "CALENDAR_MONTH",
    countingKey: typeof countingKey === "string" && countingKey.trim() ? countingKey : fallbackCode,
  };
}

export async function previewViolation(
  actor: ActorContext,
  attendanceId: string,
  penaltyItemId: string,
): Promise<ViolationPreviewDto> {
  requirePermission(actor, "violation:write");
  const attendance = await authorizeAttendance(actor, attendanceId, true);
  if (attendance.archivedAt) {
    throw new DomainError("CONFLICT", "Không thể thêm lỗi vào attendance đã lưu trữ.");
  }
  await activateDueSimpleRules(actor.companyId);
  const penaltyItem = await prisma.penaltyItem.findFirst({
    where: {
      id: penaltyItemId,
      companyId: actor.companyId,
      isActive: true,
      archivedAt: null,
      ruleVersion: {
        companyId: actor.companyId,
        status: "ACTIVE",
        isSimpleCurrent: true,
        supersededAt: null,
        effectiveFrom: { lte: attendance.businessDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: attendance.businessDate } }],
        ruleSet: {
          companyId: actor.companyId,
          type: "PENALTY",
          managementMode: "SIMPLE_MUTABLE",
        },
      },
    },
    select: {
      code: true,
      defaultAmount: true,
      reminderPolicy: true,
    },
  });
  if (!penaltyItem) {
    throw new DomainError("VALIDATION_ERROR", "Loại lỗi không còn hiệu lực tại ngày đã chọn.");
  }
  const policy = resolveOccurrencePolicy(penaltyItem.reminderPolicy, penaltyItem.code);
  const period = penaltyCountingPeriod(
    attendance.businessDate.toISOString().slice(0, 10),
    policy.countingWindow,
  );
  const sequence = await prisma.violation.aggregate({
    where: {
      companyId: actor.companyId,
      staffId: attendance.staffId,
      countingKey: policy.countingKey,
      countingPeriodStart: parseBusinessDate(period.start),
    },
    _max: { occurrenceNo: true },
  });
  const nextOccurrenceNo = (sequence._max.occurrenceNo ?? 0) + 1;
  const calculation = calculatePenaltyOccurrence(
    policy,
    nextOccurrenceNo,
    penaltyItem.defaultAmount.toString(),
  );
  return {
    nextOccurrenceNo,
    penaltyStartsAt: policy.penaltyStartsAt,
    expectedAmount: calculation.computedAmount,
    isChargeable: calculation.isChargeable,
    countingWindow: policy.countingWindow,
    message: calculation.isChargeable
      ? `Vi phạm lần ${nextOccurrenceNo}: phạt ${new Intl.NumberFormat("vi-VN").format(BigInt(calculation.computedAmount))}đ.`
      : `Nhắc nhở lần ${nextOccurrenceNo}/${policy.penaltyStartsAt - 1}: chưa phạt tiền.`,
  };
}

export async function createViolation(
  actor: ActorContext,
  input: ViolationCreateInput,
  metadata: RequestMetadata,
): Promise<ViolationDto> {
  requirePermission(actor, "violation:write");
  const attendance = await authorizeAttendance(actor, input.attendanceId, true);
  if (attendance.archivedAt) {
    throw new DomainError("CONFLICT", "Không thể thêm lỗi vào attendance đã lưu trữ.");
  }

  await activateDueSimpleRules(actor.companyId);
  const penaltyItem = await prisma.penaltyItem.findFirst({
    where: {
      id: input.penaltyItemId,
      companyId: actor.companyId,
      isActive: true,
      archivedAt: null,
      ruleVersion: {
        companyId: actor.companyId,
        status: "ACTIVE",
        isSimpleCurrent: true,
        supersededAt: null,
        effectiveFrom: { lte: attendance.businessDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: attendance.businessDate } }],
        ruleSet: {
          companyId: actor.companyId,
          type: "PENALTY",
          managementMode: "SIMPLE_MUTABLE",
        },
      },
    },
    select: {
      id: true,
      ruleVersionId: true,
      code: true,
      name: true,
      defaultAmount: true,
      reminderPolicy: true,
      metadata: true,
    },
  });
  if (!penaltyItem) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "Loại lỗi không thuộc penalty version hiệu lực tại ngày vi phạm.",
    );
  }
  const automaticCondition =
    typeof penaltyItem.metadata === "object" &&
    penaltyItem.metadata !== null &&
    !Array.isArray(penaltyItem.metadata)
      ? automaticPenaltyConditionSchema.safeParse(penaltyItem.metadata.automaticCondition)
      : null;
  if (automaticCondition?.success && automaticCondition.data.type !== "MANUAL") {
    throw new DomainError(
      "VALIDATION_ERROR",
      "Loại lỗi này được hệ thống tự động tính từ dữ liệu chấm công.",
    );
  }

  const hasOverride = input.amountOverride !== undefined && input.amountOverride !== null;
  if (hasOverride && actor.role !== "GENERAL_MANAGER") {
    throw new DomainError("FORBIDDEN", "Chỉ Tổng quản lý được override tiền phạt.");
  }
  if (hasOverride && !input.overrideReason) {
    throw new DomainError("VALIDATION_ERROR", "Override tiền phạt bắt buộc có lý do.");
  }
  const overrideReason = hasOverride ? (input.overrideReason ?? null) : null;
  const policy = resolveOccurrencePolicy(penaltyItem.reminderPolicy, penaltyItem.code);
  const period = penaltyCountingPeriod(
    attendance.businessDate.toISOString().slice(0, 10),
    policy.countingWindow,
  );

  return prisma.$transaction(async (tx) => {
    const lockKey = [actor.companyId, attendance.staffId, policy.countingKey, period.start].join(
      ":",
    );
    await tx.$queryRaw`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `;
    const sequence = await tx.violation.aggregate({
      where: {
        companyId: actor.companyId,
        staffId: attendance.staffId,
        countingKey: policy.countingKey,
        countingPeriodStart: parseBusinessDate(period.start),
      },
      _max: { occurrenceNo: true },
    });
    const occurrenceNo = (sequence._max.occurrenceNo ?? 0) + 1;
    const calculation = calculatePenaltyOccurrence(
      policy,
      occurrenceNo,
      penaltyItem.defaultAmount.toString(),
    );
    const amount = hasOverride ? BigInt(input.amountOverride!) : BigInt(calculation.computedAmount);
    const created = await tx.violation.create({
      data: {
        companyId: actor.companyId,
        branchId: attendance.branchId,
        attendanceId: attendance.id,
        staffId: attendance.staffId,
        businessDate: attendance.businessDate,
        penaltyItemId: penaltyItem.id,
        ruleVersionId: penaltyItem.ruleVersionId,
        penaltyItemCode: penaltyItem.code,
        countingKey: policy.countingKey,
        occurrenceNo,
        countingWindow: policy.countingWindow,
        countingPeriodStart: parseBusinessDate(period.start),
        countingPeriodEnd: period.end ? parseBusinessDate(period.end) : null,
        penaltyStartsAt: policy.penaltyStartsAt,
        snapshottedDefaultAmount: penaltyItem.defaultAmount,
        computedAmount: BigInt(calculation.computedAmount),
        isChargeable: calculation.isChargeable,
        responsibleParty: "VIOLATING_STAFF",
        itemName: penaltyItem.name,
        amount,
        detail: input.detail,
        note: input.note ?? null,
        overrideReason,
        createdByUserId: actor.userId,
      },
      select: violationSelect,
    });
    await appendAudit(tx, {
      actor,
      action: hasOverride ? "violation.create_with_override" : "violation.create",
      entityType: "Violation",
      entityId: created.id,
      reason: input.reason,
      after: violationAuditShape(created),
      metadata,
    });
    return toViolationDto(created);
  });
}

type AutomaticCondition = Exclude<AutomaticPenaltyConditionDto, Readonly<{ type: "MANUAL" }>>;

const automaticPenaltyItemSelect = {
  id: true,
  ruleVersionId: true,
  code: true,
  name: true,
  defaultAmount: true,
  reminderPolicy: true,
  metadata: true,
  displayOrder: true,
} satisfies Prisma.PenaltyItemSelect;

type AutomaticPenaltyItem = Prisma.PenaltyItemGetPayload<{
  select: typeof automaticPenaltyItemSelect;
}>;

function readAutomaticCondition(metadata: Prisma.JsonValue | null): AutomaticCondition | null {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return null;
  const parsed = automaticPenaltyConditionSchema.safeParse(metadata.automaticCondition);
  return parsed.success && parsed.data.type !== "MANUAL" ? parsed.data : null;
}

function automaticViolationKey(item: AutomaticPenaltyItem, condition: AutomaticCondition): string {
  return `AUTO:${condition.type}:${item.code}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function comparableAutomaticSnapshot(value: Prisma.JsonValue | null): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "";
  const comparable = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "evaluatedAt"),
  );
  return stableJson(comparable);
}

function automaticDetail(
  condition: AutomaticCondition,
  actualMinutes: number,
  acceptedThresholdMinutes: number,
): string {
  if (condition.type === "CHECK_IN_LATE") {
    return `Tự động từ check-in: ${formatDurationForRule(actualMinutes)}; ca bắt đầu ${formatDurationForRule(condition.scheduledStartMinutes)}, du di ${condition.graceMinutes} phút, ngưỡng cuối ${formatDurationForRule(acceptedThresholdMinutes)}.`;
  }
  return `Tự động từ thời lượng Live: ${formatDurationForRule(actualMinutes)}; yêu cầu ${formatDurationForRule(condition.requiredLiveMinutes)}, du di ${condition.graceMinutes} phút, tối thiểu ${formatDurationForRule(acceptedThresholdMinutes)}.`;
}

function monthBoundsForBusinessDate(date: Date): Readonly<{ start: Date; end: Date }> {
  return {
    start: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)),
    end: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)),
  };
}

export async function reconcileAutomaticViolationsInTransaction(
  tx: Transaction,
  actor: ActorContext,
  attendanceId: string,
  reason: string,
  metadata: RequestMetadata,
  now = new Date(),
): Promise<AutomaticViolationReconcileSummaryDto> {
  const attendance = await tx.attendanceDay.findFirst({
    where: {
      id: attendanceId,
      companyId: actor.companyId,
    },
    select: {
      id: true,
      companyId: true,
      branchId: true,
      staffId: true,
      businessDate: true,
      checkInAt: true,
      status: true,
      company: { select: { timezone: true } },
      liveMetric: { select: { actualLiveMinutes: true } },
    },
  });
  if (!attendance?.liveMetric) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy attendance để tính lỗi tự động.");
  }

  const attendanceLockKey = `automatic-violations:${actor.companyId}:${attendance.id}`;
  await tx.$queryRaw`
    SELECT 1::integer AS "locked"
    FROM pg_advisory_xact_lock(hashtextextended(${attendanceLockKey}, 0))
  `;

  const penaltyItems = await tx.penaltyItem.findMany({
    where: {
      companyId: actor.companyId,
      isActive: true,
      archivedAt: null,
      ruleVersion: {
        companyId: actor.companyId,
        status: { in: ["ACTIVE", "SCHEDULED"] },
        isSimpleCurrent: true,
        supersededAt: null,
        effectiveFrom: { lte: attendance.businessDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: attendance.businessDate } }],
        ruleSet: {
          companyId: actor.companyId,
          type: "PENALTY",
          managementMode: "SIMPLE_MUTABLE",
        },
      },
    },
    select: automaticPenaltyItemSelect,
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
  });
  const candidates = penaltyItems.flatMap((item) => {
    const condition = readAutomaticCondition(item.metadata);
    return condition ? [{ item, condition }] : [];
  });
  const selected = (["CHECK_IN_LATE", "LIVE_DURATION_SHORT"] as const).flatMap((type) => {
    const matching = candidates.filter(
      (candidate) =>
        candidate.condition.type === type &&
        (candidate.condition.branchId === null ||
          candidate.condition.branchId === attendance.branchId),
    );
    const branchSpecific = matching.find(
      (candidate) => candidate.condition.branchId === attendance.branchId,
    );
    const companyWide = matching.find((candidate) => candidate.condition.branchId === null);
    const chosen = branchSpecific ?? companyWide;
    return chosen ? [chosen] : [];
  });

  const existing = await tx.violation.findMany({
    where: {
      companyId: actor.companyId,
      attendanceId: attendance.id,
      origin: "AUTOMATIC",
    },
    select: violationSelect,
  });
  const existingByKey = new Map(
    existing.flatMap((violation) =>
      violation.automaticKey ? [[violation.automaticKey, violation] as const] : [],
    ),
  );
  const selectedKeys = new Set<string>();
  let createdCount = 0;
  let reactivatedCount = 0;
  let cancelledCount = 0;
  let unchangedCount = 0;

  const cancelAutomaticViolation = async (
    violation: ViolationRecord,
    cancellationReason: string,
  ): Promise<void> => {
    if (violation.status !== "ACTIVE") {
      unchangedCount += 1;
      return;
    }
    const after = await tx.violation.update({
      where: { id: violation.id },
      data: {
        status: "CANCELLED",
        cancelledByUserId: actor.userId,
        cancelledAt: now,
        cancellationReason,
        version: { increment: 1 },
      },
      select: violationSelect,
    });
    cancelledCount += 1;
    await appendAudit(tx, {
      actor,
      action: "violation.automatic_cancel",
      entityType: "Violation",
      entityId: violation.id,
      reason,
      before: violationAuditShape(violation),
      after: violationAuditShape(after),
      metadata,
    });
  };

  for (const { item, condition } of selected) {
    const key = automaticViolationKey(item, condition);
    selectedKeys.add(key);
    const current = existingByKey.get(key);
    const evaluation = evaluateAutomaticPenalty(
      condition,
      {
        status: attendance.status,
        businessDate: attendance.businessDate.toISOString().slice(0, 10),
        checkInAt: attendance.checkInAt?.toISOString() ?? null,
        actualLiveMinutes: attendance.liveMetric.actualLiveMinutes,
      },
      attendance.company.timezone,
    );
    if (evaluation.status !== "VIOLATION" || evaluation.actualMinutes === null) {
      if (current) {
        await cancelAutomaticViolation(
          current,
          evaluation.status === "INSUFFICIENT_DATA"
            ? "Dữ liệu chấm công không còn đủ để xác định vi phạm tự động."
            : "Dữ liệu chấm công đã được điều chỉnh và không còn vi phạm điều kiện tự động.",
        );
      } else {
        unchangedCount += 1;
      }
      continue;
    }

    const businessDate = attendance.businessDate.toISOString().slice(0, 10);
    const detail = automaticDetail(
      condition,
      evaluation.actualMinutes,
      evaluation.acceptedThresholdMinutes,
    );
    const snapshotBase = {
      triggerType: condition.type,
      condition,
      actualMinutes: evaluation.actualMinutes,
      acceptedThresholdMinutes: evaluation.acceptedThresholdMinutes,
      businessDate,
      ruleVersionId: item.ruleVersionId,
      penaltyItemId: item.id,
    };
    const snapshot = {
      ...snapshotBase,
      evaluatedAt: now.toISOString(),
    } satisfies Prisma.InputJsonObject;

    if (current) {
      if (current.status === "CANCELLED") {
        const after = await tx.violation.update({
          where: { id: current.id },
          data: {
            status: "ACTIVE",
            detail,
            automaticSnapshot: snapshot,
            cancelledByUserId: null,
            cancelledAt: null,
            cancellationReason: null,
            version: { increment: 1 },
          },
          select: violationSelect,
        });
        reactivatedCount += 1;
        await appendAudit(tx, {
          actor,
          action: "violation.automatic_reactivate",
          entityType: "Violation",
          entityId: current.id,
          reason,
          before: violationAuditShape(current),
          after: violationAuditShape(after),
          metadata,
        });
      } else if (
        current.detail !== detail ||
        comparableAutomaticSnapshot(current.automaticSnapshot) !== stableJson(snapshotBase)
      ) {
        const after = await tx.violation.update({
          where: { id: current.id },
          data: {
            detail,
            automaticSnapshot: snapshot,
            version: { increment: 1 },
          },
          select: violationSelect,
        });
        await appendAudit(tx, {
          actor,
          action: "violation.automatic_refresh",
          entityType: "Violation",
          entityId: current.id,
          reason,
          before: violationAuditShape(current),
          after: violationAuditShape(after),
          metadata,
        });
        unchangedCount += 1;
      } else {
        unchangedCount += 1;
      }
      continue;
    }

    const policy = resolveOccurrencePolicy(item.reminderPolicy, item.code);
    const period = penaltyCountingPeriod(businessDate, policy.countingWindow);
    const occurrenceLockKey = [
      actor.companyId,
      attendance.staffId,
      policy.countingKey,
      period.start,
    ].join(":");
    await tx.$queryRaw`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(hashtextextended(${occurrenceLockKey}, 0))
    `;
    const sequence = await tx.violation.aggregate({
      where: {
        companyId: actor.companyId,
        staffId: attendance.staffId,
        countingKey: policy.countingKey,
        countingPeriodStart: parseBusinessDate(period.start),
      },
      _max: { occurrenceNo: true },
    });
    const occurrenceNo = (sequence._max.occurrenceNo ?? 0) + 1;
    const calculation = calculatePenaltyOccurrence(
      policy,
      occurrenceNo,
      item.defaultAmount.toString(),
    );
    const created = await tx.violation.create({
      data: {
        companyId: actor.companyId,
        branchId: attendance.branchId,
        attendanceId: attendance.id,
        staffId: attendance.staffId,
        businessDate: attendance.businessDate,
        penaltyItemId: item.id,
        ruleVersionId: item.ruleVersionId,
        penaltyItemCode: item.code,
        countingKey: policy.countingKey,
        occurrenceNo,
        countingWindow: policy.countingWindow,
        countingPeriodStart: parseBusinessDate(period.start),
        countingPeriodEnd: period.end ? parseBusinessDate(period.end) : null,
        penaltyStartsAt: policy.penaltyStartsAt,
        snapshottedDefaultAmount: item.defaultAmount,
        computedAmount: BigInt(calculation.computedAmount),
        isChargeable: calculation.isChargeable,
        responsibleParty: "VIOLATING_STAFF",
        itemName: item.name,
        amount: BigInt(calculation.computedAmount),
        detail,
        status: "ACTIVE",
        origin: "AUTOMATIC",
        automaticKey: key,
        automaticSnapshot: snapshot,
        createdByUserId: actor.userId,
      },
      select: violationSelect,
    });
    createdCount += 1;
    await appendAudit(tx, {
      actor,
      action: "violation.automatic_create",
      entityType: "Violation",
      entityId: created.id,
      reason,
      after: violationAuditShape(created),
      metadata,
    });
  }

  for (const violation of existing) {
    if (
      violation.automaticKey &&
      !selectedKeys.has(violation.automaticKey) &&
      violation.status === "ACTIVE"
    ) {
      await cancelAutomaticViolation(
        violation,
        "Rule tự động không còn áp dụng cho ngày hoặc cơ sở này.",
      );
    }
  }

  const month = monthBoundsForBusinessDate(attendance.businessDate);
  const [attendanceTotal, staffMonthTotal] = await Promise.all([
    tx.violation.aggregate({
      where: {
        companyId: actor.companyId,
        attendanceId: attendance.id,
        status: "ACTIVE",
      },
      _sum: { amount: true },
    }),
    tx.violation.aggregate({
      where: {
        companyId: actor.companyId,
        staffId: attendance.staffId,
        businessDate: { gte: month.start, lt: month.end },
        status: "ACTIVE",
      },
      _sum: { amount: true },
    }),
  ]);

  return {
    createdCount,
    reactivatedCount,
    cancelledCount,
    unchangedCount,
    attendanceActivePenaltyTotal: (attendanceTotal._sum.amount ?? 0n).toString(),
    staffMonthActivePenaltyTotal: (staffMonthTotal._sum.amount ?? 0n).toString(),
  };
}

export async function cancelViolation(
  actor: ActorContext,
  id: string,
  input: ViolationCancelInput,
  metadata: RequestMetadata,
): Promise<ViolationDto> {
  requirePermission(actor, "violation:cancel");
  const authorized = await authorizeViolation(actor, id, true);
  if (authorized.status === "CANCELLED") {
    const existing = await prisma.violation.findUniqueOrThrow({
      where: { id },
      select: violationSelect,
    });
    return toViolationDto(existing);
  }

  return prisma.$transaction(async (tx) => {
    const before = await tx.violation.findUniqueOrThrow({
      where: { id },
      select: violationSelect,
    });
    const result = await tx.violation.updateMany({
      where: {
        id,
        companyId: actor.companyId,
        status: "ACTIVE",
        version: input.version,
      },
      data: {
        status: "CANCELLED",
        cancelledByUserId: actor.userId,
        cancelledAt: new Date(),
        cancellationReason: input.reason,
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) {
      throw new DomainError("CONFLICT", "Vi phạm đã được cập nhật bởi người khác.");
    }
    const after = await tx.violation.findUniqueOrThrow({
      where: { id },
      select: violationSelect,
    });
    await appendAudit(tx, {
      actor,
      action: "violation.cancel",
      entityType: "Violation",
      entityId: id,
      reason: input.reason,
      before: violationAuditShape(before),
      after: violationAuditShape(after),
      metadata,
    });
    return toViolationDto(after);
  });
}

const extensionByMime = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export async function presignEvidenceUpload(
  actor: ActorContext,
  input: EvidencePresignInput,
  metadata: RequestMetadata,
) {
  requirePermission(actor, "evidence:upload");
  const violation = await authorizeViolation(actor, input.violationId, true);
  if (violation.status !== "ACTIVE") {
    throw new DomainError("CONFLICT", "Không thể thêm ảnh vào vi phạm đã hủy.");
  }
  const extension = extensionByMime[input.mimeType];
  const objectKey = `companies/${actor.companyId}/violations/${violation.id}/${randomUUID()}.${extension}`;
  const upload = await createEvidenceUploadUrl({
    objectKey,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    checksumSha256: input.checksumSha256,
  });

  const evidence = await prisma.$transaction(async (tx) => {
    const created = await tx.evidenceObject.create({
      data: {
        companyId: actor.companyId,
        branchId: violation.branchId,
        violationId: violation.id,
        objectKey,
        originalFileName: input.originalFileName,
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.sizeBytes),
        checksumSha256: input.checksumSha256,
        createdByUserId: actor.userId,
      },
    });
    await appendAudit(tx, {
      actor,
      action: "evidence.presign_upload",
      entityType: "EvidenceObject",
      entityId: created.id,
      reason: input.reason,
      after: {
        violationId: created.violationId,
        originalFileName: created.originalFileName,
        mimeType: created.mimeType,
        sizeBytes: created.sizeBytes.toString(),
        checksumSha256: created.checksumSha256,
        status: created.status,
      },
      metadata,
    });
    return created;
  });

  return {
    evidence: {
      id: evidence.id,
      originalFileName: evidence.originalFileName,
      mimeType: evidence.mimeType as EvidenceDto["mimeType"],
      sizeBytes: evidence.sizeBytes.toString(),
      checksumSha256: evidence.checksumSha256,
      status: evidence.status,
      version: evidence.version,
    } satisfies EvidenceDto,
    upload,
  };
}

export async function completeEvidenceUpload(
  actor: ActorContext,
  id: string,
  input: EvidenceCompleteInput,
  metadata: RequestMetadata,
): Promise<EvidenceDto> {
  requirePermission(actor, "evidence:upload");
  const existing = await prisma.evidenceObject.findFirst({
    where: { id, companyId: actor.companyId },
    include: {
      violation: {
        select: { attendanceId: true },
      },
    },
  });
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy evidence.");
  }
  await authorizeAttendance(actor, existing.violation.attendanceId, true);
  if (existing.status !== "PENDING_UPLOAD") {
    throw new DomainError("CONFLICT", "Evidence không còn chờ upload.");
  }
  if (existing.version !== input.version) {
    throw new DomainError("CONFLICT", "Evidence đã được cập nhật bởi người khác.");
  }

  try {
    await verifyEvidenceObject({
      objectKey: existing.objectKey,
      mimeType: existing.mimeType,
      sizeBytes: Number(existing.sizeBytes),
      checksumSha256: existing.checksumSha256,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Không thể xác minh object upload.";
    await prisma.$transaction(async (tx) => {
      const result = await tx.evidenceObject.updateMany({
        where: {
          id,
          companyId: actor.companyId,
          status: "PENDING_UPLOAD",
          version: input.version,
        },
        data: {
          status: "REJECTED",
          rejectionReason: reason,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        throw new DomainError("CONFLICT", "Evidence đã được cập nhật bởi người khác.");
      }
      await appendAudit(tx, {
        actor,
        action: "evidence.reject",
        entityType: "EvidenceObject",
        entityId: id,
        reason: "Object upload không khớp metadata đã ký.",
        before: { status: existing.status, version: existing.version },
        after: { status: "REJECTED", rejectionReason: reason },
        metadata,
      });
    });
    throw new DomainError(
      "VALIDATION_ERROR",
      "Ảnh upload không khớp MIME, kích thước hoặc checksum đã khai báo.",
    );
  }

  return prisma.$transaction(async (tx) => {
    const result = await tx.evidenceObject.updateMany({
      where: {
        id,
        companyId: actor.companyId,
        status: "PENDING_UPLOAD",
        version: input.version,
      },
      data: {
        status: "READY",
        uploadedAt: new Date(),
        verifiedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) {
      throw new DomainError("CONFLICT", "Evidence đã được cập nhật bởi người khác.");
    }
    const ready = await tx.evidenceObject.findUniqueOrThrow({ where: { id } });
    await appendAudit(tx, {
      actor,
      action: "evidence.verify",
      entityType: "EvidenceObject",
      entityId: id,
      reason: "Đã xác minh MIME, kích thước và SHA-256.",
      before: { status: existing.status, version: existing.version },
      after: { status: ready.status, version: ready.version },
      metadata,
    });
    return {
      id: ready.id,
      originalFileName: ready.originalFileName,
      mimeType: ready.mimeType as EvidenceDto["mimeType"],
      sizeBytes: ready.sizeBytes.toString(),
      checksumSha256: ready.checksumSha256,
      status: ready.status,
      version: ready.version,
    };
  });
}

export async function getEvidenceView(actor: ActorContext, id: string, metadata?: RequestMetadata) {
  requirePermission(actor, "evidence:read");
  const evidence = await prisma.evidenceObject.findFirst({
    where: { id, companyId: actor.companyId, status: "READY" },
    include: {
      violation: {
        select: { attendanceId: true },
      },
    },
  });
  if (!evidence) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy evidence.");
  }
  await authorizeAttendance(actor, evidence.violation.attendanceId, false);
  if (actor.role === "TRAINING_MANAGER" && !actor.activeBranchIds.includes(evidence.branchId)) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy evidence.");
  }
  const signed = await createEvidenceViewUrl({
    objectKey: evidence.objectKey,
    originalFileName: evidence.originalFileName,
    mimeType: evidence.mimeType,
  });
  if (metadata) {
    await appendSecureAudit({
      actor,
      action: "EVIDENCE_VIEW",
      entityType: "EvidenceObject",
      entityId: evidence.id,
      branchId: evidence.branchId,
      reason: "Đọc evidence bằng signed URL ngắn hạn.",
      after: { violationId: evidence.violationId, expiresInSeconds: signed.expiresInSeconds },
      metadata,
    });
  }
  return signed;
}
