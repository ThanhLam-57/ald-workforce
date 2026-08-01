import type { AttendanceBatchSaveInput } from "@ald/contracts";
import { describe, expect, it, vi } from "vitest";

import { postAttendanceBatch } from "./attendance-batch-client";

describe("attendance batch client", () => {
  it("sends one POST request for all changed rows", async () => {
    const request = vi.fn(async () => new Response(null, { status: 200 }));
    const rows = Array.from({ length: 31 }, (_, index) => ({
      businessDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
      attendanceId: null,
      version: null,
      checkInAt: null,
      checkOutAt: null,
      spansNextDay: false,
      workUnits: index % 2 === 0 ? "1" : "0.5",
      overtimeMinutes: 0,
      note: null,
      status: "PRESENT" as const,
      actualLiveMinutes: index % 2 === 0 ? 360 : 180,
      revenueAmount: index % 2 === 0 ? "100000" : "50000",
    }));
    const input = {
      staffId: "11111111-1111-4111-8111-111111111111",
      month: "2026-07",
      rows,
    } satisfies AttendanceBatchSaveInput;

    await postAttendanceBatch(input, request as unknown as typeof fetch);

    expect(request).toHaveBeenCalledTimes(1);
    expect(input.rows).toHaveLength(31);
    expect(request).toHaveBeenCalledWith(
      "/api/attendance/batch",
      expect.objectContaining({ method: "POST", body: JSON.stringify(input) }),
    );
  });
});
