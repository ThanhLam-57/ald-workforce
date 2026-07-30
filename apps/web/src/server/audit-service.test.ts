import { describe, expect, it } from "vitest";

import { systemAuditReason } from "./audit-service";

describe("systemAuditReason", () => {
  it("creates a stable server-owned audit description", () => {
    expect(systemAuditReason("attendance.updated from month grid")).toBe(
      "SYSTEM:ATTENDANCE_UPDATED_FROM_MONTH_GRID",
    );
  });

  it("normalizes punctuation instead of preserving client text", () => {
    expect(systemAuditReason("violation.cancel")).toBe("SYSTEM:VIOLATION_CANCEL");
  });
});
