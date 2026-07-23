import { expect, test } from "@playwright/test";

test("GM đăng nhập bằng username và thấy dashboard quản trị", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email hoặc tên đăng nhập").fill("admin");
  await page.getByLabel("Mật khẩu").fill(process.env.SEED_GM_PASSWORD ?? "ChangeMe-12345!");
  await page.getByRole("button", { name: "Đăng nhập" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
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
