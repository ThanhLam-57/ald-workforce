import { describe, expect, it } from "vitest";

import {
  attendanceMachineImportCommitSchema,
  attendanceMachineImportHistoryQuerySchema,
  attendanceMachineImportPresignSchema,
} from "./index";

const validPresign = {
  staffId: "11111111-1111-4111-8111-111111111111",
  branchId: "22222222-2222-4222-8222-222222222222",
  month: "2026-07",
  attemptId: "33333333-3333-4333-8333-333333333333",
  idempotencyKey: "attendance-machine:33333333-3333-4333-8333-333333333333",
  originalFileName: "Nem-Chanh.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  sizeBytes: 1_024,
  checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
} as const;

describe("attendance machine import contracts", () => {
  it("accepts a scoped XLSX upload request", () => {
    expect(attendanceMachineImportPresignSchema.parse(validPresign)).toEqual(validPresign);
  });

  it("rejects non-XLSX files, invalid months and oversized uploads", () => {
    expect(
      attendanceMachineImportPresignSchema.safeParse({
        ...validPresign,
        originalFileName: "attendance.csv",
      }).success,
    ).toBe(false);
    expect(
      attendanceMachineImportPresignSchema.safeParse({
        ...validPresign,
        month: "2026-13",
      }).success,
    ).toBe(false);
    expect(
      attendanceMachineImportPresignSchema.safeParse({
        ...validPresign,
        sizeBytes: 20 * 1_024 * 1_024 + 1,
      }).success,
    ).toBe(false);
  });

  it("rejects an idempotency key that belongs to another attempt", () => {
    expect(
      attendanceMachineImportPresignSchema.safeParse({
        ...validPresign,
        idempotencyKey: "attendance-machine:44444444-4444-4444-8444-444444444444",
      }).success,
    ).toBe(false);
  });

  it("requires explicit confirmation without a client-entered audit reason", () => {
    expect(
      attendanceMachineImportCommitSchema.safeParse({
        confirm: true,
      }).success,
    ).toBe(true);
    expect(
      attendanceMachineImportCommitSchema.safeParse({
        confirm: false,
      }).success,
    ).toBe(false);
  });

  it("accepts a unique subset of preview row keys", () => {
    const selectedRowKeys = [
      "w8teHy1VPl3nVdLZ0mV1QH1WyxvOQeSMGNzV7V3nQxA",
      "Qy9f0NwM5pO1e2r3t4u5v6w7x8y9z0ABCDEFGHIJKLM",
    ];
    expect(
      attendanceMachineImportCommitSchema.parse({
        confirm: true,
        selectedRowKeys,
      }),
    ).toEqual({ confirm: true, selectedRowKeys });
    expect(
      attendanceMachineImportCommitSchema.safeParse({
        confirm: true,
        selectedRowKeys: [selectedRowKeys[0], selectedRowKeys[0]],
      }).success,
    ).toBe(false);
  });

  it("validates the exact branch, staff and month history scope", () => {
    expect(
      attendanceMachineImportHistoryQuerySchema.parse({
        branchId: validPresign.branchId,
        staffId: validPresign.staffId,
        month: validPresign.month,
      }),
    ).toEqual({
      branchId: validPresign.branchId,
      staffId: validPresign.staffId,
      month: validPresign.month,
    });
    expect(
      attendanceMachineImportHistoryQuerySchema.safeParse({
        branchId: validPresign.branchId,
        staffId: validPresign.staffId,
        month: "2026-13",
      }).success,
    ).toBe(false);
  });
});
