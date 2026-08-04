import type {
  AssignmentCancelInput,
  AssignmentCreateInput,
  AssignmentTransferInput,
  AssignmentUpdateInput,
  BranchCreateInput,
  BranchUpdateInput,
  StaffArchiveInput,
  StaffCreateInput,
  StaffTerminateInput,
  StaffUpdateInput,
  UserCreateInput,
  UserUpdateInput,
} from "@ald/contracts";
import { prisma, type Prisma } from "@ald/db";
import { DomainError, requirePermission, type ActorContext, type AuthRole } from "@ald/domain";

import { auth } from "./auth";
import { systemAuditReason } from "./audit-service";
import { parseBusinessDate, toBusinessDate } from "./business-date";
import type { RequestMetadata } from "./request-metadata";
import { enforceSensitiveMutationRateLimit } from "./sensitive-rate-limit";
import {
  safeAssignmentAuditSnapshot,
  safeStaffAuditSnapshot,
} from "./staff-audit-snapshot";

type Transaction = Prisma.TransactionClient;

const branchSelect = {
  id: true,
  code: true,
  name: true,
  address: true,
  isActive: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BranchSelect;

const staffDirectorySelect = {
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
  version: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StaffMemberSelect;

const staffSelect = {
  ...staffDirectorySelect,
  baseSalaryAmount: true,
} satisfies Prisma.StaffMemberSelect;

type SelectedStaff = Prisma.StaffMemberGetPayload<{ select: typeof staffSelect }>;

function staffResponse(staff: SelectedStaff) {
  return {
    ...staff,
    baseSalaryAmount: staff.baseSalaryAmount.toString(),
    joinedDate: staff.joinedDate?.toISOString().slice(0, 10) ?? null,
    officialDate: staff.officialDate?.toISOString().slice(0, 10) ?? null,
    terminationDate: staff.terminationDate?.toISOString().slice(0, 10) ?? null,
    dateOfBirth: staff.dateOfBirth?.toISOString().slice(0, 10) ?? null,
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
    entityType: string;
    entityId: string;
    reason: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    metadata: RequestMetadata;
  },
): Promise<void> {
  const snapshotBranchId = input.after?.branchId ?? input.before?.branchId;
  const branchId =
    input.entityType === "Branch"
      ? input.entityId
      : typeof snapshotBranchId === "string"
        ? snapshotBranchId
        : undefined;
  await tx.auditLog.create({
    data: {
      companyId: input.actor.companyId,
      ...(branchId ? { branchId } : {}),
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

function branchAuditShape(branch: {
  code: string;
  name: string;
  address: string | null;
  isActive: boolean;
  version: number;
}): Record<string, unknown> {
  return {
    code: branch.code,
    name: branch.name,
    address: branch.address,
    isActive: branch.isActive,
    version: branch.version,
  };
}

export async function listBranches(actor: ActorContext) {
  requirePermission(actor, "branch:read");
  return prisma.branch.findMany({
    where: {
      companyId: actor.companyId,
      ...(actor.role === "TRAINING_MANAGER" ? { id: { in: [...actor.activeBranchIds] } } : {}),
    },
    select: branchSelect,
    orderBy: [{ isActive: "desc" }, { code: "asc" }],
  });
}

export async function getBranch(actor: ActorContext, id: string) {
  requirePermission(actor, "branch:read");
  if (actor.role === "TRAINING_MANAGER" && !actor.activeBranchIds.includes(id)) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy cơ sở.");
  }
  const branch = await prisma.branch.findFirst({
    where: {
      id,
      companyId: actor.companyId,
    },
    select: branchSelect,
  });
  if (!branch) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy cơ sở.");
  }
  return branch;
}

export async function createBranch(
  actor: ActorContext,
  input: BranchCreateInput,
  metadata: RequestMetadata,
) {
  requirePermission(actor, "branch:create");
  return prisma.$transaction(async (tx) => {
    const branch = await tx.branch.create({
      data: {
        companyId: actor.companyId,
        code: input.code.toUpperCase(),
        name: input.name,
        address: input.address || null,
      },
      select: branchSelect,
    });

    await appendAudit(tx, {
      actor,
      action: "branch.create",
      entityType: "Branch",
      entityId: branch.id,
      reason: systemAuditReason("BRANCH_CREATED_FROM_UI"),
      after: branchAuditShape(branch),
      metadata,
    });

    return branch;
  });
}

export async function updateBranch(
  actor: ActorContext,
  id: string,
  input: BranchUpdateInput,
  metadata: RequestMetadata,
  now = new Date(),
) {
  requirePermission(actor, "branch:update");
  return prisma.$transaction(async (tx) => {
    const before = await tx.branch.findFirst({
      where: { id, companyId: actor.companyId },
      select: branchSelect,
    });
    if (!before) {
      throw new DomainError("NOT_FOUND", "Không tìm thấy cơ sở.");
    }
    if (before.isActive && input.isActive === false) {
      const businessDate = toBusinessDate(now);
      const activeAssignments = await tx.branchAssignment.count({
        where: {
          companyId: actor.companyId,
          branchId: id,
          archivedAt: null,
          effectiveFrom: { lte: businessDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: businessDate } }],
        },
      });
      if (activeAssignments > 0) {
        throw new DomainError(
          "CONFLICT",
          `Cơ sở còn ${activeAssignments} phân công hiệu lực. Hãy kết thúc hoặc chuyển phân công trước.`,
          { activeAssignments },
        );
      }
    }

    const data: Prisma.BranchUpdateManyMutationInput = {
      version: { increment: 1 },
    };
    if (input.name !== undefined) data.name = input.name;
    if (input.address !== undefined) data.address = input.address || null;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    const result = await tx.branch.updateMany({
      where: { id, companyId: actor.companyId, version: input.version },
      data,
    });
    if (result.count !== 1) {
      throw new DomainError("CONFLICT", "Cơ sở đã được cập nhật bởi người khác.");
    }

    const after = await tx.branch.findUniqueOrThrow({ where: { id }, select: branchSelect });
    await appendAudit(tx, {
      actor,
      action:
        before.isActive !== after.isActive
          ? after.isActive
            ? "branch.reactivate"
            : "branch.deactivate"
          : "branch.update",
      entityType: "Branch",
      entityId: id,
      reason: systemAuditReason(
        before.isActive !== after.isActive
          ? after.isActive
            ? "BRANCH_REACTIVATED_FROM_UI"
            : "BRANCH_DEACTIVATED_FROM_UI"
          : "BRANCH_UPDATED_FROM_UI",
      ),
      before: branchAuditShape(before),
      after: branchAuditShape(after),
      metadata,
    });
    return after;
  });
}

export async function listStaff(actor: ActorContext, now: Date) {
  requirePermission(actor, "staff:read");
  const businessDate = toBusinessDate(now);
  return prisma.staffMember.findMany({
    where: {
      companyId: actor.companyId,
      archivedAt: null,
      ...(actor.role === "TRAINING_MANAGER"
        ? {
            assignments: {
              some: {
                branchId: { in: [...actor.activeBranchIds] },
                archivedAt: null,
                effectiveFrom: { lte: businessDate },
                OR: [{ effectiveTo: null }, { effectiveTo: { gt: businessDate } }],
              },
            },
          }
        : {}),
    },
    select: staffDirectorySelect,
    orderBy: [{ employmentStatus: "asc" }, { staffCode: "asc" }],
  });
}

export async function createStaff(
  actor: ActorContext,
  input: StaffCreateInput,
  metadata: RequestMetadata,
) {
  requirePermission(actor, "staff:create");
  return prisma.$transaction(async (tx) => {
    const joinedDate = parseBusinessDate(input.joinedDate);
    const officialDate = input.officialDate ? parseBusinessDate(input.officialDate) : null;
    const duplicate = await tx.staffMember.findFirst({
      where: {
        companyId: actor.companyId,
        OR: [
          { staffCode: input.staffCode.toUpperCase() },
          ...(input.citizenIdNumber ? [{ citizenIdNumber: input.citizenIdNumber }] : []),
        ],
      },
      select: { staffCode: true, citizenIdNumber: true },
    });
    if (duplicate) {
      throw new DomainError(
        "CONFLICT",
        duplicate.staffCode === input.staffCode.toUpperCase()
          ? "Mã hồ sơ đã tồn tại trong công ty."
          : "Số CCCD/CMND đã tồn tại trong công ty.",
      );
    }
    const staff = await tx.staffMember.create({
      data: {
        companyId: actor.companyId,
        staffCode: input.staffCode.toUpperCase(),
        fullName: input.fullName,
        streamingAlias: input.streamingAlias || null,
        tiktokChannelId: input.tiktokChannelId ?? null,
        email: input.email?.toLowerCase() ?? null,
        phone: input.phone || null,
        dateOfBirth: input.dateOfBirth ? parseBusinessDate(input.dateOfBirth) : null,
        citizenIdNumber: input.citizenIdNumber || null,
        bankAccountNumber: input.bankAccountNumber || null,
        bankName: input.bankName || null,
        permanentAddress: input.permanentAddress || null,
        temporaryAddress: input.temporaryAddress || null,
        facebookUrl: input.facebookUrl || null,
        university: input.university || null,
        jobTitle: input.jobTitle,
        baseSalaryAmount: BigInt(input.baseSalaryAmount ?? "0"),
        joinedDate,
        officialDate,
        employmentCategory: input.employmentCategory,
      },
      select: staffSelect,
    });
    await tx.staffEmploymentHistory.create({
      data: {
        companyId: actor.companyId,
        staffId: staff.id,
        employmentStatus: staff.employmentStatus,
        employmentCategory: staff.employmentCategory,
        effectiveFrom: joinedDate,
        createdByUserId: actor.userId,
      },
    });
    const auditSnapshot = safeStaffAuditSnapshot(staff);
    await appendAudit(tx, {
      actor,
      action: "staff.create",
      entityType: "StaffMember",
      entityId: staff.id,
      reason: systemAuditReason("STAFF_CREATED_FROM_UI"),
      after: {
        ...auditSnapshot,
        changedFields: Object.keys(auditSnapshot),
      },
      metadata,
    });
    return staffResponse(staff);
  });
}

export async function updateStaff(
  actor: ActorContext,
  id: string,
  input: StaffUpdateInput,
  metadata: RequestMetadata,
  now = new Date(),
) {
  requirePermission(actor, "staff:update");
  return prisma.$transaction(
    async (tx) => {
      const before = await tx.staffMember.findFirst({
        where: { id, companyId: actor.companyId, archivedAt: null },
        select: staffSelect,
      });
      if (!before) {
        throw new DomainError("NOT_FOUND", "Không tìm thấy nhân sự.");
      }
      if (input.staffCode !== undefined) {
        const normalizedStaffCode = input.staffCode.toUpperCase();
        const duplicateStaffCode = await tx.staffMember.findFirst({
          where: {
            id: { not: id },
            companyId: actor.companyId,
            staffCode: normalizedStaffCode,
          },
          select: { id: true },
        });
        if (duplicateStaffCode) {
          throw new DomainError("CONFLICT", "Mã hồ sơ đã tồn tại trong công ty.");
        }
      }
      if (input.citizenIdNumber) {
        const duplicateCitizenId = await tx.staffMember.findFirst({
          where: {
            id: { not: id },
            companyId: actor.companyId,
            citizenIdNumber: input.citizenIdNumber,
          },
          select: { id: true },
        });
        if (duplicateCitizenId) {
          throw new DomainError("CONFLICT", "Số CCCD/CMND đã tồn tại trong công ty.");
        }
      }

      if (
        input.employmentStatus === "TERMINATED" ||
        (before.employmentStatus === "TERMINATED" && input.employmentStatus !== undefined)
      ) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "Hãy dùng thao tác “Cho nghỉ việc” để cập nhật trạng thái và ngày nghỉ việc.",
        );
      }

      const data: Prisma.StaffMemberUpdateManyMutationInput = {
        version: { increment: 1 },
      };
      if (input.staffCode !== undefined) data.staffCode = input.staffCode.toUpperCase();
      if (input.fullName !== undefined) data.fullName = input.fullName;
      if (input.streamingAlias !== undefined) {
        data.streamingAlias = input.streamingAlias || null;
      }
      if (input.tiktokChannelId !== undefined) data.tiktokChannelId = input.tiktokChannelId;
      if (input.email !== undefined) data.email = input.email?.toLowerCase() ?? null;
      if (input.phone !== undefined) data.phone = input.phone || null;
      if (input.dateOfBirth !== undefined) {
        data.dateOfBirth = input.dateOfBirth ? parseBusinessDate(input.dateOfBirth) : null;
      }
      if (input.citizenIdNumber !== undefined) {
        data.citizenIdNumber = input.citizenIdNumber || null;
      }
      if (input.bankAccountNumber !== undefined) {
        data.bankAccountNumber = input.bankAccountNumber || null;
      }
      if (input.bankName !== undefined) data.bankName = input.bankName || null;
      if (input.permanentAddress !== undefined) {
        data.permanentAddress = input.permanentAddress || null;
      }
      if (input.temporaryAddress !== undefined) {
        data.temporaryAddress = input.temporaryAddress || null;
      }
      if (input.facebookUrl !== undefined) data.facebookUrl = input.facebookUrl || null;
      if (input.university !== undefined) data.university = input.university || null;
      if (input.jobTitle !== undefined) data.jobTitle = input.jobTitle;
      if (input.baseSalaryAmount !== undefined) {
        data.baseSalaryAmount = BigInt(input.baseSalaryAmount);
      }
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
          "Ngày lên chính thức phải bằng hoặc sau ngày gia nhập công ty.",
        );
      }
      if (input.joinedDate !== undefined) data.joinedDate = joinedDate;
      if (input.officialDate !== undefined) data.officialDate = officialDate;
      const changesEmployment =
        input.employmentStatus !== undefined || input.employmentCategory !== undefined;
      const effectiveFrom = input.effectiveFrom ? parseBusinessDate(input.effectiveFrom) : null;
      const businessDate = toBusinessDate(now);
      if (changesEmployment && (!effectiveFrom || effectiveFrom > businessDate)) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "Ngày hiệu lực việc làm là bắt buộc và không được nằm trong tương lai.",
        );
      }

      const result = await tx.staffMember.updateMany({
        where: { id, companyId: actor.companyId, version: input.version, archivedAt: null },
        data,
      });
      if (result.count !== 1) {
        throw new DomainError("CONFLICT", "Nhân sự đã được cập nhật bởi người khác.");
      }

      if (changesEmployment && effectiveFrom) {
        const currentAtEffectiveDate = await tx.staffEmploymentHistory.findFirst({
          where: {
            companyId: actor.companyId,
            staffId: id,
            effectiveFrom: { lte: effectiveFrom },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
          },
          orderBy: { effectiveFrom: "desc" },
        });
        const nextHistory = await tx.staffEmploymentHistory.findFirst({
          where: {
            companyId: actor.companyId,
            staffId: id,
            effectiveFrom: { gt: effectiveFrom },
          },
          orderBy: { effectiveFrom: "asc" },
        });
        const nextStatus =
          input.employmentStatus ??
          currentAtEffectiveDate?.employmentStatus ??
          before.employmentStatus;
        const nextCategory =
          input.employmentCategory ??
          currentAtEffectiveDate?.employmentCategory ??
          before.employmentCategory;

        if (currentAtEffectiveDate?.effectiveFrom.getTime() === effectiveFrom.getTime()) {
          await tx.staffEmploymentHistory.update({
            where: { id: currentAtEffectiveDate.id },
            data: {
              employmentStatus: nextStatus,
              employmentCategory: nextCategory,
              version: { increment: 1 },
            },
          });
        } else {
          if (currentAtEffectiveDate) {
            await tx.staffEmploymentHistory.update({
              where: { id: currentAtEffectiveDate.id },
              data: { effectiveTo: effectiveFrom, version: { increment: 1 } },
            });
          }
          await tx.staffEmploymentHistory.create({
            data: {
              companyId: actor.companyId,
              staffId: id,
              employmentStatus: nextStatus,
              employmentCategory: nextCategory,
              effectiveFrom,
              effectiveTo: nextHistory?.effectiveFrom ?? null,
              createdByUserId: actor.userId,
            },
          });
        }
        const effectiveToday = await tx.staffEmploymentHistory.findFirstOrThrow({
          where: {
            companyId: actor.companyId,
            staffId: id,
            effectiveFrom: { lte: businessDate },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: businessDate } }],
          },
          orderBy: { effectiveFrom: "desc" },
        });
        await tx.staffMember.update({
          where: { id },
          data: {
            employmentStatus: effectiveToday.employmentStatus,
            employmentCategory: effectiveToday.employmentCategory,
          },
        });
      }
      const after = await tx.staffMember.findUniqueOrThrow({ where: { id }, select: staffSelect });
      const auditAssignment = await tx.branchAssignment.findFirst({
        where: {
          companyId: actor.companyId,
          staffId: id,
          archivedAt: null,
          effectiveFrom: { lte: businessDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: businessDate } }],
        },
        orderBy: { effectiveFrom: "desc" },
      });
      const assignmentSnapshot = auditAssignment
        ? safeAssignmentAuditSnapshot(auditAssignment)
        : null;
      await appendAudit(tx, {
        actor,
        action: changesEmployment ? "staff.status-change" : "staff.update",
        entityType: "StaffMember",
        entityId: id,
        reason: systemAuditReason(
          changesEmployment ? "STAFF_STATUS_UPDATED_FROM_UI" : "STAFF_UPDATED_FROM_UI",
        ),
        before: {
          ...safeStaffAuditSnapshot(before),
          ...(auditAssignment ? { branchId: auditAssignment.branchId } : {}),
          ...(assignmentSnapshot ? { assignment: assignmentSnapshot } : {}),
        },
        after: {
          ...safeStaffAuditSnapshot(after),
          ...(auditAssignment ? { branchId: auditAssignment.branchId } : {}),
          ...(assignmentSnapshot ? { assignment: assignmentSnapshot } : {}),
          changedFields: Object.keys(input).filter(
            (field) => !["version", "effectiveFrom"].includes(field),
          ),
        },
        metadata,
      });
      return staffResponse(after);
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

