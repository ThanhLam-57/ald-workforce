import type {
  AttendanceBatchSaveInput,
  AttendanceBatchSaveResultDto,
  AttendanceCreateInput,
  AttendanceFilterOptionsDto,
  AttendanceMonthDto,
  AttendancePrintDataDto,
  AttendanceRecordDto,
  AutomaticViolationReconcileInput,
  AutomaticViolationReconcileSummaryDto,
  AttendanceUpdateInput,
  EmployeeErrorReportDto,
} from "@ald/contracts";
import { configuredRuleSchema } from "@ald/contracts";
import { prisma, type Prisma } from "@ald/db";
import {
  DomainError,
  effectivePenaltyAmount,
  enumerateBusinessMonth,
  matchRevenueBand,
  requirePermission,
  sumPenaltyAmounts,
  validateAttendanceValues,
  type ActorContext,
} from "@ald/domain";

import { systemAuditReason } from "./audit-service";
import { parseBusinessDate, toBusinessDate } from "./business-date";
import { createEvidenceViewUrl } from "./object-storage";
import type { RequestMetadata } from "./request-metadata";
import { activateDueSimpleRules } from "./simple-rule-service";
import {
  reconcileAutomaticViolationsBatchInTransaction,
  reconcileAutomaticViolationsInTransaction,
  toViolationDto,
  violationSelect,
} from "./violation-service";

type Transaction = Prisma.TransactionClient;

const attendanceSelect = {
  id: true,
  companyId: true,
  branchId: true,
  staffId: true,
  businessDate: true,
  checkInAt: true,
  checkOutAt: true,
  spansNextDay: true,
  workUnits: true,
  overtimeMinutes: true,
  penaltyOverrideAmount: true,
  note: true,
  status: true,
  version: true,
  archivedAt: true,
  liveMetric: {
    select: {
      actualLiveMinutes: true,
      revenueAmount: true,
      revenueUnit: true,
      revenueScale: true,
    },
  },
} satisfies Prisma.AttendanceDaySelect;

type AttendanceRecord = Prisma.AttendanceDayGetPayload<{ select: typeof attendanceSelect }>;
type DailyRewardDto = AttendanceRecordDto["dailyReward"];

const noDailyReward: DailyRewardDto = {
  amount: "0",
  matchedThreshold: null,
  ruleVersionId: null,
  status: "NO_ACTIVE_RULE",
};

function auditJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function appendAudit(
  tx: Transaction,
  input: {
    actor: ActorContext;
    action: string;
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
      entityType: "AttendanceDay",
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

function toDto(
  record: AttendanceRecord,
  dailyReward: DailyRewardDto = noDailyReward,
): AttendanceRecordDto {
  if (!record.liveMetric) {
    throw new Error(`Attendance ${record.id} thiếu live metric 1-1.`);
  }

  return {
    id: record.id,
    staffId: record.staffId,
    branchId: record.branchId,
    businessDate: record.businessDate.toISOString().slice(0, 10),
    checkInAt: record.checkInAt?.toISOString() ?? null,
    checkOutAt: record.checkOutAt?.toISOString() ?? null,
    spansNextDay: record.spansNextDay,
    workUnits: record.workUnits.toString(),
    overtimeMinutes: record.overtimeMinutes,
    penaltyOverrideAmount: record.penaltyOverrideAmount?.toString() ?? null,
    note: record.note,
    status: record.status,
    version: record.version,
    archivedAt: record.archivedAt?.toISOString() ?? null,
    actualLiveMinutes: record.liveMetric.actualLiveMinutes,
    revenueAmount: record.liveMetric.revenueAmount.toString(),
    revenueUnit: record.liveMetric.revenueUnit,
    revenueScale: record.liveMetric.revenueScale,
    dailyReward,
  };
}

async function dailyRewardsForRecords(
  companyId: string,
  records: readonly AttendanceRecord[],
): Promise<ReadonlyMap<string, DailyRewardDto>> {
  if (records.length === 0) return new Map();
  const dates = records.map((record) => record.businessDate);
  const firstDate = dates.reduce((left, right) => (left < right ? left : right));
  const lastDate = dates.reduce((left, right) => (left > right ? left : right));
  await activateDueSimpleRules(companyId);
  const versions = await prisma.ruleVersion.findMany({
    where: {
      companyId,
      isSimpleCurrent: true,
      supersededAt: null,
      ruleSet: {
        companyId,
        type: "DAILY_REWARD_TIERS",
        managementMode: "SIMPLE_MUTABLE",
      },
      status: "ACTIVE",
      effectiveFrom: { lte: lastDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: firstDate } }],
    },
    select: {
      id: true,
      effectiveFrom: true,
      effectiveTo: true,
      configuration: true,
    },
    orderBy: [{ effectiveFrom: "asc" }, { versionNo: "asc" }],
  });
  const result = new Map<string, DailyRewardDto>();
  for (const record of records) {
    if (!record.liveMetric) continue;
    const matches = versions.filter(
      (version) =>
        version.effectiveFrom !== null &&
        version.effectiveFrom <= record.businessDate &&
        (version.effectiveTo === null || version.effectiveTo > record.businessDate),
    );
    if (matches.length === 0) {
      result.set(record.id, noDailyReward);
      continue;
    }
    if (matches.length > 1) {
      result.set(record.id, {
        ...noDailyReward,
        status: "MULTIPLE_ACTIVE_RULES",
      });
      continue;
    }
    const version = matches[0]!;
    const parsed = configuredRuleSchema.safeParse(version.configuration);
    if (!parsed.success || parsed.data.kind !== "DAILY_REWARD_TIERS") {
      throw new DomainError("VALIDATION_ERROR", "Bộ thưởng ngày đang áp dụng không hợp lệ.");
    }
    const matched = matchRevenueBand(record.liveMetric.revenueAmount.toString(), parsed.data.tiers);
    result.set(record.id, {
      amount: matched?.rewardAmount ?? "0",
      matchedThreshold: matched?.minRevenue ?? null,
      ruleVersionId: version.id,
      status: matched ? "MATCHED" : "BELOW_MINIMUM",
    });
  }
  return result;
}

async function toDtoWithDailyReward(record: AttendanceRecord): Promise<AttendanceRecordDto> {
  const rewards = await dailyRewardsForRecords(record.companyId, [record]);
  return toDto(record, rewards.get(record.id) ?? noDailyReward);
}

