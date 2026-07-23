import { describe, expect, it } from "vitest";

import { dataExportCreateSchema } from "./index";

describe("data governance contracts", () => {
  it("rejects an inverted audit range for an export job", () => {
    const result = dataExportCreateSchema.safeParse({
      template: "AUDIT",
      format: "XLSX",
      auditFilters: {
        from: "2026-07-24T00:00:00.000Z",
        to: "2026-07-23T00:00:00.000Z",
      },
      reason: "Kiểm thử khoảng thời gian audit.",
    });
    expect(result.success).toBe(false);
  });
});
