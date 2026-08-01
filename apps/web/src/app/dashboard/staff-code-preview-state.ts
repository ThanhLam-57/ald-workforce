export function isLatestStaffCodePreviewRequest(
  input: Readonly<{
    currentBranchId: string;
    latestRequestId: number;
    requestedBranchId: string;
    requestId: number;
  }>,
): boolean {
  return (
    input.requestId === input.latestRequestId && input.currentBranchId === input.requestedBranchId
  );
}

export function canSubmitStaffOnboarding(
  input: Readonly<{
    branchId: string;
    pending: boolean;
    previewStatus: "IDLE" | "LOADING" | "READY" | "ERROR";
    staffCode: string;
  }>,
): boolean {
  return (
    !input.pending &&
    input.previewStatus === "READY" &&
    Boolean(input.branchId) &&
    Boolean(input.staffCode)
  );
}