async function toMutationDto(
  record: AttendanceRecord,
  automaticViolationSummary: AutomaticViolationReconcileSummaryDto,
): Promise<AttendanceRecordDto> {
  const [attendance, violations] = await Promise.all([
    toDtoWithDailyReward(record),
    prisma.violation.findMany({
      where: {
        companyId: record.companyId,
        attendanceId: record.id,
      },
      select: violationSelect,
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return {
    ...attendance,
    automaticViolationSummary,
    violations: violations.map(toViolationDto),
    activePenaltyTotal: effectivePenaltyAmount(
      automaticViolationSummary.attendanceActivePenaltyTotal,
      record.penaltyOverrideAmount?.toString(),
    ),
  };
}

function attendanceAuditShape(record: AttendanceRecord): Record<string, unknown> {
  const dto = toDto(record);
  return {
    branchId: dto.branchId,
    staffId: dto.staffId,
    businessDate: dto.businessDate,
    checkInAt: dto.checkInAt,
    checkOutAt: dto.checkOutAt,
    spansNextDay: dto.spansNextDay,
    workUnits: dto.workUnits,
    overtimeMinutes: dto.overtimeMinutes,
    penaltyOverrideAmount: dto.penaltyOverrideAmount,
    note: dto.note,
    status: dto.status,
    version: dto.version,
    archivedAt: dto.archivedAt,
    actualLiveMinutes: dto.actualLiveMinutes,
    revenueAmount: dto.revenueAmount,
    revenueUnit: dto.revenueUnit,
    revenueScale: dto.revenueScale,
  };
}

const assignmentPriority = {
  MEMBER: 0,
  PRIMARY_MANAGER: 1,
  SECONDARY_MANAGER: 2,
} as const;

async function resolveTarget(
  actor: ActorContext,
  staffId: string,
  businessDate: string,
  mutation: boolean,
  expectedBranchId?: string,
) {
  const date = parseBusinessDate(businessDate);
  const staff = await prisma.staffMember.findFirst({
    where: {
      id: staffId,
      companyId: actor.companyId,
      archivedAt: null,
    },
    select: {
      id: true,
      staffCode: true,
      fullName: true,
      jobTitle: true,
      user: { select: { role: true } },
      company: {
        select: {
          timezone: true,
          revenueUnit: true,
          revenueScale: true,
        },
      },
      assignments: {
        where: {
          archivedAt: null,
          effectiveFrom: { lte: date },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: date } }],
        },
        select: {
          branchId: true,
          assignmentType: true,
        },
      },
    },
  });

  if (!staff) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy nhân viên trong phạm vi.");
  }
  if (
    expectedBranchId &&
    actor.role === "TRAINING_MANAGER" &&
    !actor.activeBranchIds.includes(expectedBranchId)
  ) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy nhân viên trong phạm vi.");
  }
  const branchAssignments = expectedBranchId
    ? staff.assignments.filter((assignment) => assignment.branchId === expectedBranchId)
    : staff.assignments;

  if (actor.role === "TRAINING_MANAGER") {
    const isLiveEmployee = !staff.user || staff.user.role === "LIVE_EMPLOYEE";
    if (
      !isLiveEmployee ||
      (mutation && actor.staffId === staff.id) ||
      !branchAssignments.some(
        (assignment) =>
          assignment.assignmentType === "MEMBER" &&
          actor.activeBranchIds.includes(assignment.branchId),
      )
    ) {
      throw new DomainError("NOT_FOUND", "Không tìm thấy nhân viên trong phạm vi.");
    }
  }

  const assignments =
    actor.role === "TRAINING_MANAGER"
      ? branchAssignments.filter(
          (assignment) =>
            assignment.assignmentType === "MEMBER" &&
            actor.activeBranchIds.includes(assignment.branchId),
        )
      : [...branchAssignments].sort(
          (left, right) =>
            assignmentPriority[left.assignmentType] - assignmentPriority[right.assignmentType],
        );

  const assignment = assignments[0];
  if (!assignment) {
    if (actor.role === "GENERAL_MANAGER") {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Nhân viên chưa có phân công cơ sở tại ngày nghiệp vụ.",
      );
    }
    throw new DomainError("NOT_FOUND", "Không tìm thấy nhân viên trong phạm vi.");
  }

  return {
    ...staff,
    branchId: assignment.branchId,
  };
}

async function assertExistingRecordAccess(
  actor: ActorContext,
  record: Pick<AttendanceRecord, "staffId" | "branchId" | "businessDate">,
  mutation: boolean,
) {
  const target = await resolveTarget(
    actor,
    record.staffId,
    record.businessDate.toISOString().slice(0, 10),
    mutation,
    record.branchId,
  );
  if (target.branchId !== record.branchId) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy attendance trong phạm vi.");
  }
  return target;
}

async function resolveMonthTarget(
  actor: ActorContext,
  staffId: string,
  start: Date,
  end: Date,
  expectedBranchId?: string,
) {
  if (
    expectedBranchId &&
    actor.role === "TRAINING_MANAGER" &&
    !actor.activeBranchIds.includes(expectedBranchId)
  ) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy nhân viên trong phạm vi.");
  }
  const staff = await prisma.staffMember.findFirst({
    where: {
      id: staffId,
      companyId: actor.companyId,
      AND: [
        { OR: [{ archivedAt: null }, { archivedAt: { gte: start } }] },
        { OR: [{ joinedDate: null }, { joinedDate: { lt: end } }] },
        { OR: [{ terminationDate: null }, { terminationDate: { gte: start } }] },
      ],
    },
    select: {
      id: true,
      staffCode: true,
      fullName: true,
      jobTitle: true,
      streamingAlias: true,
      user: { select: { role: true } },
      company: {
        select: {
          name: true,
          timezone: true,
          revenueUnit: true,
          revenueScale: true,
        },
      },
      assignments: {
        where: {
          ...(expectedBranchId ? { branchId: expectedBranchId } : {}),
          archivedAt: null,
          effectiveFrom: { lt: end },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: start } }],
        },
        select: {
          branchId: true,
          assignmentType: true,
          attendanceMachineCode: true,
          effectiveFrom: true,
          effectiveTo: true,
          branch: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
        orderBy: { effectiveFrom: "desc" },
      },
    },
  });
  if (!staff) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy nhân viên trong phạm vi.");
  }

  const scopedAssignments =
    actor.role === "TRAINING_MANAGER"
      ? staff.assignments.filter(
          (assignment) =>
            assignment.assignmentType === "MEMBER" &&
            actor.activeBranchIds.includes(assignment.branchId),
        )
      : staff.assignments;
  const isLiveEmployee = !staff.user || staff.user.role === "LIVE_EMPLOYEE";
  if (scopedAssignments.length === 0 || (actor.role === "TRAINING_MANAGER" && !isLiveEmployee)) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy nhân viên trong phạm vi.");
  }
  return staff;
}