export async function terminateStaff(
  actor: ActorContext,
  id: string,
  input: StaffTerminateInput,
  metadata: RequestMetadata,
  now = new Date(),
) {
  requirePermission(actor, "staff:update");
  const terminationDate = parseBusinessDate(input.terminationDate);
  const businessDate = toBusinessDate(now);
  if (terminationDate > businessDate) {
    throw new DomainError("VALIDATION_ERROR", "Ngày nghỉ việc không được nằm trong tương lai.");
  }
  const assignmentCutoff = new Date(
    Date.UTC(terminationDate.getUTCFullYear(), terminationDate.getUTCMonth() + 1, 1),
  );

  return prisma.$transaction(
    async (tx) => {
      const before = await tx.staffMember.findFirst({
        where: { id, companyId: actor.companyId, archivedAt: null },
        select: staffSelect,
      });
      if (!before) {
        throw new DomainError("NOT_FOUND", "Không tìm thấy nhân viên.");
      }
      if (before.joinedDate && terminationDate < before.joinedDate) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "Ngày nghỉ việc không được trước ngày gia nhập công ty.",
        );
      }
      if (before.employmentStatus === "TERMINATED" && before.terminationDate) {
        throw new DomainError(
          "CONFLICT",
          "Nhân viên đã có ngày nghỉ việc. Không thể thực hiện lại thao tác cho nghỉ việc.",
        );
      }

      const updated = await tx.staffMember.updateMany({
        where: {
          id,
          companyId: actor.companyId,
          archivedAt: null,
          version: input.version,
        },
        data: {
          employmentStatus: "TERMINATED",
          terminationDate,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new DomainError(
          "CONFLICT",
          "Hồ sơ nhân viên đã được cập nhật bởi người khác. Hãy tải lại.",
        );
      }

      const currentHistory = await tx.staffEmploymentHistory.findFirst({
        where: {
          companyId: actor.companyId,
          staffId: id,
          effectiveFrom: { lte: terminationDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: terminationDate } }],
        },
        orderBy: { effectiveFrom: "desc" },
      });
      const nextHistory = await tx.staffEmploymentHistory.findFirst({
        where: {
          companyId: actor.companyId,
          staffId: id,
          effectiveFrom: { gt: terminationDate },
        },
        orderBy: { effectiveFrom: "asc" },
      });

      if (currentHistory?.effectiveFrom.getTime() === terminationDate.getTime()) {
        await tx.staffEmploymentHistory.update({
          where: { id: currentHistory.id },
          data: { employmentStatus: "TERMINATED", version: { increment: 1 } },
        });
      } else {
        if (currentHistory) {
          await tx.staffEmploymentHistory.update({
            where: { id: currentHistory.id },
            data: { effectiveTo: terminationDate, version: { increment: 1 } },
          });
        }
        await tx.staffEmploymentHistory.create({
          data: {
            companyId: actor.companyId,
            staffId: id,
            employmentStatus: "TERMINATED",
            employmentCategory: currentHistory?.employmentCategory ?? before.employmentCategory,
            effectiveFrom: terminationDate,
            effectiveTo: nextHistory?.effectiveFrom ?? null,
            createdByUserId: actor.userId,
          },
        });
      }
      await tx.staffEmploymentHistory.updateMany({
        where: {
          companyId: actor.companyId,
          staffId: id,
          effectiveFrom: { gt: terminationDate },
          employmentStatus: { not: "TERMINATED" },
        },
        data: { employmentStatus: "TERMINATED", version: { increment: 1 } },
      });

      const endedAssignments = await tx.branchAssignment.updateMany({
        where: {
          companyId: actor.companyId,
          staffId: id,
          archivedAt: null,
          effectiveFrom: { lt: assignmentCutoff },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: assignmentCutoff } }],
        },
        data: { effectiveTo: assignmentCutoff, version: { increment: 1 } },
      });
      const cancelledFutureAssignments = await tx.branchAssignment.updateMany({
        where: {
          companyId: actor.companyId,
          staffId: id,
          archivedAt: null,
          effectiveFrom: { gte: assignmentCutoff },
        },
        data: { archivedAt: now, version: { increment: 1 } },
      });

      const linkedUser = await tx.user.findFirst({
        where: { companyId: actor.companyId, staffId: id },
        select: { id: true },
      });
      if (linkedUser) {
        await tx.user.update({
          where: { id: linkedUser.id },
          data: { active: false, version: { increment: 1 } },
        });
        await tx.session.deleteMany({ where: { userId: linkedUser.id } });
      }

      const after = await tx.staffMember.findUniqueOrThrow({
        where: { id },
        select: staffSelect,
      });
      await appendAudit(tx, {
        actor,
        action: "staff.terminate",
        entityType: "StaffMember",
        entityId: id,
        reason: systemAuditReason("STAFF_TERMINATED_FROM_UI"),
        before: safeStaffAuditSnapshot(before),
        after: {
          ...safeStaffAuditSnapshot(after),
          assignmentCutoff: assignmentCutoff.toISOString().slice(0, 10),
          endedAssignments: endedAssignments.count,
          cancelledFutureAssignments: cancelledFutureAssignments.count,
          disabledUserId: linkedUser?.id ?? null,
          sessionsRevoked: linkedUser !== null,
        },
        metadata,
      });
      return staffResponse(after);
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

