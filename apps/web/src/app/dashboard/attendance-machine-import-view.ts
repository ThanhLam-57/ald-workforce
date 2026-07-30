import type {
  AttendanceMachineImportPreviewRowDto,
  AttendanceMachineImportRowStatus,
} from "@ald/contracts";

export type AttendanceMachineImportAvailability = Readonly<{
  branchId: string;
  staffId: string;
  month: string;
  attendanceMachineCode: string | null;
  datasetReady: boolean;
  optionsLoading: boolean;
  attendanceLoading: boolean;
  pendingCount: number;
  conflictCount: number;
  saving: boolean;
  reconciling: boolean;
  hasReconcilePreview: boolean;
}>;

export function isAttendanceMachineImportRowSelectable(
  status: AttendanceMachineImportRowStatus,
): boolean {
  return status === "CREATE" || status === "UPDATE";
}

export function attendanceMachineImportSelectableRowKeys(
  rows: readonly AttendanceMachineImportPreviewRowDto[],
): readonly string[] {
  return rows
    .filter((row) => isAttendanceMachineImportRowSelectable(row.status))
    .map((row) => row.rowKey);
}

export function attendanceMachineImportBlockedReason(
  input: AttendanceMachineImportAvailability,
): string | null {
  if (!input.branchId) return "Hãy chọn cơ sở trước khi import.";
  if (!input.staffId) return "Hãy chọn một nhân viên trước khi import.";
  if (!input.month) return "Hãy chọn tháng trước khi import.";
  if (input.optionsLoading || input.attendanceLoading || !input.datasetReady) {
    return "Hãy chờ bảng chấm công tải xong.";
  }
  if (!input.attendanceMachineCode?.trim()) {
    return "Nhân viên chưa được cấu hình Mã máy chấm công.";
  }
  if (input.saving) return "Hãy chờ lưu dữ liệu chấm công hiện tại.";
  if (input.conflictCount > 0) return "Hãy xử lý xung đột trước khi import.";
  if (input.pendingCount > 0) return "Hãy lưu tất cả thay đổi trước khi import.";
  if (input.reconciling || input.hasReconcilePreview) {
    return "Hãy hoàn tất thao tác tính lại lỗi tự động trước khi import.";
  }
  return null;
}
