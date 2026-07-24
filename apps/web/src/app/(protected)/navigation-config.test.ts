import { describe, expect, it } from "vitest";

import { navigationForRole, roleCanOpenPath } from "./navigation-config";

describe("navigation theo vai trò", () => {
  it("không expose payroll/admin/company report cho manager", () => {
    const items = navigationForRole("TRAINING_MANAGER");
    const hrefs = items.map((item) => item.href);

    expect(hrefs).toContain("/attendance");
    expect(hrefs).toContain("/branch-overview");
    expect(hrefs).not.toContain("/payroll");
    expect(hrefs).not.toContain("/administration");
    expect(hrefs).not.toContain("/company-report");
    expect(items.find((item) => item.href === "/data-governance")?.label).toBe("Import & Export");
    expect(items.some((item) => item.label.includes("Audit"))).toBe(false);
  });

  it("employee chỉ có tổng quan, payslip và bảo mật", () => {
    expect(navigationForRole("LIVE_EMPLOYEE").map((item) => item.href)).toEqual([
      "/dashboard",
      "/my-payslips",
      "/settings/security",
    ]);
  });

  it("kiểm tra cả direct child path", () => {
    expect(roleCanOpenPath("GENERAL_MANAGER", "/rules/configured/history")).toBe(true);
    expect(roleCanOpenPath("TRAINING_MANAGER", "/payroll")).toBe(false);
    expect(roleCanOpenPath("LIVE_EMPLOYEE", "/attendance")).toBe(false);
  });
});
