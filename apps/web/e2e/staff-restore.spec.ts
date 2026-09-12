import { expect, test, type Page } from "@playwright/test";
import { prisma, type Prisma } from "@ald/db";

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

async function appendLegacyTerminationAudit(staffId: string): Promise<void> {
  const terminationAudit = await prisma.auditLog.findFirstOrThrow({
    where: {
      action: "staff.terminate",
      entityId: staffId,
      entityType: "StaffMember",
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    select: {
      action: true,
      actorUserId: true,
      after: true,
      before: true,
      branchId: true,
      companyId: true,
      entityId: true,
      entityType: true,
      ipAddress: true,
      occurredAt: true,
      reason: true,
      requestId: true,
      userAgent: true,
    },
  });
  if (
    typeof terminationAudit.before !== "object" ||
    terminationAudit.before === null ||
    Array.isArray(terminationAudit.before)
  ) {
    throw new Error("Termination audit fixture does not contain an object snapshot.");
  }

  const legacyBefore = { ...(terminationAudit.before as Prisma.JsonObject) };
  if (!("terminationRecovery" in legacyBefore)) {
    throw new Error("Termination audit fixture does not contain a recovery snapshot.");
  }
  delete legacyBefore.terminationRecovery;
  if (
    typeof terminationAudit.after !== "object" ||
    terminationAudit.after === null ||
    Array.isArray(terminationAudit.after)
  ) {
    throw new Error("Termination audit fixture does not contain an after snapshot.");
  }
  await prisma.auditLog.create({
    data: {
      action: terminationAudit.action,
      actorUserId: terminationAudit.actorUserId,
      after: terminationAudit.after as Prisma.InputJsonObject,
      before: legacyBefore as Prisma.InputJsonObject,
      branchId: terminationAudit.branchId,
      companyId: terminationAudit.companyId,
      entityId: terminationAudit.entityId,
      entityType: terminationAudit.entityType,
      ipAddress: terminationAudit.ipAddress,
      occurredAt: new Date(terminationAudit.occurredAt.getTime() + 1_000),
      reason: terminationAudit.reason,
      requestId: terminationAudit.requestId,
      userAgent: terminationAudit.userAgent,
    },
  });
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

test("GM khôi phục thủ công dữ liệu nghỉ việc cũ thiếu snapshot", async ({ page }) => {
  const suffix = Date.now().toString(36).toUpperCase();
  const staffCode = "LEGACY" + suffix;
  const machineCode = "LG" + suffix;
  const today = businessToday();
  const assignmentCutoff = new Date(`${today}T00:00:00.000Z`);
  assignmentCutoff.setUTCMonth(assignmentCutoff.getUTCMonth() + 1, 1);
  const displayDate = (value: string) => {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  };

  await page.setViewportSize({ width: 390, height: 844 });
  await signInWithUsername(page, "admin", process.env.SEED_GM_PASSWORD ?? "ChangeMe-12345!");
  await page.goto("/staff");
  await expect(page.getByRole("heading", { name: "Nhân viên" })).toBeVisible();

  const branchesResponse = await browserRequest(page, "/api/branches");
  expect(branchesResponse.ok, branchesResponse.body).toBe(true);
  const branches = JSON.parse(branchesResponse.body) as {
    data: Array<{ id: string; code: string; name: string }>;
  };
  const branch = branches.data.find(({ code }) => code === "DEMO") ?? branches.data[0];
  expect(branch).toBeTruthy();

  const createResponse = await browserRequest(page, "/api/staff", {
    method: "POST",
    data: {
      staffCode,
      fullName: "Nhân viên dữ liệu cũ " + suffix,
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
  await appendLegacyTerminationAudit(created.data.id);

  await page.goto("/staff");
  await page.getByRole("button", { name: "Hiện nhân viên đã nghỉ" }).click();
  await page.getByLabel("Cơ sở").selectOption(branch!.id);
  await page.getByLabel("Trạng thái").selectOption("TERMINATED");

  const row = page.getByRole("row").filter({ hasText: staffCode });
  await row.getByRole("button", { name: "Xem hồ sơ" }).click();
  const profile = page.getByRole("dialog", { name: /Hồ sơ nhân viên/ });
  await profile.getByRole("button", { name: "Hoàn tác nghỉ việc" }).click();

  let restoreDialog = page.getByRole("alertdialog", {
    name: "Xác nhận hoàn tác nghỉ việc",
  });
  const reason = "Khôi phục bản ghi cũ do bấm nhầm thao tác nghỉ việc.";
  await restoreDialog.getByLabel("Lý do hoàn tác nghỉ việc").fill(reason);
  await restoreDialog.getByRole("button", { name: "Xác nhận hoàn tác" }).click();

  await expect(
    restoreDialog.getByText(/Dữ liệu nghỉ việc cũ không có bản chụp khôi phục đầy đủ/),
  ).toBeVisible();
  const manualTrigger = restoreDialog.getByRole("button", { name: "Khôi phục thủ công" });
  await expect(manualTrigger).toBeFocused();
  await manualTrigger.click();

  restoreDialog = page.getByRole("alertdialog", {
    name: "Khôi phục thủ công dữ liệu cũ",
  });
  const status = restoreDialog.getByLabel("Trạng thái sau khôi phục");
  await expect(status).toBeFocused();
  await expect(status).toHaveValue("ACTIVE");
  await expect(restoreDialog.getByLabel("Ngày nghỉ việc đã ghi nhận")).toHaveValue(
    displayDate(today),
  );
  await expect(restoreDialog.getByLabel("Mốc kết thúc phân công đã ghi nhận")).toHaveValue(
    displayDate(assignmentCutoff.toISOString().slice(0, 10)),
  );

  const assignment = restoreDialog.getByRole("checkbox", {
    name: new RegExp(`Khôi phục phân công tại ${branch!.code}`),
  });
  await expect(assignment).not.toBeChecked();
  await expect(
    restoreDialog.getByLabel("Ngày kết thúc phân công sau khôi phục (không bắt buộc)"),
  ).toHaveValue("");
  await expect(restoreDialog.getByText(machineCode)).toBeVisible();
  await expect(restoreDialog.getByLabel("Lý do hoàn tác nghỉ việc")).toHaveValue(reason);

  const acknowledgement = restoreDialog.getByRole("checkbox", {
    name: /Tôi đã kiểm tra trạng thái, ngày hiệu lực và phân công được gợi ý/,
  });
  const confirmManual = restoreDialog.getByRole("button", { name: "Khôi phục dữ liệu cũ" });
  await expect(acknowledgement).not.toBeChecked();
  await expect(confirmManual).toBeDisabled();
  await acknowledgement.check();
  await expect(confirmManual).toBeEnabled();
  await assignment.check();
  await expect(assignment).toBeChecked();
  await confirmManual.focus();
  await page.keyboard.press("Tab");
  await expect(
    restoreDialog.getByRole("button", { name: "Đóng hoàn tác nghỉ việc" }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await confirmManual.focus();
  await confirmManual.click();

  await expect(profile.getByText(/Đã khôi phục dữ liệu cũ cho/)).toBeVisible();
  await expect(profile.getByText("Đang làm", { exact: true })).toBeVisible();
  await expect(profile.getByRole("button", { name: "Đóng", exact: true })).toBeFocused();
  await profile.getByRole("button", { name: "Chỉnh sửa" }).click();
  await profile.getByLabel("Họ và tên").fill("Nhân viên cũ đã sửa " + suffix);
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
    fullName: "Nhân viên cũ đã sửa " + suffix,
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
