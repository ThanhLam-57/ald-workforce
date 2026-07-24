import type {
  AdminAssignmentDto,
  AdminAssignmentListQuery,
  AdminBranchDto,
  AdminBranchListQuery,
  AdminPageDto,
  AdminStaffDto,
  AdminStaffListQuery,
  AdminUserDto,
  AdminUserListQuery,
} from "@ald/contracts";
import { prisma, type Prisma } from "@ald/db";
import { DomainError, type ActorContext, type AuthRole } from "@ald/domain";

import { toBusinessDate } from "./business-date";

function requireGeneralManager(actor: ActorContext): void {
  if (actor.role !== "GENERAL_MANAGER") {
    throw new DomainError("FORBIDDEN", "Chỉ Tổng quản lý được truy cập khu vực quản trị.");
  }
}

function authRole(value: string): AuthRole {
  if (value === "GENERAL_MANAGER" || value === "TRAINING_MANAGER" || value === "LIVE_EMPLOYEE") {
    return value;
  }
  throw new DomainError("VALIDATION_ERROR", "Tài khoản có vai trò không hợp lệ.");
}

function pageOffset(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

export async function listAdminBranches(
  actor: ActorContext,
  query: AdminBranchListQuery,
  now = new Date(),
): Promise<AdminPageDto<AdminBranchDto>> {
  requireGeneralManager(actor);
  const businessDate = toBusinessDate(now);
  const where: Prisma.BranchWhereInput = {
    companyId: actor.companyId,
    ...(query.status === "ACTIVE"
      ? { isActive: true }
      : query.status === "INACTIVE"
        ? { isActive: false }
        : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: "insensitive" } },
            { name: { contains: query.search, mode: "insensitive" } },
            { address: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const orderBy = {
    [query.sort]: query.direction,
  } satisfies Prisma.BranchOrderByWithRelationInput;
  const [items, total] = await prisma.$transaction([
    prisma.branch.findMany({
      where,
      orderBy: [orderBy, { id: "asc" }],
      skip: pageOffset(query.page, query.pageSize),
      take: query.pageSize,
      select: {
        id: true,
        code: true,
        name: true,
        address: true,
        isActive: true,
        version: true,
        updatedAt: true,
        assignments: {
          where: {
            archivedAt: null,
            effectiveFrom: { lte: businessDate },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: businessDate } }],
          },
          select: { assignmentType: true },
        },
      },
    }),
    prisma.branch.count({ where }),
  ]);

  return {
    items: items.map(({ assignments, ...branch }) => ({
      ...branch,
      activeStaffCount: assignments.filter(({ assignmentType }) => assignmentType === "MEMBER")
        .length,
      activeManagerCount: assignments.filter(({ assignmentType }) => assignmentType !== "MEMBER")
        .length,
      updatedAt: branch.updatedAt.toISOString(),
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function listAdminStaff(
  actor: ActorContext,
  query: AdminStaffListQuery,
  now = new Date(),
): Promise<AdminPageDto<AdminStaffDto>> {
  requireGeneralManager(actor);
  const businessDate = toBusinessDate(now);
  const where: Prisma.StaffMemberWhereInput = {
    companyId: actor.companyId,
    archivedAt: null,
    ...(query.employmentStatus !== "ALL" ? { employmentStatus: query.employmentStatus } : {}),
    ...(query.employmentCategory !== "ALL" ? { employmentCategory: query.employmentCategory } : {}),
    ...(query.branchId
      ? {
          assignments: {
            some: {
              branchId: query.branchId,
              archivedAt: null,
              effectiveFrom: { lte: businessDate },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: businessDate } }],
            },
          },
        }
      : {}),
    ...(query.account === "LINKED"
      ? { user: { isNot: null } }
      : query.account === "UNLINKED"
        ? { user: { is: null } }
        : {}),
    ...(query.search
      ? {
          OR: [
            { staffCode: { contains: query.search, mode: "insensitive" } },
            { fullName: { contains: query.search, mode: "insensitive" } },
            { streamingAlias: { contains: query.search, mode: "insensitive" } },
            { email: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const orderBy = {
    [query.sort]: query.direction,
  } satisfies Prisma.StaffMemberOrderByWithRelationInput;
  const [items, total] = await prisma.$transaction([
    prisma.staffMember.findMany({
      where,
      orderBy: [orderBy, { id: "asc" }],
      skip: pageOffset(query.page, query.pageSize),
      take: query.pageSize,
      select: {
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
        updatedAt: true,
        assignments: {
          where: {
            archivedAt: null,
            effectiveFrom: { lte: businessDate },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: businessDate } }],
          },
          orderBy: { effectiveFrom: "desc" },
          select: {
            id: true,
            branchId: true,
            assignmentType: true,
            branch: { select: { code: true, name: true } },
          },
        },
        user: { select: { id: true, username: true, active: true } },
        levelHistories: {
          where: {
            effectiveFrom: { lte: businessDate },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: businessDate } }],
          },
          orderBy: { effectiveFrom: "desc" },
          take: 1,
          select: { performanceLevel: { select: { code: true, name: true } } },
        },
      },
    }),
    prisma.staffMember.count({ where }),
  ]);

  return {
    items: items.map(({ assignments, levelHistories, ...staff }) => ({
      ...staff,
      currentAssignments: assignments.map((assignment) => ({
        id: assignment.id,
        branchId: assignment.branchId,
        branchCode: assignment.branch.code,
        branchName: assignment.branch.name,
        assignmentType: assignment.assignmentType,
      })),
      level: levelHistories[0]?.performanceLevel ?? null,
      updatedAt: staff.updatedAt.toISOString(),
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

function assignmentStatus(
  assignment: Readonly<{
    archivedAt: Date | null;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  }>,
  businessDate: Date,
): AdminAssignmentDto["status"] {
  if (assignment.archivedAt) return "CANCELLED";
  if (assignment.effectiveFrom > businessDate) return "UPCOMING";
  if (assignment.effectiveTo && assignment.effectiveTo <= businessDate) return "ENDED";
  return "CURRENT";
}

export async function listAdminAssignments(
  actor: ActorContext,
  query: AdminAssignmentListQuery,
  now = new Date(),
): Promise<AdminPageDto<AdminAssignmentDto>> {
  requireGeneralManager(actor);
  const businessDate = toBusinessDate(now);
  const statusWhere: Prisma.BranchAssignmentWhereInput =
    query.status === "CURRENT"
      ? {
          archivedAt: null,
          effectiveFrom: { lte: businessDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: businessDate } }],
        }
      : query.status === "UPCOMING"
        ? { archivedAt: null, effectiveFrom: { gt: businessDate } }
        : query.status === "ENDED"
          ? { archivedAt: null, effectiveTo: { lte: businessDate } }
          : query.status === "CANCELLED"
            ? { archivedAt: { not: null } }
            : {};
  const where: Prisma.BranchAssignmentWhereInput = {
    companyId: actor.companyId,
    ...statusWhere,
    ...(query.branchId ? { branchId: query.branchId } : {}),
    ...(query.staffId ? { staffId: query.staffId } : {}),
    ...(query.assignmentType !== "ALL" ? { assignmentType: query.assignmentType } : {}),
    ...(query.search
      ? {
          OR: [
            { branch: { code: { contains: query.search, mode: "insensitive" } } },
            { branch: { name: { contains: query.search, mode: "insensitive" } } },
            { staff: { staffCode: { contains: query.search, mode: "insensitive" } } },
            { staff: { fullName: { contains: query.search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const orderBy = {
    [query.sort]: query.direction,
  } satisfies Prisma.BranchAssignmentOrderByWithRelationInput;
  const [items, total] = await prisma.$transaction([
    prisma.branchAssignment.findMany({
      where,
      orderBy: [orderBy, { id: "asc" }],
      skip: pageOffset(query.page, query.pageSize),
      take: query.pageSize,
      select: {
        id: true,
        assignmentType: true,
        effectiveFrom: true,
        effectiveTo: true,
        archivedAt: true,
        version: true,
        updatedAt: true,
        branch: { select: { id: true, code: true, name: true, isActive: true } },
        staff: {
          select: {
            id: true,
            staffCode: true,
            fullName: true,
            employmentStatus: true,
          },
        },
      },
    }),
    prisma.branchAssignment.count({ where }),
  ]);

  return {
    items: items.map(({ archivedAt, ...assignment }) => ({
      ...assignment,
      effectiveFrom: assignment.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: assignment.effectiveTo?.toISOString().slice(0, 10) ?? null,
      status: assignmentStatus({ ...assignment, archivedAt }, businessDate),
      updatedAt: assignment.updatedAt.toISOString(),
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function listAdminUsers(
  actor: ActorContext,
  query: AdminUserListQuery,
): Promise<AdminPageDto<AdminUserDto>> {
  requireGeneralManager(actor);
  const where: Prisma.UserWhereInput = {
    companyId: actor.companyId,
    ...(query.role !== "ALL" ? { role: query.role } : {}),
    ...(query.status === "ACTIVE"
      ? { active: true }
      : query.status === "INACTIVE"
        ? { active: false }
        : {}),
    ...(query.account === "LINKED"
      ? { staffId: { not: null } }
      : query.account === "UNLINKED"
        ? { staffId: null }
        : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { username: { contains: query.search, mode: "insensitive" } },
            { email: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const orderBy = {
    [query.sort]: query.direction,
  } satisfies Prisma.UserOrderByWithRelationInput;
  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      orderBy: [orderBy, { id: "asc" }],
      skip: pageOffset(query.page, query.pageSize),
      take: query.pageSize,
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        role: true,
        active: true,
        mustChangePassword: true,
        version: true,
        updatedAt: true,
        staff: { select: { id: true, staffCode: true, fullName: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    items: items.map(({ role, updatedAt, ...user }) => ({
      ...user,
      role: authRole(role),
      updatedAt: updatedAt.toISOString(),
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}
