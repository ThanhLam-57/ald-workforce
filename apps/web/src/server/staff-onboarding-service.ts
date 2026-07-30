import type {
  BranchStaffDto,
  StaffOnboardInput,
  StaffProfileUpdateInput,
  StaffWorkScheduleCreateInput,
  StaffWorkScheduleDto,
  StaffWorkScheduleUpdateInput,
} from "@ald/contracts";
import { prisma, type Prisma } from "@ald/db";
import { DomainError, requirePermission, type ActorContext } from "@ald/domain";

import { parseBusinessDate, toBusinessDate } from "./business-date";
import type { RequestMetadata } from "./request-metadata";
import { safeAssignmentAuditSnapshot, safeStaffAuditSnapshot } from "./staff-audit-snapshot";
import { systemAuditReason } from "./audit-service";

type Transaction = Prisma.TransactionClient;
type Database = Transaction | typeof prisma;

const MACHINE_CODE_CONFLICT_MESSAGE =
  "Mã máy chấm công đã được dùng trong cơ sở ở khoảng thời gian này.";

function machineCodeConflictError(): DomainError {
  return new DomainError("CONFLICT", MACHINE_CODE_CONFLICT_MESSAGE, {
    fieldErrors: {
      attendanceMachineCode: [MACHINE_CODE_CONFLICT_MESSAGE],
    },
  });
}

const scheduleSelect = {
  id: true,
  branchId: true,
  staffId: true,
  name: true,
  scheduledStartMinutes: true,
  scheduledEndMinutes: true,
  spansNextDay: true,
  requiredLiveMinutes: true,
  effectiveFrom: true,
  effectiveTo: true,
  version: true,
} satisfies Prisma.StaffWorkScheduleSelect;

const privateDocumentMetadataSelect = {
  id: true,
  originalFileName: true,
  mimeType: true,
  sizeBytes: true,
  status: true,
  version: true,
  uploadedAt: true,
  verifiedAt: true,
} satisfies Prisma.StaffBankQrDocumentSelect;

const staffAuditSelect = {
  id: true,
  staffCode: true,
  fullName: true,
  streamingAlias: true,
  tiktokChannelId: true,
  email: true,
  phone: true,
  dateOfBirth: true,
  citizenIdNumber: true,
  bankAccountNumber: true,
  bankName: true,
  permanentAddress: true,
  temporaryAddress: true,
  facebookUrl: true,
  university: true,
  jobTitle: true,
  baseSalaryAmount: true,
  joinedDate: true,
  officialDate: true,
  terminationDate: true,
  employmentCategory: true,
  employmentStatus: true,
  version: true,
} satisfies Prisma.StaffMemberSelect;

function optionalText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function normalizeTikTokChannelId(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/^@/, "").toLowerCase();
  return normalized || null;
}

function scheduleDto(
  schedule: Prisma.StaffWorkScheduleGetPayload<{ select: typeof scheduleSelect }>,
): StaffWorkScheduleDto {
  return {
    ...schedule,
    effectiveFrom: schedule.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: schedule.effectiveTo?.toISOString().slice(0, 10) ?? null,
  };
}

function auditJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function appendAudit(
  tx: Transaction,
  input: {
    actor: ActorContext;
    branchId: string;
    action: string;
    entityType: string;
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
      branchId: input.branchId,
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

function assertActorBranch(actor: ActorContext, branchId: string): void {
  if (actor.role === "TRAINING_MANAGER" && !actor.activeBranchIds.includes(branchId)) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy cơ sở trong phạm vi.");
  }
}

export async function listStaffOnboardingBranches(
  actor: ActorContext,
): Promise<readonly Readonly<{ id: string; code: string; name: string }>[]> {
  requirePermission(actor, "staff:read");
  return prisma.branch.findMany({
    where: {
      companyId: actor.companyId,
      isActive: true,
      ...(actor.role === "TRAINING_MANAGER" ? { id: { in: [...actor.activeBranchIds] } } : {}),
    },
    select: { id: true, code: true, name: true },
    orderBy: [{ code: "asc" }, { name: "asc" }],
  });
}

export async function authorizeBranchStaff(
  db: Database,
  actor: ActorContext,
  staffId: string,
  now = new Date(),
  assignmentId?: string,
): Promise<
  Readonly<{
    staffId: string;
    branchId: string;
    assignmentId: string;
    attendanceMachineCode: string | null;
    assignmentVersion: number;
    assignmentEffectiveFrom: Date;
    assignmentEffectiveTo: Date | null;
  }>
> {
  const businessDate = toBusinessDate(now);
  const staff = await db.staffMember.findFirst({
    where: {
      id: staffId,
      companyId: actor.companyId,
      archivedAt: null,
      ...(actor.role === "TRAINING_MANAGER"
        ? {
            assignments: {
              some: {
                branchId: { in: [...actor.activeBranchIds] },
                assignmentType: "MEMBER",
                archivedAt: null,
                effectiveFrom: { lte: businessDate },
                OR: [{ effectiveTo: null }, { effectiveTo: { gt: businessDate } }],
              },
            },
          }
        : {}),
    },
    select: {
      id: true,
      assignments: {
        where: {
          ...(assignmentId ? { id: assignmentId } : {}),
          companyId: actor.companyId,
          assignmentType: "MEMBER",
          archivedAt: null,
          effectiveFrom: { lte: businessDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: businessDate } }],
        },
        orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
        take: 1,
        select: {
          id: true,
          branchId: true,
          attendanceMachineCode: true,
          version: true,
          effectiveFrom: true,
          effectiveTo: true,
        },
      },
    },
  });
  const assignment = staff?.assignments[0];
  const branchId = assignment?.branchId;
  if (!staff || !assignment || !branchId) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy nhân viên trong phạm vi.");
  }
  assertActorBranch(actor, branchId);
  return {
    staffId: staff.id,
    branchId,
    assignmentId: assignment.id,
    attendanceMachineCode: assignment.attendanceMachineCode,
    assignmentVersion: assignment.version,
    assignmentEffectiveFrom: assignment.effectiveFrom,
    assignmentEffectiveTo: assignment.effectiveTo,
  };
}

