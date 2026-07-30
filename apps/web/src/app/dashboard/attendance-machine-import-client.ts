export function attendanceMachineUploadPath(jobId: string): string {
  return `/api/attendance/machine-imports/${encodeURIComponent(jobId)}/upload`;
}

export function attendanceMachineAttemptKey(attemptId: string): string {
  return `attendance-machine:${attemptId}`;
}

export function attendanceMachineImportHistoryPath(input: {
  branchId: string;
  staffId: string;
  month: string;
}): string {
  const query = new URLSearchParams({
    branchId: input.branchId,
    staffId: input.staffId,
    month: input.month,
  });
  return `/api/attendance/machine-imports/history?${query.toString()}`;
}
