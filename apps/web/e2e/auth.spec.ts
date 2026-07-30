import { expect, test } from "@playwright/test";

test("GM đã đăng nhập thấy dashboard quản trị", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Tổng quan công ty" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Quản trị nền tảng" })).toBeVisible();
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

test("GM nhập attendance Live, lưu một lần và dùng bảng Full HD", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/attendance");
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
    },
  });
  expect(branchResponse.ok(), await branchResponse.text()).toBe(true);
  const branchPayload = (await branchResponse.json()) as {
    data: { id: string };
  };

  const staffResponse = await page.request.post("/api/staff", {
    data: {
      staffCode: `LV${suffix}`,
      fullName: `Live E2E ${suffix}`,
      jobTitle: "Nhân viên Live",
      employmentCategory: "OFFICIAL",
      joinedDate: businessDate,
      officialDate: businessDate,
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
    },
  });
  expect(assignmentResponse.ok()).toBe(true);

  await page.reload();
  await page.getByLabel("Cơ sở attendance").selectOption(branchPayload.data.id);
  await expect(
    page.getByLabel("Nhân viên attendance").locator(`option[value="${staffPayload.data.id}"]`),
  ).toHaveCount(1);
  await page.getByLabel("Nhân viên attendance").selectOption(staffPayload.data.id);
  let attendanceMutationCount = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/attendance") && ["POST", "PATCH"].includes(request.method())) {
      attendanceMutationCount += 1;
    }
  });
  await page.getByLabel(`Live thực tế ${businessDate}`).fill("02:00");
  await page.getByLabel(`Số công ${businessDate}`).fill("1");
  await page.getByLabel(`Doanh số (xu) ${businessDate}`).fill("500000");
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();

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
  await page.waitForTimeout(900);
  expect(attendanceMutationCount).toBe(1);

  const tableScroller = page.getByTestId("attendance-grid-scroll");
  await expect(tableScroller).toBeVisible();
  const scrollMetrics = await tableScroller.evaluate((element) => ({
    clientHeight: element.clientHeight,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    scrollWidth: element.scrollWidth,
    bottom: element.getBoundingClientRect().bottom,
    viewportHeight: window.innerHeight,
    bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
  expect(scrollMetrics.scrollWidth).toBeGreaterThan(scrollMetrics.clientWidth);
  expect(scrollMetrics.bottom).toBeLessThanOrEqual(scrollMetrics.viewportHeight);
  expect(scrollMetrics.bodyOverflow).toBe(0);

  const firstDate = page.getByTestId("sticky-business-date").first();
  const firstWeekday = page.getByTestId("sticky-weekday").first();
  const firstScrollableHeader = tableScroller.locator("thead th").nth(2);
  const beforeScroll = await Promise.all([
    firstDate.boundingBox(),
    firstWeekday.boundingBox(),
    firstScrollableHeader.boundingBox(),
  ]);
  await tableScroller.evaluate((element) => {
    element.scrollLeft = 900;
  });
  const afterHorizontalScroll = await Promise.all([
    firstDate.boundingBox(),
    firstWeekday.boundingBox(),
  ]);
  expect(afterHorizontalScroll[0]?.x).toBeCloseTo(beforeScroll[0]?.x ?? 0, 0);
  expect(afterHorizontalScroll[1]?.x).toBeCloseTo(beforeScroll[1]?.x ?? 0, 0);
  await tableScroller.evaluate((element) => {
    element.scrollTop = 500;
  });
  const afterVerticalScroll = await firstScrollableHeader.boundingBox();
  expect(afterVerticalScroll?.y).toBeCloseTo(beforeScroll[2]?.y ?? 0, 0);
  for (const cell of [firstDate, firstWeekday]) {
    const background = await cell.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(background).not.toBe("rgba(0, 0, 0, 0)");
  }
});

test("GM publish rule và ghi nhiều lỗi từ hồ sơ nhân viên", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/attendance");
  const suffix = Date.now().toString(36);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const month = `${values.get("year")}-${values.get("month")}`;
  const businessDate = `${month}-02`;
  const originalSimpleRules = (await (await page.request.get("/api/rules/simple")).json()) as {
    data: {
      penalty: {
        effectiveFrom: string | null;
        items: Array<{
          code: string;
          name: string;
          description: string;
          defaultAmount: string;
          reminderCount: number;
          countingWindow: "CALENDAR_MONTH" | "LIFETIME";
          displayColor: string;
          isActive: boolean;
        }>;
      };
    };
  };

  const branchResponse = await page.request.post("/api/branches", {
      data: {
        code: `P${suffix}`,
        name: `Penalty E2E ${suffix}`,
      },
    });
  expect(branchResponse.ok(), await branchResponse.text()).toBe(true);
  const branch = (await branchResponse.json()) as { data: { id: string } };
  const staffResponse = await page.request.post("/api/staff", {
      data: {
        staffCode: `P${suffix}`,
        fullName: `Live Penalty ${suffix}`,
        jobTitle: "Nhân viên Live",
        employmentCategory: "OFFICIAL",
        joinedDate: `${month}-01`,
        officialDate: `${month}-01`,
      },
    });
  expect(staffResponse.ok(), await staffResponse.text()).toBe(true);
  const staff = (await staffResponse.json()) as { data: { id: string } };
  await page.request.post("/api/assignments", {
    data: {
      staffId: staff.data.id,
      branchId: branch.data.id,
      assignmentType: "MEMBER",
      effectiveFrom: `${month}-01`,
      effectiveTo: null,
    },
  });
  const attendanceResponse = await page.request.post("/api/attendance", {
    data: {
      staffId: staff.data.id,
      businessDate,
      status: "PRESENT",
    },
  });
  expect(attendanceResponse.ok()).toBe(true);

  try {
    const penaltyCode = `L${suffix}`.toUpperCase();
    const simplePenaltyResponse = await page.request.post("/api/rules/simple/penalties", {
      data: {
        effectiveFrom: `${month}-01`,
        items: [
          {
            code: penaltyCode,
            name: `Đi muộn E2E ${suffix}`,
            description: "Đi muộn theo kiểm tra E2E",
            defaultAmount: "50000",
            reminderCount: 0,
            countingWindow: "CALENDAR_MONTH",
            isActive: true,
            displayColor: "#EF4444",
          },
        ],
      },
    });
    expect(simplePenaltyResponse.ok()).toBe(true);
    const activeResponse = await page.request.get(
      `/api/rules/penalty/active?date=${encodeURIComponent(businessDate)}`,
    );
    expect(activeResponse.ok()).toBe(true);
    const active = (await activeResponse.json()) as {
      data: Array<{ items: Array<{ id: string; code: string }> }>;
    };
    const penaltyItem = active.data
      .flatMap((version) => version.items)
      .find((item) => item.code === penaltyCode);
    expect(penaltyItem).toBeDefined();

    await page.reload();
    await page.getByLabel("Cơ sở attendance").selectOption(branch.data.id);
    await expect(
      page.getByLabel("Nhân viên attendance").locator(`option[value="${staff.data.id}"]`),
    ).toHaveCount(1);
    await page.getByLabel("Nhân viên attendance").selectOption(staff.data.id);
    await expect(page.getByLabel("Lý do thay đổi attendance")).toHaveCount(0);
    const [year, monthNumber, day] = businessDate.split("-");
    const row = page.getByRole("row").filter({ hasText: `${day}/${monthNumber}/${year}` });
    await row
      .getByRole("button", {
        name: `Mở lỗi và evidence ngày ${businessDate}, 0 lỗi hiện hành`,
      })
      .click();
    const dialog = page.getByRole("dialog", { name: `Lỗi và evidence ngày ${businessDate}` });
    await dialog.getByRole("button", { name: "Thêm lỗi" }).click();
    await dialog.getByLabel(`Loại lỗi ${businessDate}`).selectOption(penaltyItem!.id);
    await dialog.getByLabel(`Chi tiết lỗi ${businessDate}`).fill("Đi muộn 10 phút trong E2E");

    let createRequestCount = 0;
    let createReason: unknown;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/violations") && request.method() === "POST") {
        createRequestCount += 1;
        createReason = request.postDataJSON().reason;
      }
    });
    await dialog.getByRole("button", { name: "Ghi lỗi" }).click();

    await expect(page.getByText(/tổng phạt tháng 50\.000/)).toBeVisible();
    await expect.poll(() => createRequestCount).toBe(1);
    expect(createReason).toBeUndefined();
    await dialog.getByRole("button", { name: "Đóng" }).click();
    const activeViolationButton = row.getByRole("button", {
      name: `Mở lỗi và evidence ngày ${businessDate}, 1 lỗi hiện hành`,
    });
    await expect(
      activeViolationButton.getByTitle(`Đi muộn E2E ${suffix}`, { exact: true }),
    ).toBeVisible();
    await activeViolationButton.click();
    const refreshedDialog = page.getByRole("dialog", {
      name: `Lỗi và evidence ngày ${businessDate}`,
    });
    await expect(refreshedDialog.getByText(`Đi muộn E2E ${suffix}`, { exact: true })).toBeVisible();
    await expect(refreshedDialog.getByText(/^50\.000/)).toBeVisible();

    let cancelRequestCount = 0;
    let cancelReason: unknown;
    page.on("request", (request) => {
      if (request.url().includes("/api/violations/") && request.method() === "DELETE") {
        cancelRequestCount += 1;
        cancelReason = request.postDataJSON().reason;
      }
    });
    await refreshedDialog.getByRole("button", { name: "Hủy lỗi" }).click();
    await expect.poll(() => cancelRequestCount).toBe(1);
    expect(cancelReason).toBeUndefined();
    await expect(refreshedDialog.getByText("Đã hủy", { exact: true })).toBeVisible();
    await refreshedDialog.getByRole("button", { name: "Đóng" }).click();
    await expect(
      row.getByRole("button", {
        name: `Mở lỗi và evidence ngày ${businessDate}, 0 lỗi hiện hành`,
      }),
    ).toBeVisible();

    await row
      .getByRole("button", {
        name: `Mở lỗi và evidence ngày ${businessDate}, 0 lỗi hiện hành`,
      })
      .click();
    const historyDialog = page.getByRole("dialog", {
      name: `Lỗi và evidence ngày ${businessDate}`,
    });
    await expect(historyDialog.getByText(`Đi muộn E2E ${suffix}`, { exact: true })).toBeVisible();
    await expect(historyDialog.getByText("Đã hủy", { exact: true })).toBeVisible();
  } finally {
    if (
      originalSimpleRules.data.penalty.effectiveFrom &&
      originalSimpleRules.data.penalty.items.length > 0
    ) {
      const restore = await page.request.post("/api/rules/simple/penalties", {
        data: {
          effectiveFrom: originalSimpleRules.data.penalty.effectiveFrom,
          items: originalSimpleRules.data.penalty.items,
        },
      });
      expect(restore.ok()).toBe(true);
    }
  }
});

