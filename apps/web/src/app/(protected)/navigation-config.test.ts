import { describe, expect, it } from "vitest";

import { navigationForRole, roleCanOpenPath } from "./navigation-config";

describe("navigation theo vai trò", () => {
  it("manager chỉ thấy các trang vận hành read-only được cấp", () => {
    const items = navigationForRole("TRAINING_MANAGER");
    const hrefs = items.map((item) => item.href);

    expect(hrefs).toContain("/attendance");
    expect(hrefs).toContain("/staff");
    expect(hrefs).toContain("/branch-overview");
    expect(hrefs).toContain("/company-report");
    expect(hrefs).toContain("/manager-kpi");
    expect(hrefs).toContain("/rules");
    expect(hrefs).not.toContain("/payroll");
    expect(hrefs).not.toContain("/administration");
    expect(hrefs).not.toContain("/data-governance");
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
    expect(roleCanOpenPath("TRAINING_MANAGER", "/payroll", true)).toBe(false);
    expect(navigationForRole("TRAINING_MANAGER", true).map((item) => item.href)).not.toContain(
      "/payroll",
    );
    expect(roleCanOpenPath("TRAINING_MANAGER", "/company-report")).toBe(true);
    expect(roleCanOpenPath("TRAINING_MANAGER", "/staff")).toBe(true);
    expect(roleCanOpenPath("TRAINING_MANAGER", "/rules")).toBe(true);
    expect(roleCanOpenPath("TRAINING_MANAGER", "/rules/configured")).toBe(false);
    expect(roleCanOpenPath("TRAINING_MANAGER", "/rules/penalties")).toBe(false);
    expect(roleCanOpenPath("TRAINING_MANAGER", "/data-governance")).toBe(false);
    expect(roleCanOpenPath("LIVE_EMPLOYEE", "/attendance")).toBe(false);
  });
});
