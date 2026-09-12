import { randomUUID } from "node:crypto";

import { prisma } from "@ald/db";
import type { ActorContext } from "@ald/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { restoreStaff } from "./services";
import { previewManualStaffRestore, restoreStaffManually } from "./staff-manual-restore-service";

const runId = randomUUID().slice(0, 8);
const companyId = randomUUID();
const branchId = randomUUID();
const gmUserId = randomUUID();
const metadata = {
  requestId: `manual-restore-${runId}`,
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
} as const;

const gm: ActorContext = {
  userId: gmUserId,
  companyId,
  staffId: null,
  role: "GENERAL_MANAGER",
  activeBranchIds: [],
};
const manager: ActorContext = {
  userId: randomUUID(),
  companyId,
  staffId: null,
  role: "TRAINING_MANAGER",
  activeBranchIds: [branchId],
};

type LegacyCaseOptions = Readonly<{
  previousStatus?: "ACTIVE" | "ON_LEAVE";
  endedAssignments?: number;
  createAssignment?: boolean;
  extraManagerCandidate?: boolean;
  cancelledFutureAssignments?: number;
  withFutureHistory?: boolean;
  withUser?: boolean;
  userRole?: "GENERAL_MANAGER" | "TRAINING_MANAGER" | "LIVE_EMPLOYEE";
  recoveryField?: "ABSENT" | "NULL";
}>;

async function createLegacyCase(options: LegacyCaseOptions = {}) {
  const suffix = randomUUID().slice(0, 8);
  const previousStatus = options.previousStatus ?? "ACTIVE";
  const endedAssignments = options.endedAssignments ?? 1;
  const createAssignment = options.createAssignment ?? endedAssignments > 0;
  const terminationDate = new Date("2026-07-15T00:00:00.000Z");
  const assignmentCutoff = new Date("2026-08-01T00:00:00.000Z");
  const futureHistoryDate = new Date("2026-09-01T00:00:00.000Z");

  const staff = await prisma.staffMember.create({
    data: {
      companyId,
      staffCode: `MR-${suffix}`,
      fullName: `Nhân viên cũ ${suffix}`,
      jobTitle: "Live",
      joinedDate: new Date("2026-06-01T00:00:00.000Z"),
      terminationDate,
      employmentCategory: "OFFICIAL",
      employmentStatus: "TERMINATED",
      version: 2,
    },
  });
  await prisma.staffEmploymentHistory.create({
    data: {
      companyId,
      staffId: staff.id,
      employmentStatus: previousStatus,
      employmentCategory: "OFFICIAL",
      effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
      effectiveTo: terminationDate,
      version: 2,
      createdByUserId: gmUserId,
    },
  });
  const history = await prisma.staffEmploymentHistory.create({
    data: {
      companyId,
      staffId: staff.id,
      employmentStatus: "TERMINATED",
      employmentCategory: "OFFICIAL",
      effectiveFrom: terminationDate,
      effectiveTo: options.withFutureHistory ? futureHistoryDate : null,
      createdByUserId: gmUserId,
    },
  });
  if (options.withFutureHistory) {
    await prisma.staffEmploymentHistory.create({
      data: {
        companyId,
        staffId: staff.id,
        employmentStatus: "TERMINATED",
        employmentCategory: "OFFICIAL",
        effectiveFrom: futureHistoryDate,
        createdByUserId: gmUserId,
      },
    });
  }

  const assignment = createAssignment
    ? await prisma.branchAssignment.create({
        data: {
          companyId,
          branchId,
          staffId: staff.id,
          assignmentType: "MEMBER",
          attendanceMachineCode: `MR-${suffix}`.toUpperCase(),
          effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
          effectiveTo: assignmentCutoff,
          version: 2,
        },
      })
    : null;
  const extraManagerCandidate = options.extraManagerCandidate
    ? await prisma.branchAssignment.create({
        data: {
          companyId,
          branchId,
          staffId: staff.id,
          assignmentType: "PRIMARY_MANAGER",
          effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
          effectiveTo: assignmentCutoff,
          version: 2,
        },
      })
    : null;

  const user = options.withUser
    ? await prisma.user.create({
        data: {
          companyId,
          staffId: staff.id,
          name: staff.fullName,
          email: `manual-restore-${suffix}@test.local`,
          username: `manual_restore_${suffix}`,
          role: options.userRole ?? "LIVE_EMPLOYEE",
          active: false,
          banned: false,
          version: 2,
        },
      })
    : null;
  const before = {
    employmentStatus: previousStatus,
    employmentCategory: "OFFICIAL",
    ...(options.recoveryField === "NULL" ? { terminationRecovery: null } : {}),
  };
  const audit = await prisma.auditLog.create({
    data: {
      companyId,
      branchId,
      actorUserId: gmUserId,
      action: "staff.terminate",
      entityType: "StaffMember",
      entityId: staff.id,
      reason: "SYSTEM:STAFF_TERMINATED_FROM_UI",
      before,
      after: {
        employmentStatus: "TERMINATED",
        terminationDate: "2026-07-15",
        assignmentCutoff: "2026-08-01",
        endedAssignments,
        cancelledFutureAssignments: options.cancelledFutureAssignments ?? 0,
        disabledUserId: user?.id ?? null,
        sessionsRevoked: Boolean(user),
      },
      requestId: metadata.requestId,
    },
  });

  return { staff, history, assignment, extraManagerCandidate, user, audit };
}