type ResolvedMonthTarget = Awaited<ReturnType<typeof resolveMonthTarget>>;
type ResolvedMonthAssignment = ResolvedMonthTarget["assignments"][number];

function assignmentForBusinessDate(
  actor: ActorContext,
  target: ResolvedMonthTarget,
  businessDate: string,
): ResolvedMonthAssignment | null {
  const date = parseBusinessDate(businessDate);
  const matches = target.assignments.filter(
    (assignment) =>
      assignment.effectiveFrom <= date &&
      (assignment.effectiveTo === null || assignment.effectiveTo > date) &&
      (actor.role !== "TRAINING_MANAGER" ||
        (assignment.assignmentType === "MEMBER" &&
          actor.activeBranchIds.includes(assignment.branchId))),
  );
  return (
    [...matches].sort((left, right) => {
      const priority =
        assignmentPriority[left.assignmentType] - assignmentPriority[right.assignmentType];
      return priority !== 0
        ? priority
        : right.effectiveFrom.getTime() - left.effectiveFrom.getTime();
    })[0] ?? null
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function prismaErrorCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

function isTransactionBusyError(error: unknown): boolean {
  const code = prismaErrorCode(error);
  if (code === "P2028" || code === "P2034") return true;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("unable to start a transaction") ||
    message.includes("expired transaction") ||
    message.includes("transaction api error") ||
    message.includes("deadlock") ||
    message.includes("write conflict")
  );
}

function attendanceBatchBusyError(): DomainError {
  return new DomainError(
    "ATTENDANCE_BATCH_BUSY",
    "Hệ thống đang bận và chưa lưu thay đổi nào. Vui lòng thử lại.",
  );
}

function decimalHundredths(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(`${fraction}00`.slice(0, 2));
}

function hundredthsDecimal(value: bigint): string {
  const whole = value / 100n;
  const fraction = value % 100n;
  return fraction === 0n
    ? whole.toString()
    : `${whole}.${fraction.toString().padStart(2, "0").replace(/0$/, "")}`;
}

function monthBounds(month: string) {
  const days = enumerateBusinessMonth(month);
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) {
    throw new DomainError("VALIDATION_ERROR", "Tháng không hợp lệ.");
  }
  const start = parseBusinessDate(first.businessDate);
  const end = parseBusinessDate(last.businessDate);
  end.setUTCDate(end.getUTCDate() + 1);
  return { days, start, end };
}

export async function listAttendanceStaff(actor: ActorContext, now: Date) {
  requirePermission(actor, "attendance:read");
  const businessDate = toBusinessDate(now);
  return prisma.staffMember.findMany({
    where: {
      companyId: actor.companyId,
      archivedAt: null,
      assignments: {
        some: {
          archivedAt: null,
          effectiveFrom: { lte: businessDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: businessDate } }],
          ...(actor.role === "TRAINING_MANAGER"
            ? {
                assignmentType: "MEMBER",
                branchId: { in: [...actor.activeBranchIds] },
              }
            : {}),
        },
      },
      ...(actor.role === "TRAINING_MANAGER"
        ? {
            ...(actor.staffId ? { id: { not: actor.staffId } } : {}),
            OR: [{ user: { is: null } }, { user: { is: { role: "LIVE_EMPLOYEE" } } }],
          }
        : {}),
    },
    select: {
      id: true,
      staffCode: true,
      fullName: true,
      jobTitle: true,
    },
    orderBy: [{ staffCode: "asc" }],
  });
}

export async function getAttendanceFilterOptions(
  actor: ActorContext,
  month: string,
  requestedBranchId?: string,
): Promise<AttendanceFilterOptionsDto> {
  requirePermission(actor, "attendance:read");
  const { start, end } = monthBounds(month);
  const branches = await prisma.branch.findMany({
    where: {
      companyId: actor.companyId,
      ...(actor.role === "TRAINING_MANAGER" ? { id: { in: [...actor.activeBranchIds] } } : {}),
    },
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
    },
    orderBy: [{ isActive: "desc" }, { code: "asc" }],
  });

  if (requestedBranchId && !branches.some((branch) => branch.id === requestedBranchId)) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy cơ sở trong phạm vi được phép.");
  }

  const selectedBranchId =
    requestedBranchId ?? branches.find((branch) => branch.isActive)?.id ?? branches[0]?.id ?? null;
  if (!selectedBranchId) {
    return {
      month,
      selectedBranchId: null,
      branches,
      staff: [],
    };
  }

  const staff = await prisma.staffMember.findMany({
    where: {
      companyId: actor.companyId,
      AND: [
        { OR: [{ archivedAt: null }, { archivedAt: { gte: start } }] },
        { OR: [{ joinedDate: null }, { joinedDate: { lt: end } }] },
        { OR: [{ terminationDate: null }, { terminationDate: { gte: start } }] },
        {
          OR: [
            { user: { is: null } },
            { user: { is: { companyId: actor.companyId, role: "LIVE_EMPLOYEE" } } },
          ],
        },
      ],
      assignments: {
        some: {
          companyId: actor.companyId,
          branchId: selectedBranchId,
          assignmentType: "MEMBER",
          archivedAt: null,
          effectiveFrom: { lt: end },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: start } }],
        },
      },
      ...(actor.staffId ? { id: { not: actor.staffId } } : {}),
    },
    select: {
      id: true,
      staffCode: true,
      fullName: true,
      jobTitle: true,
      assignments: {
        where: {
          companyId: actor.companyId,
          branchId: selectedBranchId,
          assignmentType: "MEMBER",
          archivedAt: null,
          effectiveFrom: { lt: end },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: start } }],
        },
        select: { attendanceMachineCode: true },
        orderBy: { effectiveFrom: "desc" },
        take: 1,
      },
    },
    orderBy: [{ staffCode: "asc" }],
  });

  return {
    month,
    selectedBranchId,
    branches,
    staff: staff.map(({ assignments, ...person }) => ({
      ...person,
      attendanceMachineCode: assignments[0]?.attendanceMachineCode ?? null,
    })),
  };
}

