import { describe, expect, it } from "vitest";

import {
  attendanceMachineImportBlockedReason,
  attendanceMachineImportSelectableRowKeys,
  isAttendanceMachineImportRowSelectable,
  type AttendanceMachineImportAvailability,
} from "./attendance-machine-import-view";

const ready: AttendanceMachineImportAvailability = {
  branchId: "branch-id",
  staffId: "staff-id",
  month: "2026-07",
  attendanceMachineCode: "00033",
  datasetReady: true,
  optionsLoading: false,
  attendanceLoading: false,
  pendingCount: 0,
  conflictCount: 0,
  saving: false,
  reconciling: false,
  hasReconcilePreview: false,
};

describe("attendanceMachineImportBlockedReason", () => {
  it("allows import only after branch, employee, month and machine code are ready", () => {
    expect(attendanceMachineImportBlockedReason(ready)).toBeNull();
    expect(attendanceMachineImportBlockedReason({ ...ready, staffId: "" })).toBe(
      "Hãy chọn một nhân viên trước khi import.",
    );
    expect(
      attendanceMachineImportBlockedReason({
        ...ready,
        attendanceMachineCode: null,
      }),
    ).toBe("Nhân viên chưa được cấu hình Mã máy chấm công.");
  });

  it("blocks import while the attendance grid has unsaved or conflicting data", () => {
    expect(attendanceMachineImportBlockedReason({ ...ready, pendingCount: 1 })).toBe(
      "Hãy lưu tất cả thay đổi trước khi import.",
    );
    expect(
      attendanceMachineImportBlockedReason({
        ...ready,
        pendingCount: 1,
        conflictCount: 1,
      }),
    ).toBe("Hãy xử lý xung đột trước khi import.");
    expect(attendanceMachineImportBlockedReason({ ...ready, saving: true })).toBe(
      "Hãy chờ lưu dữ liệu chấm công hiện tại.",
    );
  });

  it("blocks import while automatic-violation reconciliation is active", () => {
    expect(attendanceMachineImportBlockedReason({ ...ready, reconciling: true })).toBe(
      "Hãy hoàn tất thao tác tính lại lỗi tự động trước khi import.",
    );
    expect(
      attendanceMachineImportBlockedReason({
        ...ready,
        hasReconcilePreview: true,
      }),
    ).toBe("Hãy hoàn tất thao tác tính lại lỗi tự động trước khi import.");
  });
});

describe("attendance machine import row selection", () => {
  it("selects create and update rows but always excludes error and skipped rows", () => {
    const row = {
      sheetName: "Sheet1",
      rowNumber: 4,
      machineCode: "00014",
      businessDate: "2026-07-01",
      currentCheckInTime: null,
      currentCheckOutTime: null,
      fileCheckInTime: "09:00",
      fileCheckOutTime: "17:00",
      message: null,
    } as const;
    const rows = [
      { ...row, rowKey: "create-row-key-0001", status: "CREATE" as const },
      { ...row, rowKey: "update-row-key-0002", status: "UPDATE" as const },
      { ...row, rowKey: "error-row-key-00003", status: "ERROR" as const },
      {
        ...row,
        rowKey: "skip-row-key-000004",
        status: "SKIP_CODE_MISMATCH" as const,
      },
    ];

    expect(attendanceMachineImportSelectableRowKeys(rows)).toEqual([
      "create-row-key-0001",
      "update-row-key-0002",
    ]);
    expect(isAttendanceMachineImportRowSelectable("ERROR")).toBe(false);
    expect(isAttendanceMachineImportRowSelectable("CREATE")).toBe(true);
  });
});