export async function listBranchStaff(
  actor: ActorContext,
  now = new Date(),
  includeInactive = false,
): Promise<readonly BranchStaffDto[]> {
  requirePermission(actor, "staff:read");
  const businessDate = toBusinessDate(now);
  const mayIncludeHistorical = includeInactive && actor.role === "GENERAL_MANAGER";
  const assignmentScope = {
    assignmentType: "MEMBER" as const,
    archivedAt: null,
    ...(!mayIncludeHistorical
      ? {
          effectiveFrom: { lte: businessDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: businessDate } }],
        }
      : {}),
    ...(actor.role === "TRAINING_MANAGER" ? { branchId: { in: [...actor.activeBranchIds] } } : {}),
  };
  const records = await prisma.staffMember.findMany({
    where: {
      companyId: actor.companyId,
      archivedAt: null,
      ...(!includeInactive ? { employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] } } : {}),
      assignments: {
        some: assignmentScope,
      },
    },
    select: {
      id: true,
      staffCode: true,
      fullName: true,
      streamingAlias: true,
      tiktokChannelId: true,
      email: true,
      phone: true,
      dateOfBirth: true,
      citizenIdNumber: true,
      bankAccountNumber: true,
      bankName: true,
      permanentAddress: true,
      temporaryAddress: true,
      facebookUrl: true,
      university: true,
      jobTitle: true,
      joinedDate: true,
      officialDate: true,
      terminationDate: true,
      employmentCategory: true,
      employmentStatus: true,
      baseSalaryAmount: true,
      version: true,
      assignments: {
        where: assignmentScope,
        orderBy: { effectiveFrom: "desc" },
        take: 1,
        select: {
          id: true,
          attendanceMachineCode: true,
          version: true,
          effectiveFrom: true,
          effectiveTo: true,
          branch: { select: { id: true, code: true, name: true } },
        },
      },
      workSchedules: {
        where: {
          archivedAt: null,
          ...(!mayIncludeHistorical
            ? {
                effectiveFrom: { lte: businessDate },
                OR: [{ effectiveTo: null }, { effectiveTo: { gt: businessDate } }],
              }
            : {}),
        },
        orderBy: { effectiveFrom: "desc" },
        select: scheduleSelect,
      },
      identityDocuments: {
        where: { status: { in: ["PENDING_UPLOAD", "READY", "REJECTED"] } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          side: true,
          originalFileName: true,
          mimeType: true,
          sizeBytes: true,
          status: true,
          version: true,
          uploadedAt: true,
          verifiedAt: true,
        },
      },
      bankQrDocuments: {
        where: { status: { in: ["PENDING_UPLOAD", "READY", "REJECTED"] } },
        orderBy: { createdAt: "desc" },
        select: privateDocumentMetadataSelect,
      },
    },
    orderBy: [{ fullName: "asc" }, { staffCode: "asc" }],
  });

  return records.flatMap((record): readonly BranchStaffDto[] => {
    const assignment = record.assignments[0];
    const branch = assignment?.branch;
    if (!branch || !assignment) return [];
    const currentSchedule = record.workSchedules.find(
      (schedule) => schedule.branchId === branch.id,
    );
    const latestBySide = new Map<
      "CITIZEN_ID_FRONT" | "CITIZEN_ID_BACK",
      (typeof record.identityDocuments)[number]
    >();
    for (const document of record.identityDocuments) {
      const current = latestBySide.get(document.side);
      if (!current || (current.status !== "READY" && document.status === "READY")) {
        latestBySide.set(document.side, document);
      }
    }
    const bankQrDocument =
      record.bankQrDocuments.find((document) => document.status === "READY") ??
      record.bankQrDocuments[0];
    return [
      {
        id: record.id,
        branch,
        staffCode: record.staffCode,
        assignmentId: assignment.id,
        attendanceMachineCode: assignment.attendanceMachineCode,
        assignmentVersion: assignment.version,
        fullName: record.fullName,
        streamingAlias: record.streamingAlias,
        tiktokChannelId: record.tiktokChannelId,
        email: record.email,
        phone: record.phone,
        dateOfBirth: record.dateOfBirth?.toISOString().slice(0, 10) ?? null,
        citizenIdNumber: record.citizenIdNumber,
        bankAccountNumber: record.bankAccountNumber,
        bankName: record.bankName,
        permanentAddress: record.permanentAddress,
        temporaryAddress: record.temporaryAddress,
        facebookUrl: record.facebookUrl,
        university: record.university,
        jobTitle: record.jobTitle,
        joinedDate: record.joinedDate?.toISOString().slice(0, 10) ?? null,
        officialDate: record.officialDate?.toISOString().slice(0, 10) ?? null,
        terminationDate: record.terminationDate?.toISOString().slice(0, 10) ?? null,
        employmentCategory: record.employmentCategory,
        employmentStatus: record.employmentStatus,
        ...(actor.role === "GENERAL_MANAGER"
          ? { baseSalaryAmount: record.baseSalaryAmount.toString() }
          : {}),
        currentSchedule: currentSchedule ? scheduleDto(currentSchedule) : null,
        identityDocuments: [...latestBySide.values()].map((document) => ({
          id: document.id,
          side: document.side,
          originalFileName: document.originalFileName,
          mimeType: document.mimeType as "image/jpeg" | "image/png" | "image/webp",
          sizeBytes: document.sizeBytes.toString(),
          status: document.status,
          version: document.version,
          uploadedAt: document.uploadedAt?.toISOString() ?? null,
          verifiedAt: document.verifiedAt?.toISOString() ?? null,
        })),
        bankQrDocument: bankQrDocument
          ? {
              ...bankQrDocument,
              mimeType: bankQrDocument.mimeType as "image/jpeg" | "image/png" | "image/webp",
              sizeBytes: bankQrDocument.sizeBytes.toString(),
              uploadedAt: bankQrDocument.uploadedAt?.toISOString() ?? null,
              verifiedAt: bankQrDocument.verifiedAt?.toISOString() ?? null,
            }
          : null,
        version: record.version,
      },
    ];
  });
}

