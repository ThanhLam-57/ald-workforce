import { randomUUID } from "node:crypto";

import { prisma } from "@ald/db";
import type { ActorContext } from "@ald/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createAttendance,
  getAttendanceMonth,
  reconcileAutomaticViolationsForMonth,
  updateAttendance,
} from "./attendance-service";
import {
  applySimpleMonthlyLevelRules,
  applySimplePenaltyRules,
  applySimpleRewardRules,
  getSimpleRules,
} from "./simple-rule-service";
import { listActiveSimplePenaltyVersions } from "./penalty-rule-service";
import { createViolation, previewViolation } from "./violation-service";

const runId = randomUUID().slice(0, 8);
const metadata = {
  requestId: `simple-rules-${runId}`,
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
} as const;
const now = new Date("2026-07-01T03:00:00.000Z");

let companyId: string;
let branchId: string;
let liveStaffId: string;
let gm: ActorContext;
let manager: ActorContext;
let penaltyItemId: string;
let penaltyItemCode: string;
let snapshottedViolationId: string;

beforeAll(async () => {
  const company = await prisma.company.create({
    data: {
      name: `Simple rules ${runId}`,
      slug: `simple-rules-${runId}`,
      revenueUnit: "COIN",
    },
  });
  companyId = company.id;
  const branch = await prisma.branch.create({
    data: { companyId, code: "A", name: "Cơ sở A" },
  });
  branchId = branch.id;
  const [gmStaff, managerStaff, liveStaff] = await Promise.all([
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: "GM",
        fullName: "GM Rule",
        jobTitle: "Tổng quản lý",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: "TM",
        fullName: "Manager Rule",
        jobTitle: "Quản lý đào tạo",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: "LIVE",
        fullName: "Live Rule",
        jobTitle: "Live",
        employmentCategory: "OFFICIAL",
      },
    }),
  ]);
  liveStaffId = liveStaff.id;
  const [gmUser, managerUser] = await Promise.all([
    prisma.user.create({
      data: {
        companyId,
        staffId: gmStaff.id,
        name: "GM Rule",
        email: `simple-rule-gm-${runId}@test.local`,
        username: `simple_rule_gm_${runId}`,
        role: "GENERAL_MANAGER",
      },
    }),
    prisma.user.create({
      data: {
        companyId,
        staffId: managerStaff.id,
        name: "Manager Rule",
        email: `simple-rule-manager-${runId}@test.local`,
        username: `simple_rule_manager_${runId}`,
        role: "TRAINING_MANAGER",
      },
    }),
  ]);
  await Promise.all([
    prisma.branchAssignment.create({
      data: {
        companyId,
        branchId,
        staffId: managerStaff.id,
        assignmentType: "PRIMARY_MANAGER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
    prisma.branchAssignment.create({
      data: {
        companyId,
        branchId,
        staffId: liveStaff.id,
        assignmentType: "MEMBER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
  ]);
  gm = {
    userId: gmUser.id,
    companyId,
    staffId: gmStaff.id,
    role: "GENERAL_MANAGER",
    activeBranchIds: [],
  };
  manager = {
    userId: managerUser.id,
    companyId,
    staffId: managerStaff.id,
    role: "TRAINING_MANAGER",
    activeBranchIds: [branchId],
  };
});

afterAll(async () => {
  if (!companyId) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'ALTER TABLE "violations" DISABLE TRIGGER "violations_no_hard_delete"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "penalty_items" DISABLE TRIGGER "penalty_items_published_immutable"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "rule_versions" DISABLE TRIGGER "rule_versions_published_immutable"',
    );
    await tx.violation.deleteMany({ where: { companyId } });
    await tx.penaltyItem.deleteMany({ where: { companyId } });
    await tx.ruleVersion.deleteMany({ where: { companyId } });
    await tx.ruleSet.deleteMany({ where: { companyId } });
    await tx.liveDailyMetric.deleteMany({ where: { companyId } });
    await tx.attendanceDay.deleteMany({ where: { companyId } });
    await tx.$executeRawUnsafe("SET LOCAL ald.audit_cleanup = 'on'");
    await tx.auditLog.deleteMany({ where: { companyId } });
    await tx.branchAssignment.deleteMany({ where: { companyId } });
    await tx.user.deleteMany({ where: { companyId } });
    await tx.branch.deleteMany({ where: { companyId } });
    await tx.staffMember.deleteMany({ where: { companyId } });
    await tx.company.deleteMany({ where: { id: companyId } });
    await tx.$executeRawUnsafe(
      'ALTER TABLE "rule_versions" ENABLE TRIGGER "rule_versions_published_immutable"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "penalty_items" ENABLE TRIGGER "penalty_items_published_immutable"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "violations" ENABLE TRIGGER "violations_no_hard_delete"',
    );
  });
});

describe("quy định thưởng/phạt đơn giản", () => {
  it("lưu bảng mốc xu tháng với điều kiện chuyên cần theo ngày", async () => {
    const applied = await applySimpleMonthlyLevelRules(
      gm,
      {
        effectiveFrom: "2026-07-01",
        attendanceRequiredDays: 26,
        levels: [
          {
            name: "Khởi Động",
            monthlyCoinThreshold: "80000",
            attendanceBonus: "500000",
            achievementBonus: "0",
            retainLevelBonus: "0",
            jumpLevelBonus: "0",
          },
          {
            name: "Kiến Tạo",
            monthlyCoinThreshold: "150000",
            attendanceBonus: "500000",
            achievementBonus: "100000",
            retainLevelBonus: "0",
            jumpLevelBonus: "0",
          },
        ],
      },
      metadata,
      now,
    );
    expect(applied).toMatchObject({
      status: "ACTIVE",
      attendanceRequiredDays: 26,
    });
    expect(applied.levels.map((level) => level.monthlyCoinThreshold)).toEqual(["80000", "150000"]);
    const visible = await getSimpleRules(manager, now);
    expect(visible.monthlyLevel).toMatchObject({
      attendanceRequiredDays: 26,
      effectiveFrom: "2026-07-01",
    });
    await expect(
      applySimpleMonthlyLevelRules(
        manager,
        {
          effectiveFrom: "2026-07-01",
          attendanceRequiredDays: 26,
          levels: [
            {
              name: "Không được lưu",
              monthlyCoinThreshold: "1",
              attendanceBonus: "0",
              achievementBonus: "0",
              retainLevelBonus: "0",
              jumpLevelBonus: "0",
            },
          ],
        },
        metadata,
        now,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("áp dụng thưởng xu tự động vào hồ sơ chấm công", async () => {
    await applySimpleRewardRules(
      gm,
      {
        effectiveFrom: "2026-07-01",
        tiers: [
          { thresholdAmount: "10000", rewardAmount: "50000" },
          { thresholdAmount: "15000", rewardAmount: "90000" },
          { thresholdAmount: "20000", rewardAmount: "180000" },
        ],
      },
      metadata,
      now,
    );
    const attendance = await createAttendance(
      manager,
      {
        staffId: liveStaffId,
        businessDate: "2026-07-15",
        revenueAmount: "17000",
        reason: "Kiểm tra tự động tính thưởng xu",
      },
      metadata,
    );
    expect(attendance.revenueUnit).toBe("COIN");
    expect(attendance.dailyReward).toMatchObject({
      amount: "90000",
      matchedThreshold: "15000",
      status: "MATCHED",
    });

    const month = await getAttendanceMonth(manager, liveStaffId, "2026-07");
    expect(month.dailyRewardTotal).toBe("90000");
    expect(
      month.days.find((day) => day.businessDate === "2026-07-15")?.attendance?.dailyReward.amount,
    ).toBe("90000");
  });

  it("nhắc ba lần rồi tự động phạt từ lần thứ tư", async () => {
    const applied = await applySimplePenaltyRules(
      gm,
      {
        effectiveFrom: "2026-07-01",
        items: [
          {
            name: "Trang phục",
            description: "Mặc đồ không phù hợp khi Live.",
            defaultAmount: "50000",
            reminderCount: 3,
            countingWindow: "CALENDAR_MONTH",
            displayColor: "#F97316",
            isActive: true,
          },
        ],
      },
      metadata,
      now,
    );
    const itemCode = applied.items[0]!.code;
    penaltyItemCode = itemCode;
    penaltyItemId = (
      await prisma.penaltyItem.findFirstOrThrow({
        where: { companyId, code: itemCode },
        select: { id: true },
      })
    ).id;

    const amounts: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const attendance = await createAttendance(
        manager,
        {
          staffId: liveStaffId,
          businessDate: `2026-07-${String(index + 20).padStart(2, "0")}`,
          reason: "Kiểm tra thứ tự vi phạm",
        },
        metadata,
      );
      const preview = await previewViolation(manager, attendance.id, penaltyItemId);
      expect(preview.nextOccurrenceNo).toBe(index + 1);
      const violation = await createViolation(
        manager,
        {
          attendanceId: attendance.id,
          penaltyItemId,
          detail: "Trang phục chưa đúng quy định.",
          reason: "Ghi nhận vi phạm",
        },
        metadata,
      );
      expect(violation.occurrenceNo).toBe(index + 1);
      amounts.push(violation.amount);
    }

    expect(amounts).toEqual(["0", "0", "0", "50000"]);
    const fourth = await prisma.violation.findFirstOrThrow({
      where: { companyId, penaltyItemId, occurrenceNo: 4 },
    });
    snapshottedViolationId = fourth.id;
    expect(fourth).toMatchObject({
      penaltyStartsAt: 4,
      computedAmount: 50000n,
      isChargeable: true,
      responsibleParty: "VIOLATING_STAFF",
    });
  });

  it("manager chỉ xem và không được sửa bộ quy định", async () => {
    const visible = await getSimpleRules(manager, new Date("2026-07-15T03:00:00.000Z"));
    expect(visible.reward.tiers).toHaveLength(3);
    expect(visible.penalty.items[0]).toMatchObject({
      reminderCount: 3,
      defaultAmount: "50000",
    });
    await expect(
      applySimpleRewardRules(
        manager,
        {
          effectiveFrom: "2026-08-01",
          tiers: [{ thresholdAmount: "10000", rewardAmount: "1" }],
        },
        metadata,
        now,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("ghi đè ngày áp dụng trên cùng current version cho ngày quá khứ, hôm nay và tương lai", async () => {
    const businessNow = new Date("2026-07-25T03:00:00.000Z");
    const tiers = [{ thresholdAmount: "10000", rewardAmount: "51000" }];

    await applySimpleRewardRules(gm, { effectiveFrom: "2026-07-25", tiers }, metadata, businessNow);
    const first = await prisma.ruleVersion.findFirstOrThrow({
      where: {
        companyId,
        isSimpleCurrent: true,
        ruleSet: {
          companyId,
          type: "DAILY_REWARD_TIERS",
          managementMode: "SIMPLE_MUTABLE",
        },
      },
      select: { id: true, versionNo: true, rowVersion: true, status: true },
    });
    expect(first.status).toBe("ACTIVE");

    await applySimpleRewardRules(gm, { effectiveFrom: "2026-06-01", tiers }, metadata, businessNow);
    const backdated = await prisma.ruleVersion.findFirstOrThrow({
      where: { id: first.id },
      select: {
        id: true,
        versionNo: true,
        rowVersion: true,
        status: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    });
    expect(backdated).toMatchObject({
      id: first.id,
      versionNo: first.versionNo,
      status: "ACTIVE",
      effectiveTo: null,
    });
    expect(backdated.rowVersion).toBe(first.rowVersion + 1);
    expect(backdated.effectiveFrom?.toISOString().slice(0, 10)).toBe("2026-06-01");

    const scheduled = await applySimpleRewardRules(
      gm,
      { effectiveFrom: "2026-08-01", tiers },
      metadata,
      businessNow,
    );
    expect(scheduled.status).toBe("SCHEDULED");
    const todayResult = await applySimpleRewardRules(
      gm,
      { effectiveFrom: "2026-07-25", tiers },
      metadata,
      businessNow,
    );
    expect(todayResult.status).toBe("ACTIVE");

    const currentVersions = await prisma.ruleVersion.findMany({
      where: {
        companyId,
        isSimpleCurrent: true,
        supersededAt: null,
        ruleSet: {
          companyId,
          type: "DAILY_REWARD_TIERS",
          managementMode: "SIMPLE_MUTABLE",
        },
      },
      select: { id: true, versionNo: true },
    });
    expect(currentVersions).toEqual([{ id: first.id, versionNo: first.versionNo }]);
    const dto = await getSimpleRules(gm, businessNow);
    expect(dto.reward.effectiveFrom).toBe("2026-07-25");
  });

  it("backdate reward chỉ áp dụng rule mới từ effectiveFrom và không fallback rule cũ", async () => {
    const beforeDate = await createAttendance(
      manager,
      {
        staffId: liveStaffId,
        businessDate: "2026-05-31",
        revenueAmount: "12000",
        reason: "Attendance trước ngày backdate",
      },
      metadata,
    );
    const fromDate = await createAttendance(
      manager,
      {
        staffId: liveStaffId,
        businessDate: "2026-06-02",
        revenueAmount: "12000",
        reason: "Attendance sau ngày backdate",
      },
      metadata,
    );
    await applySimpleRewardRules(
      gm,
      {
        effectiveFrom: "2026-06-01",
        tiers: [{ thresholdAmount: "10000", rewardAmount: "77777" }],
      },
      metadata,
      new Date("2026-07-25T03:00:00.000Z"),
    );

    const monthBefore = await getAttendanceMonth(manager, liveStaffId, "2026-05");
    const monthAfter = await getAttendanceMonth(manager, liveStaffId, "2026-06");
    expect(
      monthBefore.days.find((day) => day.attendance?.id === beforeDate.id)?.attendance?.dailyReward,
    ).toMatchObject({ amount: "0", ruleVersionId: null, status: "NO_ACTIVE_RULE" });
    expect(
      monthAfter.days.find((day) => day.attendance?.id === fromDate.id)?.attendance?.dailyReward,
    ).toMatchObject({ amount: "77777", status: "MATCHED" });
  });

  it("backdate penalty dùng cấu hình mới cho violation mới nhưng giữ nguyên snapshot cũ", async () => {
    const oldSnapshot = await prisma.violation.findUniqueOrThrow({
      where: { id: snapshottedViolationId },
      select: {
        ruleVersionId: true,
        itemName: true,
        amount: true,
        occurrenceNo: true,
      },
    });
    const applied = await applySimplePenaltyRules(
      gm,
      {
        effectiveFrom: "2026-06-01",
        items: [
          {
            code: penaltyItemCode,
            name: "Trang phục cập nhật",
            description: "Nội dung mới áp dụng khi ghi violation mới.",
            defaultAmount: "99000",
            reminderCount: 0,
            countingWindow: "CALENDAR_MONTH",
            displayColor: "#DC2626",
            isActive: true,
          },
        ],
      },
      metadata,
      new Date("2026-07-25T03:00:00.000Z"),
    );
    const currentPenaltyVersion = await prisma.ruleVersion.findFirstOrThrow({
      where: {
        companyId,
        isSimpleCurrent: true,
        supersededAt: null,
        ruleSet: {
          companyId,
          type: "PENALTY",
          managementMode: "SIMPLE_MUTABLE",
        },
      },
      select: { id: true, effectiveFrom: true, effectiveTo: true },
    });
    expect(currentPenaltyVersion.id).toBe(oldSnapshot.ruleVersionId);
    expect(currentPenaltyVersion.effectiveFrom?.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(currentPenaltyVersion.effectiveTo).toBeNull();
    const attendance = await createAttendance(
      manager,
      {
        staffId: liveStaffId,
        businessDate: "2026-08-01",
        reason: "Attendance dùng penalty mới",
      },
      metadata,
    );
    const item = await prisma.penaltyItem.findFirstOrThrow({
      where: {
        companyId,
        code: applied.items[0]!.code,
        archivedAt: null,
        ruleVersion: { isSimpleCurrent: true },
      },
      select: { id: true },
    });
    const created = await createViolation(
      manager,
      {
        attendanceId: attendance.id,
        penaltyItemId: item.id,
        detail: "Violation mới sau khi backdate.",
        reason: "Kiểm tra snapshot rule mới",
      },
      metadata,
    );
    expect(created).toMatchObject({
      itemName: "Trang phục cập nhật",
      amount: "99000",
      occurrenceNo: 1,
    });

    const unchanged = await prisma.violation.findUniqueOrThrow({
      where: { id: snapshottedViolationId },
      select: {
        ruleVersionId: true,
        itemName: true,
        amount: true,
        occurrenceNo: true,
      },
    });
    expect(unchanged).toEqual(oldSnapshot);
  });

  it("xóa penalty item đã tham chiếu sẽ archive, bỏ khỏi dropdown và vẫn đọc được violation cũ", async () => {
    await applySimplePenaltyRules(
      gm,
      {
        effectiveFrom: "2026-06-01",
        items: [
          {
            name: "Lỗi thay thế",
            description: "Item còn lại trong bộ rule.",
            defaultAmount: "10000",
            reminderCount: 0,
            countingWindow: "CALENDAR_MONTH",
            displayColor: "#2563EB",
            isActive: true,
          },
        ],
      },
      metadata,
      new Date("2026-07-25T03:00:00.000Z"),
    );

    const archived = await prisma.penaltyItem.findUniqueOrThrow({
      where: { id: penaltyItemId },
      select: { archivedAt: true, isActive: true },
    });
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.isActive).toBe(false);

    const dropdown = await listActiveSimplePenaltyVersions(manager, "2026-07-20");
    expect(
      dropdown.flatMap((version) => version.items).some((item) => item.id === penaltyItemId),
    ).toBe(false);
    const month = await getAttendanceMonth(manager, liveStaffId, "2026-07");
    expect(
      month.days
        .flatMap((day) => day.violations)
        .some((violation) => violation.id === snapshottedViolationId),
    ).toBe(true);
  });

  it("xóa hẳn penalty item chưa được tham chiếu", async () => {
    const unreferenced = await prisma.penaltyItem.findFirstOrThrow({
      where: {
        companyId,
        name: "Lỗi thay thế",
        archivedAt: null,
        ruleVersion: { isSimpleCurrent: true },
      },
      select: { id: true },
    });
    await applySimplePenaltyRules(
      gm,
      {
        effectiveFrom: "2026-06-01",
        items: [
          {
            name: "Lỗi cuối",
            description: "Item mới thay item chưa tham chiếu.",
            defaultAmount: "20000",
            reminderCount: 0,
            countingWindow: "CALENDAR_MONTH",
            displayColor: "#16A34A",
            isActive: true,
          },
        ],
      },
      metadata,
      new Date("2026-07-25T03:00:00.000Z"),
    );
    expect(await prisma.penaltyItem.findUnique({ where: { id: unreferenced.id } })).toBeNull();
  });

  it("tự động tạo, hủy và kích hoạt lại lỗi giờ chấm công mà không tạo trùng", async () => {
    const applied = await applySimplePenaltyRules(
      gm,
      {
        effectiveFrom: "2026-07-01",
        items: [
          {
            name: "Đi muộn toàn công ty",
            description: "Fallback toàn công ty.",
            defaultAmount: "10000",
            reminderCount: 0,
            countingWindow: "CALENDAR_MONTH",
            displayColor: "#F97316",
            isActive: true,
            automaticCondition: {
              type: "CHECK_IN_LATE",
              scheduledStartMinutes: 540,
              graceMinutes: 15,
              branchId: null,
            },
          },
          {
            name: "Đi muộn cơ sở A",
            description: "Ưu tiên rule riêng cơ sở.",
            defaultAmount: "20000",
            reminderCount: 0,
            countingWindow: "CALENDAR_MONTH",
            displayColor: "#DC2626",
            isActive: true,
            automaticCondition: {
              type: "CHECK_IN_LATE",
              scheduledStartMinutes: 540,
              graceMinutes: 15,
              branchId,
            },
          },
          {
            name: "Thiếu Live",
            description: "Live dưới ngưỡng.",
            defaultAmount: "30000",
            reminderCount: 0,
            countingWindow: "CALENDAR_MONTH",
            displayColor: "#7C3AED",
            isActive: true,
            automaticCondition: {
              type: "LIVE_DURATION_SHORT",
              requiredLiveMinutes: 360,
              graceMinutes: 15,
              branchId: null,
            },
          },
          {
            name: "Lỗi thủ công",
            description: "Không được reconcile tự động.",
            defaultAmount: "40000",
            reminderCount: 0,
            countingWindow: "CALENDAR_MONTH",
            displayColor: "#475569",
            isActive: true,
            automaticCondition: { type: "MANUAL" },
          },
        ],
      },
      metadata,
      now,
    );
    const manualItem = await prisma.penaltyItem.findFirstOrThrow({
      where: {
        companyId,
        code: applied.items.find((item) => item.name === "Lỗi thủ công")!.code,
      },
      select: { id: true },
    });
    const created = await createAttendance(
      manager,
      {
        staffId: liveStaffId,
        businessDate: "2026-07-29",
        status: "PRESENT",
        checkInAt: "2026-07-29T09:16:00+07:00",
        actualLiveMinutes: 344,
        reason: "Kiểm tra tự động ghi lỗi",
      },
      metadata,
    );
    const automaticAtStart = await prisma.violation.findMany({
      where: { companyId, attendanceId: created.id, origin: "AUTOMATIC" },
      orderBy: { itemName: "asc" },
    });
    expect(automaticAtStart).toHaveLength(2);
    expect(automaticAtStart.map((violation) => violation.itemName)).toEqual([
      "Thiếu Live",
      "Đi muộn cơ sở A",
    ]);
    expect(automaticAtStart.map((violation) => violation.amount.toString()).sort()).toEqual([
      "20000",
      "30000",
    ]);

    await createViolation(
      manager,
      {
        attendanceId: created.id,
        penaltyItemId: manualItem.id,
        detail: "Lỗi nhập thủ công.",
        reason: "Thêm lỗi thủ công để kiểm tra",
      },
      metadata,
    );
    const corrected = await updateAttendance(
      manager,
      created.id,
      {
        version: created.version,
        checkInAt: "2026-07-29T09:15:00+07:00",
        actualLiveMinutes: 345,
        reason: "Sửa dữ liệu về đúng ngưỡng",
      },
      metadata,
    );
    expect(corrected.automaticViolationSummary).toMatchObject({ cancelledCount: 2 });
    expect(
      await prisma.violation.count({
        where: { companyId, attendanceId: created.id, origin: "AUTOMATIC", status: "ACTIVE" },
      }),
    ).toBe(0);
    expect(
      await prisma.violation.count({
        where: { companyId, attendanceId: created.id, origin: "MANUAL", status: "ACTIVE" },
      }),
    ).toBe(1);

    const invalidAgain = await updateAttendance(
      manager,
      created.id,
      {
        version: corrected.version,
        checkInAt: "2026-07-29T09:16:00+07:00",
        actualLiveMinutes: 344,
        reason: "Đưa dữ liệu về trạng thái vi phạm",
      },
      metadata,
    );
    expect(invalidAgain.automaticViolationSummary).toMatchObject({ reactivatedCount: 2 });
    const savedAgain = await updateAttendance(
      manager,
      created.id,
      {
        version: invalidAgain.version,
        note: "Lưu lại không tạo lỗi trùng",
        reason: "Kiểm tra idempotency",
      },
      metadata,
    );
    expect(savedAgain.automaticViolationSummary).toMatchObject({
      createdCount: 0,
      reactivatedCount: 0,
    });
    expect(
      await prisma.violation.count({
        where: { companyId, attendanceId: created.id, origin: "AUTOMATIC" },
      }),
    ).toBe(2);

    const concurrentAttendance = await createAttendance(
      manager,
      {
        staffId: liveStaffId,
        businessDate: "2026-07-30",
        status: "DRAFT",
        reason: "Chuẩn bị kiểm tra hai request lưu đồng thời",
      },
      metadata,
    );
    const concurrentResults = await Promise.allSettled([
      updateAttendance(
        manager,
        concurrentAttendance.id,
        {
          version: concurrentAttendance.version,
          status: "PRESENT",
          checkInAt: "2026-07-30T09:16:00+07:00",
          actualLiveMinutes: 344,
          reason: "Request lưu đồng thời thứ nhất",
        },
        metadata,
      ),
      updateAttendance(
        manager,
        concurrentAttendance.id,
        {
          version: concurrentAttendance.version,
          status: "PRESENT",
          checkInAt: "2026-07-30T09:16:00+07:00",
          actualLiveMinutes: 344,
          reason: "Request lưu đồng thời thứ hai",
        },
        metadata,
      ),
    ]);
    expect(concurrentResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrentResults.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      await prisma.violation.count({
        where: {
          companyId,
          attendanceId: concurrentAttendance.id,
          origin: "AUTOMATIC",
        },
      }),
    ).toBe(2);

    const dryRun = await reconcileAutomaticViolationsForMonth(
      manager,
      {
        staffId: liveStaffId,
        month: "2026-07",
        dryRun: true,
        reason: "Xem trước tính lại lỗi tháng",
      },
      metadata,
    );
    expect(dryRun.createdCount).toBe(0);
    expect(dryRun.cancelledCount).toBe(0);
  });

  it("rule VERSIONED vẫn immutable và vẫn chặn overlap", async () => {
    const ruleSet = await prisma.ruleSet.create({
      data: {
        companyId,
        type: "PENALTY",
        managementMode: "VERSIONED",
        name: `Versioned guard ${runId}`,
        createdByUserId: gm.userId,
      },
    });
    const first = await prisma.ruleVersion.create({
      data: {
        companyId,
        ruleSetId: ruleSet.id,
        versionNo: 1,
        status: "DRAFT",
        createdByUserId: gm.userId,
      },
    });
    await prisma.penaltyItem.create({
      data: {
        companyId,
        ruleVersionId: first.id,
        code: "VERSIONED_1",
        name: "Versioned item",
        description: "Kiểm tra immutable.",
        defaultAmount: 1000n,
      },
    });
    await prisma.ruleVersion.update({
      where: { id: first.id },
      data: {
        status: "ACTIVE",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        publishedByUserId: gm.userId,
        publishedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    await expect(
      prisma.ruleVersion.update({
        where: { id: first.id },
        data: { notes: "Không được sửa" },
      }),
    ).rejects.toThrow(/immutable/i);

    const second = await prisma.ruleVersion.create({
      data: {
        companyId,
        ruleSetId: ruleSet.id,
        versionNo: 2,
        status: "DRAFT",
        createdByUserId: gm.userId,
      },
    });
    await expect(
      prisma.ruleVersion.update({
        where: { id: second.id },
        data: {
          status: "ACTIVE",
          effectiveFrom: new Date("2026-02-01T00:00:00.000Z"),
          publishedByUserId: gm.userId,
          publishedAt: new Date("2026-02-01T00:00:00.000Z"),
        },
      }),
    ).rejects.toThrow();
  });

  it("không đọc chéo simple rules giữa hai công ty", async () => {
    const otherCompany = await prisma.company.create({
      data: {
        name: `Other simple rules ${runId}`,
        slug: `other-simple-rules-${runId}`,
      },
    });
    const otherStaff = await prisma.staffMember.create({
      data: {
        companyId: otherCompany.id,
        staffCode: "OTHER_GM",
        fullName: "Other GM",
        jobTitle: "GM",
        employmentCategory: "OFFICIAL",
      },
    });
    const otherUser = await prisma.user.create({
      data: {
        companyId: otherCompany.id,
        staffId: otherStaff.id,
        name: "Other GM",
        email: `other-simple-rule-${runId}@test.local`,
        username: `other_simple_rule_${runId}`,
        role: "GENERAL_MANAGER",
      },
    });
    const otherActor: ActorContext = {
      userId: otherUser.id,
      companyId: otherCompany.id,
      staffId: otherStaff.id,
      role: "GENERAL_MANAGER",
      activeBranchIds: [],
    };
    const otherRules = await getSimpleRules(otherActor);
    expect(otherRules.reward.tiers).toEqual([]);
    expect(otherRules.penalty.items).toEqual([]);

    await prisma.user.delete({ where: { id: otherUser.id } });
    await prisma.staffMember.delete({ where: { id: otherStaff.id } });
    await prisma.company.delete({ where: { id: otherCompany.id } });
  });
});
