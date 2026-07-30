import { createHash, randomUUID } from "node:crypto";

import { prisma } from "@ald/db";
import type { ActorContext } from "@ald/domain";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const privateObjectStorage = vi.hoisted(() => ({
  bytes: new Uint8Array(),
}));

vi.mock("./object-storage", () => ({
  putPrivateObject: vi.fn(async (input: { body: Uint8Array }) => {
    privateObjectStorage.bytes = Uint8Array.from(input.body);
  }),
  verifyPrivateObject: vi.fn(async () => undefined),
  readPrivateObject: vi.fn(async () => privateObjectStorage.bytes),
}));

import {
  commitAttendanceMachineImport,
  listAttendanceMachineImportHistory,
  presignAttendanceMachineImportUpload,
  previewAttendanceMachineImport,
  uploadAttendanceMachineImport,
} from "./attendance-machine-import-service";
import { putPrivateObject } from "./object-storage";
import type { RequestMetadata } from "./request-metadata";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const runId = randomUUID().slice(0, 8);
const metadata: RequestMetadata = {
  requestId: `attendance-machine-import-${runId}`,
  ipAddress: "127.0.0.1",
  userAgent: "vitest-integration",
};

function attemptFields(): { attemptId: string; idempotencyKey: string } {
  const attemptId = randomUUID();
  return {
    attemptId,
    idempotencyKey: `attendance-machine:${attemptId}`,
  };
}

