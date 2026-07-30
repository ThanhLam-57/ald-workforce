import { describe, expect, it } from "vitest";

import {
  attendanceMachineImportBlockedReason,
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