export async function archiveStaff(
  actor: ActorContext,
  id: string,
  input: StaffArchiveInput,
  metadata: RequestMetadata,
  now = new Date(),
) {
  requirePermission(actor, "staff:update");
  return prisma.$transaction(async (tx) => {
    const before = await tx.staffMember.findFirst({
      where: { id, companyId: actor.companyId, archivedAt: null },
      select: staffSelect,
    });
    if (!before) throw new DomainError("NOT_FOUND", "Không tìm thấy nhân sự.");
    if (before.employmentStatus !== "TERMINATED") {
      throw new DomainError("CONFLICT", "Chỉ có thể lưu trữ nhân viên đã nghỉ việc.");
    }
    const businessDate = toBusinessDate(now);
    const [activeAssignments, activeUser] = await Promise.all([
      tx.branchAssignment.count({
        where: {
          companyId: actor.companyId,
          staffId: id,
          archivedAt: null,
          effectiveFrom: { lte: businessDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: businessDate } }],
        },
      }),
      tx.user.count({ where: { companyId: actor.companyId, staffId: id, active: true } }),
    ]);
    if (activeAssignments > 0 || activeUser > 0) {
      throw new DomainError(
        "CONFLICT",
        "Hãy kết thúc phân công và vô hiệu hóa tài khoản trước khi lưu trữ nhân viên.",
        { activeAssignments, activeUser },
      );
    }
    const archivedAt = new Date();
    const result = await tx.staffMember.updateMany({
      where: {
        id,
        companyId: actor.companyId,
        archivedAt: null,
        version: input.version,
      },
      data: { archivedAt, version: { increment: 1 } },
    });
    if (result.count !== 1) {
      throw new DomainError("CONFLICT", "Nhân sự đã được cập nhật bởi người khác.");
    }
    const after = {
      ...safeStaffAuditSnapshot(before),
      archivedAt: archivedAt.toISOString(),
      version: before.version + 1,
    };
    await appendAudit(tx, {
      actor,
      action: "staff.archive",
      entityType: "StaffMember",
      entityId: id,
      reason: systemAuditReason("STAFF_ARCHIVED_FROM_UI"),
      before: safeStaffAuditSnapshot(before),
      after,
      metadata,
    });
    return { id, archivedAt: archivedAt.toISOString(), version: before.version + 1 };
  });
}

