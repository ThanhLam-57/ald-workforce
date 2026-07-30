import { describe, expect, it } from "vitest";

import {
  attendanceMachineAttemptKey,
  attendanceMachineImportHistoryPath,
  attendanceMachineUploadPath,
} from "./attendance-machine-import-client";

describe("attendance machine import client routing", () => {
  it("uploads through the authenticated same-origin API", () => {
    const path = attendanceMachineUploadPath("job/id");

    expect(path).toBe("/api/attendance/machine-imports/job%2Fid/upload");
    expect(path).not.toMatch(/^https?:\/\//);
  });

  it("keeps idempotency scoped to the current attempt", () => {
    expect(attendanceMachineAttemptKey("attempt-a")).toBe("attendance-machine:attempt-a");
    expect(attendanceMachineAttemptKey("attempt-b")).not.toBe(
      attendanceMachineAttemptKey("attempt-a"),
    );
  });

  it("loads history from a same-origin route with an exact target scope", () => {
    expect(
      attendanceMachineImportHistoryPath({
        branchId: "branch/id",
        staffId: "staff id",
        month: "2026-07",
      }),
    ).toBe(
      "/api/attendance/machine-imports/history?branchId=branch%2Fid&staffId=staff+id&month=2026-07",
    );
  });
});
