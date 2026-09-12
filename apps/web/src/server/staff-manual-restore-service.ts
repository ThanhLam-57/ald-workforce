import {
  idSchema,
  type StaffManualRestoreInput,
  type StaffManualRestorePreviewDto,
  type StaffManualRestorePreviewQuery,
} from "@ald/contracts";
import { prisma, type Prisma } from "@ald/db";
import { DomainError, requirePermission, type ActorContext } from "@ald/domain";

import { parseBusinessDate } from "./business-date";
import type { RequestMetadata } from "./request-metadata";
import { enforceSensitiveMutationRateLimit } from "./sensitive-rate-limit";
import { safeAssignmentAuditSnapshot, safeStaffAuditSnapshot } from "./staff-audit-snapshot";

type Transaction = Prisma.TransactionClient;
type EmploymentStatus = "ACTIVE" | "ON_LEAVE";
type EmploymentCategory = "OFFICIAL" | "PROBATION" | "CONTRACTOR" | "INTERN";

type LegacyTerminationEvidence = Readonly<{
  previousEmploymentStatus: EmploymentStatus;
  previousEmploymentCategory: EmploymentCategory;
  terminationDate: string;
  assignmentCutoff: string;
  endedAssignments: number;
  cancelledFutureAssignments: number;
  disabledUserId: string | null;
}>;

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function businessDateString(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function employmentStatus(value: unknown): EmploymentStatus | null {
  return value === "ACTIVE" || value === "ON_LEAVE" ? value : null;
}

function employmentCategory(value: unknown): EmploymentCategory | null {
  return value === "OFFICIAL" ||
    value === "PROBATION" ||
    value === "CONTRACTOR" ||
    value === "INTERN"
    ? value
    : null;
}

function nextMonthStart(value: string): string {
  const date = parseBusinessDate(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 10);
}

function invalidLegacyAudit(message: string): never {
  throw new DomainError("CONFLICT", message, { reason: "LEGACY_RECOVERY_AUDIT_INVALID" });
}

function parseLegacyTerminationEvidence(audit: {
  before: Prisma.JsonValue | null;
  after: Prisma.JsonValue | null;
}): LegacyTerminationEvidence {
  const before = jsonRecord(audit.before);
  const after = jsonRecord(audit.after);
  if (!before || !after) {
    return invalidLegacyAudit("Nhật ký nghỉ việc cũ không đủ dữ liệu để khôi phục an toàn.");
  }
  if (hasOwn(before, "terminationRecovery")) {
    throw new DomainError(
      "CONFLICT",
      "Lần nghỉ việc này có bản chụp khôi phục. Không được dùng chế độ khôi phục thủ công.",
      { reason: "MANUAL_RECOVERY_NOT_AVAILABLE" },
    );
  }

  const previousEmploymentStatus = employmentStatus(before.employmentStatus);
  const previousEmploymentCategory = employmentCategory(before.employmentCategory);
  const terminationDate = businessDateString(after.terminationDate);
  const assignmentCutoff = businessDateString(after.assignmentCutoff);
  const endedAssignments = nonNegativeInteger(after.endedAssignments);
  const cancelledFutureAssignments = nonNegativeInteger(after.cancelledFutureAssignments);
  const disabledUserId =
    after.disabledUserId === null
      ? null
      : typeof after.disabledUserId === "string" && idSchema.safeParse(after.disabledUserId).success
        ? after.disabledUserId
        : undefined;

  if (
    !previousEmploymentStatus ||
    !previousEmploymentCategory ||
    after.employmentStatus !== "TERMINATED" ||
    !terminationDate ||
    !assignmentCutoff ||
    assignmentCutoff !== nextMonthStart(terminationDate) ||
    endedAssignments === null ||
    cancelledFutureAssignments === null ||
    disabledUserId === undefined
  ) {
    return invalidLegacyAudit(
      "Nhật ký nghỉ việc cũ không hợp lệ. Không thể suy luận dữ liệu an toàn.",
    );
  }

  return {
    previousEmploymentStatus,
    previousEmploymentCategory,
    terminationDate,
    assignmentCutoff,
    endedAssignments,
    cancelledFutureAssignments,
    disabledUserId,
  };
}

async function buildManualRestoreContext(
  tx: Transaction,
  actor: ActorContext,
  id: string,
  expectedStaffVersion: number,
) {
  const staff = await tx.staffMember.findFirst({
    where: { id, companyId: actor.companyId, archivedAt: null },
  });
  if (!staff) {
    throw new DomainError("NOT_FOUND", "Không tìm thấy nhân viên.");
  }
  if (staff.version !== expectedStaffVersion) {
    throw new DomainError(
      "CONFLICT",
      "Hồ sơ nhân viên đã được cập nhật bởi người khác. Hãy tải lại.",
      { reason: "STALE_STAFF_VERSION" },
    );
  }
  if (staff.employmentStatus !== "TERMINATED" || !staff.terminationDate) {
    throw new DomainError("CONFLICT", "Chỉ có thể khôi phục nhân viên đã nghỉ việc.");
  }

  const terminationAudit = await tx.auditLog.findFirst({
    where: {
      companyId: actor.companyId,
      entityType: "StaffMember",
      entityId: id,
      action: "staff.terminate",
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    select: { id: true, occurredAt: true, before: true, after: true },
  });
  if (!terminationAudit) {
    return invalidLegacyAudit("Không tìm thấy nhật ký nghỉ việc tương ứng.");
  }
  const evidence = parseLegacyTerminationEvidence(terminationAudit);
  const currentTerminationDate = staff.terminationDate.toISOString().slice(0, 10);
  if (evidence.terminationDate !== currentTerminationDate) {
    throw new DomainError("CONFLICT", "Ngày nghỉ việc hiện tại không còn khớp với nhật ký gốc.", {
      reason: "TERMINATION_DATE_MISMATCH",
    });
  }

  const terminationDate = parseBusinessDate(evidence.terminationDate);
  const assignmentCutoff = parseBusinessDate(evidence.assignmentCutoff);
  const [histories, assignmentCandidates, linkedUser] = await Promise.all([
    tx.staffEmploymentHistory.findMany({
      where: {
        companyId: actor.companyId,
        staffId: id,
        effectiveFrom: { gte: terminationDate },
      },
      orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }],
    }),
    tx.branchAssignment.findMany({
      where: {
        companyId: actor.companyId,
        staffId: id,
        archivedAt: null,
        effectiveFrom: { lt: assignmentCutoff },
        effectiveTo: assignmentCutoff,
      },
      include: {
        branch: { select: { id: true, code: true, name: true, isActive: true } },
      },
      orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
    }),
    evidence.disabledUserId
      ? tx.user.findFirst({
          where: {
            id: evidence.disabledUserId,
            companyId: actor.companyId,
            staffId: id,
          },
          select: {
            id: true,
            name: true,
            username: true,
            role: true,
            active: true,
            banned: true,
            version: true,
          },
        })
      : Promise.resolve(null),
  ]);

  const blockers: string[] = [];
  const warnings: string[] = [
    "Dữ liệu này được suy luận từ nhật ký cũ và cần Tổng quản lý kiểm tra trước khi xác nhận.",
  ];
  const historyAtTermination = histories.filter(
    (history) => history.effectiveFrom.getTime() === terminationDate.getTime(),
  );
  const futureHistories = histories.filter(
    (history) => history.effectiveFrom.getTime() > terminationDate.getTime(),
  );
  const recoverableHistory =
    historyAtTermination.length === 1 && historyAtTermination[0]?.employmentStatus === "TERMINATED"
      ? historyAtTermination[0]
      : null;

  if (!recoverableHistory) {
    blockers.push("Không tìm thấy đúng một dòng lịch sử nghỉ việc tại ngày đã ghi nhận.");
  }
  if (futureHistories.length > 0) {
    blockers.push(
      "Có lịch sử việc làm sau ngày nghỉ; trạng thái gốc của các dòng này không còn đủ để tự khôi phục.",
    );
  }
  if (recoverableHistory?.effectiveTo) {
    blockers.push(
      "Dòng lịch sử nghỉ việc có ngày kết thúc nhưng không có lịch sử kế tiếp phù hợp.",
    );
  }
  if (
    staff.employmentCategory !== evidence.previousEmploymentCategory ||
    (recoverableHistory &&
      recoverableHistory.employmentCategory !== evidence.previousEmploymentCategory)
  ) {
    blockers.push(
      "Loại hình nhân sự đã thay đổi sau lần nghỉ việc; không thể tự suy luận an toàn.",
    );
  }
  if (evidence.cancelledFutureAssignments !== 0) {
    blockers.push(
      "Lần nghỉ việc đã hủy phân công tương lai; dữ liệu cũ không lưu đủ để khôi phục tự động.",
    );
  }
  if (evidence.endedAssignments > 1) {
    blockers.push(
      "Lần nghỉ việc đã kết thúc nhiều phân công; cần xử lý riêng để tránh cấp sai quyền.",
    );
  }
  if (assignmentCandidates.length !== evidence.endedAssignments) {
    blockers.push("Không xác định duy nhất phân công đã bị kết thúc bởi lần nghỉ việc này.");
  }

  const assignment = assignmentCandidates.length === 1 ? assignmentCandidates[0] : null;
  if (assignment) {
    warnings.push(
      "Phân công hiển thị chỉ là ứng viên suy luận từ mốc kết thúc và số lượng trong nhật ký cũ; hãy bỏ chọn nếu chưa chắc chắn.",
    );
  }
  if (assignment && !assignment.branch.isActive) {
    blockers.push("Cơ sở của phân công cũ đang ngừng hoạt động.");
  }
  if (
    assignment &&
    (assignment.assignmentType === "PRIMARY_MANAGER" ||
      assignment.assignmentType === "SECONDARY_MANAGER")
  ) {
    blockers.push(
      "Không thể khôi phục thủ công phân công quản lý vì thao tác này sẽ cấp lại quyền truy cập cơ sở.",
    );
  }

  if (evidence.disabledUserId && !linkedUser) {
    warnings.push("Tài khoản trong nhật ký cũ không còn liên kết đúng với nhân viên này.");
  } else if (linkedUser?.active) {
    warnings.push("Tài khoản liên kết hiện đã hoạt động; hệ thống sẽ không thay đổi tài khoản.");
  } else if (linkedUser?.banned) {
    warnings.push("Tài khoản đang bị khóa và không thể được kích hoạt bằng thao tác này.");
  } else if (linkedUser && linkedUser.role !== "LIVE_EMPLOYEE") {
    warnings.push(
      "Tài khoản quản lý không thể được kích hoạt bằng khôi phục thủ công; hãy xử lý riêng trong quản trị tài khoản.",
    );
  }
  warnings.push("Các phiên đăng nhập cũ không được khôi phục; nhân viên phải đăng nhập lại.");

  const preview: StaffManualRestorePreviewDto = {
    eligible: blockers.length === 0,
    blockers,
    warnings,
    staff: {
      id: staff.id,
      staffCode: staff.staffCode,
      fullName: staff.fullName,
      employmentStatus: "TERMINATED",
      employmentCategory: staff.employmentCategory,
      terminationDate: currentTerminationDate,
      version: staff.version,
    },
    terminationAudit: {
      id: terminationAudit.id,
      occurredAt: terminationAudit.occurredAt.toISOString(),
    },
    assignmentCutoff: evidence.assignmentCutoff,
    suggestedEmploymentStatus: evidence.previousEmploymentStatus,
    suggestedEmploymentCategory: evidence.previousEmploymentCategory,
    history: recoverableHistory
      ? {
          id: recoverableHistory.id,
          employmentStatus: "TERMINATED",
          employmentCategory: recoverableHistory.employmentCategory,
          effectiveFrom: recoverableHistory.effectiveFrom.toISOString().slice(0, 10),
          effectiveTo: recoverableHistory.effectiveTo?.toISOString().slice(0, 10) ?? null,
          version: recoverableHistory.version,
        }
      : null,
    assignment: assignment
      ? {
          id: assignment.id,
          branch: assignment.branch,
          assignmentType: assignment.assignmentType,
          attendanceMachineCode: assignment.attendanceMachineCode,
          effectiveFrom: assignment.effectiveFrom.toISOString().slice(0, 10),
          effectiveTo: evidence.assignmentCutoff,
          suggestedEffectiveTo: null,
          version: assignment.version,
        }
      : null,
    user: linkedUser
      ? {
          ...linkedUser,
          canReactivate:
            linkedUser.role === "LIVE_EMPLOYEE" && !linkedUser.active && !linkedUser.banned,
        }
      : null,
    sessionsRestored: false,
  };

  return {
    preview,
    staff,
    terminationAudit,
    evidence,
    history: recoverableHistory,
    assignment,
    user: linkedUser,
  };
}