export async function createAssignment(
  actor: ActorContext,
  input: AssignmentCreateInput,
  metadata: RequestMetadata,
) {
  requirePermission(actor, "assignment:create");
  const effectiveFrom = parseBusinessDate(input.effectiveFrom);
  const effectiveTo = input.effectiveTo ? parseBusinessDate(input.effectiveTo) : null;

  return prisma.$transaction(async (tx) => {
    const [branch, staff] = await Promise.all([
      tx.branch.findFirst({
        where: { id: input.branchId, companyId: actor.companyId, isActive: true },
        select: { id: true, isActive: true },
      }),
      tx.staffMember.findFirst({
        where: {
          id: input.staffId,
          companyId: actor.companyId,
          archivedAt: null,
          employmentStatus: { not: "TERMINATED" },
        },
        select: { id: true, employmentStatus: true },
      }),
    ]);
    if (!branch || !staff) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Cơ sở phải đang hoạt động và nhân viên chưa nghỉ việc.",
      );
    }

    const overlap = await tx.branchAssignment.findFirst({
      where: {
        companyId: actor.companyId,
        staffId: input.staffId,
        assignmentType: input.assignmentType,
        archivedAt: null,
        ...(effectiveTo ? { effectiveFrom: { lt: effectiveTo } } : {}),
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
      },
      select: { id: true },
    });
    if (overlap) {
      throw new DomainError("CONFLICT", "Khoảng phân công bị trùng với lịch sử hiện có.");
    }

    if (input.assignmentType === "MEMBER" && input.attendanceMachineCode) {
      const duplicateMachineCode = await tx.branchAssignment.findFirst({
        where: {
          companyId: actor.companyId,
          branchId: input.branchId,
          assignmentType: "MEMBER",
          attendanceMachineCode: input.attendanceMachineCode,
          archivedAt: null,
          ...(effectiveTo ? { effectiveFrom: { lt: effectiveTo } } : {}),
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
        },
        select: { id: true },
      });
      if (duplicateMachineCode) {
        throw new DomainError(
          "CONFLICT",
          "Mã máy chấm công đã được dùng trong cơ sở ở khoảng thời gian này.",
        );
      }
    }

    const assignment = await tx.branchAssignment.create({
      data: {
        companyId: actor.companyId,
        branchId: input.branchId,
        staffId: input.staffId,
        assignmentType: input.assignmentType,
        attendanceMachineCode:
          input.assignmentType === "MEMBER" ? (input.attendanceMachineCode ?? null) : null,
        effectiveFrom,
        effectiveTo,
      },
    });
    await appendAudit(tx, {
      actor,
      action: "assignment.create",
      entityType: "BranchAssignment",
      entityId: assignment.id,
      reason: systemAuditReason("ASSIGNMENT_CREATED_FROM_UI"),
      after: safeAssignmentAuditSnapshot(assignment),
      metadata,
    });
    return assignment;
  });
}