beforeAll(async () => {
  await prisma.company.create({
    data: {
      id: companyId,
      name: `Manual restore ${runId}`,
      slug: `manual-restore-${runId}`,
    },
  });
  await prisma.branch.create({
    data: {
      id: branchId,
      companyId,
      code: `MR-${runId}`.toUpperCase(),
      name: "Cơ sở khôi phục thủ công",
    },
  });
  await prisma.user.create({
    data: {
      id: gmUserId,
      companyId,
      name: "GM khôi phục thủ công",
      email: `gm-manual-restore-${runId}@test.local`,
      username: `gm_manual_restore_${runId}`,
      role: "GENERAL_MANAGER",
    },
  });
});

afterAll(async () => {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL ald.audit_cleanup = 'on'");
    await tx.$executeRawUnsafe(
      'ALTER TABLE "staff_employment_history" DISABLE TRIGGER "staff_employment_history_no_delete"',
    );
    await tx.auditLog.deleteMany({ where: { companyId } });
    await tx.session.deleteMany({ where: { user: { companyId } } });
    await tx.branchAssignment.deleteMany({ where: { companyId } });
    await tx.staffEmploymentHistory.deleteMany({ where: { companyId } });
    await tx.user.deleteMany({ where: { companyId } });
    await tx.staffMember.deleteMany({ where: { companyId } });
    await tx.branch.deleteMany({ where: { companyId } });
    await tx.company.deleteMany({ where: { id: companyId } });
    await tx.$executeRawUnsafe(
      'ALTER TABLE "staff_employment_history" ENABLE TRIGGER "staff_employment_history_no_delete"',
    );
  });
  await prisma.$disconnect();
});

