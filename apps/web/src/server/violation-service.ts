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
import { prisma, Prisma } from "@ald/db";
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
import { EVIDENCE_VERSION_HEADER, readEvidenceVersion } from "./evidence-upload-body";
import {
  cleanupRejectedEvidenceObjects,
  EVIDENCE_UPLOAD_TTL_MS,
  evidenceStorageUnavailable,
  isEvidenceContentFailure,
  storeEvidenceUpload,
} from "./evidence-upload";
import { createEvidenceViewUrl, verifyEvidenceObject } from "./object-storage";
import { appendSecureAudit, systemAuditReason } from "./audit-service";
import type { RequestMetadata } from "./request-metadata";
import { activateDueSimpleRules } from "./simple-rule-service";

type Transaction = Prisma.TransactionClient;

const violationAuditSelect = {
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
  cancellationReason: true,
  version: true,
} satisfies Prisma.ViolationSelect;

type ViolationAuditRecord = Prisma.ViolationGetPayload<{
  select: typeof violationAuditSelect;
}>;

export const violationSelect = {
  ...violationAuditSelect,
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

type RejectedEvidenceRow = Readonly<{
  id: string;
  branchId: string;
  objectKey: string;
  version: number;
}>;

async function lockEvidenceMutation(
  tx: Transaction,
  companyId: string,
  violationId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT 1::integer
    FROM pg_advisory_xact_lock(
      hashtextextended(${`evidence-upload:${companyId}:${violationId}`}, 0)
    )
  `;
}

async function rejectPendingEvidence(
  tx: Transaction,
  input: Readonly<{
    actor: ActorContext;
    violationId: string;
    rejectionReason: string;
    auditReason: string;
    metadata: RequestMetadata;
  }>,
): Promise<readonly RejectedEvidenceRow[]> {
  const rejected = await tx.$queryRaw<RejectedEvidenceRow[]>`
    UPDATE "evidence_objects"
    SET
      "status" = 'REJECTED'::"EvidenceStatus",
      "rejectionReason" = ${input.rejectionReason},
      "version" = "version" + 1,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE
      "companyId" = ${input.actor.companyId}::uuid
      AND "violationId" = ${input.violationId}::uuid
      AND "status" = 'PENDING_UPLOAD'::"EvidenceStatus"
    RETURNING "id", "branchId", "objectKey", "version"
  `;
  if (rejected.length === 0) return rejected;

  await tx.auditLog.createMany({
    data: rejected.map((evidence) => ({
      companyId: input.actor.companyId,
      branchId: evidence.branchId,
      actorUserId: input.actor.userId,
      action: "evidence.reject",
      entityType: "EvidenceObject",
      entityId: evidence.id,
      reason: input.auditReason,
      before: auditJson({
        branchId: evidence.branchId,
        status: "PENDING_UPLOAD",
        version: evidence.version - 1,
      }),
      after: auditJson({
        branchId: evidence.branchId,
        status: "REJECTED",
        version: evidence.version,
        rejectionReason: input.rejectionReason,
      }),
      requestId: input.metadata.requestId,
      ipAddress: input.metadata.ipAddress,
      userAgent: input.metadata.userAgent,
    })),
  });
  return rejected;
}

async function rejectEvidenceByVersion(
  tx: Transaction,
  input: Readonly<{
    actor: ActorContext;
    evidence: Readonly<{ id: string; branchId: string; version: number }>;
    rejectionReason: string;
    auditReason: string;
    metadata: RequestMetadata;
  }>,
): Promise<boolean> {
  const result = await tx.evidenceObject.updateMany({
    where: {
      id: input.evidence.id,
      companyId: input.actor.companyId,
      status: "PENDING_UPLOAD",
      version: input.evidence.version,
    },
    data: {
      status: "REJECTED",
      rejectionReason: input.rejectionReason,
      version: { increment: 1 },
    },
  });
  if (result.count !== 1) return false;

  await appendAudit(tx, {
    actor: input.actor,
    action: "evidence.reject",
    entityType: "EvidenceObject",
    entityId: input.evidence.id,
    reason: input.auditReason,
    before: {
      branchId: input.evidence.branchId,
      status: "PENDING_UPLOAD",
      version: input.evidence.version,
    },
    after: {
      branchId: input.evidence.branchId,
      status: "REJECTED",
      version: input.evidence.version + 1,
      rejectionReason: input.rejectionReason,
    },
    metadata: input.metadata,
  });
  return true;
}

function violationAuditShape(violation: ViolationAuditRecord): Record<string, unknown> {
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
    cancellationReason: violation.cancellationReason,
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
      reason: systemAuditReason(
        hasOverride ? "VIOLATION_CREATED_WITH_AMOUNT_OVERRIDE" : "VIOLATION_CREATED",
      ),
      after: violationAuditShape(created),
      metadata,
    });
    return toViolationDto(created);
  });
}

type AutomaticCondition = Exclude<AutomaticPenaltyConditionDto, Readonly<{ type: "MANUAL" }>>;
type ResolvedAutomaticCondition =
  | Readonly<{
      type: "CHECK_IN_LATE";
      thresholdSource: "STAFF_SHIFT" | "RULE_FIXED";
      scheduledStartMinutes: number;
      graceMinutes: number;
      branchId: string | null;
    }>
  | Readonly<{
      type: "LIVE_DURATION_SHORT";
      thresholdSource: "STAFF_SHIFT" | "RULE_FIXED";
      requiredLiveMinutes: number;
      graceMinutes: number;
      branchId: string | null;
    }>;

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

const automaticPenaltyBatchItemSelect = {
  ...automaticPenaltyItemSelect,
  ruleVersion: {
    select: {
      effectiveFrom: true,
      effectiveTo: true,
    },
  },
} satisfies Prisma.PenaltyItemSelect;

type AutomaticPenaltyBatchItem = Prisma.PenaltyItemGetPayload<{
  select: typeof automaticPenaltyBatchItemSelect;
}>;

const automaticAttendanceSelect = {
  id: true,
  companyId: true,
  branchId: true,
  staffId: true,
  businessDate: true,
  checkInAt: true,
  status: true,
  company: { select: { timezone: true } },
  liveMetric: { select: { actualLiveMinutes: true } },
} satisfies Prisma.AttendanceDaySelect;

type AutomaticAttendance = Prisma.AttendanceDayGetPayload<{
  select: typeof automaticAttendanceSelect;
}>;

const automaticScheduleSelect = {
  id: true,
  companyId: true,
  branchId: true,
  staffId: true,
  version: true,
  name: true,
  scheduledStartMinutes: true,
  scheduledEndMinutes: true,
  spansNextDay: true,
  requiredLiveMinutes: true,
  effectiveFrom: true,
  effectiveTo: true,
} satisfies Prisma.StaffWorkScheduleSelect;

type AutomaticSchedule = Prisma.StaffWorkScheduleGetPayload<{
  select: typeof automaticScheduleSelect;
}>;

type AutomaticViolationBatchContext = {
  attendanceById: ReadonlyMap<string, AutomaticAttendance>;
  orderedAttendanceIds: readonly string[];
  penaltyItems: readonly AutomaticPenaltyBatchItem[];
  schedules: readonly AutomaticSchedule[];
  existingByAttendanceId: ReadonlyMap<string, readonly ViolationAuditRecord[]>;
  lockedAttendanceIds: ReadonlySet<string>;
  lockedOccurrenceKeys: Set<string>;
  nextOccurrenceNoByKey: Map<string, number>;
  skipTotals: true;
};

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
  condition: ResolvedAutomaticCondition,
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

function effectiveOnDate(
  effectiveFrom: Date | null,
  effectiveTo: Date | null,
  businessDate: Date,
): boolean {
  if (effectiveFrom === null) return false;
  return (
    effectiveFrom.getTime() <= businessDate.getTime() &&
    (effectiveTo === null || effectiveTo.getTime() > businessDate.getTime())
  );
}

function batchPenaltyItemsForDate(
  context: AutomaticViolationBatchContext,
  businessDate: Date,
): readonly AutomaticPenaltyItem[] {
  return context.penaltyItems.filter((item) =>
    effectiveOnDate(item.ruleVersion.effectiveFrom, item.ruleVersion.effectiveTo, businessDate),
  );
}

function batchScheduleForAttendance(
  context: AutomaticViolationBatchContext,
  attendance: AutomaticAttendance,
): AutomaticSchedule | null {
  return (
    context.schedules.find(
      (schedule) =>
        schedule.branchId === attendance.branchId &&
        schedule.staffId === attendance.staffId &&
        effectiveOnDate(schedule.effectiveFrom, schedule.effectiveTo, attendance.businessDate),
    ) ?? null
  );
}

async function lockAutomaticAttendanceBatch(
  tx: Transaction,
  actor: ActorContext,
  attendance: readonly AutomaticAttendance[],
): Promise<void> {
  const lockKeys = attendance
    .map((record) => `automatic-violations:${actor.companyId}:${record.id}`)
    .sort();
  if (lockKeys.length === 0) return;
  const values = Prisma.join(lockKeys.map((lockKey) => Prisma.sql`(${lockKey})`));
  await tx.$queryRaw(
    Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended("lockKey", 0))::text AS "lockResult"
      FROM (
        SELECT "lockKey"
        FROM (VALUES ${values}) AS "lockValues"("lockKey")
        ORDER BY "lockKey"
      ) AS "orderedLocks"
    `,
  );
}