export async function updateAssignment(
  actor: ActorContext,
  id: string,
  input: AssignmentUpdateInput,
  metadata: RequestMetadata,
  now = new Date(),
) {
  requirePermission(actor, "assignment:update");
  const effectiveTo = input.effectiveTo ? parseBusinessDate(input.effectiveTo) : null;
  const businessDate = toBusinessDate(now);

  return prisma.$transaction(async (tx) => {
    const before = await tx.branchAssignment.findFirst({
      where: { id, companyId: actor.companyId, archivedAt: null },
    });
    if (!before) {
      throw new DomainError("NOT_FOUND", "Không tìm thấy phân công.");
    }
    if (effectiveTo && effectiveTo <= before.effectiveFrom) {
      throw new DomainError("VALIDATION_ERROR", "Ngày kết thúc phải sau ngày bắt đầu.");
    }

    const wasEnded = Boolean(before.effectiveTo && before.effectiveTo <= businessDate);
    const willBeCurrent = !effectiveTo || effectiveTo > businessDate;
    if (wasEnded && !willBeCurrent) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Để kích hoạt lại, ngày kết thúc mới phải sau ngày hiện tại hoặc để trống nếu phân công không thời hạn.",
      );
    }

    if (wasEnded) {
      const branch = await tx.branch.findFirst({
        where: { id: before.branchId, companyId: actor.companyId, isActive: true },
        select: { id: true },
      });
      const staff = await tx.staffMember.findFirst({
        where: {
          id: before.staffId,
          companyId: actor.companyId,
          archivedAt: null,
          employmentStatus: { not: "TERMINATED" },
        },
        select: { id: true },
      });
      if (!branch || !staff) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "Chỉ có thể kích hoạt lại phân công khi cơ sở và nhân sự vẫn đang hoạt động.",
        );
      }
    }

    const overlap = await tx.branchAssignment.findFirst({
      where: {
        id: { not: id },
        companyId: actor.companyId,
        staffId: before.staffId,
        assignmentType: before.assignmentType,
        archivedAt: null,
        ...(effectiveTo ? { effectiveFrom: { lt: effectiveTo } } : {}),
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: before.effectiveFrom } }],
      },
      select: { id: true },
    });
    if (overlap) {
      throw new DomainError(
        "CONFLICT",
        "Khoảng hiệu lực mới bị trùng với một phân công khác của nhân sự.",
      );
    }

    if (before.assignmentType === "MEMBER" && before.attendanceMachineCode) {
      const duplicateMachineCode = await tx.branchAssignment.findFirst({
        where: {
          id: { not: id },
          companyId: actor.companyId,
          branchId: before.branchId,
          assignmentType: "MEMBER",
          attendanceMachineCode: before.attendanceMachineCode,
          archivedAt: null,
          ...(effectiveTo ? { effectiveFrom: { lt: effectiveTo } } : {}),
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: before.effectiveFrom } }],
        },
        select: { id: true },
      });
      if (duplicateMachineCode) {
        throw new DomainError(
          "CONFLICT",
          "Mã máy chấm công đã được dùng tại cơ sở trong khoảng hiệu lực mới.",
        );
      }
    }

    const result = await tx.branchAssignment.updateMany({
      where: { id, companyId: actor.companyId, version: input.version, archivedAt: null },
      data: { effectiveTo, version: { increment: 1 } },
    });
    if (result.count !== 1) {
      throw new DomainError("CONFLICT", "Phân công đã được cập nhật bởi người khác.");
    }

    const after = await tx.branchAssignment.findUniqueOrThrow({ where: { id } });
    const changedEffectiveTo = before.effectiveTo?.getTime() !== after.effectiveTo?.getTime();
    const reactivated = wasEnded && (!after.effectiveTo || after.effectiveTo > businessDate);
    await appendAudit(tx, {
      actor,
      action: reactivated
        ? "assignment.reactivate"
        : changedEffectiveTo && after.effectiveTo
          ? "assignment.end"
          : "assignment.update",
      entityType: "BranchAssignment",
      entityId: id,
      reason: systemAuditReason(
        reactivated
          ? "ASSIGNMENT_REACTIVATED_FROM_UI"
          : changedEffectiveTo && after.effectiveTo
            ? "ASSIGNMENT_ENDED_FROM_UI"
            : "ASSIGNMENT_UPDATED_FROM_UI",
      ),
      before: safeAssignmentAuditSnapshot(before),
      after: safeAssignmentAuditSnapshot(after),
      metadata,
    });
    return after;
  });
}

