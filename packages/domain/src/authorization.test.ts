import { describe, expect, it } from "vitest";

import { can, type ActorContext, type ResourceAction } from "./index";

const manager: ActorContext = {
  userId: "manager-user",
  companyId: "company-a",
  staffId: "manager-staff",
  role: "TRAINING_MANAGER",
  activeBranchIds: ["branch-a"],
  canManagePayroll: true,
};

describe("Training Manager permission matrix", () => {
  it.each<ResourceAction>([
    "branch:read",
    "staff:read",
    "staff:onboard",
    "staff-schedule:read",
    "staff-schedule:write",
    "staff-identity-document:read",
    "staff-identity-document:write",
    "attendance:read",
    "attendance:write",
    "attendance:export",
    "violation:read",
    "violation:write",
    "violation:cancel",
    "evidence:upload",
    "evidence:read",
    "branch-overview:read",
    "company-report:read",
    "rule:read",
    "manager-kpi:read",
  ])("allows %s", (action) => {
    expect(can(manager, action)).toBe(true);
  });

  it.each<ResourceAction>([
    "branch-overview:write",
    "branch-overview:export",
    "company-report:export",
    "payroll:read",
    "payroll:write",
    "payroll:export",
    "rule:write",
    "manager-kpi:write",
    "import:read",
    "import:write",
    "export-center:read",
    "export-center:write",
    "audit:read",
    "audit:export",
    "branch:create",
    "branch:update",
    "staff:create",
    "staff:update",
    "user:create",
    "user:update",
    "assignment:create",
    "assignment:update",
  ])("denies %s even when canManagePayroll is true", (action) => {
    expect(can(manager, action)).toBe(false);
  });
});
