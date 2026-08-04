import type { BranchStaffDto } from "@ald/contracts";
import { describe, expect, it } from "vitest";

import { createStaffProfileUpdatePayload, type EditableStaffProfile } from "./staff-profile-update";

const staff = {
  id: "00000000-0000-4000-8000-000000000001",
  branch: {
    id: "00000000-0000-4000-8000-000000000002",
    code: "A",
    name: "Cơ sở A",
  },
  staffCode: "LIVE01",
  assignmentId: "00000000-0000-4000-8000-000000000003",
  attendanceMachineCode: null,
  assignmentVersion: 2,
  assignmentEffectiveFrom: "2026-07-01",
  assignmentEffectiveTo: null,
  fullName: "Nhân viên A",
  streamingAlias: null,
  tiktokChannelId: null,
  email: null,
  phone: null,
  dateOfBirth: null,
  citizenIdNumber: null,
  bankAccountNumber: null,
  bankName: null,
  permanentAddress: null,
  temporaryAddress: null,
  facebookUrl: null,
  university: null,
  jobTitle: "Nhân viên Live",
  joinedDate: null,
  officialDate: null,
  terminationDate: null,
  employmentCategory: "PROBATION",
  employmentStatus: "ACTIVE",
  baseSalaryAmount: "0",
  currentSchedule: null,
  identityDocuments: [],
  bankQrDocument: null,
  version: 4,
} satisfies BranchStaffDto;

function form(overrides: Partial<EditableStaffProfile> = {}): EditableStaffProfile {
  return {
    staffCode: staff.staffCode,
    attendanceMachineCode: "",
    fullName: staff.fullName,
    streamingAlias: "",
    tiktokChannelId: "",
    email: "",
    phone: "",
    dateOfBirth: "",
    citizenIdNumber: "",
    bankAccountNumber: "",
    bankName: "",
    permanentAddress: "",
    temporaryAddress: "",
    facebookUrl: "",
    university: "",
    jobTitle: staff.jobTitle,
    joinedDate: "",
    officialDate: "",
    employmentCategory: staff.employmentCategory,
    baseSalaryAmount: staff.baseSalaryAmount ?? "",
    ...overrides,
  };
}

describe("createStaffProfileUpdatePayload", () => {
  it("không gửi lại trường null của hồ sơ legacy khi chưa thay đổi", () => {
    expect(createStaffProfileUpdatePayload(staff, form())).toEqual({
      assignmentId: staff.assignmentId,
      assignmentVersion: staff.assignmentVersion,
      version: staff.version,
    });
  });

  it("giữ nguyên số 0 đầu của mã máy và chỉ gửi trường thay đổi", () => {
    expect(
      createStaffProfileUpdatePayload(staff, form({ attendanceMachineCode: " 00033 " })),
    ).toEqual({
      assignmentId: staff.assignmentId,
      assignmentVersion: staff.assignmentVersion,
      version: staff.version,
      attendanceMachineCode: "00033",
    });
  });

  it("không cho xóa mã máy đang dùng bằng chuỗi rỗng", () => {
    expect(() =>
      createStaffProfileUpdatePayload(
        { ...staff, attendanceMachineCode: "00033" },
        form({ attendanceMachineCode: "" }),
      ),
    ).toThrow("không được để trống");
  });

  it("chỉ gửi lương khi capability cho phép", () => {
    const salaryForm = form({ baseSalaryAmount: "7000000" });
    expect(
      createStaffProfileUpdatePayload(staff, salaryForm, {
        canEditAssignment: true,
        canEditSalary: false,
      }),
    ).not.toHaveProperty("baseSalaryAmount");
    expect(
      createStaffProfileUpdatePayload(staff, salaryForm, {
        canEditAssignment: true,
        canEditSalary: true,
      }),
    ).toHaveProperty("baseSalaryAmount", "7000000");
  });

  it("không gửi thay đổi mã máy khi capability phân công bị tắt", () => {
    expect(
      createStaffProfileUpdatePayload(staff, form({ attendanceMachineCode: "00033" }), {
        canEditAssignment: false,
        canEditSalary: false,
      }),
    ).not.toHaveProperty("attendanceMachineCode");
  });
});
