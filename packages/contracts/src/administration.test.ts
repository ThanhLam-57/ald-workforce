import { describe, expect, it } from "vitest";

import {
  adminAssignmentListQuerySchema,
  adminBranchListQuerySchema,
  adminStaffListQuerySchema,
  adminUserListQuerySchema,
  staffCreateSchema,
  staffIdentityDocumentPresignSchema,
  staffCodePreviewQuerySchema,
  staffOnboardSchema,
  staffProfileUpdateSchema,
  staffStartDateCorrectionSchema,
  staffUpdateSchema,
  staffWorkScheduleCreateSchema,
} from "./index";

describe("administration list query", () => {
  it("áp dụng page mặc định và chuẩn hóa số từ URL", () => {
    expect(adminBranchListQuerySchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 20,
      search: "",
      status: "ALL",
      sort: "code",
      direction: "asc",
    });
    expect(adminStaffListQuerySchema.parse({ page: "2", pageSize: "50" })).toMatchObject({
      page: 2,
      pageSize: 50,
    });
  });

  it("chặn page size vượt giới hạn", () => {
    expect(() => adminUserListQuerySchema.parse({ pageSize: "101" })).toThrow();
  });

  it("chỉ nhận sort và filter trong allow-list", () => {
    expect(() => adminBranchListQuerySchema.parse({ sort: "companyId" })).toThrow();
    expect(() => adminAssignmentListQuerySchema.parse({ status: "DELETED" })).toThrow();
  });
});

describe("manager staff onboarding", () => {
  const validSchedule = {
    name: "Ca Live sáng",
    scheduledStartMinutes: 540,
    scheduledEndMinutes: 900,
    spansNextDay: false,
    requiredLiveMinutes: 360,
  };

  it("nhận ca trong ngày và ca qua ngày hợp lệ", () => {
    expect(
      staffWorkScheduleCreateSchema.parse({
        ...validSchedule,
        effectiveFrom: "2026-07-01",
        effectiveTo: null,
      }),
    ).toMatchObject(validSchedule);
    expect(
      staffWorkScheduleCreateSchema.parse({
        ...validSchedule,
        scheduledStartMinutes: 1_320,
        scheduledEndMinutes: 240,
        spansNextDay: true,
        requiredLiveMinutes: 300,
        effectiveFrom: "2026-07-01",
      }),
    ).toMatchObject({ spansNextDay: true });
  });

  it("chặn cờ qua ngày sai và Live dài hơn ca", () => {
    expect(() =>
      staffWorkScheduleCreateSchema.parse({
        ...validSchedule,
        scheduledEndMinutes: 480,
        spansNextDay: false,
        effectiveFrom: "2026-07-01",
      }),
    ).toThrow();
    expect(() =>
      staffWorkScheduleCreateSchema.parse({
        ...validSchedule,
        requiredLiveMinutes: 361,
        effectiveFrom: "2026-07-01",
      }),
    ).toThrow();
  });

  it("form onboarding nhận lương cơ bản để service kiểm tra quyền theo vai trò", () => {
    const parsed = staffOnboardSchema.parse({
      branchId: "00000000-0000-4000-8000-000000000001",
      attendanceMachineCode: "001",
      fullName: "Nhân viên Live 02",
      jobTitle: "Nhân viên Live",
      joinedDate: "2026-07-01",
      officialDate: null,
      employmentCategory: "PROBATION",
      initialSchedule: validSchedule,
      baseSalaryAmount: "999999999",
    });
    expect(parsed).toHaveProperty("baseSalaryAmount", "999999999");
  });

  it("chuẩn hóa mã máy chấm công và bắt buộc mã khi onboarding", () => {
    const base = {
      branchId: "00000000-0000-4000-8000-000000000001",
      fullName: "Nhân viên Live 03",
      jobTitle: "Nhân viên Live",
      joinedDate: "2026-07-01",
      officialDate: null,
      employmentCategory: "PROBATION" as const,
      initialSchedule: validSchedule,
    };
    expect(staffOnboardSchema.parse({ ...base, attendanceMachineCode: " nv_001 " })).toMatchObject({
      attendanceMachineCode: "NV_001",
    });
    expect(() => staffOnboardSchema.parse(base)).toThrow();
  });

  it("không bắt buộc staffCode từ client và validate branchId khi xem trước mã", () => {
    expect(
      staffOnboardSchema.parse({
        branchId: "00000000-0000-4000-8000-000000000001",
        attendanceMachineCode: "001",
        fullName: "Nhân viên tự sinh mã",
        jobTitle: "Nhân viên Live",
        joinedDate: "2026-07-01",
        officialDate: null,
        employmentCategory: "PROBATION",
        initialSchedule: validSchedule,
      }),
    ).not.toHaveProperty("staffCode");
    expect(
      staffCodePreviewQuerySchema.parse({
        branchId: "00000000-0000-4000-8000-000000000001",
      }),
    ).toEqual({ branchId: "00000000-0000-4000-8000-000000000001" });
  });

  it("validate hồ sơ mở rộng và cho phép xóa trường nullable bằng null", () => {
    const base = {
      assignmentId: "00000000-0000-4000-8000-000000000002",
      assignmentVersion: 1,
      version: 1,
    };
    expect(
      staffProfileUpdateSchema.parse({
        ...base,
        tiktokChannelId: "@KenhLive",
        citizenIdNumber: "001234567890",
        bankAccountNumber: "ABC-1234",
        facebookUrl: "https://facebook.com/kenhlive",
      }),
    ).toMatchObject({
      tiktokChannelId: "kenhlive",
      citizenIdNumber: "001234567890",
    });
    expect(
      staffProfileUpdateSchema.parse({
        ...base,
        citizenIdNumber: null,
        bankAccountNumber: null,
        facebookUrl: null,
      }),
    ).toMatchObject({
      citizenIdNumber: null,
      bankAccountNumber: null,
      facebookUrl: null,
    });
    expect(() => staffProfileUpdateSchema.parse({ ...base, citizenIdNumber: "12345" })).toThrow();
    expect(() =>
      staffProfileUpdateSchema.parse({ ...base, facebookUrl: "ftp://example.com" }),
    ).toThrow();
    expect(() => staffProfileUpdateSchema.parse({ ...base, dateOfBirth: "2999-01-01" })).toThrow();
    expect(staffProfileUpdateSchema.parse({ ...base, baseSalaryAmount: "9000000" })).toHaveProperty(
      "baseSalaryAmount",
      "9000000",
    );
  });

  it("cập nhật được hồ sơ legacy và giữ nguyên số 0 đầu của mã máy", () => {
    const parsed = staffProfileUpdateSchema.parse({
      assignmentId: "00000000-0000-4000-8000-000000000002",
      assignmentVersion: 1,
      version: 1,
      joinedDate: null,
      attendanceMachineCode: "00033",
    });
    expect(parsed).toMatchObject({
      joinedDate: null,
      attendanceMachineCode: "00033",
    });
    expect(parsed).not.toHaveProperty("reason");
  });

  it("bắt buộc lý do và optimistic lock khi đồng bộ ngày bắt đầu hồi tố", () => {
    const valid = {
      targetDate: "2026-06-30",
      assignmentId: "00000000-0000-4000-8000-000000000002",
      assignmentVersion: 2,
      staffVersion: 3,
      reason: "Hồ sơ được nhập muộn hơn ngày nhân viên bắt đầu làm việc.",
    };
    expect(staffStartDateCorrectionSchema.parse(valid)).toEqual(valid);
    expect(() => staffStartDateCorrectionSchema.parse({ ...valid, reason: " " })).toThrow();
    expect(() =>
      staffStartDateCorrectionSchema.parse({ ...valid, assignmentVersion: 0 }),
    ).toThrow();
  });

  it("chỉ nhận ảnh CCCD đúng MIME, dung lượng và checksum base64", () => {
    expect(
      staffIdentityDocumentPresignSchema.parse({
        side: "CITIZEN_ID_FRONT",
        originalFileName: "front.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 100,
        checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      }),
    ).toMatchObject({ side: "CITIZEN_ID_FRONT" });
    expect(() =>
      staffIdentityDocumentPresignSchema.parse({
        side: "CITIZEN_ID_BACK",
        originalFileName: "back.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        checksumSha256: "not-a-checksum",
      }),
    ).toThrow();
  });
});

