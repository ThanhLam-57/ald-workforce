import { expect, test as setup } from "@playwright/test";

const authFile = "test-results/.auth/gm.json";

setup("đăng nhập GM dùng chung cho các luồng nghiệp vụ", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email hoặc tên đăng nhập").fill("admin");
  await page.getByLabel("Mật khẩu").fill(process.env.SEED_GM_PASSWORD ?? "ChangeMe-12345!");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.context().storageState({ path: authFile });
});
