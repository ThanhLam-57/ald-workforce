import { describe, expect, it } from "vitest";

import { can, canAccessBranch, type ActorContext } from "./index.js";

const gm: ActorContext = {
  userId: "gm",
  companyId: "company",
  staffId: "staff-gm",
  role: "GENERAL_MANAGER",
  activeBranchIds: [],
};

const manager: ActorContext = {
  userId: "manager",
  companyId: "company",
  staffId: "staff-manager",
  role: "TRAINING_MANAGER",
  activeBranchIds: ["branch-a"],
};

describe("authorization policy", () => {
  it("cho phép GM mutation toàn công ty", () => {
    expect(can(gm, "branch:create")).toBe(true);
    expect(can(gm, "assignment:update")).toBe(true);
  });

  it("chỉ cho manager đọc và giới hạn branch được phân công", () => {
    expect(can(manager, "staff:read")).toBe(true);
    expect(can(manager, "staff:update")).toBe(false);
    expect(canAccessBranch(manager, "branch-a")).toBe(true);
    expect(canAccessBranch(manager, "branch-b")).toBe(false);
  });
});
