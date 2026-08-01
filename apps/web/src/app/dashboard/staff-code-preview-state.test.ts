import { describe, expect, it } from "vitest";

import {
  canSubmitStaffOnboarding,
  isLatestStaffCodePreviewRequest,
} from "./staff-code-preview-state";

describe("trạng thái mã nhân viên xem trước", () => {
  it("không áp dụng response cũ hoặc response của cơ sở cũ", () => {
    expect(
      isLatestStaffCodePreviewRequest({
        currentBranchId: "branch-b",
        latestRequestId: 2,
        requestedBranchId: "branch-a",
        requestId: 1,
      }),
    ).toBe(false);
    expect(
      isLatestStaffCodePreviewRequest({
        currentBranchId: "branch-b",
        latestRequestId: 2,
        requestedBranchId: "branch-b",
        requestId: 2,
      }),
    ).toBe(true);
  });

  it("chỉ cho lưu khi mã đã sẵn sàng", () => {
    expect(
      canSubmitStaffOnboarding({
        branchId: "branch-a",
        pending: false,
        previewStatus: "READY",
        staffCode: "NV_XT_001",
      }),
    ).toBe(true);
    expect(
      canSubmitStaffOnboarding({
        branchId: "branch-a",
        pending: false,
        previewStatus: "LOADING",
        staffCode: "",
      }),
    ).toBe(false);
  });
});
