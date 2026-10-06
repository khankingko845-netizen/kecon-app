import { expect, test } from "@playwright/test";
import { signInAsMockFamily } from "./support/fixtures";

/** UI-06/07 — luồng bé sau đăng nhập (mock Supabase): Đóm ở mọi trạng thái, không còn spinner trơn. */

test.beforeEach(async ({ context, baseURL }) => {
  await signInAsMockFamily(context, baseURL!);
});

test("Trang chủ buổi sáng: Đóm chào + CTA chọn truyện → Thư viện", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date("2025-06-02T09:00:00"));
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Gia đình Gấu" })).toBeVisible();
  const mascot = page.locator('[data-mascot="hello"] img').first();
  await expect(mascot).toBeVisible();
  await expect.poll(() => mascot.evaluate((img: HTMLImageElement) => img.naturalWidth > 0)).toBe(true);

  await page.getByRole("button", { name: /Chọn truyện/ }).click();
  await expect(page.getByRole("heading", { name: "Thư viện" })).toBeVisible();
  await expect(page.getByText("Sóc Nhỏ tìm hạt dẻ")).toBeVisible();
  expect(errors).toEqual([]);
});

test("TabBar: nhãn viết thường, tab đang mở có aria-current", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
  for (const label of ["Trang chủ", "Thư viện", "Tạo", "Giọng đọc", "Cài đặt"]) {
    await expect(nav.getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole("button", { name: "Trang chủ", exact: true })).toHaveAttribute("aria-current", "page");
});

test("Tạo truyện: chọn nhóm tuổi 3–5 mặc định, chủ đề có icon 3D", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("button", { name: "Tạo", exact: true }).click();
  await expect(page.getByRole("button", { name: "3–5 tuổi" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "6–8 tuổi" }).click();
  await expect(page.getByRole("button", { name: "6–8 tuổi" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('img[data-icon3d="castle"]').first()).toBeVisible();
});

test("không còn spinner trơn trong luồng bé (Home → Player → Thư viện)", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Sóc Nhỏ tìm hạt dẻ").first().click();
  await expect(page.getByRole("button", { name: /Phát|Tạm dừng/ })).toBeVisible();
  expect(await page.locator(".animate-spin").count()).toBe(0);
});
