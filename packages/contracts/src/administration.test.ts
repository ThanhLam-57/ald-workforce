import { describe, expect, it } from "vitest";

import {
  adminAssignmentListQuerySchema,
  adminBranchListQuerySchema,
  adminStaffListQuerySchema,
  adminUserListQuerySchema,
  staffCreateSchema,
  staffUpdateSchema,
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

describe("employment milestone dates", () => {
  const baseStaff = {
    staffCode: "LIVE01",
    fullName: "Nhân viên Live",
    jobTitle: "Live",
    baseSalaryAmount: "7000000",
    joinedDate: "2026-07-01",
    employmentCategory: "PROBATION" as const,
    reason: "Tạo hồ sơ để kiểm thử",
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
        reason: "Sửa ngày không hợp lệ",
      }),
    ).toThrow();
  });
});