describe("legacy staff termination manual recovery", () => {
  it("preview và khôi phục đúng history, assignment, tài khoản với audit", async () => {
    const legacy = await createLegacyCase({ withUser: true });
    const preview = await previewManualStaffRestore(gm, legacy.staff.id, {
      version: legacy.staff.version,
    });

    expect(preview).toMatchObject({
      eligible: true,
      blockers: [],
      suggestedEmploymentStatus: "ACTIVE",
      suggestedEmploymentCategory: "OFFICIAL",
      history: { id: legacy.history.id, version: legacy.history.version },
      assignment: {
        id: legacy.assignment?.id,
        branch: { id: branchId, isActive: true },
        effectiveTo: "2026-08-01",
        suggestedEffectiveTo: null,
      },
      user: { id: legacy.user?.id, canReactivate: true },
      sessionsRestored: false,
    });

    const restored = await restoreStaffManually(
      gm,
      legacy.staff.id,
      {
        version: preview.staff.version,
        terminationAuditId: preview.terminationAudit.id,
        targetEmploymentStatus: "ACTIVE",
        history: { id: preview.history!.id, version: preview.history!.version },
        assignment: {
          id: preview.assignment!.id,
          version: preview.assignment!.version,
          effectiveTo: null,
        },
        user: { id: preview.user!.id, version: preview.user!.version },
        reason: "Tổng quản lý xác nhận đã bấm nhầm thao tác cho nghỉ việc.",
        acknowledged: true,
      },
      metadata,
    );
    const [staff, history, assignment, user, sessions, audit] = await Promise.all([
      prisma.staffMember.findUniqueOrThrow({ where: { id: legacy.staff.id } }),
      prisma.staffEmploymentHistory.findUniqueOrThrow({ where: { id: legacy.history.id } }),
      prisma.branchAssignment.findUniqueOrThrow({ where: { id: legacy.assignment!.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: legacy.user!.id } }),
      prisma.session.count({ where: { userId: legacy.user!.id } }),
      prisma.auditLog.findFirstOrThrow({
        where: {
          companyId,
          entityId: legacy.staff.id,
          action: "staff.termination.restore-manual",
        },
      }),
    ]);

    expect(restored).toMatchObject({
      employmentStatus: "ACTIVE",
      assignmentRestored: true,
      userReactivated: true,
      sessionsRestored: false,
    });
    expect(staff).toMatchObject({ employmentStatus: "ACTIVE", terminationDate: null });
    expect(history.employmentStatus).toBe("ACTIVE");
    expect(assignment.effectiveTo).toBeNull();
    expect(user.active).toBe(true);
    expect(sessions).toBe(0);
    expect(audit).toMatchObject({
      reason: "Tổng quản lý xác nhận đã bấm nhầm thao tác cho nghỉ việc.",
      branchId,
    });
    expect(audit.after).toMatchObject({
      manualRecovery: {
        sourceTerminationAuditId: legacy.audit.id,
        restoredAssignment: true,
        reactivatedUser: true,
        sessionsRestored: false,
      },
    });
  });

  it("cho phép giữ tài khoản vô hiệu hóa và chọn trạng thái nghỉ phép", async () => {
    const legacy = await createLegacyCase({ previousStatus: "ON_LEAVE", withUser: true });
    const preview = await previewManualStaffRestore(gm, legacy.staff.id, {
      version: legacy.staff.version,
    });
    const restored = await restoreStaffManually(
      gm,
      legacy.staff.id,
      {
        version: preview.staff.version,
        terminationAuditId: preview.terminationAudit.id,
        targetEmploymentStatus: "ON_LEAVE",
        history: { id: preview.history!.id, version: preview.history!.version },
        assignment: {
          id: preview.assignment!.id,
          version: preview.assignment!.version,
          effectiveTo: "2026-12-01",
        },
        user: null,
        reason: "Giữ tài khoản khóa trong lúc kiểm tra quyền truy cập.",
        acknowledged: true,
      },
      metadata,
    );
    const [user, assignment] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: legacy.user!.id } }),
      prisma.branchAssignment.findUniqueOrThrow({ where: { id: legacy.assignment!.id } }),
    ]);

    expect(restored).toMatchObject({ employmentStatus: "ON_LEAVE", userReactivated: false });
    expect(user.active).toBe(false);
    expect(assignment.effectiveTo?.toISOString().slice(0, 10)).toBe("2026-12-01");
  });

  it("cho phép bỏ qua assignment được suy luận và ghi rõ lựa chọn trong audit", async () => {
    const legacy = await createLegacyCase();
    const preview = await previewManualStaffRestore(gm, legacy.staff.id, {
      version: legacy.staff.version,
    });

    const restored = await restoreStaffManually(
      gm,
      legacy.staff.id,
      {
        version: preview.staff.version,
        terminationAuditId: preview.terminationAudit.id,
        targetEmploymentStatus: "ACTIVE",
        history: { id: preview.history!.id, version: preview.history!.version },
        assignment: null,
        user: null,
        reason: "Chỉ khôi phục hồ sơ; phân công sẽ được kiểm tra riêng.",
        acknowledged: true,
      },
      metadata,
    );
    const [assignment, audit] = await Promise.all([
      prisma.branchAssignment.findUniqueOrThrow({ where: { id: legacy.assignment!.id } }),
      prisma.auditLog.findFirstOrThrow({
        where: {
          companyId,
          entityId: legacy.staff.id,
          action: "staff.termination.restore-manual",
        },
      }),
    ]);

    expect(restored).toMatchObject({
      employmentStatus: "ACTIVE",
      assignmentRestored: false,
    });
    expect(assignment.effectiveTo?.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(audit.after).toMatchObject({
      manualRecovery: { restoredAssignment: false, assignmentSkipped: true },
    });
  });

  it("không kích hoạt tài khoản quản lý qua luồng legacy", async () => {
    const legacy = await createLegacyCase({
      endedAssignments: 0,
      createAssignment: false,
      withUser: true,
      userRole: "TRAINING_MANAGER",
    });
    const preview = await previewManualStaffRestore(gm, legacy.staff.id, {
      version: legacy.staff.version,
    });

    expect(preview).toMatchObject({
      eligible: true,
      user: { id: legacy.user?.id, role: "TRAINING_MANAGER", canReactivate: false },
    });
    await expect(
      restoreStaffManually(
        gm,
        legacy.staff.id,
        {
          version: preview.staff.version,
          terminationAuditId: preview.terminationAudit.id,
          targetEmploymentStatus: "ACTIVE",
          history: { id: preview.history!.id, version: preview.history!.version },
          assignment: null,
          user: { id: preview.user!.id, version: preview.user!.version },
          reason: "Không được kích hoạt tài khoản quản lý từ luồng này.",
          acknowledged: true,
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const [staff, user] = await Promise.all([
      prisma.staffMember.findUniqueOrThrow({ where: { id: legacy.staff.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: legacy.user!.id } }),
    ]);
    expect(staff.employmentStatus).toBe("TERMINATED");
    expect(user.active).toBe(false);
  });

  it("chỉ cho Tổng quản lý và không làm lộ nhân viên công ty khác", async () => {
    const legacy = await createLegacyCase({ endedAssignments: 0, createAssignment: false });

    await expect(
      previewManualStaffRestore(manager, legacy.staff.id, { version: legacy.staff.version }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      previewManualStaffRestore(
        { ...gm, companyId: randomUUID(), userId: randomUUID() },
        legacy.staff.id,
        { version: legacy.staff.version },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("không fallback manual khi field recovery snapshot tồn tại nhưng hỏng", async () => {
    const legacy = await createLegacyCase({
      endedAssignments: 0,
      createAssignment: false,
      recoveryField: "NULL",
    });

    await expect(
      restoreStaff(
        gm,
        legacy.staff.id,
        { version: legacy.staff.version, reason: "Không dùng snapshot hỏng." },
        metadata,
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "RECOVERY_SNAPSHOT_INVALID" },
    });
    await expect(
      previewManualStaffRestore(gm, legacy.staff.id, { version: legacy.staff.version }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "MANUAL_RECOVERY_NOT_AVAILABLE" },
    });
  });

  it("đánh dấu legacy thiếu snapshot để UI mở preview manual", async () => {
    const legacy = await createLegacyCase({ endedAssignments: 0, createAssignment: false });

    await expect(
      restoreStaff(
        gm,
        legacy.staff.id,
        { version: legacy.staff.version, reason: "Chuyển sang khôi phục thủ công." },
        metadata,
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "LEGACY_RECOVERY_REQUIRED" },
    });
  });

  it("không gợi ý legacy manual nếu hoàn toàn thiếu audit nghỉ việc", async () => {
    const staff = await prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `NOAUD-${randomUUID().slice(0, 8)}`,
        fullName: "Nhân viên thiếu nhật ký nghỉ việc",
        jobTitle: "Live",
        employmentCategory: "OFFICIAL",
        employmentStatus: "TERMINATED",
        terminationDate: new Date("2026-07-15T00:00:00.000Z"),
      },
    });

    await expect(
      restoreStaff(
        gm,
        staff.id,
        { version: staff.version, reason: "Không có nguồn audit để khôi phục." },
        metadata,
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "TERMINATION_AUDIT_MISSING" },
    });
  });

  it("block phân công quản lý để không tự cấp lại phạm vi cơ sở", async () => {
    const legacy = await createLegacyCase({
      endedAssignments: 1,
      createAssignment: false,
      extraManagerCandidate: true,
    });
    const preview = await previewManualStaffRestore(gm, legacy.staff.id, {
      version: legacy.staff.version,
    });

    expect(preview.eligible).toBe(false);
    expect(preview.assignment?.assignmentType).toBe("PRIMARY_MANAGER");
    expect(preview.blockers).toContain(
      "Không thể khôi phục thủ công phân công quản lý vì thao tác này sẽ cấp lại quyền truy cập cơ sở.",
    );
  });

  it("block future history và assignment candidate mơ hồ mà không mutation", async () => {
    const legacy = await createLegacyCase({
      endedAssignments: 1,
      extraManagerCandidate: true,
      withFutureHistory: true,
    });
    const preview = await previewManualStaffRestore(gm, legacy.staff.id, {
      version: legacy.staff.version,
    });

    expect(preview.eligible).toBe(false);
    expect(preview.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("lịch sử việc làm sau ngày nghỉ"),
        expect.stringContaining("Không xác định duy nhất phân công"),
      ]),
    );
    await expect(
      restoreStaffManually(
        gm,
        legacy.staff.id,
        {
          version: preview.staff.version,
          terminationAuditId: preview.terminationAudit.id,
          targetEmploymentStatus: "ACTIVE",
          history: { id: legacy.history.id, version: legacy.history.version },
          assignment: null,
          user: null,
          reason: "Không được ghi khi preview đang bị chặn.",
          acknowledged: true,
        },
        metadata,
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "MANUAL_RECOVERY_BLOCKED" },
    });
    const unchanged = await prisma.staffMember.findUniqueOrThrow({
      where: { id: legacy.staff.id },
    });
    expect(unchanged).toMatchObject({
      employmentStatus: "TERMINATED",
      terminationDate: new Date("2026-07-15T00:00:00.000Z"),
      version: legacy.staff.version,
    });
  });

  it("rollback toàn bộ khi child version stale", async () => {
    const legacy = await createLegacyCase();
    const preview = await previewManualStaffRestore(gm, legacy.staff.id, {
      version: legacy.staff.version,
    });
    await prisma.staffEmploymentHistory.update({
      where: { id: legacy.history.id },
      data: { version: { increment: 1 } },
    });

    await expect(
      restoreStaffManually(
        gm,
        legacy.staff.id,
        {
          version: preview.staff.version,
          terminationAuditId: preview.terminationAudit.id,
          targetEmploymentStatus: "ACTIVE",
          history: { id: preview.history!.id, version: preview.history!.version },
          assignment: {
            id: preview.assignment!.id,
            version: preview.assignment!.version,
            effectiveTo: null,
          },
          user: null,
          reason: "Kiểm tra optimistic lock cho dữ liệu con.",
          acknowledged: true,
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const [staff, assignment, auditCount] = await Promise.all([
      prisma.staffMember.findUniqueOrThrow({ where: { id: legacy.staff.id } }),
      prisma.branchAssignment.findUniqueOrThrow({ where: { id: legacy.assignment!.id } }),
      prisma.auditLog.count({
        where: {
          companyId,
          entityId: legacy.staff.id,
          action: "staff.termination.restore-manual",
        },
      }),
    ]);
    expect(staff.employmentStatus).toBe("TERMINATED");
    expect(assignment.effectiveTo?.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(auditCount).toBe(0);
  });
});
