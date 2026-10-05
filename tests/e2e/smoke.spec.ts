import { expect, test, type Page } from "@playwright/test";

/** Collects uncaught exceptions thrown in the page (React crashes, hydration errors…). */
function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test.describe("Trang chủ (chưa đăng nhập)", () => {
  test("render màn hình onboarding đầu tiên, không có lỗi JS", async ({ page }) => {
    const pageErrors = trackPageErrors(page);

    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle(/KểCon/);
    await expect(page.getByRole("heading", { level: 1, name: /Chào mừng đến KểCon!/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Bỏ qua" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Tiếp tục/ })).toBeVisible();
    await expect(page.getByText(/Application error|Unhandled Runtime Error/)).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test("đi hết onboarding → 'Đã có tài khoản? Đăng nhập' → form đăng nhập", async ({ page }) => {
    const pageErrors = trackPageErrors(page);
    await page.goto("/");

    for (const title of ["Clone giọng nói", "Tạo truyện bằng AI", "An toàn cho bé", "Sẵn sàng rồi!"]) {
      await page.getByRole("button", { name: /Tiếp tục/ }).click();
      await expect(page.getByRole("heading", { level: 1, name: new RegExp(title) })).toBeVisible();
    }
    await page.getByRole("button", { name: "Đã có tài khoản? Đăng nhập" }).click();

    await expect(page.getByPlaceholder("name@email.com")).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("'Bỏ qua' → màn hình tạo tài khoản", async ({ page }) => {
    // Regression: nút "Bỏ qua" từng bị khối nội dung (-mt-8 z-10) che mất.
    const pageErrors = trackPageErrors(page);
    await page.goto("/");

    await page.getByRole("button", { name: "Bỏ qua" }).click({ timeout: 5_000 });

    await expect(page.getByRole("heading", { name: "Tạo tài khoản" })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
