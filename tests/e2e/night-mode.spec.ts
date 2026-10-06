import { expect, test, type Page } from "@playwright/test";
import { pureWhiteElements, signInAsMockFamily } from "./support/fixtures";

/**
 * UI-08 — Chế độ ngủ (concept board): tự bật 19:30–6:00 cho Player/Ru ngủ (class `bedtime`),
 * Trang chủ vẫn nền kem như concept; "Luôn bật" trong tab Bố mẹ → toàn app nền đêm, không có #FFF.
 */

const htmlClasses = (page: Page) => page.evaluate(() => document.documentElement.className);
const hasClass = async (page: Page, c: string) => (await htmlClasses(page)).split(/\s+/).includes(c);
const isNight = (page: Page) => hasClass(page, "night");
const isBedtime = (page: Page) => hasClass(page, "bedtime");

test.describe("Chế độ ngủ (chưa đăng nhập)", () => {
  test("pref 'on' → nền đêm, không phần tử nào trắng tinh", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kecon-night-mode", "on"));
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /Mỗi tối, Đóm thắp sáng/ })).toBeVisible();
    await expect.poll(() => isNight(page)).toBe(true);
    expect(await htmlClasses(page)).toContain("dark");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(21, 18, 51)");
    expect(await pureWhiteElements(page)).toEqual([]);
  });

  test("auto: 10:00 tắt, tự bật đúng 19:30", async ({ page }) => {
    await page.clock.install({ time: new Date("2025-06-02T19:29:00") });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /Mỗi tối, Đóm thắp sáng/ })).toBeVisible();
    expect(await isBedtime(page)).toBe(false);

    await page.clock.fastForward("02:00");
    await expect.poll(() => isBedtime(page)).toBe(true);
    // Tự động chỉ làm tối Player/Ru ngủ — các màn khác giữ nền kem như concept
    expect(await isNight(page)).toBe(false);
  });

  test("auto: 06:00 sáng tự tắt", async ({ page }) => {
    await page.clock.install({ time: new Date("2025-06-03T05:59:00") });
    await page.goto("/");
    await expect.poll(() => isBedtime(page)).toBe(true);
    await page.clock.fastForward("02:00");
    await expect.poll(() => isBedtime(page)).toBe(false);
  });
});

test.describe("Chế độ ngủ (đã đăng nhập)", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsMockFamily(context, baseURL!);
  });

  test("bật/tắt trong tab Bố mẹ: Tự động → Luôn bật → Tắt", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2025-06-02T10:00:00"));
    await page.goto("/");
    await expect(page.locator('[data-mascot="hello"]').first()).toBeVisible();
    expect(await isNight(page)).toBe(false);

    await page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("button", { name: "Bố mẹ", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Bố mẹ" })).toBeVisible();
    const row = page.getByRole("button", { name: /Chế độ ngủ/ });
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

  test("Trang chủ buổi tối: Đóm kể chuyện, nền kem như concept (không ép nền đêm)", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2025-06-02T20:30:00"));
    await page.goto("/");
    await expect(page.locator('[data-mascot="story"]').first()).toBeVisible();
    await expect(page.getByText("Tối nay mình nghe truyện gì nhỉ?")).toBeVisible();
    await expect.poll(() => isBedtime(page)).toBe(true);
    expect(await isNight(page)).toBe(false);
  });

  test("Trang chủ khi 'Luôn bật': nền đêm, không có #FFF", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kecon-night-mode", "on"));
    await page.clock.setFixedTime(new Date("2025-06-02T20:30:00"));
    await page.goto("/");
    await expect(page.getByText("Tối nay mình nghe truyện gì nhỉ?")).toBeVisible();
    await expect.poll(() => isNight(page)).toBe(true);
    expect(await pureWhiteElements(page)).toEqual([]);
  });

  test("Player ban đêm: tự vào Chế độ ngủ, hẹn giờ + tắt màn", async ({ page }) => {
    await page.clock.install({ time: new Date("2025-06-02T21:00:00") });
    await page.goto("/");
    await page.getByText("Sóc Nhỏ tìm hạt dẻ").first().click();

    const pill = page.getByTestId("sleep-mode-pill");
    await expect(pill).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-mascot="sleepy"]')).toBeVisible();
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
    await page.getByRole("button", { name: "Thêm tuỳ chọn" }).click();
    await page.getByRole("dialog", { name: "Tuỳ chọn truyện" }).getByRole("button", { name: /Ru ngủ/ }).click();
    await expect(page.getByRole("heading", { name: "Ru ngủ cùng Đóm" })).toBeVisible();
    await expect(page.locator('[data-mascot="sleepy"]')).toBeVisible();
    await expect(page.getByTestId("screen-off-button")).toBeVisible();
    expect(await pureWhiteElements(page)).toEqual([]);
  });
});