export async function transferAssignment(
  actor: ActorContext,
  id: string,
  input: AssignmentTransferInput,
  metadata: RequestMetadata,
) {
  requirePermission(actor, "assignment:update");
  const transferDate = parseBusinessDate(input.effectiveFrom);
  return prisma.$transaction(async (tx) => {
    const before = await tx.branchAssignment.findFirst({
      where: { id, companyId: actor.companyId, archivedAt: null },
      include: {
        branch: { select: { code: true } },
        staff: { select: { employmentStatus: true, archivedAt: true } },
      },
    });
    if (!before) throw new DomainError("NOT_FOUND", "Không tìm thấy phân công.");
    if (
      transferDate <= before.effectiveFrom ||
      (before.effectiveTo && transferDate >= before.effectiveTo)
    ) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Ngày chuyển phải nằm sau ngày bắt đầu và trước ngày kết thúc hiện tại.",
      );
    }
    if (before.branchId === input.targetBranchId) {
      throw new DomainError("VALIDATION_ERROR", "Cơ sở mới phải khác cơ sở hiện tại.");
    }
    const targetBranch = await tx.branch.findFirst({
      where: { id: input.targetBranchId, companyId: actor.companyId, isActive: true },
      select: { id: true, code: true },
    });
    if (!targetBranch) {
      throw new DomainError("VALIDATION_ERROR", "Cơ sở nhận phải đang hoạt động.");
    }
    if (before.staff.archivedAt || before.staff.employmentStatus === "TERMINATED") {
      throw new DomainError("VALIDATION_ERROR", "Không thể chuyển nhân viên đã nghỉ việc.");
    }
    if (before.assignmentType === "MEMBER" && !input.attendanceMachineCode) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Mã máy chấm công mới là bắt buộc khi chuyển cơ sở.",
      );
    }
    const overlap = await tx.branchAssignment.findFirst({
      where: {
        id: { not: id },
        companyId: actor.companyId,
        staffId: before.staffId,
        assignmentType: before.assignmentType,
        archivedAt: null,
        ...(before.effectiveTo ? { effectiveFrom: { lt: before.effectiveTo } } : {}),
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: transferDate } }],
      },
      select: { id: true },
    });
    if (overlap) {
      throw new DomainError("CONFLICT", "Khoảng phân công mới bị trùng với lịch sử hiện có.");
    }
    if (before.assignmentType === "MEMBER" && input.attendanceMachineCode) {
      const duplicateMachineCode = await tx.branchAssignment.findFirst({
        where: {
          companyId: actor.companyId,
          branchId: targetBranch.id,
          assignmentType: "MEMBER",
          attendanceMachineCode: input.attendanceMachineCode,
          archivedAt: null,
          ...(before.effectiveTo ? { effectiveFrom: { lt: before.effectiveTo } } : {}),
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: transferDate } }],
        },
        select: { id: true },
      });
      if (duplicateMachineCode) {
        throw new DomainError(
          "CONFLICT",
          "Mã máy chấm công đã được dùng trong cơ sở đích ở khoảng thời gian này.",
        );
      }
    }

    const updated = await tx.branchAssignment.updateMany({
      where: {
        id,
        companyId: actor.companyId,
        version: input.version,
        archivedAt: null,
      },
      data: { effectiveTo: transferDate, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new DomainError("CONFLICT", "Phân công đã được cập nhật bởi người khác.");
    }
    const created = await tx.branchAssignment.create({
      data: {
        companyId: actor.companyId,
        branchId: targetBranch.id,
        staffId: before.staffId,
        assignmentType: before.assignmentType,
        attendanceMachineCode:
          before.assignmentType === "MEMBER" ? (input.attendanceMachineCode ?? null) : null,
        effectiveFrom: transferDate,
        effectiveTo: before.effectiveTo,
      },
    });
    await appendAudit(tx, {
      actor,
      action: "assignment.transfer",
      entityType: "BranchAssignment",
      entityId: id,
      reason: systemAuditReason("ASSIGNMENT_TRANSFERRED_FROM_UI"),
      before: safeAssignmentAuditSnapshot(before),
      after: {
        ...safeAssignmentAuditSnapshot({
          ...before,
          effectiveTo: transferDate,
          version: before.version + 1,
        }),
        branchCode: before.branch.code,
        transferredToAssignmentId: created.id,
      },
      metadata,
    });
    await appendAudit(tx, {
      actor,
      action: "assignment.transfer.target",
      entityType: "BranchAssignment",
      entityId: created.id,
      reason: systemAuditReason("ASSIGNMENT_TRANSFER_TARGET_CREATED_FROM_UI"),
      after: {
        ...safeAssignmentAuditSnapshot(created),
        branchCode: targetBranch.code,
        transferredFromAssignmentId: id,
      },
      metadata,
    });
    return {
      previousAssignmentId: id,
      assignment: created,
    };
  });
}

