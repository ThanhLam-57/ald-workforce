import { expect, test, type Page } from "@playwright/test";

function businessToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function signInWithUsername(page: Page, username: string, password: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email hoặc tên đăng nhập").fill(username);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function browserRequest(
  page: Page,
  path: string,
  options: Readonly<{ method?: string; data?: unknown }> = {},
) {
  return page.evaluate(
    async ({ data, method, path: requestPath }) => {
      const response = await fetch(requestPath, {
        method,
        ...(data === undefined
          ? {}
          : {
              body: JSON.stringify(data),
              headers: { "content-type": "application/json" },
            }),
      });
      return { body: await response.text(), ok: response.ok, status: response.status };
    },
    { data: options.data, method: options.method ?? "GET", path },
  );
}

test("GM hoàn tác nghỉ việc do bấm nhầm rồi tiếp tục chỉnh sửa hồ sơ", async ({ page }) => {
  const suffix = Date.now().toString(36).toUpperCase();
  const staffCode = "RESTORE" + suffix;
  const machineCode = "RS" + suffix;
  const today = businessToday();

  await signInWithUsername(page, "admin", process.env.SEED_GM_PASSWORD ?? "ChangeMe-12345!");
  await page.goto("/staff");
  await expect(page.getByRole("heading", { name: "Nhân viên" })).toBeVisible();

  const branchesResponse = await browserRequest(page, "/api/branches");
  expect(branchesResponse.ok, branchesResponse.body).toBe(true);
  const branches = JSON.parse(branchesResponse.body) as {
    data: Array<{ id: string; code: string }>;
  };
  const branch = branches.data.find(({ code }) => code === "DEMO") ?? branches.data[0];
  expect(branch).toBeTruthy();

  const createResponse = await browserRequest(page, "/api/staff", {
    method: "POST",
    data: {
      staffCode,
      fullName: "Nhân viên hoàn tác " + suffix,
      jobTitle: "Nhân viên Live",
      joinedDate: today,
      employmentCategory: "PROBATION",
    },
  });
  expect(createResponse.status, createResponse.body).toBe(201);
  const created = JSON.parse(createResponse.body) as {
    data: { id: string; version: number };
  };

  const assignmentResponse = await browserRequest(page, "/api/assignments", {
    method: "POST",
    data: {
      staffId: created.data.id,
      branchId: branch!.id,
      assignmentType: "MEMBER",
      attendanceMachineCode: machineCode,
      effectiveFrom: today,
      effectiveTo: null,
    },
  });
  expect(assignmentResponse.status, assignmentResponse.body).toBe(201);

  const terminateResponse = await browserRequest(
    page,
    "/api/staff/" + created.data.id + "/terminate",
    {
      method: "POST",
      data: {
        terminationDate: today,
        version: created.data.version,
      },
    },
  );
  expect(terminateResponse.ok, terminateResponse.body).toBe(true);

  await page.goto("/staff");
  await page.getByRole("button", { name: "Hiện nhân viên đã nghỉ" }).click();
  await page.getByLabel("Cơ sở").selectOption(branch!.id);
  await page.getByLabel("Trạng thái").selectOption("TERMINATED");

  const row = page.getByRole("row").filter({ hasText: staffCode });
  await expect(row).toContainText("Đã nghỉ việc");
  await row.getByRole("button", { name: "Xem hồ sơ" }).click();

  const profile = page.getByRole("dialog", { name: /Hồ sơ nhân viên/ });
  await expect(profile.getByText(/Đã nghỉ việc từ/)).toBeVisible();
  await expect(profile.getByRole("button", { name: "Chỉnh sửa" })).toHaveCount(0);
  const restoreTrigger = profile.getByRole("button", { name: "Hoàn tác nghỉ việc" });
  await restoreTrigger.click();

  const restoreDialog = page.getByRole("alertdialog", {
    name: "Xác nhận hoàn tác nghỉ việc",
  });
  const reasonInput = restoreDialog.getByLabel("Lý do hoàn tác nghỉ việc");
  await expect(reasonInput).toBeFocused();
  await reasonInput.press("Escape");
  await expect(restoreDialog).toHaveCount(0);
  await expect(restoreTrigger).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await restoreTrigger.click();

  const confirmButton = restoreDialog.getByRole("button", { name: "Xác nhận hoàn tác" });
  await expect(confirmButton).toBeDisabled();
  await reasonInput.fill("Bấm nhầm thao tác cho nhân viên nghỉ việc.");
  await confirmButton.focus();
  await page.keyboard.press("Tab");
  await expect(
    restoreDialog.getByRole("button", { name: "Đóng hoàn tác nghỉ việc" }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await confirmButton.click();

  await expect(profile.getByText(/Đã hoàn tác nghỉ việc cho/)).toBeVisible();
  await expect(profile.getByText("Đang làm", { exact: true })).toBeVisible();
  await expect(profile.getByText(/Đã nghỉ việc từ/)).toHaveCount(0);
  await expect(profile.getByRole("button", { name: "Đóng", exact: true })).toBeFocused();
  await profile.getByRole("button", { name: "Chỉnh sửa" }).click();
  await profile.getByLabel("Họ và tên").fill("Nhân viên đã sửa " + suffix);
  await profile.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(profile.getByText("Đã lưu thay đổi hồ sơ nhân viên.")).toBeVisible();

  const staffResponse = await browserRequest(page, "/api/staff");
  expect(staffResponse.ok, staffResponse.body).toBe(true);
  const staff = JSON.parse(staffResponse.body) as {
    data: Array<{
      id: string;
      fullName: string;
      employmentStatus: string;
      terminationDate: string | null;
    }>;
  };
  expect(staff.data.find(({ id }) => id === created.data.id)).toMatchObject({
    fullName: "Nhân viên đã sửa " + suffix,
    employmentStatus: "ACTIVE",
    terminationDate: null,
  });
});

test("quản lý đào tạo không được hoàn tác nghỉ việc", async ({ page }) => {
  await signInWithUsername(
    page,
    "manager_demo",
    process.env.SEED_MANAGER_PASSWORD ?? process.env.SEED_GM_PASSWORD ?? "ChangeMe-12345!",
  );
  await page.goto("/staff");
  await expect(page.getByRole("heading", { name: "Nhân viên" })).toBeVisible();

  const response = await browserRequest(
    page,
    "/api/staff/11111111-1111-4111-8111-111111111111/restore",
    {
      method: "POST",
      data: {
        reason: "Không có quyền hoàn tác nghỉ việc.",
        version: 1,
      },
    },
  );
  expect(response.status).toBe(403);

  await expect(page.getByRole("button", { name: "Hiện nhân viên đã nghỉ" })).toHaveCount(0);
});
