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

test("GM publish rule và ghi nhiều lỗi từ hồ sơ nhân viên", async ({ page }) => {
  await signInAsGm(page);
  const suffix = Date.now().toString(36);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const month = `${values.get("year")}-${values.get("month")}`;
  const businessDate = `${month}-02`;

  const branch = (await (
    await page.request.post("/api/branches", {
      data: {
        code: `P${suffix}`,
        name: `Penalty E2E ${suffix}`,
        reason: "E2E tạo branch penalty",
      },
    })
  ).json()) as { data: { id: string } };
  const staff = (await (
    await page.request.post("/api/staff", {
      data: {
        staffCode: `P${suffix}`,
        fullName: `Live Penalty ${suffix}`,
        jobTitle: "Nhân viên Live",
        employmentCategory: "OFFICIAL",
        reason: "E2E tạo staff penalty",
      },
    })
  ).json()) as { data: { id: string } };
  await page.request.post("/api/assignments", {
    data: {
      staffId: staff.data.id,
      branchId: branch.data.id,
      assignmentType: "MEMBER",
      effectiveFrom: `${month}-01`,
      effectiveTo: null,
      reason: "E2E phân công penalty",
    },
  });
  const attendanceResponse = await page.request.post("/api/attendance", {
    data: {
      staffId: staff.data.id,
      businessDate,
      status: "PRESENT",
      reason: "E2E attendance penalty",
    },
  });
  expect(attendanceResponse.ok()).toBe(true);

  const ruleSetResponse = await page.request.post("/api/rules/penalty", {
    data: {
      name: `Rule E2E ${suffix}`,
      reason: "E2E tạo rule",
    },
  });
  expect(ruleSetResponse.ok()).toBe(true);
  const ruleSet = (await ruleSetResponse.json()) as {
    data: {
      versions: Array<{ id: string; rowVersion: number }>;
    };
  };
  const draft = ruleSet.data.versions[0]!;
  const saveResponse = await page.request.patch(`/api/rules/penalty/versions/${draft.id}`, {
    data: {
      notes: "E2E rule",
      rowVersion: draft.rowVersion,
      reason: "E2E thêm loại lỗi",
      items: [
        {
          code: `L${suffix}`,
          name: `Đi muộn E2E ${suffix}`,
          description: "Đi muộn theo kiểm tra E2E",
          defaultAmount: "50000",
          isActive: true,
          displayColor: "#EF4444",
          displayOrder: 1,
        },
      ],
    },
  });
  expect(saveResponse.ok()).toBe(true);
  const saved = (await saveResponse.json()) as {
    data: { id: string; rowVersion: number };
  };
  const publishResponse = await page.request.post(
    `/api/rules/penalty/versions/${saved.data.id}/publish`,
    {
      data: {
        effectiveFrom: `${month}-01`,
        effectiveTo: null,
        rowVersion: saved.data.rowVersion,
        reason: "E2E publish rule",
      },
    },
  );
  expect(publishResponse.ok()).toBe(true);
  const published = (await publishResponse.json()) as {
    data: { items: Array<{ id: string }> };
  };

  await page.reload();
  await page.getByLabel("Nhân viên attendance").selectOption(staff.data.id);
  await page.getByLabel("Lý do thay đổi attendance").fill("E2E ghi violation");
  const [year, monthNumber, day] = businessDate.split("-");
  const row = page.getByRole("row").filter({ hasText: `${day}/${monthNumber}/${year}` });
  await row.getByRole("button", { name: "Thêm lỗi" }).click();
  await row.getByLabel(`Loại lỗi ${businessDate}`).selectOption(published.data.items[0]!.id);
  await row.getByLabel(`Chi tiết lỗi ${businessDate}`).fill("Đi muộn 10 phút trong E2E");
  await row.getByRole("button", { name: "Ghi lỗi" }).click();

  await expect(row.getByText(`Đi muộn E2E ${suffix}`, { exact: true })).toBeVisible();
  await expect(row.getByText(/^50\.000/)).toBeVisible();
});
