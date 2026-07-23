import { expect, test, type Page } from "@playwright/test";

async function signInAsGm(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email hoặc tên đăng nhập").fill("admin");
  await page.getByLabel("Mật khẩu").fill(process.env.SEED_GM_PASSWORD ?? "ChangeMe-12345!");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("GM đăng nhập bằng username và thấy dashboard quản trị", async ({ page }) => {
  await signInAsGm(page);
  await expect(page.getByText("Tổng quan nền tảng")).toBeVisible();
  await expect(page.getByText("Quản trị nền tảng")).toBeVisible();
});

test("không cho tự đăng ký tài khoản", async ({ request }) => {
  const response = await request.post("/api/auth/sign-up/email", {
    data: {
      email: "self-register@test.local",
      name: "Self Register",
      password: "Not-Allowed-Password-123!",
    },
  });

  expect([403, 404]).toContain(response.status());
});

test("GM nhập attendance Live và autosave từ hồ sơ tháng", async ({ page }) => {
  await signInAsGm(page);
  const suffix = Date.now().toString(36);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const month = `${values.get("year")}-${values.get("month")}`;
  const businessDate = `${month}-01`;

  const branchResponse = await page.request.post("/api/branches", {
    data: {
      code: `E2E${suffix}`,
      name: `Cơ sở E2E ${suffix}`,
      reason: "E2E tạo cơ sở attendance",
    },
  });
  expect(branchResponse.ok()).toBe(true);
  const branchPayload = (await branchResponse.json()) as {
    data: { id: string };
  };

  const staffResponse = await page.request.post("/api/staff", {
    data: {
      staffCode: `LV${suffix}`,
      fullName: `Live E2E ${suffix}`,
      jobTitle: "Nhân viên Live",
      employmentCategory: "OFFICIAL",
      reason: "E2E tạo nhân viên attendance",
    },
  });
  expect(staffResponse.ok()).toBe(true);
  const staffPayload = (await staffResponse.json()) as {
    data: { id: string };
  };

  const assignmentResponse = await page.request.post("/api/assignments", {
    data: {
      staffId: staffPayload.data.id,
      branchId: branchPayload.data.id,
      assignmentType: "MEMBER",
      effectiveFrom: businessDate,
      effectiveTo: null,
      reason: "E2E phân công attendance",
    },
  });
  expect(assignmentResponse.ok()).toBe(true);

  await page.reload();
  await page.getByLabel("Nhân viên attendance").selectOption(staffPayload.data.id);
  await page.getByLabel("Lý do thay đổi attendance").fill("E2E autosave attendance");
  await page.getByLabel(`Live thực tế ${businessDate}`).fill("120");
  await page.getByLabel(`Số công ${businessDate}`).fill("1");
  await page.getByLabel(`Doanh số ${businessDate}`).fill("500000");

  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/attendance?staffId=${staffPayload.data.id}&month=${month}`,
      );
      const payload = (await response.json()) as {
        data: {
          days: Array<{
            businessDate: string;
            attendance: null | {
              workUnits: string;
              actualLiveMinutes: number;
              revenueAmount: string;
            };
          }>;
        };
      };
      return payload.data.days.find((day) => day.businessDate === businessDate)?.attendance;
    })
    .toMatchObject({
      workUnits: "1",
      actualLiveMinutes: 120,
      revenueAmount: "500000",
    });
});
