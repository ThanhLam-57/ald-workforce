import { expect, test, type Page } from "@playwright/test";

async function signInWithUsername(page: Page, username: string, password: string) {
  await page.context().clearCookies();
  const response = await page.request.post("/api/auth/sign-in/username", {
    data: { username, password },
  });
  expect(response.ok()).toBe(true);
}

test("GM mở từng khu vực từ sidebar và trình duyệt back/forward giữ đúng route", async ({
  page,
}) => {
  test.slow();
  const destinations = [
    ["/attendance", "Chấm công & Live", "Chấm công & Live"],
    ["/branch-overview", "Tổng quan cơ sở", "Bảng tổng quan cơ sở"],
    ["/company-report", "Báo cáo công ty", "Dashboard và báo cáo công ty"],
    ["/manager-kpi", "KPI quản lý", "KPI quản lý đào tạo"],
    ["/rules/configured", "Thưởng, level, lương & KPI", "Thưởng, level, lương & KPI"],
    ["/rules/penalties", "Rule phạt", "Rule phạt"],
    ["/payroll", "Payroll", "Payroll"],
    ["/data-governance", "Import, Export & Audit", "Import, Export Center & Audit"],
    ["/administration", "Quản trị nền tảng", "Quản trị nền tảng"],
    ["/settings/security", "Bảo mật tài khoản", "Bảo mật tài khoản"],
  ] as const;

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Tổng quan công ty" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toBeVisible();

  for (const [href, linkName, heading] of destinations) {
    await page.getByRole("link", { name: linkName, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${href.replaceAll("/", "\\/")}$`), {
      timeout: 15_000,
    });
    await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
  }

  await page.getByRole("link", { name: "Chấm công & Live", exact: true }).click();
  await expect(page).toHaveURL(/\/attendance$/, { timeout: 15_000 });
  await page.getByRole("link", { name: "Tổng quan cơ sở", exact: true }).click();
  await expect(page).toHaveURL(/\/branch-overview$/, { timeout: 15_000 });
  await page.goBack();
  await expect(page).toHaveURL(/\/attendance$/, { timeout: 15_000 });
  await page.goForward();
  await expect(page).toHaveURL(/\/branch-overview$/, { timeout: 15_000 });
});

test("drawer mobile mở, giữ focus trong dialog và đóng bằng Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");

  await page.getByRole("button", { name: "Mở menu" }).click();
  const drawer = page.getByRole("dialog", { name: "Menu di động" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Đóng" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("manager chỉ thấy menu trong phạm vi và direct URL payroll bị chặn", async ({ page }) => {
  await signInWithUsername(
    page,
    "manager_demo",
    process.env.SEED_MANAGER_PASSWORD ?? process.env.SEED_GM_PASSWORD ?? "ChangeMe-12345!",
  );
  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Tổng quan cơ sở" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Chấm công & Live", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Tổng quan cơ sở", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Import & Export", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Payroll" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Báo cáo công ty" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Quản trị nền tảng" })).toHaveCount(0);

  await page.getByRole("link", { name: "Import & Export", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Import & Export" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Import và Export Center" })).toBeVisible();
  await expect(page.getByText("Audit", { exact: false })).toHaveCount(0);

  await page.goto("/payroll");
  await expect(page).toHaveURL(/\/forbidden$/);
  await expect(
    page.getByRole("heading", { name: "Bạn không có quyền mở trang này" }),
  ).toBeVisible();
});

test("employee chỉ thấy trang cá nhân và direct URL attendance bị chặn", async ({ page }) => {
  await signInWithUsername(
    page,
    "live_b01",
    process.env.SEED_EMPLOYEE_PASSWORD ?? process.env.SEED_GM_PASSWORD ?? "ChangeMe-12345!",
  );
  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Tổng quan của tôi" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Phiếu lương của tôi", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Bảo mật tài khoản", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Chấm công & Live" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Payroll" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Quản trị nền tảng" })).toHaveCount(0);

  await page.goto("/attendance");
  await expect(page).toHaveURL(/\/forbidden$/);
  await expect(
    page.getByRole("heading", { name: "Bạn không có quyền mở trang này" }),
  ).toBeVisible();
});

test("đăng xuất từ shell quay về trang đăng nhập", async ({ page }) => {
  await signInWithUsername(page, "admin", process.env.SEED_GM_PASSWORD ?? "ChangeMe-12345!");
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Đăng nhập hệ thống" })).toBeVisible();
});