export async function getAttendanceMonth(
  actor: ActorContext,
  staffId: string,
  month: string,
  branchId?: string,
): Promise<AttendanceMonthDto> {
  requirePermission(actor, "attendance:read");
  const { days, start, end } = monthBounds(month);
  const target = await resolveMonthTarget(actor, staffId, start, end, branchId);

  const records = await prisma.attendanceDay.findMany({
    where: {
      companyId: actor.companyId,
      staffId,
      businessDate: { gte: start, lt: end },
      ...(branchId
        ? { branchId }
        : actor.role === "TRAINING_MANAGER"
          ? { branchId: { in: [...actor.activeBranchIds] } }
          : {}),
    },
    select: attendanceSelect,
    orderBy: { businessDate: "asc" },
  });
  const dailyRewards = await dailyRewardsForRecords(actor.companyId, records);
  const byDate = new Map(
    records.map((record) => [
      record.businessDate.toISOString().slice(0, 10),
      toDto(record, dailyRewards.get(record.id) ?? noDailyReward),
    ]),
  );
  const violations = await prisma.violation.findMany({
    where: {
      companyId: actor.companyId,
      staffId,
      businessDate: { gte: start, lt: end },
      ...(branchId
        ? { branchId }
        : actor.role === "TRAINING_MANAGER"
          ? { branchId: { in: [...actor.activeBranchIds] } }
          : {}),
    },
    select: violationSelect,
    orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }],
  });
  const violationsByDate = new Map<string, ReturnType<typeof toViolationDto>[]>();
  for (const violation of violations) {
    const date = violation.businessDate.toISOString().slice(0, 10);
    const bucket = violationsByDate.get(date) ?? [];
    bucket.push(toViolationDto(violation));
    violationsByDate.set(date, bucket);
  }
  const monthDays = days.map((day) => {
    const attendance = byDate.get(day.businessDate) ?? null;
    const dayViolations = violationsByDate.get(day.businessDate) ?? [];
    const calculatedPenaltyTotal = sumPenaltyAmounts(
      dayViolations
        .filter((violation) => violation.status === "ACTIVE")
        .map((violation) => violation.amount),
    );
    return {
      ...day,
      attendance,
      violations: dayViolations,
      calculatedPenaltyTotal,
      activePenaltyTotal: effectivePenaltyAmount(
        calculatedPenaltyTotal,
        attendance?.penaltyOverrideAmount,
      ),
    };
  });
  const activePenaltyTotal = sumPenaltyAmounts(monthDays.map((day) => day.activePenaltyTotal));

  return {
    month,
    activePenaltyTotal,
    dailyRewardTotal: sumPenaltyAmounts(
      records.map((record) => dailyRewards.get(record.id)?.amount ?? "0"),
    ),
    staff: {
      id: target.id,
      staffCode: target.staffCode,
      fullName: target.fullName,
      jobTitle: target.jobTitle,
      attendanceMachineCode:
        target.assignments.find(
          (assignment) =>
            assignment.assignmentType === "MEMBER" && assignment.attendanceMachineCode,
        )?.attendanceMachineCode ?? null,
    },
    revenueConfig: {
      unit: target.company.revenueUnit,
      scale: target.company.revenueScale,
    },
    days: monthDays,
  };
}