function requestBody(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

let companyId: string;
let branchAId: string;
let branchBId: string;
let liveAId: string;
let liveBId: string;
let managerStaffId: string;
let gm: ActorContext;
let manager: ActorContext;
let manualPenaltyItemId: string;
let automaticPenaltyItemId: string;
let ruleVersionId: string;

type WorkbookRow = Readonly<{
  machineCode: string;
  businessDate: string;
  checkInTime?: string | null;
  checkOutTime?: string | null;
}>;

async function workbookBytes(rows: readonly WorkbookRow[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Máy chấm công");
  sheet.mergeCells("A1:H1");
  sheet.getCell("A1").value = "BẢNG CHẤM CÔNG";
  sheet.getCell("B3").value = "Mã Nhân Viên";
  sheet.getCell("E3").value = "Ngày";
  sheet.getCell("G3").value = "Giờ vào";
  sheet.getCell("H3").value = "Giờ ra";

  rows.forEach((row, index) => {
    const rowNumber = index + 4;
    sheet.getCell(`B${rowNumber}`).value = row.machineCode;
    sheet.getCell(`E${rowNumber}`).value = row.businessDate;
    sheet.getCell(`G${rowNumber}`).value = row.checkInTime ?? null;
    sheet.getCell(`H${rowNumber}`).value = row.checkOutTime ?? null;
  });

  const output = await workbook.xlsx.writeBuffer();
  return Uint8Array.from(Array.from(output as unknown as ArrayLike<number>));
}

async function stageWorkbook(
  actor: ActorContext,
  input: {
    staffId: string;
    branchId: string;
    month: string;
    bytes: Uint8Array;
    label: string;
  },
) {
  privateObjectStorage.bytes = Uint8Array.from(input.bytes);
  const checksumSha256 = createHash("sha256").update(input.bytes).digest("base64");
  const presigned = await presignAttendanceMachineImportUpload(
    actor,
    {
      ...attemptFields(),
      staffId: input.staffId,
      branchId: input.branchId,
      month: input.month,
      originalFileName: `${input.label}.xlsx`,
      mimeType: XLSX_MIME,
      sizeBytes: input.bytes.byteLength,
      checksumSha256,
    },
    metadata,
  );
  await uploadAttendanceMachineImport(
    actor,
    presigned.job.id,
    new Request("http://localhost/api/attendance/machine-imports/upload", {
      method: "PUT",
      headers: { "Content-Type": XLSX_MIME },
      body: requestBody(input.bytes),
    }),
    metadata,
  );
  const preview = await previewAttendanceMachineImport(actor, presigned.job.id, metadata);
  return { presigned, preview, checksumSha256 };
}

async function createAttendanceFixture(input: {
  staffId: string;
  branchId: string;
  businessDate: string;
  checkInAt: string;
  checkOutAt: string;
  workUnits?: string;
  overtimeMinutes?: number;
  note?: string;
  actualLiveMinutes?: number;
  revenueAmount?: bigint;
}) {
  return prisma.attendanceDay.create({
    data: {
      companyId,
      branchId: input.branchId,
      staffId: input.staffId,
      businessDate: new Date(`${input.businessDate}T00:00:00.000Z`),
      checkInAt: new Date(input.checkInAt),
      checkOutAt: new Date(input.checkOutAt),
      workUnits: input.workUnits ?? "1",
      overtimeMinutes: input.overtimeMinutes ?? 0,
      note: input.note ?? null,
      status: "PRESENT",
      createdByUserId: gm.userId,
      updatedByUserId: gm.userId,
      liveMetric: {
        create: {
          companyId,
          branchId: input.branchId,
          actualLiveMinutes: input.actualLiveMinutes ?? 0,
          revenueAmount: input.revenueAmount ?? 0n,
          revenueUnit: "COIN",
          revenueScale: 1,
        },
      },
    },
    include: { liveMetric: true },
  });
}

beforeAll(async () => {
  const company = await prisma.company.create({
    data: {
      name: `Attendance machine import ${runId}`,
      slug: `attendance-machine-import-${runId}`,
      timezone: "Asia/Ho_Chi_Minh",
      revenueUnit: "COIN",
      revenueScale: 1,
    },
  });
  companyId = company.id;

  const [branchA, branchB] = await Promise.all([
    prisma.branch.create({
      data: { companyId, code: `A-${runId}`, name: "Cơ sở A" },
    }),
    prisma.branch.create({
      data: { companyId, code: `B-${runId}`, name: "Cơ sở B" },
    }),
  ]);
  branchAId = branchA.id;
  branchBId = branchB.id;

  const [gmStaff, managerStaff, liveA, liveB] = await Promise.all([
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `GM-${runId}`,
        fullName: "Tổng quản lý import",
        jobTitle: "Tổng quản lý",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `TM-${runId}`,
        fullName: "Quản lý cơ sở A",
        jobTitle: "Quản lý đào tạo",
        employmentCategory: "OFFICIAL",
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `LIVE-A-${runId}`,
        fullName: "Nhân viên Live A",
        jobTitle: "Nhân viên Live",
        employmentCategory: "OFFICIAL",
        joinedDate: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
    prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `LIVE-B-${runId}`,
        fullName: "Nhân viên Live B",
        jobTitle: "Nhân viên Live",
        employmentCategory: "OFFICIAL",
        joinedDate: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
  ]);
  managerStaffId = managerStaff.id;
  liveAId = liveA.id;
  liveBId = liveB.id;

  const [gmUser, managerUser] = await Promise.all([
    prisma.user.create({
      data: {
        companyId,
        staffId: gmStaff.id,
        name: gmStaff.fullName,
        email: `attendance-import-gm-${runId}@test.local`,
        username: `attendance_import_gm_${runId}`,
        role: "GENERAL_MANAGER",
      },
    }),
    prisma.user.create({
      data: {
        companyId,
        staffId: managerStaff.id,
        name: managerStaff.fullName,
        email: `attendance-import-manager-${runId}@test.local`,
        username: `attendance_import_manager_${runId}`,
        role: "TRAINING_MANAGER",
      },
    }),
  ]);

  await Promise.all([
    prisma.branchAssignment.create({
      data: {
        companyId,
        branchId: branchAId,
        staffId: managerStaff.id,
        assignmentType: "PRIMARY_MANAGER",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
    prisma.branchAssignment.create({
      data: {
        companyId,
        branchId: branchAId,
        staffId: liveA.id,
        assignmentType: "MEMBER",
        attendanceMachineCode: "00123",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
    prisma.branchAssignment.create({
      data: {
        companyId,
        branchId: branchBId,
        staffId: liveB.id,
        assignmentType: "MEMBER",
        attendanceMachineCode: "00123",
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
    activeBranchIds: [branchAId],
  };

  await Promise.all([
    prisma.staffWorkSchedule.create({
      data: {
        companyId,
        branchId: branchAId,
        staffId: liveA.id,
        name: "Ca chuẩn A",
        scheduledStartMinutes: 540,
        scheduledEndMinutes: 1_020,
        spansNextDay: false,
        requiredLiveMinutes: 360,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        createdByUserId: gm.userId,
      },
    }),
    prisma.staffWorkSchedule.create({
      data: {
        companyId,
        branchId: branchBId,
        staffId: liveB.id,
        name: "Ca chuẩn B",
        scheduledStartMinutes: 540,
        scheduledEndMinutes: 1_020,
        spansNextDay: false,
        requiredLiveMinutes: 360,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        createdByUserId: gm.userId,
      },
    }),
  ]);

  const ruleSet = await prisma.ruleSet.create({
    data: {
      companyId,
      type: "PENALTY",
      managementMode: "SIMPLE_MUTABLE",
      name: `Phạt import ${runId}`,
      createdByUserId: gm.userId,
    },
  });
  const version = await prisma.ruleVersion.create({
    data: {
      companyId,
      ruleSetId: ruleSet.id,
      versionNo: 1,
      status: "ACTIVE",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      isSimpleCurrent: true,
      createdByUserId: gm.userId,
      publishedByUserId: gm.userId,
      publishedAt: new Date(),
    },
  });
  ruleVersionId = version.id;
  const [manualItem, automaticItem] = await Promise.all([
    prisma.penaltyItem.create({
      data: {
        companyId,
        ruleVersionId: version.id,
        code: `MANUAL_${runId.toUpperCase()}`,
        name: "Lỗi thủ công được giữ nguyên",
        description: "Fixture kiểm tra import không làm mất lỗi thủ công.",
        defaultAmount: 50_000n,
        reminderPolicy: {
          penaltyStartsAt: 1,
          countingWindow: "CALENDAR_MONTH",
          countingKey: `MANUAL_${runId.toUpperCase()}`,
        },
        metadata: { automaticCondition: { type: "MANUAL" } },
        displayColor: "#475569",
        displayOrder: 1,
      },
    }),
    prisma.penaltyItem.create({
      data: {
        companyId,
        ruleVersionId: version.id,
        code: `LATE_${runId.toUpperCase()}`,
        name: "Đi làm muộn tự động",
        description: "Fixture kiểm tra reconcile sau import.",
        defaultAmount: 20_000n,
        reminderPolicy: {
          penaltyStartsAt: 1,
          countingWindow: "CALENDAR_MONTH",
          countingKey: `LATE_${runId.toUpperCase()}`,
        },
        metadata: {
          automaticCondition: {
            type: "CHECK_IN_LATE",
            thresholdSource: "STAFF_SHIFT",
            graceMinutes: 15,
            branchId: branchAId,
          },
        },
        displayColor: "#DC2626",
        displayOrder: 2,
      },
    }),
  ]);
  manualPenaltyItemId = manualItem.id;
  automaticPenaltyItemId = automaticItem.id;
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
    await tx.importError.deleteMany({ where: { companyId } });
    await tx.importJob.deleteMany({ where: { companyId } });
    await tx.violation.deleteMany({ where: { companyId } });
    await tx.penaltyItem.deleteMany({ where: { companyId } });
    await tx.ruleVersion.deleteMany({ where: { companyId } });
    await tx.ruleSet.deleteMany({ where: { companyId } });
    await tx.liveDailyMetric.deleteMany({ where: { companyId } });
    await tx.attendanceDay.deleteMany({ where: { companyId } });
    await tx.staffWorkSchedule.deleteMany({ where: { companyId } });
    await tx.$executeRawUnsafe("SET LOCAL ald.audit_cleanup = 'on'");
    await tx.auditLog.deleteMany({ where: { companyId } });
    await tx.rateLimit.deleteMany({ where: { key: { startsWith: `app:${companyId}:` } } });
    await tx.session.deleteMany({ where: { user: { companyId } } });
    await tx.account.deleteMany({ where: { user: { companyId } } });
    await tx.branchAssignment.deleteMany({ where: { companyId } });
    await tx.user.deleteMany({ where: { companyId } });
    await tx.staffMember.deleteMany({ where: { companyId } });
    await tx.branch.deleteMany({ where: { companyId } });
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

describe("attendance machine import theo nhân viên đang chọn", () => {
  it("match mã máy theo đúng interval hiệu lực khi đổi mã giữa tháng và giữ số 0 đầu", async () => {
    const intervalStaff = await prisma.staffMember.create({
      data: {
        companyId,
        staffCode: `LIVE-INTERVAL-${runId}`,
        fullName: "Nhân viên đổi mã giữa tháng",
        jobTitle: "Nhân viên Live",
        employmentCategory: "OFFICIAL",
        joinedDate: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    await prisma.branchAssignment.createMany({
      data: [
        {
          companyId,
          branchId: branchAId,
          staffId: intervalStaff.id,
          assignmentType: "MEMBER",
          attendanceMachineCode: "00033",
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          effectiveTo: new Date("2026-07-15T00:00:00.000Z"),
        },
        {
          companyId,
          branchId: branchAId,
          staffId: intervalStaff.id,
          assignmentType: "MEMBER",
          attendanceMachineCode: "00044",
          effectiveFrom: new Date("2026-07-15T00:00:00.000Z"),
        },
      ],
    });
    await prisma.staffWorkSchedule.create({
      data: {
        companyId,
        branchId: branchAId,
        staffId: intervalStaff.id,
        name: "Ca chuẩn đổi mã",
        scheduledStartMinutes: 540,
        scheduledEndMinutes: 1_020,
        spansNextDay: false,
        requiredLiveMinutes: 360,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        createdByUserId: gm.userId,
      },
    });

    const { presigned, preview } = await stageWorkbook(manager, {
      staffId: intervalStaff.id,
      branchId: branchAId,
      month: "2026-07",
      bytes: await workbookBytes([
        {
          machineCode: "00033",
          businessDate: "14/07/2026",
          checkInTime: "09:01",
          checkOutTime: "17:01",
        },
        {
          machineCode: "00044",
          businessDate: "15/07/2026",
          checkInTime: "09:02",
          checkOutTime: "17:02",
        },
        {
          machineCode: "00033",
          businessDate: "16/07/2026",
          checkInTime: "09:03",
          checkOutTime: "17:03",
        },
      ]),
      label: "mid-month-machine-code",
    });

    expect(preview.target.attendanceMachineCode).toBe("00044");
    expect(preview.summary).toMatchObject({
      totalRows: 3,
      matchedRows: 2,
      createRows: 2,
      skippedRows: 1,
      errorRows: 0,
    });
    expect(
      preview.rows.map(({ businessDate, machineCode, status }) => ({
        businessDate,
        machineCode,
        status,
      })),
    ).toEqual([
      { businessDate: "2026-07-14", machineCode: "00033", status: "CREATE" },
      { businessDate: "2026-07-15", machineCode: "00044", status: "CREATE" },
      { businessDate: "2026-07-16", machineCode: "00033", status: "SKIP_CODE_MISMATCH" },
    ]);

    await expect(
      commitAttendanceMachineImport(manager, presigned.job.id, { confirm: true }, metadata),
    ).resolves.toMatchObject({ status: "SUCCEEDED", committedRows: 2 });

    const imported = await prisma.attendanceDay.findMany({
      where: {
        companyId,
        branchId: branchAId,
        staffId: intervalStaff.id,
        businessDate: {
          gte: new Date("2026-07-14T00:00:00.000Z"),
          lt: new Date("2026-07-17T00:00:00.000Z"),
        },
      },
      select: { businessDate: true, checkInAt: true, checkOutAt: true },
      orderBy: { businessDate: "asc" },
    });
    expect(
      imported.map((record) => ({
        businessDate: record.businessDate.toISOString().slice(0, 10),
        checkInAt: record.checkInAt?.toISOString(),
        checkOutAt: record.checkOutAt?.toISOString(),
      })),
    ).toEqual([
      {
        businessDate: "2026-07-14",
        checkInAt: "2026-07-14T02:01:00.000Z",
        checkOutAt: "2026-07-14T10:01:00.000Z",
      },
      {
        businessDate: "2026-07-15",
        checkInAt: "2026-07-15T02:02:00.000Z",
        checkOutAt: "2026-07-15T10:02:00.000Z",
      },
    ]);
    expect(
      (
        await prisma.branchAssignment.findMany({
          where: { companyId, branchId: branchAId, staffId: intervalStaff.id },
          select: { attendanceMachineCode: true },
          orderBy: { effectiveFrom: "asc" },
        })
      ).map((assignment) => assignment.attendanceMachineCode),
    ).toEqual(["00033", "00044"]);
  });

  it("chỉ match mã máy/ngày hợp lệ, chỉ cập nhật giờ và reconcile lỗi tự động", async () => {
    const july10 = await createAttendanceFixture({
      staffId: liveAId,
      branchId: branchAId,
      businessDate: "2026-07-10",
      checkInAt: "2026-07-10T08:45:00+07:00",
      checkOutAt: "2026-07-10T17:00:00+07:00",
      workUnits: "1.5",
      overtimeMinutes: 45,
      note: "Ghi chú phải được giữ nguyên",
      actualLiveMinutes: 333,
      revenueAmount: 987_654n,
    });
    const july11 = await createAttendanceFixture({
      staffId: liveAId,
      branchId: branchAId,
      businessDate: "2026-07-11",
      checkInAt: "2026-07-11T09:00:00+07:00",
      checkOutAt: "2026-07-11T17:00:00+07:00",
      workUnits: "0.5",
      overtimeMinutes: 10,
      note: "Không xóa check-in khi ô file trống",
      actualLiveMinutes: 300,
      revenueAmount: 123_456n,
    });
    const manualViolation = await prisma.violation.create({
      data: {
        companyId,
        branchId: branchAId,
        attendanceId: july10.id,
        staffId: liveAId,
        businessDate: new Date("2026-07-10T00:00:00.000Z"),
        penaltyItemId: manualPenaltyItemId,
        ruleVersionId,
        penaltyItemCode: `MANUAL_${runId.toUpperCase()}`,
        countingKey: `MANUAL_${runId.toUpperCase()}`,
        occurrenceNo: 1,
        countingWindow: "CALENDAR_MONTH",
        countingPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
        countingPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
        penaltyStartsAt: 1,
        snapshottedDefaultAmount: 50_000n,
        computedAmount: 50_000n,
        isChargeable: true,
        responsibleParty: "VIOLATING_STAFF",
        itemName: "Lỗi thủ công được giữ nguyên",
        amount: 50_000n,
        detail: "Chi tiết lỗi thủ công không được thay đổi.",
        note: "Ghi chú lỗi thủ công.",
        status: "ACTIVE",
        origin: "MANUAL",
        createdByUserId: gm.userId,
      },
    });
    const bytes = await workbookBytes([
      {
        machineCode: "00123",
        businessDate: "10/07/2026",
        checkInTime: "09:20",
        checkOutTime: "17:30",
      },
      {
        machineCode: "00123",
        businessDate: "11/07/2026",
        checkInTime: null,
        checkOutTime: "18:00",
      },
      {
        machineCode: "00123",
        businessDate: "12/07/2026",
        checkInTime: "09:05",
        checkOutTime: "17:00",
      },
      {
        machineCode: "99999",
        businessDate: "13/07/2026",
        checkInTime: "09:00",
        checkOutTime: "17:00",
      },
      {
        machineCode: "00123",
        businessDate: "01/08/2026",
        checkInTime: "09:00",
        checkOutTime: "17:00",
      },
      {
        machineCode: "00123",
        businessDate: "14/07/2026",
        checkInTime: null,
        checkOutTime: null,
      },
    ]);
    const { presigned, preview } = await stageWorkbook(manager, {
      staffId: liveAId,
      branchId: branchAId,
      month: "2026-07",
      bytes,
      label: "selected-staff",
    });

    expect(preview.target).toMatchObject({
      branchId: branchAId,
      staffId: liveAId,
      attendanceMachineCode: "00123",
      month: "2026-07",
    });
    expect(preview.summary).toEqual({
      totalRows: 6,
      matchedRows: 4,
      createRows: 1,
      updateRows: 2,
      unchangedRows: 0,
      skippedRows: 3,
      errorRows: 0,
    });
    expect(preview.rows.map(({ businessDate, status }) => ({ businessDate, status }))).toEqual(
      expect.arrayContaining([
        { businessDate: "2026-07-10", status: "UPDATE" },
        { businessDate: "2026-07-11", status: "UPDATE" },
        { businessDate: "2026-07-12", status: "CREATE" },
        { businessDate: "2026-07-13", status: "SKIP_CODE_MISMATCH" },
        { businessDate: "2026-08-01", status: "SKIP_OUTSIDE_MONTH" },
        { businessDate: "2026-07-14", status: "SKIP_EMPTY_TIME" },
      ]),
    );

    const committed = await commitAttendanceMachineImport(
      manager,
      presigned.job.id,
      { confirm: true },
      metadata,
    );
    expect(committed).toMatchObject({ status: "SUCCEEDED", committedRows: 3 });

    const [updatedJuly10, updatedJuly11, createdJuly12, skippedJuly13, skippedJuly14] =
      await Promise.all([
        prisma.attendanceDay.findUniqueOrThrow({
          where: { id: july10.id },
          include: { liveMetric: true },
        }),
        prisma.attendanceDay.findUniqueOrThrow({
          where: { id: july11.id },
          include: { liveMetric: true },
        }),
        prisma.attendanceDay.findUnique({
          where: {
            companyId_staffId_businessDate: {
              companyId,
              staffId: liveAId,
              businessDate: new Date("2026-07-12T00:00:00.000Z"),
            },
          },
          include: { liveMetric: true },
        }),
        prisma.attendanceDay.findUnique({
          where: {
            companyId_staffId_businessDate: {
              companyId,
              staffId: liveAId,
              businessDate: new Date("2026-07-13T00:00:00.000Z"),
            },
          },
        }),
        prisma.attendanceDay.findUnique({
          where: {
            companyId_staffId_businessDate: {
              companyId,
              staffId: liveAId,
              businessDate: new Date("2026-07-14T00:00:00.000Z"),
            },
          },
        }),
      ]);

    expect(updatedJuly10).toMatchObject({
      id: july10.id,
      staffId: liveAId,
      branchId: branchAId,
      spansNextDay: false,
      overtimeMinutes: 45,
      note: "Ghi chú phải được giữ nguyên",
      status: "PRESENT",
      version: july10.version + 1,
    });
    expect(updatedJuly10.checkInAt?.toISOString()).toBe("2026-07-10T02:20:00.000Z");
    expect(updatedJuly10.checkOutAt?.toISOString()).toBe("2026-07-10T10:30:00.000Z");
    expect(updatedJuly10.workUnits.toString()).toBe("1.5");
    expect(updatedJuly10.liveMetric).toMatchObject({
      actualLiveMinutes: 333,
      revenueAmount: 987_654n,
    });
    expect(updatedJuly11.checkInAt?.toISOString()).toBe("2026-07-11T02:00:00.000Z");
    expect(updatedJuly11.checkOutAt?.toISOString()).toBe("2026-07-11T11:00:00.000Z");
    expect(updatedJuly11.workUnits.toString()).toBe("0.5");
    expect(updatedJuly11.liveMetric).toMatchObject({
      actualLiveMinutes: 300,
      revenueAmount: 123_456n,
    });
    expect(createdJuly12).toMatchObject({
      branchId: branchAId,
      staffId: liveAId,
      overtimeMinutes: 0,
      note: null,
      status: "DRAFT",
      liveMetric: { actualLiveMinutes: 0, revenueAmount: 0n },
    });
    expect(createdJuly12?.workUnits.toString()).toBe("0");
    expect(skippedJuly13).toBeNull();
    expect(skippedJuly14).toBeNull();
    expect(
      await prisma.attendanceDay.count({
        where: {
          companyId,
          staffId: liveAId,
          businessDate: { gte: new Date("2026-08-01"), lt: new Date("2026-09-01") },
        },
      }),
    ).toBe(0);
    expect(
      await prisma.attendanceDay.count({
        where: { companyId, staffId: liveBId },
      }),
    ).toBe(0);

    expect(
      await prisma.violation.findUniqueOrThrow({ where: { id: manualViolation.id } }),
    ).toMatchObject({
      status: "ACTIVE",
      origin: "MANUAL",
      amount: 50_000n,
      detail: "Chi tiết lỗi thủ công không được thay đổi.",
      note: "Ghi chú lỗi thủ công.",
      version: 1,
    });
    expect(
      await prisma.violation.findFirst({
        where: {
          companyId,
          attendanceId: july10.id,
          penaltyItemId: automaticPenaltyItemId,
          origin: "AUTOMATIC",
          status: "ACTIVE",
        },
      }),
    ).toMatchObject({
      itemName: "Đi làm muộn tự động",
      amount: 20_000n,
    });

    const recommitted = await commitAttendanceMachineImport(
      manager,
      presigned.job.id,
      { confirm: true },
      metadata,
    );
    expect(recommitted).toEqual(committed);
    expect(
      await prisma.auditLog.count({
        where: {
          companyId,
          entityId: presigned.job.id,
          action: "ATTENDANCE_MACHINE_IMPORT_COMMIT",
        },
      }),
    ).toBe(1);
    expect(
      await prisma.violation.count({
        where: {
          companyId,
          attendanceId: july10.id,
          penaltyItemId: automaticPenaltyItemId,
          origin: "AUTOMATIC",
        },
      }),
    ).toBe(1);
  });

  it("phát hiện preview stale và không ghi đè thay đổi mới hơn", async () => {
    const existing = await createAttendanceFixture({
      staffId: liveAId,
      branchId: branchAId,
      businessDate: "2026-07-20",
      checkInAt: "2026-07-20T09:00:00+07:00",
      checkOutAt: "2026-07-20T17:00:00+07:00",
      note: "Trước preview",
      actualLiveMinutes: 360,
      revenueAmount: 200_000n,
    });
    const bytes = await workbookBytes([
      {
        machineCode: "00123",
        businessDate: "20/07/2026",
        checkInTime: "09:10",
        checkOutTime: "17:10",
      },
    ]);
    const { presigned, preview } = await stageWorkbook(manager, {
      staffId: liveAId,
      branchId: branchAId,
      month: "2026-07",
      bytes,
      label: "stale-preview",
    });
    expect(preview.summary.updateRows).toBe(1);

    await prisma.attendanceDay.update({
      where: { id: existing.id },
      data: {
        note: "Đã được request khác cập nhật",
        version: { increment: 1 },
      },
    });
    await expect(
      commitAttendanceMachineImport(manager, presigned.job.id, { confirm: true }, metadata),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { code: "IMPORT_PREVIEW_STALE", businessDate: "2026-07-20" },
    });

    const current = await prisma.attendanceDay.findUniqueOrThrow({
      where: { id: existing.id },
    });
    expect(current.note).toBe("Đã được request khác cập nhật");
    expect(current.checkInAt?.toISOString()).toBe("2026-07-20T02:00:00.000Z");
    expect(current.checkOutAt?.toISOString()).toBe("2026-07-20T10:00:00.000Z");
    expect(
      await prisma.importJob.findUniqueOrThrow({ where: { id: presigned.job.id } }),
    ).toMatchObject({ status: "VALIDATED", committedRows: 0 });
  });

  it("khóa manager ngoài cơ sở/chính mình và tách idempotency theo hồ sơ được chọn", async () => {
    const bytes = await workbookBytes([
      {
        machineCode: "00123",
        businessDate: "25/07/2026",
        checkInTime: "09:00",
        checkOutTime: "17:00",
      },
    ]);
    const checksumSha256 = createHash("sha256").update(bytes).digest("base64");
    const common = {
      month: "2026-07",
      originalFileName: "same-file.xlsx",
      mimeType: XLSX_MIME,
      sizeBytes: bytes.byteLength,
      checksumSha256,
    } as const;

    await expect(
      presignAttendanceMachineImportUpload(
        manager,
        {
          ...attemptFields(),
          ...common,
          staffId: liveBId,
          branchId: branchBId,
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      presignAttendanceMachineImportUpload(
        {
          ...manager,
          role: "LIVE_EMPLOYEE",
          staffId: liveAId,
        },
        {
          ...attemptFields(),
          ...common,
          staffId: liveAId,
          branchId: branchAId,
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      presignAttendanceMachineImportUpload(
        manager,
        {
          ...attemptFields(),
          ...common,
          staffId: managerStaffId,
          branchId: branchAId,
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const forA = await presignAttendanceMachineImportUpload(
      gm,
      {
        ...attemptFields(),
        ...common,
        staffId: liveAId,
        branchId: branchAId,
      },
      metadata,
    );
    const forB = await presignAttendanceMachineImportUpload(
      gm,
      {
        ...attemptFields(),
        ...common,
        staffId: liveBId,
        branchId: branchBId,
      },
      metadata,
    );
    expect(forA.duplicate).toBe(false);
    expect(forB.duplicate).toBe(false);
    expect(forB.job.id).not.toBe(forA.job.id);
    expect(
      await prisma.importJob.count({
        where: {
          companyId,
          template: "ATTENDANCE_MACHINE",
          checksumSha256,
        },
      }),
    ).toBe(2);
  });

  it("chặn checksum sai và XLSX không parse được trước khi ghi object", async () => {
    const bytes = await workbookBytes([
      {
        machineCode: "00123",
        businessDate: "29/07/2026",
        checkInTime: "09:00",
        checkOutTime: "17:00",
      },
    ]);
    const checksumSha256 = createHash("sha256").update(bytes).digest("base64");
    const request = {
      ...attemptFields(),
      staffId: liveAId,
      branchId: branchAId,
      month: "2026-07",
      originalFileName: "checksum.xlsx",
      mimeType: XLSX_MIME,
      sizeBytes: bytes.byteLength,
      checksumSha256,
    } as const;
    const job = await presignAttendanceMachineImportUpload(manager, request, metadata);
    const changed = Uint8Array.from(bytes);
    changed[changed.length - 1] = (changed.at(-1)! + 1) % 256;
    vi.mocked(putPrivateObject).mockClear();

    await expect(
      uploadAttendanceMachineImport(
        manager,
        job.job.id,
        new Request("http://localhost/upload", {
          method: "PUT",
          headers: { "Content-Type": XLSX_MIME },
          body: requestBody(changed),
        }),
        metadata,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: { code: "IMPORT_CHECKSUM_MISMATCH" },
    });
    expect(putPrivateObject).not.toHaveBeenCalled();

    const invalidBytes = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    const invalidJob = await presignAttendanceMachineImportUpload(
      manager,
      {
        ...attemptFields(),
        staffId: liveAId,
        branchId: branchAId,
        month: "2026-07",
        originalFileName: "invalid.xlsx",
        mimeType: XLSX_MIME,
        sizeBytes: invalidBytes.byteLength,
        checksumSha256: createHash("sha256").update(invalidBytes).digest("base64"),
      },
      metadata,
    );
    await expect(
      uploadAttendanceMachineImport(
        manager,
        invalidJob.job.id,
        new Request("http://localhost/upload", {
          method: "PUT",
          headers: { "Content-Type": XLSX_MIME },
          body: requestBody(invalidBytes),
        }),
        metadata,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(putPrivateObject).not.toHaveBeenCalled();
  });

  it("reports a sanitized storage outage, keeps the job pending and retries successfully", async () => {
    const bytes = await workbookBytes([
      {
        machineCode: "00123",
        businessDate: "17/07/2026",
        checkInTime: "09:00",
        checkOutTime: "17:00",
      },
    ]);
    const input = {
      ...attemptFields(),
      staffId: liveAId,
      branchId: branchAId,
      month: "2026-07",
      originalFileName: "storage-retry.xlsx",
      mimeType: XLSX_MIME,
      sizeBytes: bytes.byteLength,
      checksumSha256: createHash("sha256").update(bytes).digest("base64"),
    } as const;
    const first = await presignAttendanceMachineImportUpload(manager, input, metadata);
    const storageError = Object.assign(
      new Error(
        "request to https://private-storage.internal failed with access key do-not-log-this",
      ),
      {
        name: "TimeoutError",
        $metadata: { httpStatusCode: 503 },
      },
    );
    vi.mocked(putPrivateObject).mockRejectedValueOnce(storageError);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(
        uploadAttendanceMachineImport(
          manager,
          first.job.id,
          new Request("http://localhost/upload", {
            method: "PUT",
            headers: { "Content-Type": XLSX_MIME },
            body: requestBody(bytes),
          }),
          metadata,
        ),
      ).rejects.toMatchObject({
        code: "DEPENDENCY_UNAVAILABLE",
        message:
          "Kho lưu trữ file đang tạm thời không khả dụng. Vui lòng thử lại sau hoặc báo quản trị viên kiểm tra cấu hình lưu trữ.",
        details: { code: "STORAGE_UNAVAILABLE", retryable: true },
      });

      expect(consoleError).toHaveBeenCalledTimes(1);
      const logLine = String(consoleError.mock.calls[0]?.[0]);
      expect(JSON.parse(logLine)).toEqual({
        event: "attendance_machine_import.storage_upload_failed",
        requestId: metadata.requestId,
        importJobId: first.job.id,
        error: {
          name: "TimeoutError",
          message: "Private object storage request failed.",
          status: 503,
        },
      });
      expect(logLine).not.toContain("private-storage.internal");
      expect(logLine).not.toContain("do-not-log-this");
    } finally {
      consoleError.mockRestore();
    }
    await expect(
      prisma.importJob.findUniqueOrThrow({
        where: { id: first.job.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "PENDING_UPLOAD" });

    const sameAttempt = await presignAttendanceMachineImportUpload(manager, input, metadata);
    expect(sameAttempt).toMatchObject({
      duplicate: true,
      job: { id: first.job.id, status: "PENDING_UPLOAD" },
    });

    const uploaded = await uploadAttendanceMachineImport(
      manager,
      first.job.id,
      new Request("http://localhost/upload", {
        method: "PUT",
        headers: { "Content-Type": XLSX_MIME },
        body: requestBody(bytes),
      }),
      metadata,
    );
    expect(uploaded).toMatchObject({ id: first.job.id, status: "UPLOADED" });
    expect(
      await prisma.importJob.count({
        where: {
          companyId,
          idempotencyKey: input.idempotencyKey,
        },
      }),
    ).toBe(1);
  });

  it("renews a pending retry window and ignores expired sibling attempts in the warning", async () => {
    const bytes = await workbookBytes([
      {
        machineCode: "00123",
        businessDate: "18/08/2026",
        checkInTime: "09:00",
        checkOutTime: "17:00",
      },
    ]);
    const baseInput = {
      staffId: liveAId,
      branchId: branchAId,
      month: "2026-08",
      originalFileName: "retry-window.xlsx",
      mimeType: XLSX_MIME,
      sizeBytes: bytes.byteLength,
      checksumSha256: createHash("sha256").update(bytes).digest("base64"),
    } as const;
    const firstInput = { ...attemptFields(), ...baseInput };
    const first = await presignAttendanceMachineImportUpload(manager, firstInput, metadata);
    await prisma.importJob.update({
      where: { id: first.job.id },
      data: { expiresAt: new Date(Date.now() + 5_000) },
    });

    const retried = await presignAttendanceMachineImportUpload(manager, firstInput, metadata);
    const renewed = await prisma.importJob.findUniqueOrThrow({
      where: { id: first.job.id },
      select: { expiresAt: true },
    });
    expect(retried).toMatchObject({
      duplicate: true,
      unfinishedAttemptExists: false,
      job: { id: first.job.id, status: "PENDING_UPLOAD" },
    });
    expect(renewed.expiresAt?.getTime()).toBeGreaterThan(Date.now() + 20 * 60 * 1_000);

    await prisma.importJob.update({
      where: { id: first.job.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await expect(
      presignAttendanceMachineImportUpload(manager, firstInput, metadata),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { code: "IMPORT_ATTEMPT_EXPIRED" },
    });
    const replacement = await presignAttendanceMachineImportUpload(
      manager,
      { ...attemptFields(), ...baseInput },
      metadata,
    );
    expect(replacement.unfinishedAttemptExists).toBe(false);
    expect(replacement.job.id).not.toBe(first.job.id);
  });

  it("cho phép người có quyền tạo attempt mới cùng file và supersede preview cũ sau commit", async () => {
    const bytes = await workbookBytes([
      {
        machineCode: "00123",
        businessDate: "29/07/2026",
        checkInTime: "09:05",
        checkOutTime: "17:05",
      },
    ]);
    const attemptA = await stageWorkbook(manager, {
      staffId: liveAId,
      branchId: branchAId,
      month: "2026-07",
      bytes,
      label: "same-file-attempt-a",
    });
    const attemptB = await stageWorkbook(gm, {
      staffId: liveAId,
      branchId: branchAId,
      month: "2026-07",
      bytes,
      label: "same-file-attempt-b",
    });

    expect(attemptA.presigned.job.id).not.toBe(attemptB.presigned.job.id);
    expect(attemptA.preview.summary.createRows).toBe(1);
    expect(attemptB.preview.summary.createRows).toBe(1);

    const jobsBeforeCommit = await prisma.importJob.findMany({
      where: { id: { in: [attemptA.presigned.job.id, attemptB.presigned.job.id] } },
      select: {
        requestedByUserId: true,
        objectKey: true,
      },
    });
    expect(new Set(jobsBeforeCommit.map((item) => item.requestedByUserId))).toEqual(
      new Set([manager.userId, gm.userId]),
    );
    expect(new Set(jobsBeforeCommit.map((item) => item.objectKey)).size).toBe(2);

    await commitAttendanceMachineImport(gm, attemptB.presigned.job.id, { confirm: true }, metadata);

    await expect(
      commitAttendanceMachineImport(
        manager,
        attemptA.presigned.job.id,
        { confirm: true },
        metadata,
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { code: "IMPORT_PREVIEW_STALE" },
    });
    expect(
      await prisma.importJob.findUniqueOrThrow({ where: { id: attemptA.presigned.job.id } }),
    ).toMatchObject({
      status: "SUPERSEDED",
      requestedByUserId: manager.userId,
      committedAt: null,
    });
    expect(
      await prisma.importJob.findUniqueOrThrow({ where: { id: attemptB.presigned.job.id } }),
    ).toMatchObject({
      status: "SUCCEEDED",
      requestedByUserId: gm.userId,
    });
  });

  it("job PENDING hoặc UPLOADED bị bỏ dở không chặn người có quyền khác", async () => {
    const bytes = await workbookBytes([
      {
        machineCode: "00123",
        businessDate: "30/07/2026",
        checkInTime: "09:10",
        checkOutTime: "17:10",
      },
    ]);
    const checksumSha256 = createHash("sha256").update(bytes).digest("base64");
    const base = {
      staffId: liveAId,
      branchId: branchAId,
      month: "2026-07",
      originalFileName: "abandoned.xlsx",
      mimeType: XLSX_MIME,
      sizeBytes: bytes.byteLength,
      checksumSha256,
    } as const;
    const pendingInput = { ...attemptFields(), ...base };
    const pending = await presignAttendanceMachineImportUpload(manager, pendingInput, metadata);
    const sameAttemptRetry = await presignAttendanceMachineImportUpload(
      manager,
      pendingInput,
      metadata,
    );
    expect(sameAttemptRetry.job.id).toBe(pending.job.id);
    expect(sameAttemptRetry.duplicate).toBe(true);

    await expect(
      uploadAttendanceMachineImport(
        gm,
        pending.job.id,
        new Request("http://localhost/upload", {
          method: "PUT",
          headers: { "Content-Type": XLSX_MIME },
          body: requestBody(bytes),
        }),
        metadata,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const uploadedInput = { ...attemptFields(), ...base };
    const uploaded = await presignAttendanceMachineImportUpload(manager, uploadedInput, metadata);
    const uploadedDto = await uploadAttendanceMachineImport(
      manager,
      uploaded.job.id,
      new Request("http://localhost/upload", {
        method: "PUT",
        headers: { "Content-Type": XLSX_MIME },
        body: requestBody(bytes),
      }),
      metadata,
    );
    expect(uploadedDto.status).toBe("UPLOADED");
    expect(uploadedDto).not.toHaveProperty("objectKey");
    expect(uploadedDto).not.toHaveProperty("checksumSha256");
    expect(uploadedDto).not.toHaveProperty("upload");

    const replacement = await stageWorkbook(gm, {
      staffId: liveAId,
      branchId: branchAId,
      month: "2026-07",
      bytes,
      label: "replacement-after-abandoned",
    });
    await commitAttendanceMachineImport(
      gm,
      replacement.presigned.job.id,
      { confirm: true },
      metadata,
    );

    expect(
      await prisma.importJob.findUniqueOrThrow({ where: { id: pending.job.id } }),
    ).toMatchObject({ status: "PENDING_UPLOAD", requestedByUserId: manager.userId });
    expect(
      await prisma.importJob.findUniqueOrThrow({ where: { id: uploaded.job.id } }),
    ).toMatchObject({ status: "UPLOADED", requestedByUserId: manager.userId });
  });

  it("hai commit đồng thời chỉ có một lượt thắng và lượt còn lại nhận preview stale", async () => {
    const bytes = await workbookBytes([
      {
        machineCode: "00123",
        businessDate: "31/07/2026",
        checkInTime: "09:15",
        checkOutTime: "17:15",
      },
    ]);
    const [attemptA, attemptB] = await Promise.all([
      stageWorkbook(manager, {
        staffId: liveAId,
        branchId: branchAId,
        month: "2026-07",
        bytes,
        label: "concurrent-a",
      }),
      stageWorkbook(gm, {
        staffId: liveAId,
        branchId: branchAId,
        month: "2026-07",
        bytes,
        label: "concurrent-b",
      }),
    ]);
    const jobIds = [attemptA.presigned.job.id, attemptB.presigned.job.id];
    const results = await Promise.allSettled([
      commitAttendanceMachineImport(manager, jobIds[0]!, { confirm: true }, metadata),
      commitAttendanceMachineImport(gm, jobIds[1]!, { confirm: true }, metadata),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({
      code: "CONFLICT",
      details: { code: "IMPORT_PREVIEW_STALE" },
    });
    expect(
      await prisma.attendanceDay.count({
        where: {
          companyId,
          staffId: liveAId,
          businessDate: new Date("2026-07-31T00:00:00.000Z"),
        },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          companyId,
          entityId: { in: jobIds },
          action: "ATTENDANCE_MACHINE_IMPORT_COMMIT",
        },
      }),
    ).toBe(1);
  });

  it("không cho commit khi không có dòng khớp hoặc khi mã và ngày bị trùng", async () => {
    const noMatch = await stageWorkbook(manager, {
      staffId: liveAId,
      branchId: branchAId,
      month: "2026-07",
      bytes: await workbookBytes([
        {
          machineCode: "99999",
          businessDate: "26/07/2026",
          checkInTime: "09:00",
          checkOutTime: "17:00",
        },
        {
          machineCode: "00123",
          businessDate: "01/08/2026",
          checkInTime: "09:00",
          checkOutTime: "17:00",
        },
      ]),
      label: "no-match",
    });
    expect(noMatch.preview.summary).toMatchObject({
      matchedRows: 0,
      createRows: 0,
      updateRows: 0,
      errorRows: 0,
    });
    expect(noMatch.preview.canCommit).toBe(false);
    await expect(
      commitAttendanceMachineImport(manager, noMatch.presigned.job.id, { confirm: true }, metadata),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const duplicate = await stageWorkbook(manager, {
      staffId: liveAId,
      branchId: branchAId,
      month: "2026-07",
      bytes: await workbookBytes([
        {
          machineCode: "00123",
          businessDate: "27/07/2026",
          checkInTime: "09:00",
          checkOutTime: "17:00",
        },
        {
          machineCode: "00123",
          businessDate: "27/07/2026",
          checkInTime: "09:05",
          checkOutTime: "17:05",
        },
      ]),
      label: "duplicate-date",
    });
    expect(duplicate.preview.summary).toMatchObject({
      createRows: 0,
      updateRows: 0,
      errorRows: 2,
    });
    expect(duplicate.preview.rows.map((row) => row.status)).toEqual(["DUPLICATE", "DUPLICATE"]);
    expect(duplicate.preview.canCommit).toBe(false);
    await expect(
      commitAttendanceMachineImport(
        manager,
        duplicate.presigned.job.id,
        { confirm: true },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await prisma.attendanceDay.count({
        where: {
          companyId,
          staffId: liveAId,
          businessDate: {
            in: [new Date("2026-07-26T00:00:00.000Z"), new Date("2026-07-27T00:00:00.000Z")],
          },
        },
      }),
    ).toBe(0);
  });

  it("keeps FAILED attempts terminal so cleanup cannot race with object reuse", async () => {
    const bytes = await workbookBytes([
      {
        machineCode: "00123",
        businessDate: "30/07/2026",
        checkInTime: "09:00",
        checkOutTime: "17:00",
      },
    ]);
    const baseInput = {
      staffId: liveAId,
      branchId: branchAId,
      month: "2026-07",
      originalFileName: "failed-terminal.xlsx",
      mimeType: XLSX_MIME,
      sizeBytes: bytes.byteLength,
      checksumSha256: createHash("sha256").update(bytes).digest("base64"),
    } as const;
    const firstInput = { ...attemptFields(), ...baseInput };
    const first = await presignAttendanceMachineImportUpload(manager, firstInput, metadata);
    await prisma.importJob.update({
      where: { id: first.job.id },
      data: { status: "FAILED", expiresAt: new Date() },
    });

    await expect(
      presignAttendanceMachineImportUpload(manager, firstInput, metadata),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { code: "IMPORT_ATTEMPT_FAILED" },
    });

    const replacement = await presignAttendanceMachineImportUpload(
      manager,
      { ...attemptFields(), ...baseInput },
      metadata,
    );
    expect(replacement.job.id).not.toBe(first.job.id);
    await expect(
      prisma.importJob.findUniqueOrThrow({
        where: { id: first.job.id },
        select: { status: true, requestedByUserId: true },
      }),
    ).resolves.toEqual({ status: "FAILED", requestedByUserId: manager.userId });
  });

  it("serializes the whole staff/month scope when previews change different days", async () => {
    const [bytesA, bytesB] = await Promise.all([
      workbookBytes([
        {
          machineCode: "00123",
          businessDate: "18/07/2026",
          checkInTime: "09:05",
          checkOutTime: "17:05",
        },
      ]),
      workbookBytes([
        {
          machineCode: "00123",
          businessDate: "19/07/2026",
          checkInTime: "09:10",
          checkOutTime: "17:10",
        },
      ]),
    ]);
    const attemptA = await stageWorkbook(manager, {
      staffId: liveAId,
      branchId: branchAId,
      month: "2026-07",
      bytes: bytesA,
      label: "scope-lock-a",
    });
    const attemptB = await stageWorkbook(gm, {
      staffId: liveAId,
      branchId: branchAId,
      month: "2026-07",
      bytes: bytesB,
      label: "scope-lock-b",
    });
    expect(attemptA.preview.rows.map((row) => row.businessDate)).toEqual(["2026-07-18"]);
    expect(attemptB.preview.rows.map((row) => row.businessDate)).toEqual(["2026-07-19"]);
    const jobIds = [attemptA.presigned.job.id, attemptB.presigned.job.id];

    const results = await Promise.allSettled([
      commitAttendanceMachineImport(manager, jobIds[0]!, { confirm: true }, metadata),
      commitAttendanceMachineImport(gm, jobIds[1]!, { confirm: true }, metadata),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({
      code: "CONFLICT",
      details: { code: "IMPORT_PREVIEW_STALE" },
    });
    expect(
      await prisma.attendanceDay.count({
        where: {
          companyId,
          staffId: liveAId,
          businessDate: {
            in: [new Date("2026-07-18T00:00:00.000Z"), new Date("2026-07-19T00:00:00.000Z")],
          },
        },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          companyId,
          entityId: { in: jobIds },
          action: "ATTENDANCE_MACHINE_IMPORT_COMMIT",
        },
      }),
    ).toBe(1);
  });

  it("lists safe scoped history without transferring job ownership", async () => {
    const bytes = await workbookBytes([
      {
        machineCode: "00123",
        businessDate: "15/06/2026",
        checkInTime: "09:00",
        checkOutTime: "17:00",
      },
    ]);
    const checksumSha256 = createHash("sha256").update(bytes).digest("base64");
    const common = {
      month: "2026-06",
      originalFileName: "history.xlsx",
      mimeType: XLSX_MIME,
      sizeBytes: bytes.byteLength,
      checksumSha256,
    } as const;
    const managerJob = await presignAttendanceMachineImportUpload(
      manager,
      {
        ...attemptFields(),
        ...common,
        staffId: liveAId,
        branchId: branchAId,
      },
      metadata,
    );
    const gmJob = await presignAttendanceMachineImportUpload(
      gm,
      {
        ...attemptFields(),
        ...common,
        staffId: liveAId,
        branchId: branchAId,
      },
      metadata,
    );
    await presignAttendanceMachineImportUpload(
      gm,
      {
        ...attemptFields(),
        ...common,
        staffId: liveBId,
        branchId: branchBId,
      },
      metadata,
    );

    const archivedAssignment = await prisma.branchAssignment.updateMany({
      where: {
        companyId,
        branchId: branchAId,
        staffId: liveAId,
        assignmentType: "MEMBER",
      },
      data: {
        attendanceMachineCode: null,
        archivedAt: new Date(),
      },
    });
    expect(archivedAssignment.count).toBe(1);

    const managerHistory = await listAttendanceMachineImportHistory(manager, {
      branchId: branchAId,
      staffId: liveAId,
      month: "2026-06",
    });
    expect(managerHistory).toHaveLength(2);
    expect(managerHistory.find((item) => item.id === managerJob.job.id)).toMatchObject({
      ownedByCurrentUser: true,
    });
    expect(managerHistory.find((item) => item.id === gmJob.job.id)).toMatchObject({
      ownedByCurrentUser: false,
    });
    expect(managerHistory[0]).not.toHaveProperty("objectKey");
    expect(managerHistory[0]).not.toHaveProperty("checksumSha256");
    expect(managerHistory[0]).not.toHaveProperty("requestedByUserId");

    await expect(
      listAttendanceMachineImportHistory(manager, {
        branchId: branchBId,
        staffId: liveBId,
        month: "2026-06",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      listAttendanceMachineImportHistory(manager, {
        branchId: branchAId,
        staffId: managerStaffId,
        month: "2026-06",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      listAttendanceMachineImportHistory(gm, {
        branchId: branchBId,
        staffId: liveBId,
        month: "2026-06",
      }),
    ).resolves.toHaveLength(1);

    await expect(
      prisma.importJob.findUniqueOrThrow({
        where: { id: managerJob.job.id },
        select: { requestedByUserId: true },
      }),
    ).resolves.toEqual({ requestedByUserId: manager.userId });
  });
});
