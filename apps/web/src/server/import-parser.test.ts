import { importPresignSchema } from "@ald/contracts";
import { describe, expect, it } from "vitest";

import { validateImportStructure, type ParsedImportFile } from "./import-parser";

describe("legacy import validation", () => {
  it("rejects XLSX formulas and CSV formula injection text", () => {
    const parsed: ParsedImportFile = {
      headers: ["code", "name"],
      rows: [
        {
          sheetName: "Branches",
          rowNumber: 2,
          values: { code: "A", name: '=HYPERLINK("bad")' },
          formulaColumns: ["name"],
        },
        {
          sheetName: "Branches",
          rowNumber: 3,
          values: { code: "B", name: "@IMPORTXML" },
          formulaColumns: [],
        },
        {
          sheetName: "Branches",
          rowNumber: 4,
          values: { code: "C", name: "-HYPERLINK(bad)" },
          formulaColumns: [],
        },
      ],
    };
    const result = validateImportStructure(parsed, "BRANCHES", { code: "code", name: "name" });
    expect(result.errors.map((item) => item.code)).toEqual(
      expect.arrayContaining(["FORMULA_NOT_ALLOWED", "FORMULA_INJECTION"]),
    );
    expect(result.errors.every((item) => item.severity === "CRITICAL")).toBe(true);
  });

  it("rejects oversized files at the API contract", () => {
    const result = importPresignSchema.safeParse({
      template: "BRANCHES",
      idempotencyKey: "branches-oversize",
      originalFileName: "branches.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 20 * 1_024 * 1_024 + 1,
      checksumSha256: `${"A".repeat(43)}=`,
    });
    expect(result.success).toBe(false);
  });

  it("interprets legacy local datetimes in Asia/Ho_Chi_Minh", () => {
    const parsed: ParsedImportFile = {
      headers: ["branchCode", "staffCode", "businessDate", "checkInAt", "workUnits", "status"],
      rows: [
        {
          sheetName: "Attendance",
          rowNumber: 2,
          values: {
            branchCode: "A",
            staffCode: "LIVE01",
            businessDate: "23/07/2026",
            checkInAt: "23/07/2026 08:00",
            workUnits: "1",
            status: "PRESENT",
          },
          formulaColumns: [],
        },
      ],
    };
    const mapping = Object.fromEntries(parsed.headers.map((header) => [header, header]));
    const result = validateImportStructure(parsed, "ATTENDANCE_LIVE", mapping);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.values.checkInAt).toBe("2026-07-23T01:00:00.000Z");
  });

  it("rejects an impossible calendar date", () => {
    const parsed: ParsedImportFile = {
      headers: ["branchCode", "staffCode", "businessDate", "workUnits", "status"],
      rows: [
        {
          sheetName: "Attendance",
          rowNumber: 2,
          values: {
            branchCode: "A",
            staffCode: "LIVE01",
            businessDate: "31/02/2026",
            workUnits: "1",
            status: "PRESENT",
          },
          formulaColumns: [],
        },
      ],
    };
    const mapping = Object.fromEntries(parsed.headers.map((header) => [header, header]));
    const result = validateImportStructure(parsed, "ATTENDANCE_LIVE", mapping);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "INVALID_VALUE" })]),
    );
  });

  it("rejects a file extension and MIME type mismatch", () => {
    const result = importPresignSchema.safeParse({
      template: "BRANCHES",
      idempotencyKey: "branches-mime-mismatch",
      originalFileName: "branches.csv",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 1_024,
      checksumSha256: `${"A".repeat(43)}=`,
    });
    expect(result.success).toBe(false);
  });
});