export async function onboardStaff(
  actor: ActorContext,
  input: StaffOnboardInput,
  metadata: RequestMetadata,
): Promise<BranchStaffDto> {
  requirePermission(actor, "staff:onboard");
  assertActorBranch(actor, input.branchId);
  if (input.baseSalaryAmount !== undefined && actor.role !== "GENERAL_MANAGER") {
    throw new DomainError("FORBIDDEN", "Bạn không có quyền thiết lập lương cơ bản.");
  }
  const joinedDate = parseBusinessDate(input.joinedDate);
  const officialDate = input.officialDate ? parseBusinessDate(input.officialDate) : null;

  try {
    const staffId = await prisma.$transaction(async (tx) => {
      const branch = await tx.branch.findFirst({
        where: {
          id: input.branchId,
          companyId: actor.companyId,
          isActive: true,
        },
        select: { id: true },
      });
      if (!branch) {
        throw new DomainError("NOT_FOUND", "Không tìm thấy cơ sở đang hoạt động.");
      }
      const duplicateMachineCode = await tx.branchAssignment.findFirst({
        where: {
          companyId: actor.companyId,
          branchId: input.branchId,
          assignmentType: "MEMBER",
          attendanceMachineCode: input.attendanceMachineCode,
          archivedAt: null,
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: joinedDate } }],
        },
        select: { id: true },
      });
      if (duplicateMachineCode) {
        throw machineCodeConflictError();
      }
      const staff = await tx.staffMember.create({
        data: {
          companyId: actor.companyId,
          staffCode: input.staffCode.toUpperCase(),
          fullName: input.fullName,
          streamingAlias: optionalText(input.streamingAlias),
          tiktokChannelId: normalizeTikTokChannelId(input.tiktokChannelId),
          email: input.email?.toLowerCase() ?? null,
          phone: optionalText(input.phone),
          dateOfBirth: input.dateOfBirth ? parseBusinessDate(input.dateOfBirth) : null,
          citizenIdNumber: optionalText(input.citizenIdNumber),
          bankAccountNumber: optionalText(input.bankAccountNumber),
          bankName: optionalText(input.bankName),
          permanentAddress: optionalText(input.permanentAddress),
          temporaryAddress: optionalText(input.temporaryAddress),
          facebookUrl: optionalText(input.facebookUrl),
          university: optionalText(input.university),
          jobTitle: input.jobTitle,
          baseSalaryAmount: BigInt(input.baseSalaryAmount ?? "0"),
          joinedDate,
          officialDate,
          employmentCategory: input.employmentCategory,
        },
        select: staffAuditSelect,
      });
      await tx.staffEmploymentHistory.create({
        data: {
          companyId: actor.companyId,
          staffId: staff.id,
          employmentStatus: "ACTIVE",
          employmentCategory: input.employmentCategory,
          effectiveFrom: joinedDate,
          createdByUserId: actor.userId,
        },
      });
      const assignment = await tx.branchAssignment.create({
        data: {
          companyId: actor.companyId,
          staffId: staff.id,
          branchId: input.branchId,
          assignmentType: "MEMBER",
          attendanceMachineCode: input.attendanceMachineCode,
          effectiveFrom: joinedDate,
        },
      });
      const schedule = await tx.staffWorkSchedule.create({
        data: {
          companyId: actor.companyId,
          branchId: input.branchId,
          staffId: staff.id,
          ...input.initialSchedule,
          effectiveFrom: joinedDate,
          createdByUserId: actor.userId,
        },
        select: scheduleSelect,
      });
      const staffSnapshot = safeStaffAuditSnapshot(staff);
      await appendAudit(tx, {
        actor,
        branchId: input.branchId,
        action: "staff.onboard",
        entityType: "StaffMember",
        entityId: staff.id,
        reason: systemAuditReason("STAFF_ONBOARD"),
        after: {
          ...staffSnapshot,
          changedFields: Object.keys(staffSnapshot),
          assignment: safeAssignmentAuditSnapshot(assignment),
          schedule: {
            id: schedule.id,
            name: schedule.name,
            scheduledStartMinutes: schedule.scheduledStartMinutes,
            scheduledEndMinutes: schedule.scheduledEndMinutes,
            spansNextDay: schedule.spansNextDay,
            requiredLiveMinutes: schedule.requiredLiveMinutes,
            effectiveFrom: input.joinedDate,
          },
        },
        metadata,
      });
      return staff.id;
    });
    const created = (await listBranchStaff(actor)).find((staff) => staff.id === staffId);
    if (!created) {
      throw new DomainError("NOT_FOUND", "Không thể tải lại nhân viên vừa tạo.");
    }
    return created;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      throw new DomainError("CONFLICT", "Mã nhân viên đã tồn tại trong công ty.");
    }
    throw error;
  }
}

