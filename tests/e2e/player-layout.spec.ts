import { test, expect, type Page } from "@playwright/test";
import { signInAsMockFamily } from "./support/fixtures";

// Mobile UI: the story player is one screen — book, voice switch, progress,
// Play and the bedtime chips are all visible without scrolling the page; a
// long page scrolls inside the book instead.
const LONG = Array.from({ length: 14 }, (_, i) => `Câu ${i + 1}: Sóc Nhỏ đi qua khu rừng, gặp bạn Thỏ và cùng nhau tìm hạt dẻ dưới gốc cây sồi.`).join(" ");

async function openPlayer(page: Page) {
  await page.clock.setFixedTime(new Date("2025-06-02T10:00:00"));
  await page.goto("/");
  await page.getByText("Sóc Nhỏ tìm hạt dẻ").first().click();
  await expect(page.getByTestId("story-book")).toBeVisible();
}
const pageScroll = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollHeight - innerHeight);

for (const [w, h] of [[390, 844], [375, 667], [360, 640]] as const) {
  test(`player vừa một màn hình ${w}×${h}`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: w, height: h });
    await signInAsMockFamily(context, baseURL!);
    await openPlayer(page);
    const controls = [
      page.getByRole("button", { name: "Quay lại", exact: true }),
      page.getByTestId("sleep-mode-pill"),
      page.getByRole("switch", { name: "Giọng đọc truyện", exact: true }),
      page.getByRole("slider", { name: "Tiến độ" }),
      page.getByRole("button", { name: "Phát", exact: true }),
      page.getByTestId("sleep-timer-button"),
      page.getByTestId("screen-off-button"),
    ];
    const check = async () => {
      expect(await pageScroll(page)).toBeLessThanOrEqual(1);
      for (const c of controls) await expect(c).toBeInViewport({ ratio: 1 });
    };
    await check();
    // A long page: the text scrolls inside the book, the controls stay put.
    await page.locator(".kc-page-text").first().evaluate((el, t) => (el.textContent = t), LONG);
    await check();
    const text = await page.locator(".kc-page-text").first().evaluate((el) => ({ h: el.clientHeight, overflow: el.scrollHeight - el.clientHeight }));
    expect(text.h).toBeGreaterThanOrEqual(112); // ≥ 3 lines
    expect(text.overflow).toBeGreaterThan(0);
    if (process.env.PLAYER_QA === "1") await page.screenshot({ path: `/data/fix53/after-${w}x${h}.png` });
  });
}
