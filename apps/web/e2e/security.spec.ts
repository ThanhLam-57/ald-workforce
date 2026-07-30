import { expect, test } from "@playwright/test";

function businessMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}`;
}

test("proxy chặn mutation cross-site trước application service", async ({ request }) => {
  const response = await request.post("/api/branches", {
    headers: {
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    },
    data: {
      code: "CSRF",
      name: "Không được tạo",
    },
  });
  expect(response.status()).toBe(403);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "CSRF_REJECTED" },
  });
});

test("tài khoản do GM tạo dùng được hệ thống và vẫn có thể đổi mật khẩu thủ công", async ({
  page,
}) => {
  const suffix = Date.now().toString(36);
  const username = `forced_${suffix}`;
  const password = "Temporary-Password-123!";
  const createResponse = await page.request.post("/api/users", {
    data: {
      email: `${username}@test.local`,
      username,
      password,
      name: "Forced Password E2E",
      role: "LIVE_EMPLOYEE",
      staffId: null,
    },
  });
  expect(createResponse.status()).toBe(201);

  await page.context().clearCookies();
  const login = await page.request.post("/api/auth/sign-in/username", {
    data: { username, password },
  });
  expect(login.ok()).toBe(true);
  const apiResponse = await page.request.get("/api/me");
  expect(apiResponse.ok()).toBe(true);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/change-password");
  await expect(page).toHaveURL(/\/settings\/security$/);
  await page.getByLabel("Mật khẩu hiện tại").fill(password);
  await page.getByLabel("Mật khẩu mới", { exact: true }).fill("Changed-Password-456!");
  await page.getByLabel("Nhập lại mật khẩu mới").fill("Changed-Password-456!");
  await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect((await page.request.get("/api/me")).ok()).toBe(true);
});

test("manager A không đọc record, report, payroll hoặc file của branch B bằng ID trực tiếp", async ({
  page,
}) => {
  const month = businessMonth();
  const branchesResponse = await page.request.get("/api/branches");
  const staffResponse = await page.request.get("/api/staff");
  expect(branchesResponse.ok()).toBe(true);
  expect(staffResponse.ok()).toBe(true);
  const branches = (await branchesResponse.json()) as {
    data: Array<{ id: string; code: string }>;
  };
  const staff = (await staffResponse.json()) as {
    data: Array<{ id: string; staffCode: string }>;
  };
  const branchA = branches.data.find((item) => item.code === "DEMO");
  const branchB = branches.data.find((item) => item.code === "BRANCH-B");
  const staffB = staff.data.find((item) => item.staffCode === "LIVEB01");
  const staffA = staff.data.find((item) => item.staffCode === "LIVEDEMO");
  const staffAWithViolation = staff.data.find((item) => item.staffCode === "LIVEA02");
  expect(branchA).toBeTruthy();
  expect(branchB).toBeTruthy();
  expect(staffB).toBeTruthy();
  expect(staffA).toBeTruthy();
  expect(staffAWithViolation).toBeTruthy();

  const employeeReport = await page.request.get(
    `/api/exports/employee-error-report?staffId=${staffAWithViolation!.id}&month=${month}`,
  );
  expect(employeeReport.ok()).toBe(true);
  const employeeReportText = await employeeReport.text();
  expect(employeeReportText).toContain("EMPLOYEE_ERROR_REPORT");
  expect(employeeReportText.toLowerCase()).not.toContain("revenue");

  const attendanceResponse = await page.request.get(
    `/api/attendance?staffId=${staffB!.id}&month=${month}`,
  );
  expect(attendanceResponse.ok()).toBe(true);
  const attendance = (await attendanceResponse.json()) as {
    data: {
      days: Array<{
        attendance: null | {
          id: string;
        };
        violations: Array<{ evidence: Array<{ id: string }> }>;
      }>;
    };
  };
  const branchBDay = attendance.data.days.find((day) => day.attendance);
  const branchBAttendance = branchBDay?.attendance;
  const evidenceId = branchBDay?.violations[0]?.evidence[0]?.id;
  expect(branchBAttendance?.id).toBeTruthy();
  expect(evidenceId).toBeTruthy();

  await page.context().clearCookies();
  const login = await page.request.post("/api/auth/sign-in/username", {
    data: {
      username: "manager_demo",
      password: process.env.SEED_MANAGER_PASSWORD ?? process.env.SEED_GM_PASSWORD,
    },
  });
  expect(login.ok()).toBe(true);

  const forbiddenResponses = await Promise.all([
    page.request.get(`/api/branches/${branchB!.id}`),
    page.request.get(`/api/attendance/options?month=${month}&branchId=${branchB!.id}`),
    page.request.get(`/api/attendance?staffId=${staffB!.id}&month=${month}`),
    page.request.get(`/api/branch-overview?branchId=${branchB!.id}&month=${month}`),
    page.request.get(`/api/exports/branch-monthly-overview?branchId=${branchB!.id}&month=${month}`),
    page.request.get(`/api/evidence/${evidenceId}/view`),
    page.request.get(`/api/payroll/periods?branchId=${branchB!.id}&month=${month}`),
    page.request.get(`/api/exports/employee-error-report?staffId=${staffB!.id}&month=${month}`),
  ]);

  for (const response of forbiddenResponses) {
    expect([403, 404]).toContain(response.status());
  }

  const ownAttendanceOptionsResponse = await page.request.get(
    `/api/attendance/options?month=${month}`,
  );
  expect(ownAttendanceOptionsResponse.ok()).toBe(true);
  const ownAttendanceOptions = (await ownAttendanceOptionsResponse.json()) as {
    data: {
      branches: Array<{ id: string }>;
      staff: Array<{ id: string }>;
    };
  };
  expect(ownAttendanceOptions.data.branches.map((branch) => branch.id)).toEqual([branchA!.id]);
  expect(ownAttendanceOptions.data.staff.some((person) => person.id === staffA!.id)).toBe(true);
  expect(ownAttendanceOptions.data.staff.some((person) => person.id === staffB!.id)).toBe(false);

  const ownBranchAttendanceResponse = await page.request.get(
    `/api/attendance?staffId=${staffA!.id}&month=${month}`,
  );
  expect(ownBranchAttendanceResponse.ok()).toBe(true);
  const ownBranchAttendance = (await ownBranchAttendanceResponse.json()) as {
    data: {
      days: Array<{
        businessDate: string;
        attendance: null | { id: string; version: number; note: string | null };
      }>;
    };
  };
  const editable = ownBranchAttendance.data.days.find((day) => day.attendance)?.attendance;
  expect(editable).toBeTruthy();
  const editResponse = await page.request.patch(`/api/attendance/${editable!.id}`, {
    data: {
      version: editable!.version,
      note: "Security E2E manager A scope",
    },
  });
  expect(editResponse.ok()).toBe(true);

  const managerReportResponse = await page.request.get(`/api/company-report?month=${month}`);
  expect(managerReportResponse.ok()).toBe(true);
  const managerReport = (await managerReportResponse.json()) as {
    data: { branches: Array<{ branch: { id: string } }> };
  };
  expect(managerReport.data.branches.map((item) => item.branch.id)).toEqual([branchA!.id]);
  const serializedReport = JSON.stringify(managerReport);
  expect(serializedReport).not.toMatch(/payroll/i);
  expect(serializedReport).not.toMatch(/baseSalary/i);
  expect(serializedReport).not.toMatch(/totalIncome/i);
  expect(serializedReport).not.toMatch(/revenueBonus/i);

  const editableDay = ownBranchAttendance.data.days.find((day) => day.attendance);
  expect(editableDay?.attendance).toBeTruthy();
  const validUnknownId = "00000000-0000-4000-8000-000000000000";
  const deniedResponses = await Promise.all([
    page.request.patch("/api/branch-overview", {
      data: {
        branchId: branchA!.id,
        edits: [
          {
            clientId: "security-read-only",
            staffId: staffA!.id,
            businessDate: editableDay!.businessDate,
            version: editableDay!.attendance!.version,
            workUnits: "1",
          },
        ],
      },
    }),
    page.request.get(`/api/exports/branch-monthly-overview?branchId=${branchA!.id}&month=${month}`),
    page.request.get(`/api/exports/company-report?month=${month}&format=xlsx`),
    page.request.get(`/api/company-report?month=${month}&branchId=${branchB!.id}`),
    page.request.get(`/api/payroll/periods?month=${month}`),
    page.request.get(`/api/payroll/periods/${validUnknownId}`),
    page.request.post(`/api/payroll/periods/${validUnknownId}/calculate`, {
      data: { version: 1 },
    }),
    page.request.get(`/api/payroll/exports/${validUnknownId}`),
    page.request.get(`/api/payroll/exports/${validUnknownId}/download`),
    page.request.get("/api/imports/templates"),
    page.request.get("/api/export-center"),
    page.request.get("/api/audit"),
    page.request.get("/api/administration/users"),
    page.request.post("/api/rules/simple/rewards", {
      data: {
        effectiveFrom: `${month}-01`,
        tiers: [{ thresholdAmount: "10000", rewardAmount: "50000" }],
      },
    }),
  ]);
  for (const response of deniedResponses) {
    expect([403, 404]).toContain(response.status());
  }

  const visibleRules = await page.request.get("/api/rules/simple");
  expect(visibleRules.ok()).toBe(true);
});