async function prepareAutomaticViolationBatchContext(
  tx: Transaction,
  actor: ActorContext,
  attendanceIds: readonly string[],
): Promise<AutomaticViolationBatchContext> {
  const uniqueAttendanceIds = [...new Set(attendanceIds)];
  if (uniqueAttendanceIds.length === 0) {
    throw new DomainError("VALIDATION_ERROR", "Danh sách ngày cần tính lỗi đang trống.");
  }
  const attendance = await tx.attendanceDay.findMany({
    where: {
      id: { in: uniqueAttendanceIds },
      companyId: actor.companyId,
    },
    select: automaticAttendanceSelect,
    orderBy: [{ businessDate: "asc" }, { id: "asc" }],
  });
  if (
    attendance.length !== uniqueAttendanceIds.length ||
    attendance.some((record) => !record.liveMetric)
  ) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy đủ dữ liệu chấm công để tính lỗi tự động.");
  }

  await lockAutomaticAttendanceBatch(tx, actor, attendance);
  const firstDate = attendance[0]!.businessDate;
  const lastDate = attendance.at(-1)!.businessDate;
  const rangeEnd = new Date(lastDate);
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);
  const staffBranchPairs = [
    ...new Map(
      attendance.map((record) => [
        `${record.staffId}:${record.branchId}`,
        { staffId: record.staffId, branchId: record.branchId },
      ]),
    ).values(),
  ];

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
        effectiveFrom: { lt: rangeEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: firstDate } }],
        ruleSet: {
          companyId: actor.companyId,
          type: "PENALTY",
          managementMode: "SIMPLE_MUTABLE",
        },
      },
    },
    select: automaticPenaltyBatchItemSelect,
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
  });
  const schedules = await tx.staffWorkSchedule.findMany({
    where: {
      companyId: actor.companyId,
      archivedAt: null,
      effectiveFrom: { lt: rangeEnd },
      AND: [
        { OR: [{ effectiveTo: null }, { effectiveTo: { gt: firstDate } }] },
        {
          OR: staffBranchPairs.map((pair) => ({
            staffId: pair.staffId,
            branchId: pair.branchId,
          })),
        },
      ],
    },
    select: automaticScheduleSelect,
    orderBy: [{ effectiveFrom: "desc" }, { id: "asc" }],
  });
  const existing = await tx.violation.findMany({
    where: {
      companyId: actor.companyId,
      attendanceId: { in: uniqueAttendanceIds },
      origin: "AUTOMATIC",
    },
    select: violationAuditSelect,
  });
  const existingByAttendanceId = new Map<string, ViolationAuditRecord[]>();
  for (const violation of existing) {
    const records = existingByAttendanceId.get(violation.attendanceId) ?? [];
    records.push(violation);
    existingByAttendanceId.set(violation.attendanceId, records);
  }

  return {
    attendanceById: new Map(attendance.map((record) => [record.id, record])),
    orderedAttendanceIds: attendance.map((record) => record.id),
    penaltyItems,
    schedules,
    existingByAttendanceId,
    lockedAttendanceIds: new Set(attendance.map((record) => record.id)),
    lockedOccurrenceKeys: new Set(),
    nextOccurrenceNoByKey: new Map(),
    skipTotals: true,
  };
}