test("GM sửa branch overview và dữ liệu phản ánh về employee sheet", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/branch-overview");
  const suffix = Date.now().toString(36);
  const month = "2026-07";
  const businessDate = `${month}-01`;

  const branchResponse = await page.request.post("/api/branches", {
    data: {
      code: `OV${suffix}`,
      name: `Overview E2E ${suffix}`,
    },
  });
  expect(branchResponse.ok(), await branchResponse.text()).toBe(true);
  const branch = (await branchResponse.json()) as { data: { id: string } };

  const staffResponse = await page.request.post("/api/staff", {
    data: {
      staffCode: `OV${suffix}`,
      fullName: `Live Overview ${suffix}`,
      streamingAlias: `ACC-${suffix}`,
      jobTitle: "Nhân viên Live",
      employmentCategory: "OFFICIAL",
      joinedDate: businessDate,
      officialDate: businessDate,
    },
  });
  expect(staffResponse.ok()).toBe(true);
  const staff = (await staffResponse.json()) as { data: { id: string } };

  const assignmentResponse = await page.request.post("/api/assignments", {
    data: {
      staffId: staff.data.id,
      branchId: branch.data.id,
      assignmentType: "MEMBER",
      effectiveFrom: businessDate,
      effectiveTo: null,
    },
  });
  expect(assignmentResponse.ok()).toBe(true);
  const assignment = (await assignmentResponse.json()) as { data: { id: string } };

  const attendanceResponse = await page.request.post("/api/attendance", {
    data: {
      staffId: staff.data.id,
      businessDate,
      status: "PRESENT",
      revenueAmount: "100000",
      actualLiveMinutes: 30,
    },
  });
  expect(attendanceResponse.ok()).toBe(true);

  await page.reload();
  await page.getByLabel("Cơ sở tổng quan").selectOption(branch.data.id);
  await page.getByLabel("Tháng tổng quan cơ sở").fill(month);
  await expect(page.getByLabel("Lý do chỉnh sửa tổng quan")).toHaveCount(0);

  const weeks = page.getByTestId("overview-week-list");
  await expect(weeks.getByTestId("overview-week-1")).toContainText("Tuần 1 · 01/07–05/07");
  await expect(weeks.getByTestId("overview-week-5")).toContainText("Tuần 5 · 27/07–31/07");
  await expect(weeks.locator('[data-testid^="overview-week-"]')).toHaveCount(5);
  await expect(weeks.locator('[data-business-date^="2026-06"]')).toHaveCount(0);
  await expect(weeks.locator('[data-business-date^="2026-08"]')).toHaveCount(0);
  await expect(weeks.getByTestId("overview-week-2").locator("[data-business-date]")).toHaveCount(7);

  const identity = weeks.getByTestId(`overview-identity-1-${staff.data.id}`);
  const weeklyTotal = weeks.getByTestId(`overview-total-1-${staff.data.id}`);
  const [identityBox, totalBox] = await Promise.all([
    identity.boundingBox(),
    weeklyTotal.boundingBox(),
  ]);
  expect(identityBox).not.toBeNull();
  expect(totalBox).not.toBeNull();
  expect(Math.abs(identityBox!.y - totalBox!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(identityBox!.height - totalBox!.height)).toBeLessThanOrEqual(1);

  const fullWeekSize = await weeks.getByTestId("overview-week-2").evaluate((element) => {
    const scroller = element.querySelector<HTMLElement>(".overflow-x-auto");
    return {
      clientWidth: scroller?.clientWidth ?? 0,
      scrollWidth: scroller?.scrollWidth ?? 0,
    };
  });
  expect(fullWeekSize.scrollWidth).toBeLessThanOrEqual(fullWeekSize.clientWidth + 1);

  const revenue = page.getByLabel(`Số xu OV${suffix} ${businessDate}`);
  const live = page.getByLabel(`Live phút OV${suffix} ${businessDate}`);
  await expect(revenue).toHaveValue("100000");
  const [revenueBox, liveBox] = await Promise.all([revenue.boundingBox(), live.boundingBox()]);
  expect(revenueBox).not.toBeNull();
  expect(liveBox).not.toBeNull();
  expect(revenueBox!.width).toBeGreaterThan(100);
  expect(liveBox!.width).toBeGreaterThan(100);
  expect(Math.abs(revenueBox!.x - liveBox!.x)).toBeLessThanOrEqual(1);
  expect(liveBox!.y).toBeGreaterThan(revenueBox!.y + revenueBox!.height);
  await revenue.fill("700000");
  await revenue.press("ArrowDown");
  await expect(live).toBeFocused();
  await live.fill("210");

  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/attendance?staffId=${staff.data.id}&month=${month}`,
      );
      const payload = (await response.json()) as {
        data: {
          days: Array<{
            businessDate: string;
            attendance: null | {
              actualLiveMinutes: number;
              revenueAmount: string;
            };
          }>;
        };
      };
      return payload.data.days.find((day) => day.businessDate === businessDate)?.attendance;
    })
    .toMatchObject({
      revenueAmount: "700000",
      actualLiveMinutes: 210,
    });

  await expect(page.getByText("Tổng xu theo nhân viên", { exact: true })).toBeVisible();
  await expect(page.getByText("700.000 xu", { exact: true })).toBeVisible();
  await expect(page.getByLabel(`Tổng tuần 1 OV${suffix}`)).toContainText("700.000");
  const weeklyChart = page.getByTestId("weekly-revenue-chart");
  await expect(
    weeklyChart.getByRole("heading", { name: "Tổng xu theo nhân viên từng tuần" }),
  ).toBeVisible();
  await expect(weeklyChart.getByRole("button", { name: "Tuần 1" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    weeklyChart.getByText("Tuần 1 · 01/07–05/07 · 700.000 xu", { exact: true }),
  ).toBeVisible();
  await expect(weeklyChart.locator(".recharts-bar-rectangle")).toHaveCount(1);
  await weeklyChart.getByRole("button", { name: "Tuần 2" }).click();
  await expect(weeklyChart.getByText("Tuần 2 · 06/07–12/07 · 0 xu", { exact: true })).toBeVisible();

  const exportResponse = await page.request.get(
    `/api/exports/branch-monthly-overview?branchId=${branch.data.id}&month=${month}`,
  );
  expect(exportResponse.ok()).toBe(true);
  expect(exportResponse.headers()["content-type"]).toContain(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );

  await page.getByLabel("Tháng tổng quan cơ sở").fill("2026-08");
  await expect(page.getByTestId("overview-week-6")).toContainText("Tuần 6 · 31/08–31/08");

  const cleanupDate = new Date().toISOString().slice(0, 10);
  const endAssignmentResponse = await page.request.patch(`/api/assignments/${assignment.data.id}`, {
    data: {
      effectiveTo: cleanupDate,
      version: 1,
    },
  });
  expect(endAssignmentResponse.ok()).toBe(true);

  const terminateStaffResponse = await page.request.patch(`/api/staff/${staff.data.id}`, {
    data: {
      employmentStatus: "TERMINATED",
      effectiveFrom: cleanupDate,
      version: 1,
    },
  });
  expect(terminateStaffResponse.ok()).toBe(true);

  const archiveStaffResponse = await page.request.post(`/api/staff/${staff.data.id}/archive`, {
    data: {
      version: 2,
    },
  });
  expect(archiveStaffResponse.ok()).toBe(true);

  const deactivateBranchResponse = await page.request.patch(`/api/branches/${branch.data.id}`, {
    data: {
      isActive: false,
      version: 1,
    },
  });
  expect(deactivateBranchResponse.ok()).toBe(true);
});