export async function updateStaffProfile(
  actor: ActorContext,
  staffId: string,
  input: StaffProfileUpdateInput,
  metadata: RequestMetadata,
  now = new Date(),
): Promise<BranchStaffDto> {
  requirePermission(actor, "staff-profile:update");
  if (input.baseSalaryAmount !== undefined && actor.role !== "GENERAL_MANAGER") {
    throw new DomainError("FORBIDDEN", "Bạn không có quyền cập nhật lương cơ bản.");
  }
  const businessDate = toBusinessDate(now);
  const requestedFields = Object.entries(input)
    .filter(
      ([key, value]) =>
        value !== undefined && !["version", "assignmentId", "assignmentVersion"].includes(key),
    )
    .map(([key]) => key);

  try {
    await prisma.$transaction(
      async (tx) => {
        const scope = await authorizeBranchStaff(tx, actor, staffId, now, input.assignmentId);
        const before = await tx.staffMember.findFirst({
          where: {
            id: staffId,
            companyId: actor.companyId,
            archivedAt: null,
            employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] },
          },
          select: staffAuditSelect,
        });
        if (!before) {
          throw new DomainError("NOT_FOUND", "Không tìm thấy nhân viên trong phạm vi.");
        }
        if (scope.assignmentVersion !== input.assignmentVersion) {
          throw new DomainError(
            "CONFLICT",
            "Phân công đã được cập nhật bởi người khác. Hãy tải lại hồ sơ.",
          );
        }
        if (requestedFields.length === 0) return;

        const joinedDate =
          input.joinedDate === undefined
            ? before.joinedDate
            : input.joinedDate === null
              ? null
              : parseBusinessDate(input.joinedDate);
        const officialDate =
          input.officialDate === undefined
            ? before.officialDate
            : input.officialDate === null
              ? null
              : parseBusinessDate(input.officialDate);
        if (joinedDate && officialDate && officialDate < joinedDate) {
          throw new DomainError(
            "VALIDATION_ERROR",
            "Ngày chính thức phải bằng hoặc sau ngày gia nhập.",
          );
        }

        const data: Prisma.StaffMemberUpdateManyMutationInput = {
          version: { increment: 1 },
        };
        if (input.staffCode !== undefined) data.staffCode = input.staffCode.toUpperCase();
        if (input.fullName !== undefined) data.fullName = input.fullName;
        if (input.streamingAlias !== undefined) {
          data.streamingAlias = optionalText(input.streamingAlias);
        }
        if (input.tiktokChannelId !== undefined) {
          data.tiktokChannelId = normalizeTikTokChannelId(input.tiktokChannelId);
        }
        if (input.email !== undefined) data.email = input.email?.toLowerCase() ?? null;
        if (input.phone !== undefined) data.phone = optionalText(input.phone);
        if (input.dateOfBirth !== undefined) {
          data.dateOfBirth = input.dateOfBirth ? parseBusinessDate(input.dateOfBirth) : null;
        }
        if (input.citizenIdNumber !== undefined) {
          data.citizenIdNumber = optionalText(input.citizenIdNumber);
        }
        if (input.bankAccountNumber !== undefined) {
          data.bankAccountNumber = optionalText(input.bankAccountNumber);
        }
        if (input.bankName !== undefined) data.bankName = optionalText(input.bankName);
        if (input.permanentAddress !== undefined) {
          data.permanentAddress = optionalText(input.permanentAddress);
        }
        if (input.temporaryAddress !== undefined) {
          data.temporaryAddress = optionalText(input.temporaryAddress);
        }
        if (input.facebookUrl !== undefined) {
          data.facebookUrl = optionalText(input.facebookUrl);
        }
        if (input.university !== undefined) data.university = optionalText(input.university);
        if (input.jobTitle !== undefined) data.jobTitle = input.jobTitle;
        if (input.joinedDate !== undefined) data.joinedDate = joinedDate;
        if (input.officialDate !== undefined) data.officialDate = officialDate;
        if (input.employmentCategory !== undefined) {
          data.employmentCategory = input.employmentCategory;
        }
        if (input.baseSalaryAmount !== undefined) {
          data.baseSalaryAmount = BigInt(input.baseSalaryAmount);
        }

        const updated = await tx.staffMember.updateMany({
          where: {
            id: staffId,
            companyId: actor.companyId,
            archivedAt: null,
            version: input.version,
          },
          data,
        });
        if (updated.count !== 1) {
          throw new DomainError(
            "CONFLICT",
            "Hồ sơ đã được cập nhật bởi người khác. Hãy tải lại dữ liệu.",
          );
        }

        if (
          input.attendanceMachineCode !== undefined &&
          input.attendanceMachineCode !== scope.attendanceMachineCode
        ) {
          const isInitialMachineCodeBackfill =
            scope.attendanceMachineCode === null && input.attendanceMachineCode !== null;
          const newEffectiveFrom = isInitialMachineCodeBackfill
            ? scope.assignmentEffectiveFrom
            : scope.assignmentEffectiveFrom < businessDate
              ? businessDate
              : scope.assignmentEffectiveFrom;
          const duplicateMachineCode = await tx.branchAssignment.findFirst({
            where: {
              id: { not: scope.assignmentId },
              companyId: actor.companyId,
              branchId: scope.branchId,
              assignmentType: "MEMBER",
              attendanceMachineCode: input.attendanceMachineCode,
              archivedAt: null,
              ...(scope.assignmentEffectiveTo
                ? { effectiveFrom: { lt: scope.assignmentEffectiveTo } }
                : {}),
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: newEffectiveFrom } }],
            },
            select: { id: true },
          });
          if (duplicateMachineCode) {
            throw machineCodeConflictError();
          }
          if (isInitialMachineCodeBackfill) {
            const assignmentUpdate = await tx.branchAssignment.updateMany({
              where: {
                id: scope.assignmentId,
                companyId: actor.companyId,
                branchId: scope.branchId,
                assignmentType: "MEMBER",
                archivedAt: null,
                version: input.assignmentVersion,
              },
              data: {
                attendanceMachineCode: input.attendanceMachineCode,
                version: { increment: 1 },
              },
            });
            if (assignmentUpdate.count !== 1) {
              throw new DomainError(
                "CONFLICT",
                "Phân công đã được cập nhật bởi người khác. Hãy tải lại hồ sơ.",
              );
            }
          } else if (scope.assignmentEffectiveFrom < businessDate) {
            const assignmentUpdate = await tx.branchAssignment.updateMany({
              where: {
                id: scope.assignmentId,
                companyId: actor.companyId,
                branchId: scope.branchId,
                assignmentType: "MEMBER",
                archivedAt: null,
                version: input.assignmentVersion,
              },
              data: {
                effectiveTo: businessDate,
                version: { increment: 1 },
              },
            });
            if (assignmentUpdate.count !== 1) {
              throw new DomainError(
                "CONFLICT",
                "Phân công đã được cập nhật bởi người khác. Hãy tải lại hồ sơ.",
              );
            }
            await tx.branchAssignment.create({
              data: {
                companyId: actor.companyId,
                branchId: scope.branchId,
                staffId,
                assignmentType: "MEMBER",
                attendanceMachineCode: input.attendanceMachineCode,
                effectiveFrom: businessDate,
                effectiveTo: scope.assignmentEffectiveTo,
              },
            });
          } else {
            const assignmentUpdate = await tx.branchAssignment.updateMany({
              where: {
                id: scope.assignmentId,
                companyId: actor.companyId,
                branchId: scope.branchId,
                assignmentType: "MEMBER",
                archivedAt: null,
                version: input.assignmentVersion,
              },
              data: {
                attendanceMachineCode: input.attendanceMachineCode,
                version: { increment: 1 },
              },
            });
            if (assignmentUpdate.count !== 1) {
              throw new DomainError(
                "CONFLICT",
                "Phân công đã được cập nhật bởi người khác. Hãy tải lại hồ sơ.",
              );
            }
          }
        }

        if (
          input.employmentCategory !== undefined &&
          input.employmentCategory !== before.employmentCategory
        ) {
          const currentHistory = await tx.staffEmploymentHistory.findFirst({
            where: {
              companyId: actor.companyId,
              staffId,
              effectiveFrom: { lte: businessDate },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: businessDate } }],
            },
            orderBy: { effectiveFrom: "desc" },
          });
          if (currentHistory?.effectiveFrom.getTime() === businessDate.getTime()) {
            await tx.staffEmploymentHistory.update({
              where: { id: currentHistory.id },
              data: {
                employmentCategory: input.employmentCategory,
                version: { increment: 1 },
              },
            });
          } else {
            if (currentHistory) {
              await tx.staffEmploymentHistory.update({
                where: { id: currentHistory.id },
                data: { effectiveTo: businessDate, version: { increment: 1 } },
              });
            }
            await tx.staffEmploymentHistory.create({
              data: {
                companyId: actor.companyId,
                staffId,
                employmentStatus: before.employmentStatus,
                employmentCategory: input.employmentCategory,
                effectiveFrom: businessDate,
                createdByUserId: actor.userId,
              },
            });
          }
        }

        const [after, assignmentAfter] = await Promise.all([
          tx.staffMember.findUniqueOrThrow({
            where: { id: staffId },
            select: staffAuditSelect,
          }),
          tx.branchAssignment.findFirstOrThrow({
            where: {
              companyId: actor.companyId,
              branchId: scope.branchId,
              staffId,
              assignmentType: "MEMBER",
              archivedAt: null,
              effectiveFrom: { lte: businessDate },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: businessDate } }],
            },
            orderBy: { effectiveFrom: "desc" },
          }),
        ]);
        const assignmentBefore = safeAssignmentAuditSnapshot({
          id: scope.assignmentId,
          branchId: scope.branchId,
          staffId,
          assignmentType: "MEMBER",
          attendanceMachineCode: scope.attendanceMachineCode,
          effectiveFrom: scope.assignmentEffectiveFrom,
          effectiveTo: scope.assignmentEffectiveTo,
          version: scope.assignmentVersion,
        });
        await appendAudit(tx, {
          actor,
          branchId: scope.branchId,
          action: "staff.profile.update",
          entityType: "StaffMember",
          entityId: staffId,
          reason: systemAuditReason("STAFF_PROFILE_UPDATED_FROM_UI"),
          before: {
            ...safeStaffAuditSnapshot(before),
            assignment: assignmentBefore,
          },
          after: {
            ...safeStaffAuditSnapshot(after),
            changedFields: requestedFields,
            containsSensitiveFields: requestedFields.some((field) =>
              ["citizenIdNumber", "bankAccountNumber", "baseSalaryAmount"].includes(field),
            ),
            assignment: safeAssignmentAuditSnapshot(assignmentAfter),
          },
          metadata,
        });
      },
      { maxWait: 10_000, timeout: 30_000 },
    );

    const updated = (await listBranchStaff(actor, now)).find((staff) => staff.id === staffId);
    if (!updated) {
      throw new DomainError("NOT_FOUND", "Không tìm thấy hồ sơ vừa cập nhật.");
    }
    return updated;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      if (error.code === "P2002") {
        throw new DomainError("CONFLICT", "Mã hồ sơ hoặc số CCCD đã tồn tại trong công ty.");
      }
      if (error.code === "P2004") {
        throw machineCodeConflictError();
      }
    }
    throw error;
  }
}

