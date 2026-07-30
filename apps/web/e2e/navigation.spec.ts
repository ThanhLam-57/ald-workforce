import type { AdminStaffDto } from "@ald/contracts";
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
    ["/rules", "Thưởng & phạt", "Thưởng, phạt & lương"],
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
  const drawerBox = await drawer.boundingBox();
  expect(drawerBox).not.toBeNull();
  expect(drawerBox!.x).toBeGreaterThanOrEqual(0);
  expect(drawerBox!.width).toBeLessThanOrEqual(390);
  expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("dialog quản trị và biểu đồ không tràn khung mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/administration");
  await page.getByRole("button", { name: "Thêm cơ sở" }).click();

  const administrationDialog = page.getByRole("dialog", { name: "Thêm cơ sở" });
  await expect(administrationDialog).toBeVisible();
  const dialogBox = await administrationDialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.width).toBeLessThanOrEqual(390);
  expect(
    await administrationDialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(administrationDialog).toBeHidden();

  await page.goto("/company-report");
  const charts = page.locator(".recharts-responsive-container");
  await expect(charts).toHaveCount(4);
  await expect
    .poll(async () =>
      charts.evaluateAll((containers) =>
        containers.every((container) => {
          const svg = container.querySelector("svg");
          return Boolean(
            svg &&
              svg.getBoundingClientRect().width > 0 &&
              svg.getBoundingClientRect().width <= container.clientWidth + 1,
          );
        }),
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
});

test("GM nhập và sửa ngày gia nhập, ngày chính thức trong hồ sơ nhân viên", async ({ page }) => {
  const staff: AdminStaffDto = {
    id: "11111111-1111-4111-8111-111111111111",
    staffCode: "UI-DATE-01",
    fullName: "Nhân viên kiểm thử ngày",
    streamingAlias: null,
    email: null,
    phone: null,
    jobTitle: "Nhân viên Live",
    baseSalaryAmount: "7000000",
    joinedDate: "2026-07-01",
    officialDate: "2026-07-15",
    employmentCategory: "OFFICIAL",
    employmentStatus: "ACTIVE",
    currentAssignments: [],
    user: null,
    level: null,
    version: 1,
    updatedAt: "2026-07-27T00:00:00.000Z",
  };
  let createdBody: Readonly<Record<string, unknown>> | null = null;
  let updatedBody: Readonly<Record<string, unknown>> | null = null;

  await page.route("**/api/administration/staff?*", async (route) => {
    await route.fulfill({
      json: {
        data: {
          items: [staff],
          page: 1,
          pageSize: 20,
          total: 1,
        },
      },
    });
  });
  await page.route("**/api/staff", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    createdBody = route.request().postDataJSON() as Readonly<Record<string, unknown>>;
    await route.fulfill({ json: { data: staff } });
  });
  await page.route("**/api/staff/11111111-1111-4111-8111-111111111111", async (route) => {
    updatedBody = route.request().postDataJSON() as Readonly<Record<string, unknown>>;
    await route.fulfill({
      json: {
        data: {
          ...staff,
          joinedDate: "2026-07-02",
          officialDate: "2026-07-20",
          version: 2,
        },
      },
    });
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/administration?tab=staff");
  await expect(page.getByText("UI-DATE-01", { exact: true })).toBeVisible();
  const staffTable = page.getByRole("table");
  await expect(staffTable.getByText("Gia nhập: 01/07/2026", { exact: true })).toBeVisible();
  await expect(staffTable.getByText("Chính thức: 15/07/2026", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Thêm nhân viên" }).click();
  const createDialog = page.getByRole("dialog", { name: "Thêm nhân viên" });
  await createDialog.getByLabel("Mã nhân viên").fill("UI-DATE-02");
  await createDialog.getByLabel("Họ và tên").fill("Nhân viên tạo mới");
  await createDialog.getByLabel("Vị trí công việc").fill("Nhân viên Live");
  await createDialog.getByLabel("Ngày gia nhập công ty").fill("2026-07-10");
  await createDialog.getByLabel("Ngày lên chính thức").fill("2026-07-01");
  expect(
    await createDialog
      .getByLabel("Ngày lên chính thức")
      .evaluate((element) => (element as HTMLInputElement).validity.valid),
  ).toBe(false);
  await createDialog.getByLabel("Ngày lên chính thức").fill("2026-07-15");
  await createDialog.getByRole("button", { name: "Lưu dữ liệu" }).click();
  await expect.poll(() => createdBody).not.toBeNull();
  expect(createdBody).toMatchObject({
    joinedDate: "2026-07-10",
    officialDate: "2026-07-15",
    employmentCategory: "PROBATION",
  });

  await page.getByRole("button", { name: "Sửa", exact: true }).click();
  const editDialog = page.getByRole("dialog", { name: "Sửa hồ sơ nhân viên" });
  await expect(editDialog.getByLabel("Ngày gia nhập công ty")).toHaveValue("2026-07-01");
  await expect(editDialog.getByLabel("Ngày lên chính thức")).toHaveValue("2026-07-15");
  await editDialog.getByLabel("Ngày gia nhập công ty").fill("2026-07-02");
  await editDialog.getByLabel("Ngày lên chính thức").fill("2026-07-20");
  await editDialog.getByRole("button", { name: "Xác nhận và lưu" }).click();
  await expect.poll(() => updatedBody).not.toBeNull();
  expect(updatedBody).toMatchObject({
    joinedDate: "2026-07-02",
    officialDate: "2026-07-20",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Thêm nhân viên" }).click();
  const mobileDialog = page.getByRole("dialog", { name: "Thêm nhân viên" });
  await expect(mobileDialog.getByLabel("Ngày gia nhập công ty")).toBeVisible();
  await expect(mobileDialog.getByLabel("Ngày lên chính thức")).toBeVisible();
  const mobileDialogBox = await mobileDialog.boundingBox();
  expect(mobileDialogBox).not.toBeNull();
  expect(mobileDialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(mobileDialogBox!.width).toBeLessThanOrEqual(390);
  expect(
    await mobileDialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
});

test("manager chỉ thấy menu vận hành trong phạm vi và các trang quản trị bị chặn", async ({
  page,
}) => {
  await signInWithUsername(
    page,
    "manager_demo",
    process.env.SEED_MANAGER_PASSWORD ?? process.env.SEED_GM_PASSWORD ?? "ChangeMe-12345!",
  );
  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Tổng quan cơ sở" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Chấm công & Live", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Tổng quan cơ sở", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Báo cáo công ty", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "KPI quản lý", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Thưởng & phạt", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Bảo mật tài khoản", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Payroll" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Import, Export & Audit" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Quản trị nền tảng" })).toHaveCount(0);

  await page.goto("/branch-overview");
  await expect(page.getByLabel("Lý do chỉnh sửa tổng quan")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Xuất XLSX" })).toHaveCount(0);
  await expect(page.getByText("Chỉ xem", { exact: true })).toBeVisible();

  await page.goto("/rules");
  await expect(page.getByText("Chỉ xem", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Lưu|Thêm|Xóa/i })).toHaveCount(0);

  for (const path of ["/payroll", "/data-governance", "/administration", "/rules/configured"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(
      page.getByRole("heading", { name: "Bạn không có quyền mở trang này" }),
    ).toBeVisible();
  }
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
