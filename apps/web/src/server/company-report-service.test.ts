import { describe, expect, it } from "vitest";

import { selectLatestCalculatedPayrollPeriods } from "./company-report-service";

describe("company report payroll revision selection", () => {
  it("uses the newest calculated revision instead of an older published snapshot", () => {
    const selected = selectLatestCalculatedPayrollPeriods([
      {
        id: "published-r1",
        branchId: "branch-a",
        revision: 1,
        status: "PUBLISHED" as const,
        penalties: "20000",
        totalIncome: "2178000",
      },
      {
        id: "calculated-r2",
        branchId: "branch-a",
        revision: 2,
        status: "CALCULATED" as const,
        penalties: "0",
        totalIncome: "4689000",
      },
    ]);

    expect(selected.get("branch-a")).toMatchObject({
      id: "calculated-r2",
      revision: 2,
      penalties: "0",
      totalIncome: "4689000",
    });
  });

  it("ignores a draft revision until it has been calculated", () => {
    const selected = selectLatestCalculatedPayrollPeriods([
      {
        id: "published-r1",
        branchId: "branch-a",
        revision: 1,
        status: "PUBLISHED" as const,
      },
      {
        id: "draft-r2",
        branchId: "branch-a",
        revision: 2,
        status: "DRAFT" as const,
      },
    ]);

    expect(selected.get("branch-a")?.id).toBe("published-r1");
  });
});
