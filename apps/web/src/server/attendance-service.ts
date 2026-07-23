import type {
  AttendanceArchiveInput,
  AttendanceCreateInput,
  AttendanceMonthDto,
  AttendanceRecordDto,
  AttendanceUpdateInput,
  EmployeeErrorReportDto,
} from "@ald/contracts";
import { prisma, type Prisma } from "@ald/db";
import {
  DomainError,
  enumerateBusinessMonth,
  requirePermission,
  sumPenaltyAmounts,
  validateAttendanceValues,
  type ActorContext,
} from "@ald/domain";

import { parseBusinessDate, toBusinessDate } from "./business-date";
import { createEvidenceViewUrl } from "./object-storage";
import type { RequestMetadata } from "./request-metadata";
import { toViolationDto, violationSelect } from "./violation-service";

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

function toDto(record: AttendanceRecord): AttendanceRecordDto {
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
    note: record.note,
    status: record.status,
    version: record.version,
    archivedAt: record.archivedAt?.toISOString() ?? null,
    actualLiveMinutes: record.liveMetric.actualLiveMinutes,
    revenueAmount: record.liveMetric.revenueAmount.toString(),
    revenueUnit: record.liveMetric.revenueUnit,
    revenueScale: record.liveMetric.revenueScale,
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

async function resolveMonthTarget(actor: ActorContext, staffId: string, start: Date, end: Date) {
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
          revenueUnit: true,
          revenueScale: true,
        },
      },
      assignments: {
        where: {
          archivedAt: null,
          effectiveFrom: { lt: end },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: start } }],
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

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
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

export async function getAttendanceMonth(
  actor: ActorContext,
  staffId: string,
  month: string,
): Promise<AttendanceMonthDto> {
  requirePermission(actor, "attendance:read");
  const { days, start, end } = monthBounds(month);
  const target = await resolveMonthTarget(actor, staffId, start, end);

  const records = await prisma.attendanceDay.findMany({
    where: {
      companyId: actor.companyId,
      staffId,
      businessDate: { gte: start, lt: end },
      ...(actor.role === "TRAINING_MANAGER"
        ? { branchId: { in: [...actor.activeBranchIds] } }
        : {}),
    },
    select: attendanceSelect,
    orderBy: { businessDate: "asc" },
  });
  const byDate = new Map(
    records.map((record) => [record.businessDate.toISOString().slice(0, 10), toDto(record)]),
  );
  const violations = await prisma.violation.findMany({
    where: {
      companyId: actor.companyId,
      staffId,
      businessDate: { gte: start, lt: end },
      ...(actor.role === "TRAINING_MANAGER"
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
  const activePenaltyTotal = sumPenaltyAmounts(
    violations
      .filter((violation) => violation.status === "ACTIVE")
      .map((violation) => violation.amount.toString()),
  );

  return {
    month,
    activePenaltyTotal,
    staff: {
      id: target.id,
      staffCode: target.staffCode,
      fullName: target.fullName,
      jobTitle: target.jobTitle,
    },
    revenueConfig: {
      unit: target.company.revenueUnit,
      scale: target.company.revenueScale,
    },
    days: days.map((day) => ({
      ...day,
      attendance: byDate.get(day.businessDate) ?? null,
      violations: violationsByDate.get(day.businessDate) ?? [],
      activePenaltyTotal: sumPenaltyAmounts(
        (violationsByDate.get(day.businessDate) ?? [])
          .filter((violation) => violation.status === "ACTIVE")
          .map((violation) => violation.amount),
      ),
    })),
  };
}

export async function createAttendance(
  actor: ActorContext,
  input: AttendanceCreateInput,
  metadata: RequestMetadata,
  expectedBranchId?: string,
): Promise<AttendanceRecordDto> {
  requirePermission(actor, "attendance:write");
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
    return await prisma.$transaction(async (tx) => {
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
        reason: input.reason,
        after: attendanceAuditShape(created),
        metadata,
      });
      return toDto(created);
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new DomainError("CONFLICT", "Nhân viên đã có attendance tại ngày nghiệp vụ này.");
    }
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
  const existing = await prisma.attendanceDay.findFirst({
    where: { id, companyId: actor.companyId },
    select: attendanceSelect,
  });
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy attendance.");
  }
  if (existing.archivedAt) {
    throw new DomainError("CONFLICT", "Attendance đã được lưu trữ.", {
      current: toDto(existing),
    });
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

  return prisma.$transaction(async (tx) => {
    const result = await tx.attendanceDay.updateMany({
      where: {
        id,
        companyId: actor.companyId,
        version: input.version,
        archivedAt: null,
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
        ...(input.overtimeMinutes !== undefined ? { overtimeMinutes: input.overtimeMinutes } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
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
      action: "attendance.update",
      entityId: id,
      reason: input.reason,
      before: attendanceAuditShape(existing),
      after: attendanceAuditShape(after),
      metadata,
    });
    return toDto(after);
  });
}

export async function archiveAttendance(
  actor: ActorContext,
  id: string,
  input: AttendanceArchiveInput,
  metadata: RequestMetadata,
): Promise<AttendanceRecordDto> {
  requirePermission(actor, "attendance:archive");
  const existing = await prisma.attendanceDay.findFirst({
    where: { id, companyId: actor.companyId },
    select: attendanceSelect,
  });
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy attendance.");
  }
  await assertExistingRecordAccess(actor, existing, true);
  if (existing.archivedAt) {
    return toDto(existing);
  }

  return prisma.$transaction(async (tx) => {
    const result = await tx.attendanceDay.updateMany({
      where: {
        id,
        companyId: actor.companyId,
        version: input.version,
        archivedAt: null,
      },
      data: {
        archivedAt: new Date(),
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

    const after = await tx.attendanceDay.findUniqueOrThrow({
      where: { id },
      select: attendanceSelect,
    });
    await appendAudit(tx, {
      actor,
      action: "attendance.archive",
      entityId: id,
      reason: input.reason,
      before: attendanceAuditShape(existing),
      after: attendanceAuditShape(after),
      metadata,
    });
    return toDto(after);
  });
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
