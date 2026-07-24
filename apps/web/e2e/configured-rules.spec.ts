import { expect, test } from "@playwright/test";

test("GM chỉnh draft salary rule và publish từ Rule Center", async ({ page }) => {
  await page.goto("/rules/configured");
  const suffix = Date.now().toString(36);
  const name = `Salary E2E ${suffix}`;
  const createdResponse = await page.request.post("/api/rules/configured", {
    data: {
      name,
      type: "SALARY_RULES",
      reason: "E2E tạo salary rule",
    },
  });
  expect(createdResponse.ok()).toBe(true);
  const created = (await createdResponse.json()) as {
    data: { versions: Array<{ id: string }> };
  };

  await page.reload();
  const center = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Rule Center — thưởng, level, lương & KPI",
    }),
  });
  await expect(center).toBeVisible();
  await center.getByLabel("Version", { exact: true }).selectOption(created.data.versions[0]!.id);
  await center.getByLabel("Lương cơ bản (VND)", { exact: true }).fill("13000000");
  await center.getByLabel("Lý do thay đổi", { exact: true }).fill("E2E cập nhật lương cơ bản");
  await center.getByRole("button", { name: "Lưu draft" }).click();
  await expect(center.getByText("Đã lưu draft.")).toBeVisible();

  const rulesResponse = await page.request.get("/api/rules/configured");
  const rules = (await rulesResponse.json()) as {
    data: Array<{
      name: string;
      versions: Array<{
        id: string;
        rowVersion: number;
        configuration: { kind: string; baseSalary?: string };
      }>;
    }>;
  };
  const saved = rules.data
    .find((ruleSet) => ruleSet.name === name)!
    .versions.find((version) => version.id === created.data.versions[0]!.id)!;
  expect(saved.configuration).toMatchObject({
    kind: "SALARY_RULES",
    baseSalary: "13000000",
  });

  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());
  const publishResponse = await page.request.post(
    `/api/rules/configured/versions/${saved.id}/publish`,
    {
      data: {
        effectiveFrom: date,
        effectiveTo: null,
        rowVersion: saved.rowVersion,
        reason: "E2E publish salary rule",
      },
    },
  );
  expect(publishResponse.ok()).toBe(true);

  const activeResponse = await page.request.get(
    `/api/rules/configured/active?date=${date}&type=SALARY_RULES`,
  );
  expect(activeResponse.ok()).toBe(true);
  const active = (await activeResponse.json()) as {
    data: Array<{ id: string }>;
  };
  expect(active.data.map((version) => version.id)).toContain(saved.id);
});
