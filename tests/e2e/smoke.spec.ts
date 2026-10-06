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
    await expect(page.getByRole("heading", { level: 1, name: /Mỗi tối, Đóm thắp sáng/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Bỏ qua" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Bắt đầu nào!/ })).toBeVisible();
    await expect(page.getByText(/Application error|Unhandled Runtime Error/)).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test("đi hết onboarding 3 bước → 'Tạo tài khoản cho bé'; 'Đăng nhập' → form đăng nhập", async ({ page }) => {
    const pageErrors = trackPageErrors(page);
    await page.goto("/");

    await page.getByRole("button", { name: /Bắt đầu nào!/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Nghe truyện bằng giọng bố mẹ/ })).toBeVisible();
    await page.getByRole("button", { name: /Tiếp tục/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: /An toàn, không quảng cáo/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Tạo tài khoản cho bé/ })).toBeVisible();

    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();

    await expect(page.getByPlaceholder("name@email.com")).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("UI v2: Đóm xuất hiện ở onboarding và ảnh tải thành công", async ({ page }) => {
    const pageErrors = trackPageErrors(page);
    await page.goto("/");

    const mascot = page.locator('[data-mascot="hello"] img');
    await expect(mascot).toBeVisible();
    await expect(mascot).toHaveAttribute("alt", /Đóm/);
    await expect
      .poll(() => mascot.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
      .toBe(true);
    await expect(page.getByText("Không quảng cáo")).toBeVisible();

    // Bước 2 đổi tư thế → Đóm lắng nghe
    await page.getByRole("button", { name: /Bắt đầu nào!/ }).click();
    await expect(page.locator('[data-mascot="listen"] img')).toBeVisible();
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

test.describe("Bảo mật (T05)", () => {
  test("trả header CSP và trang không vi phạm CSP", async ({ page }) => {
    const cspViolations: string[] = [];
    page.on("console", (msg) => {
      if (/Content Security Policy|Refused to/i.test(msg.text())) cspViolations.push(msg.text());
    });
    const pageErrors = trackPageErrors(page);

    const res = await page.goto("/");
    const headers = res?.headers() ?? {};
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");

    await expect(page.getByRole("heading", { level: 1, name: /Mỗi tối, Đóm thắp sáng/ })).toBeVisible();
    await page.getByRole("button", { name: "Bỏ qua" }).click();
    await expect(page.getByRole("heading", { name: "Tạo tài khoản" })).toBeVisible();

    expect(cspViolations).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("không còn API key trong localStorage (dữ liệu cũ bị xoá khi tải trang)", async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem(
          "kecon-settings",
          JSON.stringify({ language: "vi", storyApiKey: "sk-old-secret", elevenLabsApiKey: "el-old-secret" })
        );
        sessionStorage.setItem("seeded", "1");
      }
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /Mỗi tối, Đóm thắp sáng/ })).toBeVisible();

    const stored = await page.evaluate(() => localStorage.getItem("kecon-settings") ?? "");
    expect(stored).not.toContain("secret");
  });
});
