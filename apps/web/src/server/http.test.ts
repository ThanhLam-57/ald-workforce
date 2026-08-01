import { describe, expect, it } from "vitest";

import { DomainError } from "@ald/domain";

import { toErrorResponse } from "./http";

describe("toErrorResponse", () => {
  it("maps unavailable dependencies to an actionable 503 JSON response", async () => {
    const response = toErrorResponse(
      new DomainError("DEPENDENCY_UNAVAILABLE", "Kho lưu trữ file đang tạm thời không khả dụng.", {
        code: "STORAGE_UNAVAILABLE",
        retryable: true,
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "DEPENDENCY_UNAVAILABLE",
        message: "Kho lưu trữ file đang tạm thời không khả dụng.",
        details: {
          code: "STORAGE_UNAVAILABLE",
          retryable: true,
        },
      },
    });
  });

  it("preserves attendance batch error codes and maps their HTTP status", async () => {
    const conflict = toErrorResponse(
      new DomainError("ATTENDANCE_BATCH_CONFLICT", "Có dòng conflict.", {
        conflicts: [{ businessDate: "2026-07-01", current: null }],
      }),
    );
    const busy = toErrorResponse(new DomainError("ATTENDANCE_BATCH_BUSY", "Hệ thống đang bận."));

    expect(conflict.status).toBe(409);
    expect(busy.status).toBe(503);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "ATTENDANCE_BATCH_CONFLICT" },
    });
    await expect(busy.json()).resolves.toMatchObject({
      error: { code: "ATTENDANCE_BATCH_BUSY" },
    });
  });
});