describe("employment milestone dates", () => {
  const baseStaff = {
    staffCode: "LIVE01",
    fullName: "Nhân viên Live",
    jobTitle: "Live",
    baseSalaryAmount: "7000000",
    joinedDate: "2026-07-01",
    employmentCategory: "PROBATION" as const,
  };

  it("yêu cầu ngày gia nhập và ngày chính thức khi tạo nhân viên OFFICIAL", () => {
    expect(staffCreateSchema.parse(baseStaff)).toMatchObject({
      joinedDate: "2026-07-01",
    });
    expect(() =>
      staffCreateSchema.parse({
        ...baseStaff,
        employmentCategory: "OFFICIAL",
      }),
    ).toThrow();
    expect(
      staffCreateSchema.parse({
        ...baseStaff,
        employmentCategory: "OFFICIAL",
        officialDate: "2026-07-01",
      }),
    ).toMatchObject({ officialDate: "2026-07-01" });
  });

  it("chặn ngày chính thức trước ngày gia nhập ở create và update", () => {
    expect(() =>
      staffCreateSchema.parse({
        ...baseStaff,
        officialDate: "2026-06-30",
      }),
    ).toThrow();
    expect(() =>
      staffUpdateSchema.parse({
        joinedDate: "2026-07-01",
        officialDate: "2026-06-30",
        version: 1,
      }),
    ).toThrow();
  });

  it("cho phép Tổng quản lý sửa mã hồ sơ mà không cần lý do", () => {
    expect(
      staffUpdateSchema.parse({
        staffCode: "live_new_01",
        version: 1,
      }),
    ).toMatchObject({ staffCode: "live_new_01", version: 1 });
  });
});