export async function reconcileAutomaticViolationsInTransaction(
  tx: Transaction,
  actor: ActorContext,
  attendanceId: string,
  reason: string,
  metadata: RequestMetadata,
  now = new Date(),
  batchContext?: AutomaticViolationBatchContext,
): Promise<AutomaticViolationReconcileSummaryDto> {
  const attendance =
    batchContext?.attendanceById.get(attendanceId) ??
    (await tx.attendanceDay.findFirst({
      where: {
        id: attendanceId,
        companyId: actor.companyId,
      },
      select: automaticAttendanceSelect,
    }));
  if (!attendance?.liveMetric) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy attendance để tính lỗi tự động.");
  }

  if (!batchContext?.lockedAttendanceIds.has(attendance.id)) {
    const attendanceLockKey = `automatic-violations:${actor.companyId}:${attendance.id}`;
    await tx.$queryRaw`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(hashtextextended(${attendanceLockKey}, 0))
    `;
  }

  const penaltyItems = batchContext
    ? batchPenaltyItemsForDate(batchContext, attendance.businessDate)
    : await tx.penaltyItem.findMany({
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
  const needsStaffSchedule = selected.some(
    ({ condition }) => condition.thresholdSource === "STAFF_SHIFT",
  );
  const staffSchedule = needsStaffSchedule
    ? batchContext
      ? batchScheduleForAttendance(batchContext, attendance)
      : await tx.staffWorkSchedule.findFirst({
          where: {
            companyId: actor.companyId,
            branchId: attendance.branchId,
            staffId: attendance.staffId,
            archivedAt: null,
            effectiveFrom: { lte: attendance.businessDate },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: attendance.businessDate } }],
          },
          orderBy: { effectiveFrom: "desc" },
          select: automaticScheduleSelect,
        })
    : null;

  const existing =
    batchContext?.existingByAttendanceId.get(attendance.id) ??
    (await tx.violation.findMany({
      where: {
        companyId: actor.companyId,
        attendanceId: attendance.id,
        origin: "AUTOMATIC",
      },
      select: violationAuditSelect,
    }));
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
  const businessDateText = attendance.businessDate.toISOString().slice(0, 10);
  const warnings: AutomaticViolationReconcileSummaryDto["warnings"] =
    needsStaffSchedule && !staffSchedule
      ? [
          {
            businessDate: businessDateText,
            code: "MISSING_STAFF_SHIFT",
            message:
              "Nhân viên chưa có ca làm hiệu lực trong ngày này nên chưa thể tính lỗi tự động theo giờ.",
          },
        ]
      : [];

  const cancelAutomaticViolation = async (
    violation: ViolationAuditRecord,
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
      select: violationAuditSelect,
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
    const thresholdSource = condition.thresholdSource ?? "RULE_FIXED";
    const resolvedCondition: ResolvedAutomaticCondition | null =
      condition.type === "CHECK_IN_LATE"
        ? thresholdSource === "STAFF_SHIFT"
          ? staffSchedule
            ? {
                ...condition,
                thresholdSource,
                scheduledStartMinutes: staffSchedule.scheduledStartMinutes,
              }
            : null
          : condition.scheduledStartMinutes === undefined
            ? null
            : {
                ...condition,
                thresholdSource,
                scheduledStartMinutes: condition.scheduledStartMinutes,
              }
        : thresholdSource === "STAFF_SHIFT"
          ? staffSchedule
            ? {
                ...condition,
                thresholdSource,
                requiredLiveMinutes: staffSchedule.requiredLiveMinutes,
              }
            : null
          : condition.requiredLiveMinutes === undefined
            ? null
            : {
                ...condition,
                thresholdSource,
                requiredLiveMinutes: condition.requiredLiveMinutes,
              };
    if (!resolvedCondition) {
      if (current) {
        await cancelAutomaticViolation(
          current,
          thresholdSource === "STAFF_SHIFT"
            ? "Nhân viên chưa có ca làm hiệu lực trong ngày này."
            : "Rule tự động chưa có ngưỡng thời gian hợp lệ.",
        );
      } else {
        unchangedCount += 1;
      }
      continue;
    }
    const evaluation = evaluateAutomaticPenalty(
      resolvedCondition,
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

    const businessDate = businessDateText;
    const policy = resolveOccurrencePolicy(item.reminderPolicy, item.code);
    const period = penaltyCountingPeriod(businessDate, policy.countingWindow);
    const detail = automaticDetail(
      resolvedCondition,
      evaluation.actualMinutes,
      evaluation.acceptedThresholdMinutes,
    );
    const snapshotBase = {
      triggerType: condition.type,
      condition: resolvedCondition,
      scheduleId: thresholdSource === "STAFF_SHIFT" && staffSchedule ? staffSchedule.id : null,
      scheduleVersion:
        thresholdSource === "STAFF_SHIFT" && staffSchedule ? staffSchedule.version : null,
      scheduledStartMinutes:
        resolvedCondition.type === "CHECK_IN_LATE" ? resolvedCondition.scheduledStartMinutes : null,
      requiredLiveMinutes:
        resolvedCondition.type === "LIVE_DURATION_SHORT"
          ? resolvedCondition.requiredLiveMinutes
          : null,
      graceMinutes: resolvedCondition.graceMinutes,
      schedule:
        thresholdSource === "STAFF_SHIFT" && staffSchedule
          ? {
              id: staffSchedule.id,
              version: staffSchedule.version,
              name: staffSchedule.name,
              scheduledStartMinutes: staffSchedule.scheduledStartMinutes,
              scheduledEndMinutes: staffSchedule.scheduledEndMinutes,
              spansNextDay: staffSchedule.spansNextDay,
              requiredLiveMinutes: staffSchedule.requiredLiveMinutes,
              effectiveFrom: staffSchedule.effectiveFrom.toISOString().slice(0, 10),
              effectiveTo: staffSchedule.effectiveTo?.toISOString().slice(0, 10) ?? null,
            }
          : null,
      actualMinutes: evaluation.actualMinutes,
      acceptedThresholdMinutes: evaluation.acceptedThresholdMinutes,
      businessDate,
      ruleVersionId: item.ruleVersionId,
      penaltyItemId: item.id,
      penalty: {
        itemName: item.name,
        defaultAmount: item.defaultAmount.toString(),
        penaltyStartsAt: policy.penaltyStartsAt,
        countingWindow: policy.countingWindow,
        countingKey: policy.countingKey,
      },
    };
    const snapshot = {
      ...snapshotBase,
      evaluatedAt: now.toISOString(),
    } satisfies Prisma.InputJsonObject;

    if (current) {
      if (
        current.status === "CANCELLED" &&
        current.cancellationReason === systemAuditReason("VIOLATION_CANCELLED")
      ) {
        unchangedCount += 1;
        continue;
      }

      const calculation = calculatePenaltyOccurrence(
        policy,
        current.occurrenceNo,
        item.defaultAmount.toString(),
      );
      const computedAmount = BigInt(calculation.computedAmount);
      const countingPeriodStart = parseBusinessDate(period.start);
      const countingPeriodEnd = period.end ? parseBusinessDate(period.end) : null;
      const refreshedRuleData = {
        penaltyItemId: item.id,
        ruleVersionId: item.ruleVersionId,
        penaltyItemCode: item.code,
        countingKey: policy.countingKey,
        countingWindow: policy.countingWindow,
        countingPeriodStart,
        countingPeriodEnd,
        penaltyStartsAt: policy.penaltyStartsAt,
        snapshottedDefaultAmount: item.defaultAmount,
        computedAmount,
        isChargeable: calculation.isChargeable,
        responsibleParty: "VIOLATING_STAFF",
        itemName: item.name,
        amount: computedAmount,
        detail,
        automaticSnapshot: snapshot,
      } satisfies Prisma.ViolationUncheckedUpdateInput;

      if (current.status === "CANCELLED") {
        const after = await tx.violation.update({
          where: { id: current.id },
          data: {
            ...refreshedRuleData,
            status: "ACTIVE",
            cancelledByUserId: null,
            cancelledAt: null,
            cancellationReason: null,
            version: { increment: 1 },
          },
          select: violationAuditSelect,
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
        comparableAutomaticSnapshot(current.automaticSnapshot) !== stableJson(snapshotBase) ||
        current.penaltyItemId !== item.id ||
        current.ruleVersionId !== item.ruleVersionId ||
        current.penaltyItemCode !== item.code ||
        current.countingKey !== policy.countingKey ||
        current.countingWindow !== policy.countingWindow ||
        current.countingPeriodStart.getTime() !== countingPeriodStart.getTime() ||
        (current.countingPeriodEnd?.getTime() ?? null) !== (countingPeriodEnd?.getTime() ?? null) ||
        current.penaltyStartsAt !== policy.penaltyStartsAt ||
        current.snapshottedDefaultAmount !== item.defaultAmount ||
        current.computedAmount !== computedAmount ||
        current.isChargeable !== calculation.isChargeable ||
        current.responsibleParty !== "VIOLATING_STAFF" ||
        current.itemName !== item.name ||
        current.amount !== computedAmount
      ) {
        const after = await tx.violation.update({
          where: { id: current.id },
          data: {
            ...refreshedRuleData,
            version: { increment: 1 },
          },
          select: violationAuditSelect,
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

    const occurrenceLockKey = [
      actor.companyId,
      attendance.staffId,
      policy.countingKey,
      period.start,
    ].join(":");
    let occurrenceNo: number;
    if (batchContext) {
      if (!batchContext.lockedOccurrenceKeys.has(occurrenceLockKey)) {
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
        batchContext.lockedOccurrenceKeys.add(occurrenceLockKey);
        batchContext.nextOccurrenceNoByKey.set(
          occurrenceLockKey,
          (sequence._max.occurrenceNo ?? 0) + 1,
        );
      }
      occurrenceNo = batchContext.nextOccurrenceNoByKey.get(occurrenceLockKey)!;
      batchContext.nextOccurrenceNoByKey.set(occurrenceLockKey, occurrenceNo + 1);
    } else {
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
      occurrenceNo = (sequence._max.occurrenceNo ?? 0) + 1;
    }
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
      select: violationAuditSelect,
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

  if (batchContext?.skipTotals) {
    return {
      createdCount,
      reactivatedCount,
      cancelledCount,
      unchangedCount,
      missingScheduleCount: warnings.length,
      warnings,
      attendanceActivePenaltyTotal: "0",
      staffMonthActivePenaltyTotal: "0",
    };
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
    missingScheduleCount: warnings.length,
    warnings,
    attendanceActivePenaltyTotal: (attendanceTotal._sum.amount ?? 0n).toString(),
    staffMonthActivePenaltyTotal: (staffMonthTotal._sum.amount ?? 0n).toString(),
  };
}

export async function reconcileAutomaticViolationsBatchInTransaction(
  tx: Transaction,
  actor: ActorContext,
  attendanceIds: readonly string[],
  reason: string,
  metadata: RequestMetadata,
): Promise<AutomaticViolationReconcileSummaryDto> {
  const context = await prepareAutomaticViolationBatchContext(tx, actor, attendanceIds);
  const now = new Date();
  const summaries: AutomaticViolationReconcileSummaryDto[] = [];
  for (const attendanceId of context.orderedAttendanceIds) {
    summaries.push(
      await reconcileAutomaticViolationsInTransaction(
        tx,
        actor,
        attendanceId,
        reason,
        metadata,
        now,
        context,
      ),
    );
  }
  return {
    createdCount: summaries.reduce((total, summary) => total + summary.createdCount, 0),
    reactivatedCount: summaries.reduce((total, summary) => total + summary.reactivatedCount, 0),
    cancelledCount: summaries.reduce((total, summary) => total + summary.cancelledCount, 0),
    unchangedCount: summaries.reduce((total, summary) => total + summary.unchangedCount, 0),
    missingScheduleCount: summaries.reduce(
      (total, summary) => total + summary.missingScheduleCount,
      0,
    ),
    warnings: summaries.flatMap((summary) => summary.warnings),
    attendanceActivePenaltyTotal: "0",
    staffMonthActivePenaltyTotal: "0",
  };
}

export async function cancelViolation(
  actor: ActorContext,
  id: string,
  input: ViolationCancelInput,
  metadata: RequestMetadata,
): Promise<ViolationDto> {
  requirePermission(actor, "violation:cancel");
  await authorizeViolation(actor, id, true);

  const transactionResult = await prisma.$transaction(async (tx) => {
    await lockEvidenceMutation(tx, actor.companyId, id);
    const before = await tx.violation.findUniqueOrThrow({
      where: { id },
      select: violationSelect,
    });
    if (before.status === "ACTIVE") {
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
          cancellationReason: systemAuditReason("VIOLATION_CANCELLED"),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        throw new DomainError("CONFLICT", "Vi phạm đã được cập nhật bởi người khác.");
      }
      const cancelled = await tx.violation.findUniqueOrThrow({
        where: { id },
        select: violationSelect,
      });
      await appendAudit(tx, {
        actor,
        action: "violation.cancel",
        entityType: "Violation",
        entityId: id,
        reason: systemAuditReason("VIOLATION_CANCELLED"),
        before: violationAuditShape(before),
        after: violationAuditShape(cancelled),
        metadata,
      });
    }

    const rejectedEvidence = await rejectPendingEvidence(tx, {
      actor,
      violationId: id,
      rejectionReason: "Vi phạm đã bị hủy trước khi evidence hoàn tất.",
      auditReason: systemAuditReason("EVIDENCE_UPLOAD_CANCELLED_WITH_VIOLATION"),
      metadata,
    });
    const finalViolation = await tx.violation.findUniqueOrThrow({
      where: { id },
      select: violationSelect,
    });
    return {
      violation: toViolationDto(finalViolation),
      rejectedEvidenceObjectKeys: rejectedEvidence.map((evidence) => evidence.objectKey),
    };
  });
  await cleanupRejectedEvidenceObjects({
    objectKeys: transactionResult.rejectedEvidenceObjectKeys,
    metadata,
    event: "evidence.cancelled_violation_object_cleanup_failed",
  });
  return transactionResult.violation;
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
  const extension = extensionByMime[input.mimeType];
  const objectKey = `companies/${actor.companyId}/violations/${violation.id}/${randomUUID()}.${extension}`;

  const result = await prisma.$transaction(async (tx) => {
    await lockEvidenceMutation(tx, actor.companyId, violation.id);
    const currentViolation = await tx.violation.findFirst({
      where: { id: violation.id, companyId: actor.companyId },
      select: { id: true, branchId: true, status: true },
    });
    if (!currentViolation || currentViolation.status !== "ACTIVE") {
      throw new DomainError("CONFLICT", "Không thể thêm ảnh vào vi phạm đã hủy.");
    }
    const rejectedEvidence = await rejectPendingEvidence(tx, {
      actor,
      violationId: currentViolation.id,
      rejectionReason: "Được thay thế bởi yêu cầu tải evidence mới.",
      auditReason: systemAuditReason("EVIDENCE_UPLOAD_REPLACED"),
      metadata,
    });
    const created = await tx.evidenceObject.create({
      data: {
        companyId: actor.companyId,
        branchId: currentViolation.branchId,
        violationId: currentViolation.id,
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
      reason: systemAuditReason("EVIDENCE_UPLOAD_REQUESTED"),
      after: {
        branchId: created.branchId,
        violationId: created.violationId,
        originalFileName: created.originalFileName,
        mimeType: created.mimeType,
        sizeBytes: created.sizeBytes.toString(),
        checksumSha256: created.checksumSha256,
        status: created.status,
      },
      metadata,
    });
    return {
      evidence: created,
      replacedObjectKeys: rejectedEvidence.map((evidence) => evidence.objectKey),
    };
  });
  await cleanupRejectedEvidenceObjects({
    objectKeys: result.replacedObjectKeys,
    metadata,
    event: "evidence.replaced_object_cleanup_failed",
  });
  const evidence = result.evidence;

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
    upload: {
      url: `/api/evidence/${encodeURIComponent(evidence.id)}/upload`,
      expiresInSeconds: EVIDENCE_UPLOAD_TTL_MS / 1_000,
      headers: {
        "Content-Type": input.mimeType,
        [EVIDENCE_VERSION_HEADER]: String(evidence.version),
      },
    },
  };
}

export async function uploadEvidenceObject(
  actor: ActorContext,
  id: string,
  request: Request,
  metadata: RequestMetadata,
): Promise<EvidenceDto> {
  requirePermission(actor, "evidence:upload");
  const expectedVersion = readEvidenceVersion(request);
  const existing = await prisma.evidenceObject.findFirst({
    where: { id, companyId: actor.companyId },
    include: {
      violation: {
        select: { attendanceId: true, status: true },
      },
    },
  });
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy evidence.");
  }
  await authorizeAttendance(actor, existing.violation.attendanceId, true);
  if (existing.violation.status !== "ACTIVE") {
    throw new DomainError("CONFLICT", "Không thể thêm ảnh vào vi phạm đã hủy.");
  }

  await storeEvidenceUpload({
    evidence: existing,
    expectedVersion,
    request,
    metadata,
  });
  const afterStore = await prisma.evidenceObject.findFirst({
    where: { id, companyId: actor.companyId },
    include: {
      violation: {
        select: { status: true },
      },
    },
  });
  if (afterStore?.status === "READY") {
    return evidenceDto(afterStore);
  }
  if (
    !afterStore ||
    afterStore.status !== "PENDING_UPLOAD" ||
    afterStore.version !== expectedVersion ||
    afterStore.violation.status !== "ACTIVE"
  ) {
    await cleanupRejectedEvidenceObjects({
      objectKeys: [existing.objectKey],
      metadata,
      event: "evidence.stale_upload_object_cleanup_failed",
    });
    throw new DomainError(
      "CONFLICT",
      "Evidence đã bị thay thế hoặc vi phạm đã bị hủy trong lúc tải ảnh.",
    );
  }
  return completeEvidenceUpload(actor, id, { version: expectedVersion }, metadata);
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
        select: { attendanceId: true, status: true },
      },
    },
  });
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy evidence.");
  }
  await authorizeAttendance(actor, existing.violation.attendanceId, true);
  if (existing.violation.status !== "ACTIVE") {
    throw new DomainError("CONFLICT", "Không thể hoàn tất ảnh của vi phạm đã hủy.");
  }
  if (existing.status !== "PENDING_UPLOAD") {
    throw new DomainError("CONFLICT", "Evidence không còn chờ upload.");
  }
  if (existing.version !== input.version) {
    throw new DomainError("CONFLICT", "Evidence đã được cập nhật bởi người khác.");
  }
  if (Date.now() - existing.createdAt.getTime() > EVIDENCE_UPLOAD_TTL_MS) {
    const rejectionReason = "Yêu cầu tải evidence đã hết hạn trước khi hoàn tất.";
    const rejected = await prisma.$transaction(async (tx) => {
      await lockEvidenceMutation(tx, actor.companyId, existing.violationId);
      return rejectEvidenceByVersion(tx, {
        actor,
        evidence: existing,
        rejectionReason,
        auditReason: systemAuditReason("EVIDENCE_UPLOAD_EXPIRED"),
        metadata,
      });
    });
    if (rejected) {
      await cleanupRejectedEvidenceObjects({
        objectKeys: [existing.objectKey],
        metadata,
        event: "evidence.expired_object_cleanup_failed",
      });
    }
    throw new DomainError(
      "CONFLICT",
      "Yêu cầu tải evidence đã hết hạn. Vui lòng chọn lại file để tạo lượt tải mới.",
    );
  }

  try {
    await verifyEvidenceObject({
      objectKey: existing.objectKey,
      mimeType: existing.mimeType,
      sizeBytes: Number(existing.sizeBytes),
      checksumSha256: existing.checksumSha256,
    });
  } catch (error) {
    if (!isEvidenceContentFailure(error)) {
      throw evidenceStorageUnavailable(error, {
        event: "evidence.storage_verify_failed",
        requestId: metadata.requestId,
        evidenceId: existing.id,
      });
    }
    const rejectionReason = "Object evidence không tồn tại hoặc metadata file không khớp yêu cầu.";
    const rejected = await prisma.$transaction(async (tx) => {
      return rejectEvidenceByVersion(tx, {
        actor,
        evidence: existing,
        rejectionReason,
        auditReason: "Object upload không khớp metadata đã ký.",
        metadata,
      });
    });
    if (!rejected) {
      throw new DomainError("CONFLICT", "Evidence đã được cập nhật bởi người khác.");
    }
    await cleanupRejectedEvidenceObjects({
      objectKeys: [existing.objectKey],
      metadata,
      event: "evidence.invalid_object_cleanup_failed",
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
