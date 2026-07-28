import type {
  AssignmentCancelInput,
  AssignmentCreateInput,
  AssignmentTransferInput,
  AssignmentUpdateInput,
  BranchCreateInput,
  BranchUpdateInput,
  StaffArchiveInput,
  StaffCreateInput,
  StaffUpdateInput,
  UserCreateInput,
  UserUpdateInput,
} from "@ald/contracts";
import { prisma, type Prisma } from "@ald/db";
import { DomainError, requirePermission, type ActorContext, type AuthRole } from "@ald/domain";

import { auth } from "./auth";
import { parseBusinessDate, toBusinessDate } from "./business-date";
import type { RequestMetadata } from "./request-metadata";
import { enforceSensitiveMutationRateLimit } from "./sensitive-rate-limit";

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
  email: true,
  phone: true,
  jobTitle: true,
  joinedDate: true,
  officialDate: true,
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

function staffAuditShape(staff: {
  staffCode: string;
  fullName: string;
  streamingAlias: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string;
  baseSalaryAmount: bigint;
  joinedDate: Date | null;
  officialDate: Date | null;
  employmentCategory: string;
  employmentStatus: string;
  version: number;
}): Record<string, unknown> {
  return {
    staffCode: staff.staffCode,
    fullName: staff.fullName,
    streamingAlias: staff.streamingAlias,
    email: staff.email,
    phone: staff.phone,
    jobTitle: staff.jobTitle,
    baseSalaryAmount: staff.baseSalaryAmount.toString(),
    joinedDate: staff.joinedDate?.toISOString().slice(0, 10) ?? null,
    officialDate: staff.officialDate?.toISOString().slice(0, 10) ?? null,
    employmentCategory: staff.employmentCategory,
    employmentStatus: staff.employmentStatus,
    version: staff.version,
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
      reason: input.reason,
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
      reason: input.reason,
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
    const staff = await tx.staffMember.create({
      data: {
        companyId: actor.companyId,
        staffCode: input.staffCode.toUpperCase(),
        fullName: input.fullName,
        streamingAlias: input.streamingAlias || null,
        email: input.email?.toLowerCase() ?? null,
        phone: input.phone || null,
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
    await appendAudit(tx, {
      actor,
      action: "staff.create",
      entityType: "StaffMember",
      entityId: staff.id,
      reason: input.reason,
      after: staffAuditShape(staff),
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
  return prisma.$transaction(async (tx) => {
    const before = await tx.staffMember.findFirst({
      where: { id, companyId: actor.companyId, archivedAt: null },
      select: staffSelect,
    });
    if (!before) {
      throw new DomainError("NOT_FOUND", "Không tìm thấy nhân sự.");
    }

    const data: Prisma.StaffMemberUpdateManyMutationInput = {
      version: { increment: 1 },
    };
    if (input.fullName !== undefined) data.fullName = input.fullName;
    if (input.streamingAlias !== undefined) {
      data.streamingAlias = input.streamingAlias || null;
    }
    if (input.email !== undefined) data.email = input.email.toLowerCase();
    if (input.phone !== undefined) data.phone = input.phone;
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
    await appendAudit(tx, {
      actor,
      action: changesEmployment ? "staff.status-change" : "staff.update",
      entityType: "StaffMember",
      entityId: id,
      reason: input.reason,
      before: staffAuditShape(before),
      after: staffAuditShape(after),
      metadata,
    });
    return staffResponse(after);
  });
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
    const after = { ...staffAuditShape(before), archivedAt: archivedAt.toISOString() };
    await appendAudit(tx, {
      actor,
      action: "staff.archive",
      entityType: "StaffMember",
      entityId: id,
      reason: input.reason,
      before: staffAuditShape(before),
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

    const assignment = await tx.branchAssignment.create({
      data: {
        companyId: actor.companyId,
        branchId: input.branchId,
        staffId: input.staffId,
        assignmentType: input.assignmentType,
        effectiveFrom,
        effectiveTo,
      },
    });
    await appendAudit(tx, {
      actor,
      action: "assignment.create",
      entityType: "BranchAssignment",
      entityId: assignment.id,
      reason: input.reason,
      after: {
        branchId: assignment.branchId,
        staffId: assignment.staffId,
        assignmentType: assignment.assignmentType,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        version: assignment.version,
      },
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
) {
  requirePermission(actor, "assignment:update");
  const effectiveTo = input.effectiveTo ? parseBusinessDate(input.effectiveTo) : null;

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

    const result = await tx.branchAssignment.updateMany({
      where: { id, companyId: actor.companyId, version: input.version, archivedAt: null },
      data: { effectiveTo, version: { increment: 1 } },
    });
    if (result.count !== 1) {
      throw new DomainError("CONFLICT", "Phân công đã được cập nhật bởi người khác.");
    }

    const after = await tx.branchAssignment.findUniqueOrThrow({ where: { id } });
    await appendAudit(tx, {
      actor,
      action:
        before.effectiveTo?.getTime() !== after.effectiveTo?.getTime() && after.effectiveTo
          ? "assignment.end"
          : "assignment.update",
      entityType: "BranchAssignment",
      entityId: id,
      reason: input.reason,
      before: {
        effectiveFrom: before.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: before.effectiveTo?.toISOString().slice(0, 10) ?? null,
        version: before.version,
      },
      after: {
        effectiveFrom: after.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: after.effectiveTo?.toISOString().slice(0, 10) ?? null,
        version: after.version,
      },
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
        effectiveFrom: transferDate,
        effectiveTo: before.effectiveTo,
      },
    });
    await appendAudit(tx, {
      actor,
      action: "assignment.transfer",
      entityType: "BranchAssignment",
      entityId: id,
      reason: input.reason,
      before: {
        branchId: before.branchId,
        branchCode: before.branch.code,
        effectiveFrom: before.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: before.effectiveTo?.toISOString().slice(0, 10) ?? null,
        version: before.version,
      },
      after: {
        branchId: before.branchId,
        branchCode: before.branch.code,
        effectiveFrom: before.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: input.effectiveFrom,
        version: before.version + 1,
        transferredToAssignmentId: created.id,
      },
      metadata,
    });
    await appendAudit(tx, {
      actor,
      action: "assignment.transfer.target",
      entityType: "BranchAssignment",
      entityId: created.id,
      reason: input.reason,
      after: {
        branchId: created.branchId,
        branchCode: targetBranch.code,
        staffId: created.staffId,
        assignmentType: created.assignmentType,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: created.effectiveTo?.toISOString().slice(0, 10) ?? null,
        version: created.version,
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
      reason: input.reason,
      before: {
        branchId: before.branchId,
        staffId: before.staffId,
        effectiveFrom: before.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: before.effectiveTo?.toISOString().slice(0, 10) ?? null,
        version: before.version,
      },
      after: {
        branchId: before.branchId,
        staffId: before.staffId,
        archivedAt: archivedAt.toISOString(),
        version: before.version + 1,
      },
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
          mustChangePassword: true,
          invitedAt: new Date(),
          passwordChangedAt: null,
        },
      });
      await appendAudit(tx, {
        actor,
        action: "user.create",
        entityType: "User",
        entityId: user.id,
        reason: input.reason,
        after: {
          email: user.email,
          name: user.name,
          username: input.username.toLowerCase(),
          role: input.role,
          canManagePayroll: Boolean(input.canManagePayroll),
          staffId: input.staffId ?? null,
          active: true,
          mustChangePassword: true,
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
    mustChangePassword: true,
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
      data.banReason = input.active ? null : input.reason;
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
      reason: input.reason,
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
