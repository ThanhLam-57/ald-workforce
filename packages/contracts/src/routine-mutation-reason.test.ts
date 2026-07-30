import { describe, expect, it } from "vitest";

import {
  attendanceCreateSchema,
  branchOverviewBatchUpdateSchema,
  configuredRuleSetCreateSchema,
  dataExportCreateSchema,
  evidencePresignSchema,
  importCommitSchema,
  managerKpiCreateSchema,
  penaltyRuleSetCreateSchema,
  violationCancelSchema,
} from "./index";

const staffId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const violationId = "33333333-3333-4333-8333-333333333333";

describe("routine mutation audit reason", () => {
  it.each([
    [
      "attendance",
      attendanceCreateSchema,
      { staffId, businessDate: "2026-07-01" },
    ],
    [
      "branch overview",
      branchOverviewBatchUpdateSchema,
      {
        branchId,
        edits: [
          {
            clientId: "cell-1",
            staffId,
            businessDate: "2026-07-01",
            version: null,
            revenueAmount: "1000",
          },
        ],
      },
    ],
    [
      "manager KPI",
      managerKpiCreateSchema,
      { managerStaffId: staffId, month: "2026-07", notes: null },
    ],
    ["penalty rule", penaltyRuleSetCreateSchema, { name: "Quy định phạt" }],
    [
      "configured rule",
      configuredRuleSetCreateSchema,
      { name: "Quy định lương", type: "SALARY_RULES" },
    ],
    ["violation cancel", violationCancelSchema, { version: 1 }],
    [
      "evidence upload",
      evidencePresignSchema,
      {
        violationId,
        originalFileName: "evidence.png",
        mimeType: "image/png",
        sizeBytes: 1024,
        checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      },
    ],
    ["import commit", importCommitSchema, { confirm: true }],
    [
      "data export",
      dataExportCreateSchema,
      { template: "BRANCH_MONTHLY", format: "XLSX", branchId, month: "2026-07" },
    ],
  ])("accepts %s without a client-entered reason", (_name, schema, input) => {
    expect(schema.safeParse(input).success).toBe(true);
  });

  it("strips a client-supplied reason from routine mutation payloads", () => {
    const parsed = attendanceCreateSchema.parse({
      staffId,
      businessDate: "2026-07-01",
      reason: "CLIENT_MUST_NOT_CONTROL_AUDIT",
    });

    expect(parsed).not.toHaveProperty("reason");
  });
});