export async function previewManualStaffRestore(
  actor: ActorContext,
  id: string,
  input: StaffManualRestorePreviewQuery,
): Promise<StaffManualRestorePreviewDto> {
  requirePermission(actor, "staff:update");
  return prisma.$transaction(async (tx) => {
    const context = await buildManualRestoreContext(tx, actor, id, input.version);
    return context.preview;
  });
}

function historyAuditSnapshot(history: {
  id: string;
  employmentStatus: string;
  employmentCategory: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  version: number;
}) {
  return {
    id: history.id,
    employmentStatus: history.employmentStatus,
    employmentCategory: history.employmentCategory,
    effectiveFrom: history.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: history.effectiveTo?.toISOString().slice(0, 10) ?? null,
    version: history.version,
  };
}

function userAuditSnapshot(user: {
  id: string;
  role: string;
  active: boolean;
  banned: boolean;
  version: number;
}) {
  return {
    id: user.id,
    role: user.role,
    active: user.active,
    banned: user.banned,
    version: user.version,
  };
}

function auditJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function restoreStaffManually(
  actor: ActorContext,
  id: string,
  input: StaffManualRestoreInput,
  metadata: RequestMetadata,
) {
  requirePermission(actor, "staff:update");
  await enforceSensitiveMutationRateLimit(actor, "staff.termination.restore-manual", {
    windowSeconds: 300,
    maxAttempts: 10,
  });

  try {
    return await prisma.$transaction(
      async (tx) => {
        const context = await buildManualRestoreContext(tx, actor, id, input.version);
        if (!context.preview.eligible || !context.history) {
          throw new DomainError(
            "CONFLICT",
            "Dữ liệu hiện tại chưa đủ điều kiện để khôi phục thủ công an toàn.",
            {
              reason: "MANUAL_RECOVERY_BLOCKED",
              blockers: context.preview.blockers,
            },
          );
        }
        if (input.terminationAuditId !== context.terminationAudit.id) {
          throw new DomainError("CONFLICT", "Nhật ký nghỉ việc đã thay đổi. Hãy tải lại.");
        }
        if (
          input.history.id !== context.history.id ||
          input.history.version !== context.history.version
        ) {
          throw new DomainError("CONFLICT", "Lịch sử việc làm đã thay đổi. Hãy tải lại.");
        }

        if (context.assignment && input.assignment) {
          if (
            input.assignment.id !== context.assignment.id ||
            input.assignment.version !== context.assignment.version
          ) {
            throw new DomainError("CONFLICT", "Phân công được chọn đã thay đổi. Hãy tải lại.");
          }
        } else if (input.assignment) {
          throw new DomainError("VALIDATION_ERROR", "Không có phân công cũ hợp lệ để khôi phục.");
        }

        if (input.user) {
          if (
            !context.user ||
            input.user.id !== context.user.id ||
            input.user.version !== context.user.version
          ) {
            throw new DomainError("CONFLICT", "Tài khoản liên kết đã thay đổi. Hãy tải lại.");
          }
          if (context.user.role !== "LIVE_EMPLOYEE" || context.user.active || context.user.banned) {
            throw new DomainError(
              "CONFLICT",
              "Chỉ tài khoản nhân viên Live đang vô hiệu hóa và không bị khóa mới có thể được kích hoạt bằng thao tác này.",
            );
          }
        }

        const desiredAssignmentEnd = input.assignment?.effectiveTo
          ? parseBusinessDate(input.assignment.effectiveTo)
          : null;
        const assignmentCutoff = parseBusinessDate(context.evidence.assignmentCutoff);
        if (desiredAssignmentEnd && desiredAssignmentEnd <= assignmentCutoff) {
          throw new DomainError(
            "VALIDATION_ERROR",
            "Ngày kết thúc phân công khôi phục phải sau ngày bị hệ thống kết thúc.",
          );
        }

        if (context.assignment && input.assignment) {
          if (!context.assignment.branch.isActive) {
            throw new DomainError("CONFLICT", "Cơ sở của phân công cũ đang ngừng hoạt động.");
          }
          const overlapWhere = {
            id: { not: context.assignment.id },
            companyId: actor.companyId,
            staffId: id,
            assignmentType: context.assignment.assignmentType,
            archivedAt: null,
            ...(desiredAssignmentEnd ? { effectiveFrom: { lt: desiredAssignmentEnd } } : {}),
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: context.assignment.effectiveFrom } }],
          } satisfies Prisma.BranchAssignmentWhereInput;
          const overlap = await tx.branchAssignment.findFirst({
            where: overlapWhere,
            select: { id: true },
          });
          if (overlap) {
            throw new DomainError(
              "CONFLICT",
              "Khoảng phân công khôi phục bị trùng với lịch sử hiện có.",
            );
          }

          if (
            context.assignment.assignmentType === "MEMBER" &&
            context.assignment.attendanceMachineCode
          ) {
            const machineCodeOverlap = await tx.branchAssignment.findFirst({
              where: {
                id: { not: context.assignment.id },
                companyId: actor.companyId,
                branchId: context.assignment.branchId,
                assignmentType: "MEMBER",
                attendanceMachineCode: context.assignment.attendanceMachineCode,
                archivedAt: null,
                ...(desiredAssignmentEnd ? { effectiveFrom: { lt: desiredAssignmentEnd } } : {}),
                OR: [
                  { effectiveTo: null },
                  { effectiveTo: { gt: context.assignment.effectiveFrom } },
                ],
              },
              select: { id: true },
            });
            if (machineCodeOverlap) {
              throw new DomainError(
                "CONFLICT",
                "Mã máy chấm công đã được dùng tại cơ sở trong khoảng cần khôi phục.",
              );
            }
          }
        }

        const staffUpdated = await tx.staffMember.updateMany({
          where: {
            id,
            companyId: actor.companyId,
            archivedAt: null,
            employmentStatus: "TERMINATED",
            terminationDate: parseBusinessDate(context.evidence.terminationDate),
            version: context.staff.version,
          },
          data: {
            employmentStatus: input.targetEmploymentStatus,
            terminationDate: null,
            version: { increment: 1 },
          },
        });
        if (staffUpdated.count !== 1) {
          throw new DomainError("CONFLICT", "Hồ sơ nhân viên đã thay đổi. Hãy tải lại.");
        }

        const historyUpdated = await tx.staffEmploymentHistory.updateMany({
          where: {
            id: context.history.id,
            companyId: actor.companyId,
            staffId: id,
            employmentStatus: "TERMINATED",
            employmentCategory: context.evidence.previousEmploymentCategory,
            effectiveFrom: parseBusinessDate(context.evidence.terminationDate),
            effectiveTo: null,
            version: context.history.version,
          },
          data: {
            employmentStatus: input.targetEmploymentStatus,
            version: { increment: 1 },
          },
        });
        if (historyUpdated.count !== 1) {
          throw new DomainError("CONFLICT", "Lịch sử việc làm đã thay đổi. Hãy tải lại.");
        }

        let restoredAssignment = null;
        if (context.assignment && input.assignment) {
          const assignmentUpdated = await tx.branchAssignment.updateMany({
            where: {
              id: context.assignment.id,
              companyId: actor.companyId,
              staffId: id,
              archivedAt: null,
              effectiveTo: assignmentCutoff,
              version: context.assignment.version,
            },
            data: {
              effectiveTo: desiredAssignmentEnd,
              version: { increment: 1 },
            },
          });
          if (assignmentUpdated.count !== 1) {
            throw new DomainError("CONFLICT", "Phân công đã thay đổi. Hãy tải lại.");
          }
          restoredAssignment = await tx.branchAssignment.findUniqueOrThrow({
            where: { id: context.assignment.id },
          });
        }

        let restoredUser = null;
        if (context.user && input.user) {
          const userUpdated = await tx.user.updateMany({
            where: {
              id: context.user.id,
              companyId: actor.companyId,
              staffId: id,
              role: "LIVE_EMPLOYEE",
              active: false,
              banned: false,
              version: context.user.version,
            },
            data: { active: true, version: { increment: 1 } },
          });
          if (userUpdated.count !== 1) {
            throw new DomainError("CONFLICT", "Tài khoản liên kết đã thay đổi. Hãy tải lại.");
          }
          await tx.session.deleteMany({ where: { userId: context.user.id } });
          restoredUser = await tx.user.findUniqueOrThrow({
            where: { id: context.user.id },
            select: { id: true, role: true, active: true, banned: true, version: true },
          });
        }

        const [afterStaff, afterHistory] = await Promise.all([
          tx.staffMember.findUniqueOrThrow({ where: { id } }),
          tx.staffEmploymentHistory.findUniqueOrThrow({ where: { id: context.history.id } }),
        ]);
        await tx.auditLog.create({
          data: {
            companyId: actor.companyId,
            ...(context.assignment ? { branchId: context.assignment.branchId } : {}),
            actorUserId: actor.userId,
            action: "staff.termination.restore-manual",
            entityType: "StaffMember",
            entityId: id,
            reason: input.reason,
            before: auditJson({
              ...safeStaffAuditSnapshot(context.staff),
              manualRecovery: {
                sourceTerminationAuditId: context.terminationAudit.id,
                terminationDate: context.evidence.terminationDate,
                assignmentCutoff: context.evidence.assignmentCutoff,
                acknowledged: input.acknowledged,
                targetEmploymentStatus: input.targetEmploymentStatus,
                history: historyAuditSnapshot(context.history),
                assignment: context.assignment
                  ? safeAssignmentAuditSnapshot(context.assignment)
                  : null,
                user: context.user ? userAuditSnapshot(context.user) : null,
                reactivateUser: Boolean(input.user),
              },
            }),
            after: auditJson({
              ...safeStaffAuditSnapshot(afterStaff),
              manualRecovery: {
                sourceTerminationAuditId: context.terminationAudit.id,
                history: historyAuditSnapshot(afterHistory),
                assignment: restoredAssignment
                  ? safeAssignmentAuditSnapshot(restoredAssignment)
                  : null,
                assignmentSkipped: Boolean(context.assignment && !restoredAssignment),
                user: restoredUser ? userAuditSnapshot(restoredUser) : null,
                restoredAssignment: Boolean(restoredAssignment),
                reactivatedUser: Boolean(restoredUser),
                sessionsRestored: false,
              },
            }),
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
          },
        });

        return {
          id: afterStaff.id,
          employmentStatus: afterStaff.employmentStatus,
          employmentCategory: afterStaff.employmentCategory,
          terminationDate: null,
          version: afterStaff.version,
          assignmentRestored: Boolean(restoredAssignment),
          userReactivated: Boolean(restoredUser),
          sessionsRestored: false as const,
        };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "P2002" || error.code === "P2004")
    ) {
      throw new DomainError(
        "CONFLICT",
        "Không thể khôi phục vì lịch sử hoặc phân công đã thay đổi. Hãy tải lại dữ liệu.",
      );
    }
    throw error;
  }
}