export async function createAttendance(
  actor: ActorContext,
  input: AttendanceCreateInput,
  metadata: RequestMetadata,
  expectedBranchId?: string,
): Promise<AttendanceRecordDto> {
  requirePermission(actor, "attendance:write");
  if (input.penaltyOverrideAmount !== undefined && actor.role !== "GENERAL_MANAGER") {
    throw new DomainError("FORBIDDEN", "Chỉ Tổng quản lý được sửa tiền phạt.");
  }
  const target = await resolveTarget(
    actor,
    input.staffId,
    input.businessDate,
    true,
    expectedBranchId,
  );
  const values = {
    businessDate: input.businessDate,
    checkInAt: input.checkInAt ?? null,
    checkOutAt: input.checkOutAt ?? null,
    spansNextDay: input.spansNextDay ?? false,
    workUnits: input.workUnits ?? "0",
    overtimeMinutes: input.overtimeMinutes ?? 0,
    actualLiveMinutes: input.actualLiveMinutes ?? 0,
    revenueAmount: input.revenueAmount ?? "0",
  };
  validateAttendanceValues(values, target.company.timezone);

  try {
    const created = await prisma.$transaction(
      async (tx) => {
        const attendance = await tx.attendanceDay.create({
          data: {
            companyId: actor.companyId,
            branchId: target.branchId,
            staffId: input.staffId,
            businessDate: parseBusinessDate(input.businessDate),
            checkInAt: input.checkInAt ? new Date(input.checkInAt) : null,
            checkOutAt: input.checkOutAt ? new Date(input.checkOutAt) : null,
            spansNextDay: values.spansNextDay,
            workUnits: values.workUnits,
            overtimeMinutes: values.overtimeMinutes,
            ...(input.penaltyOverrideAmount !== undefined
              ? {
                  penaltyOverrideAmount:
                    input.penaltyOverrideAmount === null
                      ? null
                      : BigInt(input.penaltyOverrideAmount),
                }
              : {}),
            note: input.note ?? null,
            status: input.status ?? "DRAFT",
            createdByUserId: actor.userId,
            updatedByUserId: actor.userId,
          },
        });
        await tx.liveDailyMetric.create({
          data: {
            companyId: actor.companyId,
            branchId: target.branchId,
            attendanceId: attendance.id,
            actualLiveMinutes: values.actualLiveMinutes,
            revenueAmount: BigInt(values.revenueAmount),
            revenueUnit: target.company.revenueUnit,
            revenueScale: target.company.revenueScale,
          },
        });
        const created = await tx.attendanceDay.findUniqueOrThrow({
          where: { id: attendance.id },
          select: attendanceSelect,
        });
        await appendAudit(tx, {
          actor,
          action: "attendance.create",
          entityId: created.id,
          reason: systemAuditReason("ATTENDANCE_CREATED_FROM_MONTH_GRID"),
          after: attendanceAuditShape(created),
          metadata,
        });
        const automaticViolationSummary = await reconcileAutomaticViolationsInTransaction(
          tx,
          actor,
          created.id,
          systemAuditReason("AUTOMATIC_VIOLATIONS_RECONCILED_AFTER_ATTENDANCE_CREATE"),
          metadata,
        );
        return { record: created, automaticViolationSummary };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    return await toMutationDto(created.record, created.automaticViolationSummary);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new DomainError("CONFLICT", "Nhân viên đã có attendance tại ngày nghiệp vụ này.");
    }
    if (isTransactionBusyError(error)) throw attendanceBatchBusyError();
    throw error;
  }
}

export async function updateAttendance(
  actor: ActorContext,
  id: string,
  input: AttendanceUpdateInput,
  metadata: RequestMetadata,
): Promise<AttendanceRecordDto> {
  requirePermission(actor, "attendance:write");
  if (input.penaltyOverrideAmount !== undefined && actor.role !== "GENERAL_MANAGER") {
    throw new DomainError("FORBIDDEN", "Chỉ Tổng quản lý được sửa tiền phạt.");
  }
  const existing = await prisma.attendanceDay.findFirst({
    where: { id, companyId: actor.companyId },
    select: attendanceSelect,
  });
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy attendance.");
  }
  const target = await assertExistingRecordAccess(actor, existing, true);
  if (!existing.liveMetric) {
    throw new Error(`Attendance ${existing.id} thiếu live metric 1-1.`);
  }

  const values = {
    businessDate: existing.businessDate.toISOString().slice(0, 10),
    checkInAt:
      input.checkInAt === undefined ? (existing.checkInAt?.toISOString() ?? null) : input.checkInAt,
    checkOutAt:
      input.checkOutAt === undefined
        ? (existing.checkOutAt?.toISOString() ?? null)
        : input.checkOutAt,
    spansNextDay: input.spansNextDay ?? existing.spansNextDay,
    workUnits: input.workUnits ?? existing.workUnits.toString(),
    overtimeMinutes: input.overtimeMinutes ?? existing.overtimeMinutes,
    actualLiveMinutes: input.actualLiveMinutes ?? existing.liveMetric.actualLiveMinutes,
    revenueAmount: input.revenueAmount ?? existing.liveMetric.revenueAmount.toString(),
  };
  validateAttendanceValues(values, target.company.timezone);

  try {
    const saved = await prisma.$transaction(
      async (tx) => {
        const result = await tx.attendanceDay.updateMany({
          where: {
            id,
            companyId: actor.companyId,
            version: input.version,
          },
          data: {
            ...(input.checkInAt !== undefined
              ? { checkInAt: input.checkInAt ? new Date(input.checkInAt) : null }
              : {}),
            ...(input.checkOutAt !== undefined
              ? { checkOutAt: input.checkOutAt ? new Date(input.checkOutAt) : null }
              : {}),
            ...(input.spansNextDay !== undefined ? { spansNextDay: input.spansNextDay } : {}),
            ...(input.workUnits !== undefined ? { workUnits: input.workUnits } : {}),
            ...(input.overtimeMinutes !== undefined
              ? { overtimeMinutes: input.overtimeMinutes }
              : {}),
            ...(input.penaltyOverrideAmount !== undefined
              ? {
                  penaltyOverrideAmount:
                    input.penaltyOverrideAmount === null
                      ? null
                      : BigInt(input.penaltyOverrideAmount),
                }
              : {}),
            ...(input.note !== undefined ? { note: input.note } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            archivedAt: null,
            updatedByUserId: actor.userId,
            version: { increment: 1 },
          },
        });
        if (result.count !== 1) {
          const current = await tx.attendanceDay.findFirst({
            where: { id, companyId: actor.companyId },
            select: attendanceSelect,
          });
          throw new DomainError("CONFLICT", "Attendance đã được cập nhật bởi người khác.", {
            ...(current ? { current: toDto(current) } : {}),
          });
        }

        if (input.actualLiveMinutes !== undefined || input.revenueAmount !== undefined) {
          await tx.liveDailyMetric.update({
            where: { attendanceId: id },
            data: {
              ...(input.actualLiveMinutes !== undefined
                ? { actualLiveMinutes: input.actualLiveMinutes }
                : {}),
              ...(input.revenueAmount !== undefined
                ? { revenueAmount: BigInt(input.revenueAmount) }
                : {}),
            },
          });
        }

        const after = await tx.attendanceDay.findUniqueOrThrow({
          where: { id },
          select: attendanceSelect,
        });
        await appendAudit(tx, {
          actor,
          action: existing.archivedAt ? "attendance.restore-and-update" : "attendance.update",
          entityId: id,
          reason: systemAuditReason("ATTENDANCE_UPDATED_FROM_MONTH_GRID"),
          before: attendanceAuditShape(existing),
          after: attendanceAuditShape(after),
          metadata,
        });
        const automaticViolationSummary = await reconcileAutomaticViolationsInTransaction(
          tx,
          actor,
          after.id,
          systemAuditReason("AUTOMATIC_VIOLATIONS_RECONCILED_AFTER_ATTENDANCE_UPDATE"),
          metadata,
        );
        return { record: after, automaticViolationSummary };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    return toMutationDto(saved.record, saved.automaticViolationSummary);
  } catch (error) {
    if (isTransactionBusyError(error)) throw attendanceBatchBusyError();
    throw error;
  }
}

type AttendanceBatchConflict = Readonly<{
  businessDate: string;
  current: AttendanceRecordDto | null;
}>;

function scopedConflictRecord(
  actor: ActorContext,
  record: AttendanceRecord | null,
): AttendanceRecordDto | null {
  if (!record) return null;
  if (actor.role === "TRAINING_MANAGER" && !actor.activeBranchIds.includes(record.branchId)) {
    return null;
  }
  return toDto(record);
}

function throwAttendanceBatchConflict(conflicts: readonly AttendanceBatchConflict[]): never {
  throw new DomainError(
    "ATTENDANCE_BATCH_CONFLICT",
    `Có ${conflicts.length} dòng chấm công đã thay đổi. Chưa có dữ liệu nào được lưu.`,
    { conflicts },
  );
}

export async function saveAttendanceBatch(
  actor: ActorContext,
  input: AttendanceBatchSaveInput,
  metadata: RequestMetadata,
): Promise<AttendanceBatchSaveResultDto> {
  const startedAt = Date.now();
  requirePermission(actor, "attendance:write");
  if (
    actor.role !== "GENERAL_MANAGER" &&
    input.rows.some((row) => row.penaltyOverrideAmount !== undefined)
  ) {
    throw new DomainError("FORBIDDEN", "Chỉ Tổng quản lý được sửa tiền phạt.");
  }
  if (actor.role === "TRAINING_MANAGER" && actor.staffId === input.staffId) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy nhân viên trong phạm vi.");
  }

  const { start, end } = monthBounds(input.month);
  const target = await resolveMonthTarget(actor, input.staffId, start, end);
  const preparedRows = [...input.rows]
    .sort((left, right) => left.businessDate.localeCompare(right.businessDate))
    .map((row) => {
      const assignment = assignmentForBusinessDate(actor, target, row.businessDate);
      if (!assignment) {
        throw new DomainError(
          actor.role === "GENERAL_MANAGER" ? "VALIDATION_ERROR" : "NOT_FOUND",
          actor.role === "GENERAL_MANAGER"
            ? `Nhân viên chưa có phân công cơ sở tại ngày ${row.businessDate}.`
            : "Không tìm thấy nhân viên trong phạm vi.",
        );
      }
      validateAttendanceValues(row, target.company.timezone);
      return { row, assignment };
    });
  const branchIds = [...new Set(preparedRows.map(({ assignment }) => assignment.branchId))];
  const logFailure = (errorCode: string) => {
    console.error(
      JSON.stringify({
        event: "attendance.batch.failed",
        requestId: metadata.requestId,
        companyId: actor.companyId,
        branchId: branchIds.length === 1 ? branchIds[0] : null,
        staffId: input.staffId,
        month: input.month,
        rowCount: input.rows.length,
        createdCount: 0,
        updatedCount: 0,
        automaticViolationCreatedCount: 0,
        automaticViolationCancelledCount: 0,
        durationMs: Date.now() - startedAt,
        errorCode,
      }),
    );
  };
  const businessDates = preparedRows.map(({ row }) => parseBusinessDate(row.businessDate));
  const existingRecords = await prisma.attendanceDay.findMany({
    where: {
      companyId: actor.companyId,
      staffId: input.staffId,
      businessDate: { gte: start, lt: end },
    },
    select: attendanceSelect,
  });
  const existingByDate = new Map(
    existingRecords.map((record) => [record.businessDate.toISOString().slice(0, 10), record]),
  );
  const initialConflicts: AttendanceBatchConflict[] = [];
  for (const { row, assignment } of preparedRows) {
    const current = existingByDate.get(row.businessDate) ?? null;
    const mismatchedExisting =
      row.attendanceId === null
        ? current !== null
        : current === null ||
          current.id !== row.attendanceId ||
          current.version !== row.version ||
          current.branchId !== assignment.branchId;
    if (mismatchedExisting) {
      initialConflicts.push({
        businessDate: row.businessDate,
        current: scopedConflictRecord(actor, current),
      });
    }
  }
  if (initialConflicts.length > 0) {
    logFailure("ATTENDANCE_BATCH_CONFLICT");
    throwAttendanceBatchConflict(initialConflicts);
  }

  let transactionResult: Readonly<{
    createdCount: number;
    updatedCount: number;
    automaticViolationSummary: AutomaticViolationReconcileSummaryDto;
  }>;
  try {
    transactionResult = await prisma.$transaction(
      async (tx) => {
        const savedIds: string[] = [];
        let createdCount = 0;
        let updatedCount = 0;

        for (const { row, assignment } of preparedRows) {
          if (row.attendanceId === null) {
            const attendance = await tx.attendanceDay.create({
              data: {
                companyId: actor.companyId,
                branchId: assignment.branchId,
                staffId: input.staffId,
                businessDate: parseBusinessDate(row.businessDate),
                checkInAt: row.checkInAt ? new Date(row.checkInAt) : null,
                checkOutAt: row.checkOutAt ? new Date(row.checkOutAt) : null,
                spansNextDay: row.spansNextDay,
                workUnits: row.workUnits,
                overtimeMinutes: row.overtimeMinutes,
                ...(row.penaltyOverrideAmount !== undefined
                  ? {
                      penaltyOverrideAmount:
                        row.penaltyOverrideAmount === null
                          ? null
                          : BigInt(row.penaltyOverrideAmount),
                    }
                  : {}),
                note: row.note,
                status: row.status ?? "DRAFT",
                createdByUserId: actor.userId,
                updatedByUserId: actor.userId,
              },
              select: { id: true },
            });
            await tx.liveDailyMetric.create({
              data: {
                companyId: actor.companyId,
                branchId: assignment.branchId,
                attendanceId: attendance.id,
                actualLiveMinutes: row.actualLiveMinutes,
                revenueAmount: BigInt(row.revenueAmount),
                revenueUnit: target.company.revenueUnit,
                revenueScale: target.company.revenueScale,
              },
            });
            savedIds.push(attendance.id);
            createdCount += 1;
            continue;
          }

          const updated = await tx.attendanceDay.updateMany({
            where: {
              id: row.attendanceId,
              companyId: actor.companyId,
              branchId: assignment.branchId,
              staffId: input.staffId,
              businessDate: parseBusinessDate(row.businessDate),
              version: row.version!,
            },
            data: {
              checkInAt: row.checkInAt ? new Date(row.checkInAt) : null,
              checkOutAt: row.checkOutAt ? new Date(row.checkOutAt) : null,
              spansNextDay: row.spansNextDay,
              workUnits: row.workUnits,
              overtimeMinutes: row.overtimeMinutes,
              ...(row.penaltyOverrideAmount !== undefined
                ? {
                    penaltyOverrideAmount:
                      row.penaltyOverrideAmount === null ? null : BigInt(row.penaltyOverrideAmount),
                  }
                : {}),
              note: row.note,
              status: row.status ?? "DRAFT",
              archivedAt: null,
              updatedByUserId: actor.userId,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) {
            const current = await tx.attendanceDay.findFirst({
              where: {
                companyId: actor.companyId,
                staffId: input.staffId,
                businessDate: parseBusinessDate(row.businessDate),
              },
              select: attendanceSelect,
            });
            throwAttendanceBatchConflict([
              { businessDate: row.businessDate, current: scopedConflictRecord(actor, current) },
            ]);
          }
          const metric = await tx.liveDailyMetric.updateMany({
            where: {
              companyId: actor.companyId,
              branchId: assignment.branchId,
              attendanceId: row.attendanceId,
            },
            data: {
              actualLiveMinutes: row.actualLiveMinutes,
              revenueAmount: BigInt(row.revenueAmount),
            },
          });
          if (metric.count !== 1) {
            throw new Error(`Attendance ${row.attendanceId} thiếu live metric 1-1.`);
          }
          savedIds.push(row.attendanceId);
          updatedCount += 1;
        }

        const afterRecords = await tx.attendanceDay.findMany({
          where: { id: { in: savedIds }, companyId: actor.companyId },
          select: attendanceSelect,
        });
        const afterByDate = new Map(
          afterRecords.map((record) => [record.businessDate.toISOString().slice(0, 10), record]),
        );
        if (afterRecords.length !== savedIds.length) {
          throw new Error("Không thể đọc lại đầy đủ dữ liệu attendance sau khi lưu batch.");
        }
        const auditRows: Prisma.AuditLogCreateManyInput[] = preparedRows.map(({ row }) => {
          const before = existingByDate.get(row.businessDate) ?? null;
          const after = afterByDate.get(row.businessDate)!;
          return {
            companyId: actor.companyId,
            branchId: after.branchId,
            actorUserId: actor.userId,
            action: before
              ? before.archivedAt
                ? "attendance.restore-and-update"
                : "attendance.update"
              : "attendance.create",
            entityType: "AttendanceDay",
            entityId: after.id,
            reason: systemAuditReason(
              before ? "ATTENDANCE_UPDATED_FROM_MONTH_GRID" : "ATTENDANCE_CREATED_FROM_MONTH_GRID",
            ),
            ...(before ? { before: auditJson(attendanceAuditShape(before)) } : {}),
            after: auditJson(attendanceAuditShape(after)),
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          };
        });
        await tx.auditLog.createMany({ data: auditRows });
        const automaticViolationSummary = await reconcileAutomaticViolationsBatchInTransaction(
          tx,
          actor,
          savedIds,
          systemAuditReason("AUTOMATIC_VIOLATIONS_RECONCILED_AFTER_ATTENDANCE_BATCH"),
          metadata,
        );
        return { createdCount, updatedCount, automaticViolationSummary };
      },
      { maxWait: 15_000, timeout: 60_000 },
    );
  } catch (error) {
    if (error instanceof DomainError) {
      logFailure(error.code);
      throw error;
    }
    if (isUniqueConstraintError(error)) {
      const currentRecords = await prisma.attendanceDay.findMany({
        where: {
          companyId: actor.companyId,
          staffId: input.staffId,
          businessDate: { in: businessDates },
        },
        select: attendanceSelect,
      });
      const currentByDate = new Map(
        currentRecords.map((record) => [record.businessDate.toISOString().slice(0, 10), record]),
      );
      logFailure("ATTENDANCE_BATCH_CONFLICT");
      throwAttendanceBatchConflict(
        preparedRows
          .filter(({ row }) => {
            const current = currentByDate.get(row.businessDate);
            if (!current) return false;
            return (
              row.attendanceId === null ||
              current.id !== row.attendanceId ||
              current.version !== row.version
            );
          })
          .map(({ row }) => ({
            businessDate: row.businessDate,
            current: scopedConflictRecord(actor, currentByDate.get(row.businessDate)!),
          })),
      );
    }
    const errorCode = prismaErrorCode(error);
    logFailure(errorCode ?? (error instanceof Error ? error.name : "UNKNOWN"));
    if (isTransactionBusyError(error)) throw attendanceBatchBusyError();
    throw error;
  }

  const dataset = await getAttendanceMonth(actor, input.staffId, input.month);
  const lastSavedDate = preparedRows.at(-1)!.row.businessDate;
  const lastSavedPenalty =
    dataset.days.find((day) => day.businessDate === lastSavedDate)?.activePenaltyTotal ?? "0";
  const automaticViolationSummary = {
    ...transactionResult.automaticViolationSummary,
    attendanceActivePenaltyTotal: lastSavedPenalty,
    staffMonthActivePenaltyTotal: dataset.activePenaltyTotal,
  };
  console.info(
    JSON.stringify({
      event: "attendance.batch.saved",
      requestId: metadata.requestId,
      companyId: actor.companyId,
      branchId: branchIds.length === 1 ? branchIds[0] : null,
      staffId: input.staffId,
      month: input.month,
      rowCount: input.rows.length,
      createdCount: transactionResult.createdCount,
      updatedCount: transactionResult.updatedCount,
      automaticViolationCreatedCount:
        automaticViolationSummary.createdCount + automaticViolationSummary.reactivatedCount,
      automaticViolationCancelledCount: automaticViolationSummary.cancelledCount,
      durationMs: Date.now() - startedAt,
      errorCode: null,
    }),
  );
  return {
    dataset,
    savedCount: input.rows.length,
    createdCount: transactionResult.createdCount,
    updatedCount: transactionResult.updatedCount,
    automaticViolationSummary,
  };
}

class AutomaticViolationDryRunRollback extends Error {
  public constructor(public readonly summary: AutomaticViolationReconcileSummaryDto) {
    super("AUTOMATIC_VIOLATION_DRY_RUN_ROLLBACK");
  }
}

export async function reconcileAutomaticViolationsForMonth(
  actor: ActorContext,
  input: AutomaticViolationReconcileInput,
  metadata: RequestMetadata,
): Promise<AutomaticViolationReconcileSummaryDto> {
  requirePermission(actor, "attendance:write");
  if (actor.role === "TRAINING_MANAGER" && actor.staffId === input.staffId) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy nhân viên trong phạm vi.");
  }
  const { start, end } = monthBounds(input.month);
  await resolveMonthTarget(actor, input.staffId, start, end);
  const attendance = await prisma.attendanceDay.findMany({
    where: {
      companyId: actor.companyId,
      staffId: input.staffId,
      businessDate: { gte: start, lt: end },
      ...(actor.role === "TRAINING_MANAGER"
        ? { branchId: { in: [...actor.activeBranchIds] } }
        : {}),
    },
    select: { id: true },
    orderBy: { businessDate: "asc" },
  });

  const execute = async (tx: Transaction) => {
    const attendanceIds = attendance.map((record) => record.id);
    const summary =
      attendanceIds.length > 0
        ? await reconcileAutomaticViolationsBatchInTransaction(
            tx,
            actor,
            attendanceIds,
            systemAuditReason("AUTOMATIC_VIOLATIONS_RECONCILED_FOR_MONTH"),
            metadata,
          )
        : {
            createdCount: 0,
            reactivatedCount: 0,
            cancelledCount: 0,
            unchangedCount: 0,
            missingScheduleCount: 0,
            warnings: [],
            attendanceActivePenaltyTotal: "0",
            staffMonthActivePenaltyTotal: "0",
          };
    const lastAttendanceId = attendanceIds.at(-1) ?? null;
    const [dailyTotals, staffMonthTotal] = await Promise.all([
      attendanceIds.length > 0
        ? tx.violation.groupBy({
            by: ["attendanceId"],
            where: {
              companyId: actor.companyId,
              attendanceId: { in: attendanceIds },
              status: "ACTIVE",
            },
            _sum: { amount: true },
          })
        : Promise.resolve([]),
      tx.violation.aggregate({
        where: {
          companyId: actor.companyId,
          staffId: input.staffId,
          businessDate: { gte: start, lt: end },
          status: "ACTIVE",
        },
        _sum: { amount: true },
      }),
    ]);
    const lastAttendanceTotal = lastAttendanceId
      ? (dailyTotals.find((total) => total.attendanceId === lastAttendanceId)?._sum.amount ?? 0n)
      : 0n;
    return {
      ...summary,
      attendanceActivePenaltyTotal: lastAttendanceTotal.toString(),
      staffMonthActivePenaltyTotal: (staffMonthTotal._sum.amount ?? 0n).toString(),
    };
  };

  if (!input.dryRun) {
    return prisma.$transaction(execute, { maxWait: 15_000, timeout: 60_000 });
  }
  try {
    await prisma.$transaction(
      async (tx) => {
        const summary = await execute(tx);
        throw new AutomaticViolationDryRunRollback(summary);
      },
      { maxWait: 15_000, timeout: 60_000 },
    );
  } catch (error) {
    if (error instanceof AutomaticViolationDryRunRollback) return error.summary;
    throw error;
  }
  throw new Error("Không thể hoàn tất dry-run lỗi tự động.");
}

export async function getAttendancePrintData(
  actor: ActorContext,
  staffId: string,
  month: string,
  metadata: RequestMetadata,
  now = new Date(),
): Promise<AttendancePrintDataDto> {
  const startedAt = Date.now();
  requirePermission(actor, "attendance:read");
  if (actor.role === "LIVE_EMPLOYEE") {
    throw new DomainError("FORBIDDEN", "Bạn không có quyền in phiếu chấm công.");
  }
  const { days, start, end } = monthBounds(month);
  const target = await resolveMonthTarget(actor, staffId, start, end);
  const dataset = await getAttendanceMonth(actor, staffId, month);
  const attendanceBranchId =
    dataset.days.find((day) => day.attendance)?.attendance?.branchId ?? null;
  const scopedAssignments = target.assignments.filter(
    (assignment) =>
      actor.role !== "TRAINING_MANAGER" ||
      (assignment.assignmentType === "MEMBER" &&
        actor.activeBranchIds.includes(assignment.branchId)),
  );
  const assignment =
    (attendanceBranchId
      ? scopedAssignments.find((candidate) => candidate.branchId === attendanceBranchId)
      : null) ??
    [...scopedAssignments].sort(
      (left, right) => right.effectiveFrom.getTime() - left.effectiveFrom.getTime(),
    )[0];
  if (!assignment) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy cơ sở của nhân viên trong phạm vi.");
  }

  const rows: AttendancePrintDataDto["rows"] = days.map((calendarDay) => {
    const day = dataset.days.find(
      (candidate) => candidate.businessDate === calendarDay.businessDate,
    )!;
    const attendance = day.attendance;
    return {
      businessDate: day.businessDate,
      dayOfWeek: day.dayOfWeek,
      checkInAt: attendance?.checkInAt ?? null,
      checkOutAt: attendance?.checkOutAt ?? null,
      actualLiveMinutes: attendance?.actualLiveMinutes ?? 0,
      overtimeMinutes: attendance?.overtimeMinutes ?? 0,
      workUnits: attendance?.workUnits ?? "0",
      revenueAmount: attendance?.revenueAmount ?? "0",
      dailyRewardAmount: attendance?.dailyReward.amount ?? "0",
      violationNames: day.violations
        .filter((violation) => violation.status === "ACTIVE")
        .map((violation) => violation.itemName),
      penaltyAmount: day.activePenaltyTotal,
      note: attendance?.note ?? null,
    };
  });
  const result: AttendancePrintDataDto = {
    company: { name: target.company.name },
    branch: assignment.branch,
    staff: {
      id: target.id,
      staffCode: target.staffCode,
      fullName: target.fullName,
      attendanceMachineCode: assignment.attendanceMachineCode,
      streamingAlias: target.streamingAlias,
    },
    month,
    generatedAt: now.toISOString(),
    rows,
    totals: {
      workedDayCount: rows.filter((row) => decimalHundredths(row.workUnits) > 0n).length,
      workUnits: hundredthsDecimal(
        rows.reduce((total, row) => total + decimalHundredths(row.workUnits), 0n),
      ),
      actualLiveMinutes: rows.reduce((total, row) => total + row.actualLiveMinutes, 0),
      overtimeMinutes: rows.reduce((total, row) => total + row.overtimeMinutes, 0),
      revenueAmount: rows.reduce((total, row) => total + BigInt(row.revenueAmount), 0n).toString(),
      dailyRewardAmount: rows
        .reduce((total, row) => total + BigInt(row.dailyRewardAmount), 0n)
        .toString(),
      penaltyAmount: rows.reduce((total, row) => total + BigInt(row.penaltyAmount), 0n).toString(),
    },
  };
  console.info(
    JSON.stringify({
      event: "attendance.print",
      requestId: metadata.requestId,
      actorUserId: actor.userId,
      branchId: assignment.branchId,
      staffId,
      month,
      durationMs: Date.now() - startedAt,
    }),
  );
  return result;
}

export async function createEmployeeErrorReport(
  actor: ActorContext,
  staffId: string,
  month: string,
  now = new Date(),
): Promise<EmployeeErrorReportDto> {
  requirePermission(actor, "attendance:export");
  const { start, end } = monthBounds(month);
  const target = await resolveMonthTarget(actor, staffId, start, end);
  const attendance = await prisma.attendanceDay.findMany({
    where: {
      companyId: actor.companyId,
      staffId,
      businessDate: { gte: start, lt: end },
      archivedAt: null,
      ...(actor.role === "TRAINING_MANAGER"
        ? { branchId: { in: [...actor.activeBranchIds] } }
        : {}),
    },
    select: {
      businessDate: true,
      status: true,
      workUnits: true,
      overtimeMinutes: true,
      note: true,
      violations: {
        where: { companyId: actor.companyId, status: "ACTIVE" },
        select: {
          itemName: true,
          detail: true,
          amount: true,
          note: true,
          evidenceObjects: {
            where: { companyId: actor.companyId, status: "READY" },
            select: {
              objectKey: true,
              originalFileName: true,
              mimeType: true,
            },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { businessDate: "asc" },
  });

  const reportViolations = await Promise.all(
    attendance.flatMap((record) =>
      record.violations.map(async (violation) => ({
        businessDate: record.businessDate.toISOString().slice(0, 10),
        attendance: {
          status: record.status,
          workUnits: record.workUnits.toString(),
          overtimeMinutes: record.overtimeMinutes,
          note: record.note,
        },
        itemName: violation.itemName,
        detail: violation.detail,
        amount: violation.amount.toString(),
        note: violation.note,
        evidence: await Promise.all(
          violation.evidenceObjects.map(async (evidence) => ({
            fileName: evidence.originalFileName,
            mimeType: evidence.mimeType,
            url: (
              await createEvidenceViewUrl({
                objectKey: evidence.objectKey,
                originalFileName: evidence.originalFileName,
                mimeType: evidence.mimeType,
              })
            ).url,
          })),
        ),
      })),
    ),
  );

  // This query and DTO deliberately do not select or serialize live metrics/revenue.
  return {
    reportType: "EMPLOYEE_ERROR_REPORT",
    month,
    generatedAt: now.toISOString(),
    staff: {
      id: target.id,
      staffCode: target.staffCode,
      fullName: target.fullName,
    },
    attendance: attendance.map((record) => ({
      businessDate: record.businessDate.toISOString().slice(0, 10),
      status: record.status,
      workUnits: record.workUnits.toString(),
      overtimeMinutes: record.overtimeMinutes,
      note: record.note,
    })),
    violations: reportViolations,
  };
}
