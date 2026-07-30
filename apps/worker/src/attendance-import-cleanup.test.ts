import { describe, expect, it } from "vitest";

import {
  attendanceImportRetentionDays,
  attendanceImportRetentionReference,
} from "./attendance-import-cleanup.js";

describe("attendance import cleanup policy", () => {
  it("uses a safe default for missing or invalid retention", () => {
    expect(attendanceImportRetentionDays(undefined)).toBe(30);
    expect(attendanceImportRetentionDays("0")).toBe(30);
    expect(attendanceImportRetentionDays("abc")).toBe(30);
    expect(attendanceImportRetentionDays("366")).toBe(30);
  });

  it("accepts an explicit retention between one and 365 days", () => {
    expect(attendanceImportRetentionDays("1")).toBe(1);
    expect(attendanceImportRetentionDays("45")).toBe(45);
    expect(attendanceImportRetentionDays("365")).toBe(365);
  });

  it("starts retention from the latest lifecycle timestamp", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const uploadedAt = new Date("2026-01-01T00:10:00.000Z");
    const expiresAt = new Date("2026-01-02T00:10:00.000Z");
    expect(
      attendanceImportRetentionReference({
        createdAt,
        uploadedAt,
        validatedAt: null,
        committedAt: null,
        expiresAt,
      }),
    ).toEqual(expiresAt);
  });
});
