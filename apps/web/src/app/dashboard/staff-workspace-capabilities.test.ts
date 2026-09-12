import { describe, expect, it } from "vitest";

import { staffWorkspaceCapabilitiesFor } from "./staff-workspace-capabilities";

describe("staffWorkspaceCapabilitiesFor", () => {
  it("cho Tổng quản lý toàn bộ quyền trên hồ sơ nhân viên", () => {
    expect(staffWorkspaceCapabilitiesFor("GENERAL_MANAGER")).toEqual({
      canViewSalary: true,
      canEditSalary: true,
      canEditAssignment: true,
      canEditSchedule: true,
      canUploadPrivateDocuments: true,
      canViewPrivateDocuments: true,
      canTerminateStaff: true,
      canRestoreStaff: true,
      canCorrectStartDate: true,
    });
  });

  it("không cho quản lý cơ sở nhận hoặc sửa lương và cho nghỉ việc", () => {
    expect(staffWorkspaceCapabilitiesFor("TRAINING_MANAGER")).toMatchObject({
      canViewSalary: false,
      canEditSalary: false,
      canEditAssignment: true,
      canEditSchedule: true,
      canUploadPrivateDocuments: true,
      canViewPrivateDocuments: true,
      canTerminateStaff: false,
      canRestoreStaff: false,
      canCorrectStartDate: false,
    });
  });

  it("không cấp capability nếu vai trò nhân viên bị chuyển nhầm tới workspace", () => {
    expect(staffWorkspaceCapabilitiesFor("LIVE_EMPLOYEE")).toEqual({
      canViewSalary: false,
      canEditSalary: false,
      canEditAssignment: false,
      canEditSchedule: false,
      canUploadPrivateDocuments: false,
      canViewPrivateDocuments: false,
      canTerminateStaff: false,
      canRestoreStaff: false,
      canCorrectStartDate: false,
    });
  });
});
