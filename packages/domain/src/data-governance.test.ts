import { describe, expect, it } from "vitest";

import {
  diffAuditValues,
  escapeCsvCell,
  redactSensitiveAuditValue,
  sanitizeSpreadsheetText,
} from "./index";

describe("spreadsheet export safety", () => {
  it.each(["=CMD()", "+SUM(A1:A2)", "-HYPERLINK()", "@IMPORT()", "\t=1"])(
    "neutralizes formula-like text %s",
    (value) => {
      expect(sanitizeSpreadsheetText(value)).toBe(`'${value}`);
      expect(escapeCsvCell(value)).toContain(`'${value}`);
    },
  );

  it("keeps typed numeric values unchanged", () => {
    expect(escapeCsvCell(-100)).toBe("-100");
    expect(escapeCsvCell(1250)).toBe("1250");
  });
});

describe("audit safety", () => {
  it("redacts nested credentials and builds readable changes", () => {
    const before = redactSensitiveAuditValue({
      profile: { name: "An", password: "secret" },
      sessionToken: "token",
    });
    const after = redactSensitiveAuditValue({
      profile: { name: "Bình", password: "new-secret" },
      sessionToken: "new-token",
    });
    expect(before).toEqual({
      profile: { name: "An", password: "[REDACTED]" },
      sessionToken: "[REDACTED]",
    });
    expect(diffAuditValues(before, after)).toEqual([
      { path: "profile.name", before: "An", after: "Bình" },
    ]);
  });

  it("serializes audit dates and bigint values without losing them", () => {
    expect(
      redactSensitiveAuditValue({
        occurredAt: new Date("2026-07-23T10:00:00.000Z"),
        amount: 12_500_000n,
      }),
    ).toEqual({
      occurredAt: "2026-07-23T10:00:00.000Z",
      amount: "12500000",
    });
  });
});