export async function cancelAssignment(
  actor: ActorContext,
  id: string,
  input: AssignmentCancelInput,
  metadata: RequestMetadata,
  now = new Date(),
) {
  requirePermission(actor, "assignment:update");
  return prisma.$transaction(async (tx) => {
    const before = await tx.branchAssignment.findFirst({
      where: { id, companyId: actor.companyId, archivedAt: null },
    });
    if (!before) throw new DomainError("NOT_FOUND", "Không tìm thấy phân công.");
    if (before.effectiveFrom <= toBusinessDate(now)) {
      throw new DomainError(
        "CONFLICT",
        "Chỉ có thể hủy phân công chưa có hiệu lực. Hãy kết thúc phân công đang hoạt động.",
      );
    }
    const archivedAt = new Date();
    const result = await tx.branchAssignment.updateMany({
      where: {
        id,
        companyId: actor.companyId,
        version: input.version,
        archivedAt: null,
      },
      data: { archivedAt, version: { increment: 1 } },
    });
    if (result.count !== 1) {
      throw new DomainError("CONFLICT", "Phân công đã được cập nhật bởi người khác.");
    }
    await appendAudit(tx, {
      actor,
      action: "assignment.cancel",
      entityType: "BranchAssignment",
      entityId: id,
      reason: systemAuditReason("ASSIGNMENT_CANCELLED_FROM_UI"),
      before: safeAssignmentAuditSnapshot(before),
      after: safeAssignmentAuditSnapshot({
        ...before,
        archivedAt,
        version: before.version + 1,
      }),
      metadata,
    });
    return { id, archivedAt: archivedAt.toISOString(), version: before.version + 1 };
  });
}

