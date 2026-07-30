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
        : query.showHidden
          ? {}
          : { isActive: true }),
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
  const includeHidden = query.showHidden || query.employmentStatus === "TERMINATED";
  const where: Prisma.StaffMemberWhereInput = {
    companyId: actor.companyId,
    ...(!includeHidden ? { archivedAt: null } : {}),
    ...(query.employmentStatus !== "ALL"
      ? { employmentStatus: query.employmentStatus }
      : query.showHidden
        ? {}
        : { employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] } }),
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
            { tiktokChannelId: { contains: query.search, mode: "insensitive" } },
            { phone: { contains: query.search, mode: "insensitive" } },
            { email: { contains: query.search, mode: "insensitive" } },
            {
              assignments: {
                some: {
                  attendanceMachineCode: { contains: query.search, mode: "insensitive" },
                },
              },
            },
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
        archivedAt: true,
        version: true,
        updatedAt: true,
        assignments: {
          orderBy: { effectiveFrom: "desc" },
          select: {
            id: true,
            branchId: true,
            assignmentType: true,
            attendanceMachineCode: true,
            effectiveFrom: true,
            effectiveTo: true,
            archivedAt: true,
            version: true,
            branch: { select: { code: true, name: true } },
          },
        },
        workSchedules: {
          orderBy: { effectiveFrom: "desc" },
          select: {
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
            archivedAt: true,
            version: true,
          },
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
          select: {
            id: true,
            originalFileName: true,
            mimeType: true,
            sizeBytes: true,
            status: true,
            version: true,
            uploadedAt: true,
            verifiedAt: true,
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
    items: items.map(
      ({
        assignments,
        levelHistories,
        baseSalaryAmount,
        joinedDate,
        officialDate,
        terminationDate,
        dateOfBirth,
        archivedAt,
        workSchedules,
        identityDocuments,
        bankQrDocuments,
        ...staff
      }) => {
        const currentAssignments = assignments.filter(
          (assignment) =>
            !assignment.archivedAt &&
            assignment.effectiveFrom <= businessDate &&
            (!assignment.effectiveTo || assignment.effectiveTo > businessDate),
        );
        const currentSchedule = workSchedules.find(
          (schedule) =>
            !schedule.archivedAt &&
            schedule.effectiveFrom <= businessDate &&
            (!schedule.effectiveTo || schedule.effectiveTo > businessDate),
        );
        const selectedIdentityDocuments = (
          ["CITIZEN_ID_FRONT", "CITIZEN_ID_BACK"] as const
        ).flatMap((side) => {
          const sideDocuments = identityDocuments.filter((document) => document.side === side);
          const selected =
            sideDocuments.find((document) => document.status === "READY") ?? sideDocuments[0];
          return selected ? [selected] : [];
        });
        const selectedBankQr =
          bankQrDocuments.find((document) => document.status === "READY") ?? bankQrDocuments[0];
        const mapAssignment = (assignment: (typeof assignments)[number]) => ({
          id: assignment.id,
          branchId: assignment.branchId,
          branchCode: assignment.branch.code,
          branchName: assignment.branch.name,
          assignmentType: assignment.assignmentType,
          attendanceMachineCode: assignment.attendanceMachineCode,
          effectiveFrom: assignment.effectiveFrom.toISOString().slice(0, 10),
          effectiveTo: assignment.effectiveTo?.toISOString().slice(0, 10) ?? null,
          version: assignment.version,
        });
        const mapSchedule = (schedule: (typeof workSchedules)[number]) => ({
          id: schedule.id,
          branchId: schedule.branchId,
          staffId: schedule.staffId,
          name: schedule.name,
          scheduledStartMinutes: schedule.scheduledStartMinutes,
          scheduledEndMinutes: schedule.scheduledEndMinutes,
          spansNextDay: schedule.spansNextDay,
          requiredLiveMinutes: schedule.requiredLiveMinutes,
          effectiveFrom: schedule.effectiveFrom.toISOString().slice(0, 10),
          effectiveTo: schedule.effectiveTo?.toISOString().slice(0, 10) ?? null,
          version: schedule.version,
        });
        const mapIdentityDocument = (
          document: (typeof identityDocuments)[number],
        ): AdminStaffDto["identityDocuments"][number] => ({
          id: document.id,
          side: document.side,
          originalFileName: document.originalFileName,
          mimeType: document.mimeType as AdminStaffDto["identityDocuments"][number]["mimeType"],
          sizeBytes: document.sizeBytes.toString(),
          status: document.status,
          version: document.version,
          uploadedAt: document.uploadedAt?.toISOString() ?? null,
          verifiedAt: document.verifiedAt?.toISOString() ?? null,
        });
        const mappedIdentityDocuments = selectedIdentityDocuments.map(mapIdentityDocument);
        const mappedBankQr: AdminStaffDto["bankQrDocument"] = selectedBankQr
          ? {
              id: selectedBankQr.id,
              originalFileName: selectedBankQr.originalFileName,
              mimeType: selectedBankQr.mimeType as NonNullable<
                AdminStaffDto["bankQrDocument"]
              >["mimeType"],
              sizeBytes: selectedBankQr.sizeBytes.toString(),
              status: selectedBankQr.status,
              version: selectedBankQr.version,
              uploadedAt: selectedBankQr.uploadedAt?.toISOString() ?? null,
              verifiedAt: selectedBankQr.verifiedAt?.toISOString() ?? null,
            }
          : null;

        return {
          ...staff,
          baseSalaryAmount: baseSalaryAmount.toString(),
          joinedDate: joinedDate?.toISOString().slice(0, 10) ?? null,
          officialDate: officialDate?.toISOString().slice(0, 10) ?? null,
          terminationDate: terminationDate?.toISOString().slice(0, 10) ?? null,
          dateOfBirth: dateOfBirth?.toISOString().slice(0, 10) ?? null,
          archivedAt: archivedAt?.toISOString() ?? null,
          currentAssignments: currentAssignments.map(mapAssignment),
          assignmentHistory: assignments.map((assignment) => ({
            ...mapAssignment(assignment),
            status: assignmentStatus(assignment, businessDate),
          })),
          currentSchedule: currentSchedule ? mapSchedule(currentSchedule) : null,
          scheduleHistory: workSchedules
            .filter((schedule) => !schedule.archivedAt)
            .map(mapSchedule),
          identityDocumentStatus: {
            front:
              mappedIdentityDocuments.find((document) => document.side === "CITIZEN_ID_FRONT")
                ?.status ?? null,
            back:
              mappedIdentityDocuments.find((document) => document.side === "CITIZEN_ID_BACK")
                ?.status ?? null,
          },
          bankQrStatus: mappedBankQr?.status ?? null,
          identityDocuments: mappedIdentityDocuments,
          bankQrDocument: mappedBankQr,
          level: levelHistories[0]?.performanceLevel ?? null,
          updatedAt: staff.updatedAt.toISOString(),
        };
      },
    ),
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
          AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: businessDate } }] }],
        }
      : query.status === "UPCOMING"
        ? { archivedAt: null, effectiveFrom: { gt: businessDate } }
        : query.status === "ENDED"
          ? { archivedAt: null, effectiveTo: { lte: businessDate } }
          : query.status === "CANCELLED"
            ? { archivedAt: { not: null } }
            : query.showHidden
              ? {}
              : {
                  archivedAt: null,
                  AND: [
                    {
                      OR: [
                        { effectiveFrom: { gt: businessDate } },
                        {
                          effectiveFrom: { lte: businessDate },
                          AND: [
                            {
                              OR: [{ effectiveTo: null }, { effectiveTo: { gt: businessDate } }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                };
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
            { attendanceMachineCode: { contains: query.search, mode: "insensitive" } },
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
        attendanceMachineCode: true,
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
        : query.showHidden
          ? {}
          : { active: true }),
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
        canManagePayroll: true,
        active: true,
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
