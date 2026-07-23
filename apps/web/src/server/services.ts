import type {
  AssignmentCreateInput,
  AssignmentUpdateInput,
  BranchCreateInput,
  BranchUpdateInput,
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

const staffSelect = {
  id: true,
  staffCode: true,
  fullName: true,
  streamingAlias: true,
  email: true,
  phone: true,
  jobTitle: true,
  employmentCategory: true,
  employmentStatus: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StaffMemberSelect;

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
      action: "branch.update",
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
    select: staffSelect,
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
    const staff = await tx.staffMember.create({
      data: {
        companyId: actor.companyId,
        staffCode: input.staffCode.toUpperCase(),
        fullName: input.fullName,
        streamingAlias: input.streamingAlias || null,
        email: input.email?.toLowerCase() ?? null,
        phone: input.phone || null,
        jobTitle: input.jobTitle,
        employmentCategory: input.employmentCategory,
      },
      select: staffSelect,
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
    return staff;
  });
}

export async function updateStaff(
  actor: ActorContext,
  id: string,
  input: StaffUpdateInput,
  metadata: RequestMetadata,
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
    if (input.employmentCategory !== undefined) {
      data.employmentCategory = input.employmentCategory;
    }
    if (input.employmentStatus !== undefined) data.employmentStatus = input.employmentStatus;

    const result = await tx.staffMember.updateMany({
      where: { id, companyId: actor.companyId, version: input.version, archivedAt: null },
      data,
    });
    if (result.count !== 1) {
      throw new DomainError("CONFLICT", "Nhân sự đã được cập nhật bởi người khác.");
    }

    const after = await tx.staffMember.findUniqueOrThrow({ where: { id }, select: staffSelect });
    await appendAudit(tx, {
      actor,
      action: "staff.update",
      entityType: "StaffMember",
      entityId: id,
      reason: input.reason,
      before: staffAuditShape(before),
      after: staffAuditShape(after),
      metadata,
    });
    return after;
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
        where: { id: input.branchId, companyId: actor.companyId },
        select: { id: true },
      }),
      tx.staffMember.findFirst({
        where: { id: input.staffId, companyId: actor.companyId, archivedAt: null },
        select: { id: true },
      }),
    ]);
    if (!branch || !staff) {
      throw new DomainError("NOT_FOUND", "Không tìm thấy cơ sở hoặc nhân sự trong công ty.");
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
      action: "assignment.update",
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

export async function createUserAccount(
  actor: ActorContext,
  input: UserCreateInput,
  metadata: RequestMetadata,
) {
  requirePermission(actor, "user:create");

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
        username: input.username.toLowerCase(),
        displayUsername: input.username,
      },
    },
  });

  const user = result.user;
  try {
    await prisma.$transaction(async (tx) => {
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
          staffId: input.staffId ?? null,
          active: true,
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
    staffId: input.staffId ?? null,
    active: true,
  };
}

export async function updateUserAccount(
  actor: ActorContext,
  id: string,
  input: UserUpdateInput,
  metadata: RequestMetadata,
) {
  requirePermission(actor, "user:update");
  if (id === actor.userId && input.active === false) {
    throw new DomainError("VALIDATION_ERROR", "Không thể tự vô hiệu hóa tài khoản đang dùng.");
  }

  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findFirst({
      where: { id, companyId: actor.companyId },
      select: { id: true, email: true, role: true, active: true, version: true },
    });
    if (!before) {
      throw new DomainError("NOT_FOUND", "Không tìm thấy tài khoản.");
    }

    const data: Prisma.UserUpdateManyMutationInput = {
      version: { increment: 1 },
    };
    if (input.role !== undefined) data.role = input.role;
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
      select: { id: true, email: true, role: true, active: true, version: true },
    });
    await appendAudit(tx, {
      actor,
      action: "user.update",
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