export async function createUserAccount(
  actor: ActorContext,
  input: UserCreateInput,
  metadata: RequestMetadata,
) {
  requirePermission(actor, "user:create");
  await enforceSensitiveMutationRateLimit(actor, "user.create", {
    windowSeconds: 300,
    maxAttempts: 10,
  });
  if (input.role === "LIVE_EMPLOYEE" && input.canManagePayroll) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "Không thể cấp quyền quản lý Payroll cho tài khoản nhân viên Live.",
    );
  }

  if (input.staffId) {
    const staff = await prisma.staffMember.findFirst({
      where: { id: input.staffId, companyId: actor.companyId, archivedAt: null },
      select: { id: true },
    });
    if (!staff) {
      throw new DomainError("NOT_FOUND", "Không tìm thấy nhân sự trong công ty.");
    }
  }

  const result = await auth.api.createUser({
    body: {
      email: input.email.toLowerCase(),
      password: input.password,
      name: input.name,
      role: input.role,
      data: {
        companyId: actor.companyId,
        staffId: input.staffId ?? null,
        active: true,
        canManagePayroll: Boolean(input.canManagePayroll),
        username: input.username.toLowerCase(),
        displayUsername: input.username,
      },
    },
  });

  const user = result.user;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          mustChangePassword: false,
          invitedAt: new Date(),
          passwordChangedAt: new Date(),
        },
      });
      await appendAudit(tx, {
        actor,
        action: "user.create",
        entityType: "User",
        entityId: user.id,
        reason: systemAuditReason("USER_CREATED_FROM_UI"),
        after: {
          email: user.email,
          name: user.name,
          username: input.username.toLowerCase(),
          role: input.role,
          canManagePayroll: Boolean(input.canManagePayroll),
          staffId: input.staffId ?? null,
          active: true,
          mustChangePassword: false,
        },
        metadata,
      });
    });
  } catch (auditError) {
    // Better Auth owns its credential transaction. Fail closed if the
    // application audit append cannot be committed afterwards.
    await prisma.$transaction([
      prisma.session.deleteMany({ where: { userId: user.id } }),
      prisma.user.update({
        where: { id: user.id },
        data: {
          active: false,
          banned: true,
          banReason: "Provisioning audit failed",
        },
      }),
    ]);
    throw auditError;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    username: input.username.toLowerCase(),
    role: input.role,
    canManagePayroll: Boolean(input.canManagePayroll),
    staffId: input.staffId ?? null,
    active: true,
    mustChangePassword: false,
  };
}

export async function updateUserAccount(
  actor: ActorContext,
  id: string,
  input: UserUpdateInput,
  metadata: RequestMetadata,
) {
  requirePermission(actor, "user:update");
  await enforceSensitiveMutationRateLimit(actor, "user.update", {
    windowSeconds: 60,
    maxAttempts: 15,
  });
  if (id === actor.userId && input.active === false) {
    throw new DomainError("VALIDATION_ERROR", "Không thể tự vô hiệu hóa tài khoản đang dùng.");
  }

  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findFirst({
      where: { id, companyId: actor.companyId },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        canManagePayroll: true,
        active: true,
        staffId: true,
        version: true,
      },
    });
    if (!before) {
      throw new DomainError("NOT_FOUND", "Không tìm thấy tài khoản.");
    }
    const targetRole = input.role ?? before.role;
    const targetPayrollAccess = input.canManagePayroll ?? before.canManagePayroll;
    if (targetRole === "LIVE_EMPLOYEE" && targetPayrollAccess) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Không thể cấp quyền quản lý Payroll cho tài khoản nhân viên Live.",
      );
    }
    if (
      before.role === "GENERAL_MANAGER" &&
      before.active &&
      (input.active === false || (input.role !== undefined && input.role !== "GENERAL_MANAGER"))
    ) {
      const otherActiveGeneralManagers = await tx.user.count({
        where: {
          companyId: actor.companyId,
          id: { not: id },
          role: "GENERAL_MANAGER",
          active: true,
        },
      });
      if (otherActiveGeneralManagers === 0) {
        throw new DomainError(
          "CONFLICT",
          "Không thể vô hiệu hóa hoặc hạ quyền Tổng quản lý active cuối cùng.",
        );
      }
    }
    if (input.staffId) {
      const [staff, linkedUser] = await Promise.all([
        tx.staffMember.findFirst({
          where: { id: input.staffId, companyId: actor.companyId, archivedAt: null },
          select: { id: true },
        }),
        tx.user.findFirst({
          where: { staffId: input.staffId, id: { not: id } },
          select: { id: true },
        }),
      ]);
      if (!staff) throw new DomainError("NOT_FOUND", "Không tìm thấy nhân sự trong công ty.");
      if (linkedUser) {
        throw new DomainError("CONFLICT", "Nhân sự đã được liên kết với tài khoản khác.");
      }
    }

    const data: Prisma.UserUncheckedUpdateManyInput = {
      version: { increment: 1 },
    };
    if (input.role !== undefined) data.role = input.role;
    if (input.canManagePayroll !== undefined) data.canManagePayroll = input.canManagePayroll;
    if (input.staffId !== undefined) data.staffId = input.staffId;
    if (input.active !== undefined) {
      data.active = input.active;
      data.banned = !input.active;
      data.banReason = input.active ? null : "Vô hiệu hóa từ giao diện quản trị";
    }

    const result = await tx.user.updateMany({
      where: { id, companyId: actor.companyId, version: input.version },
      data,
    });
    if (result.count !== 1) {
      throw new DomainError("CONFLICT", "Tài khoản đã được cập nhật bởi người khác.");
    }
    if (input.active === false) {
      await tx.session.deleteMany({ where: { userId: id } });
    }

    const after = await tx.user.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        canManagePayroll: true,
        active: true,
        staffId: true,
        version: true,
      },
    });
    await appendAudit(tx, {
      actor,
      action:
        before.active !== after.active
          ? after.active
            ? "user.reactivate"
            : "user.deactivate"
          : "user.update",
      entityType: "User",
      entityId: id,
      reason: systemAuditReason(
        before.active !== after.active
          ? after.active
            ? "USER_REACTIVATED_FROM_UI"
            : "USER_DEACTIVATED_FROM_UI"
          : "USER_UPDATED_FROM_UI",
      ),
      before,
      after,
      metadata,
    });
    return after;
  });
}

export function isKnownRole(value: string): value is AuthRole {
  return value === "GENERAL_MANAGER" || value === "TRAINING_MANAGER" || value === "LIVE_EMPLOYEE";
}
