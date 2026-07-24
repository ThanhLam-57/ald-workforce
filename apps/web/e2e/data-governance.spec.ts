import { expect, test } from "@playwright/test";

test("GM thấy Import, Export Center, Audit và API template được scope", async ({
  page,
  request,
}) => {
  await page.goto("/data-governance");
  await expect(page.getByRole("heading", { name: "Import, Export Center & Audit" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Import, Export Center và Audit" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "1. Import dữ liệu cũ" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "2. Export Center" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "3. Audit Explorer" })).toBeVisible();

  const templatesResponse = await request.get("/api/imports/templates");
  expect(templatesResponse.ok()).toBe(true);
  const templates = (await templatesResponse.json()) as {
    data: readonly { template: string }[];
  };
  expect(templates.data).toHaveLength(8);
  expect(templates.data.map((item) => item.template)).toContain("HISTORICAL_PAYROLL");

  const auditResponse = await request.get("/api/audit?limit=5");
  expect(auditResponse.ok()).toBe(true);
  expect(auditResponse.headers()["cache-control"]).toContain("no-store");

  const oversized = await request.post("/api/imports/presign", {
    data: {
      template: "BRANCHES",
      idempotencyKey: "e2e-oversized-file",
      originalFileName: "oversized.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 20 * 1_024 * 1_024 + 1,
      checksumSha256: `${"A".repeat(43)}=`,
      reason: "E2E oversize validation.",
    },
  });
  expect(oversized.status()).toBe(400);
});
