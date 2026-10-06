import { expect, test, type Page } from "@playwright/test";
import { pureWhiteElements, signInAsMockFamily } from "./support/fixtures";

/** UI-08 — Chế độ Đêm: tự bật 19:30, bật/tắt trong Cài đặt, không có #FFF, hẹn giờ, tắt màn. */

const htmlClasses = (page: Page) => page.evaluate(() => document.documentElement.className);
const isNight = async (page: Page) => (await htmlClasses(page)).split(/\s+/).includes("night");

test.describe("Chế độ Đêm (chưa đăng nhập)", () => {
  test("pref 'on' → nền đêm, không phần tử nào trắng tinh", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kecon-night-mode", "on"));
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /Chào mừng đến KểCon!/ })).toBeVisible();
    await expect.poll(() => isNight(page)).toBe(true);
    expect(await htmlClasses(page)).toContain("dark");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(21, 18, 51)");
    expect(await pureWhiteElements(page)).toEqual([]);
  });

  test("auto: 10:00 tắt, tự bật đúng 19:30", async ({ page }) => {
    await page.clock.install({ time: new Date("2025-06-02T19:29:00") });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /Chào mừng đến KểCon!/ })).toBeVisible();
    expect(await isNight(page)).toBe(false);

    await page.clock.fastForward("02:00");
    await expect.poll(() => isNight(page)).toBe(true);
  });

  test("auto: 06:00 sáng tự tắt", async ({ page }) => {
    await page.clock.install({ time: new Date("2025-06-03T05:59:00") });
    await page.goto("/");
    await expect.poll(() => isNight(page)).toBe(true);
    await page.clock.fastForward("02:00");
    await expect.poll(() => isNight(page)).toBe(false);
  });
});

test.describe("Chế độ Đêm (đã đăng nhập)", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsMockFamily(context, baseURL!);
  });

  test("bật/tắt trong Cài đặt: Tự động → Luôn bật → Tắt", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2025-06-02T10:00:00"));
    await page.goto("/");
    await expect(page.locator('[data-mascot="hello"]').first()).toBeVisible();
    expect(await isNight(page)).toBe(false);

    await page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("button", { name: "Cài đặt", exact: true }).click();
    const row = page.getByRole("button", { name: /Chế độ Đêm/ });
    await expect(row).toContainText("Tự động 19:30–6:00");

    await row.click();
    await expect(row).toContainText("Luôn bật");
    await expect.poll(() => isNight(page)).toBe(true);
    expect(await pureWhiteElements(page)).toEqual([]);

    await row.click();
    await expect(row).toContainText("Tắt");
    await expect.poll(() => isNight(page)).toBe(false);

    // Lựa chọn được nhớ sau khi tải lại
    await page.reload();
    expect(await page.evaluate(() => localStorage.getItem("kecon-night-mode"))).toBe("off");
  });

  test("Trang chủ buổi tối: Đóm kể chuyện, không có #FFF", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2025-06-02T20:30:00"));
    await page.goto("/");
    await expect(page.locator('[data-mascot="story"]').first()).toBeVisible();
    await expect(page.getByText("Tối nay nghe truyện gì nhỉ?")).toBeVisible();
    await expect.poll(() => isNight(page)).toBe(true);
    expect(await pureWhiteElements(page)).toEqual([]);
  });

  test("Player ban đêm: hẹn giờ ngủ + tắt màn", async ({ page }) => {
    await page.clock.install({ time: new Date("2025-06-02T21:00:00") });
    await page.goto("/");
    await page.getByText("Sóc Nhỏ tìm hạt dẻ").first().click();

    const timer = page.getByTestId("sleep-timer-button");
    await expect(timer).toBeVisible();
    expect(await pureWhiteElements(page)).toEqual([]);

    await timer.click();
    await page.getByRole("dialog", { name: "Hẹn giờ ngủ" }).getByRole("button", { name: "5 phút", exact: true }).click();
    await expect(timer).toContainText("5:00");
    await page.clock.fastForward("01:00");
    await expect(timer).toContainText("4:0");
    await page.clock.fastForward("04:05");
    await expect(timer).not.toContainText(":");

    await page.getByTestId("screen-off-button").click();
    const overlay = page.getByTestId("screen-off");
    await expect(overlay).toBeVisible();
    await overlay.click();
    await expect(overlay).toBeHidden();
  });

  test("Ru ngủ có nút tắt màn và không có #FFF", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2025-06-02T21:00:00"));
    await page.goto("/");
    await page.getByText("Sóc Nhỏ tìm hạt dẻ").first().click();
    await page.getByRole("button", { name: /Ru Ngủ/ }).click();
    await expect(page.getByRole("heading", { name: "Ru ngủ cùng Đóm" })).toBeVisible();
    await expect(page.locator('[data-mascot="sleepy"]')).toBeVisible();
    await expect(page.getByTestId("screen-off-button")).toBeVisible();
    expect(await pureWhiteElements(page)).toEqual([]);
  });
});