export async function listStaffWorkSchedules(
  actor: ActorContext,
  staffId: string,
): Promise<readonly StaffWorkScheduleDto[]> {
  requirePermission(actor, "staff-schedule:read");
  const scope = await authorizeBranchStaff(prisma, actor, staffId);
  const schedules = await prisma.staffWorkSchedule.findMany({
    where: {
      companyId: actor.companyId,
      branchId: scope.branchId,
      staffId,
      archivedAt: null,
    },
    select: scheduleSelect,
    orderBy: { effectiveFrom: "desc" },
  });
  return schedules.map(scheduleDto);
}

export async function createStaffWorkSchedule(
  actor: ActorContext,
  staffId: string,
  input: StaffWorkScheduleCreateInput,
  metadata: RequestMetadata,
): Promise<StaffWorkScheduleDto> {
  requirePermission(actor, "staff-schedule:write");
  const scope = await authorizeBranchStaff(prisma, actor, staffId);
  const effectiveFrom = parseBusinessDate(input.effectiveFrom);
  const requestedEffectiveTo = input.effectiveTo ? parseBusinessDate(input.effectiveTo) : null;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT 1::integer
      FROM pg_advisory_xact_lock(
        hashtextextended(${`staff-schedule:${actor.companyId}:${staffId}`}, 0)
      )
    `;
    const containing = await tx.staffWorkSchedule.findFirst({
      where: {
        companyId: actor.companyId,
        staffId,
        archivedAt: null,
        effectiveFrom: { lt: effectiveFrom },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
      },
      orderBy: { effectiveFrom: "desc" },
      select: scheduleSelect,
    });
    const next = await tx.staffWorkSchedule.findFirst({
      where: {
        companyId: actor.companyId,
        staffId,
        archivedAt: null,
        effectiveFrom: { gte: effectiveFrom },
      },
      orderBy: { effectiveFrom: "asc" },
      select: scheduleSelect,
    });
    if (next?.effectiveFrom.getTime() === effectiveFrom.getTime()) {
      throw new DomainError("CONFLICT", "Nhân viên đã có ca bắt đầu từ ngày này.");
    }
    const effectiveTo = requestedEffectiveTo ?? next?.effectiveFrom ?? null;
    if (effectiveTo && effectiveTo <= effectiveFrom) {
      throw new DomainError("CONFLICT", "Khoảng hiệu lực ca bị trùng với ca kế tiếp.");
    }
    if (containing) {
      await tx.staffWorkSchedule.update({
        where: { id: containing.id },
        data: { effectiveTo: effectiveFrom, version: { increment: 1 } },
      });
    }
    const created = await tx.staffWorkSchedule.create({
      data: {
        companyId: actor.companyId,
        branchId: scope.branchId,
        staffId,
        name: input.name,
        scheduledStartMinutes: input.scheduledStartMinutes,
        scheduledEndMinutes: input.scheduledEndMinutes,
        spansNextDay: input.spansNextDay,
        requiredLiveMinutes: input.requiredLiveMinutes,
        effectiveFrom,
        effectiveTo,
        createdByUserId: actor.userId,
      },
      select: scheduleSelect,
    });
    await appendAudit(tx, {
      actor,
      branchId: scope.branchId,
      action: "staff.schedule.create",
      entityType: "StaffWorkSchedule",
      entityId: created.id,
      reason: systemAuditReason("STAFF_SCHEDULE_CREATED_FROM_UI"),
      after: { ...scheduleDto(created) },
      metadata,
    });
    return scheduleDto(created);
  });
}

export async function updateStaffWorkSchedule(
  actor: ActorContext,
  staffId: string,
  scheduleId: string,
  input: StaffWorkScheduleUpdateInput,
  metadata: RequestMetadata,
): Promise<StaffWorkScheduleDto> {
  requirePermission(actor, "staff-schedule:write");
  const scope = await authorizeBranchStaff(prisma, actor, staffId);
  const effectiveFrom = parseBusinessDate(input.effectiveFrom);
  const effectiveTo = input.effectiveTo ? parseBusinessDate(input.effectiveTo) : null;
  return prisma.$transaction(async (tx) => {
    const before = await tx.staffWorkSchedule.findFirst({
      where: {
        id: scheduleId,
        companyId: actor.companyId,
        staffId,
        branchId: scope.branchId,
        archivedAt: null,
      },
      select: scheduleSelect,
    });
    if (!before) throw new DomainError("NOT_FOUND", "Không tìm thấy ca làm.");
    const overlap = await tx.staffWorkSchedule.count({
      where: {
        id: { not: scheduleId },
        companyId: actor.companyId,
        staffId,
        archivedAt: null,
        ...(effectiveTo ? { effectiveFrom: { lt: effectiveTo } } : {}),
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
      },
    });
    if (overlap > 0) {
      throw new DomainError("CONFLICT", "Khoảng hiệu lực ca bị trùng với ca khác.");
    }
    const result = await tx.staffWorkSchedule.updateMany({
      where: {
        id: scheduleId,
        companyId: actor.companyId,
        staffId,
        branchId: scope.branchId,
        version: input.version,
        archivedAt: null,
      },
      data: {
        name: input.name,
        scheduledStartMinutes: input.scheduledStartMinutes,
        scheduledEndMinutes: input.scheduledEndMinutes,
        spansNextDay: input.spansNextDay,
        requiredLiveMinutes: input.requiredLiveMinutes,
        effectiveFrom,
        effectiveTo,
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) {
      throw new DomainError("CONFLICT", "Ca làm đã được cập nhật bởi người khác.");
    }
    const after = await tx.staffWorkSchedule.findUniqueOrThrow({
      where: { id: scheduleId },
      select: scheduleSelect,
    });
    await appendAudit(tx, {
      actor,
      branchId: scope.branchId,
      action: "staff.schedule.update",
      entityType: "StaffWorkSchedule",
      entityId: after.id,
      reason: systemAuditReason("STAFF_SCHEDULE_UPDATED_FROM_UI"),
      before: { ...scheduleDto(before) },
      after: { ...scheduleDto(after) },
      metadata,
    });
    return scheduleDto(after);
  });
}
