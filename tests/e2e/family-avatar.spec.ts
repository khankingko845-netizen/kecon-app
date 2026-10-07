import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { MOCK_AVATAR_USER_ID, mockAccessToken, passParentGate, signInAsMockFamily } from "./support/fixtures";

const profileUrl = `http://127.0.0.1:54321/rest/v1/profiles?id=eq.${MOCK_AVATAR_USER_ID}`;
const headers = { Authorization: `Bearer ${mockAccessToken(MOCK_AVATAR_USER_ID, "e2e-avatar@kecon.test")}` };

test("Avatar Đóm: legacy → chọn/lưu → Trang chủ/Bố mẹ → tải lại, ngày/đêm", async ({ page, context, request, baseURL }) => {
  test.setTimeout(60_000);
  await request.patch(profileUrl, { headers, data: { avatar_url: null, avatar_emoji: "🐰" } });
  try {
    await signInAsMockFamily(context, baseURL!, { userId: MOCK_AVATAR_USER_ID });
    await page.clock.setFixedTime(new Date("2025-06-02T10:00:00"));
    await page.goto("/");
    const homeAvatar = page.getByRole("button", { name: "Hồ sơ của bé" }).locator("[data-family-avatar]");
    await expect(homeAvatar).toHaveAttribute("data-family-avatar", "happy");
    await page.getByRole("button", { name: "Hồ sơ của bé" }).click();
    await passParentGate(page);
    await expect(page.getByRole("heading", { name: "Hồ sơ gia đình" })).toBeVisible();
    const picker = page.getByRole("group", { name: "Chọn ảnh đại diện Đóm" });
    await expect(picker.getByRole("button")).toHaveCount(6);
    await expect(picker.getByRole("button", { name: "Đóm vui", exact: true })).toHaveAttribute("aria-pressed", "true");
    // Viewing the new portraits does not overwrite the family's old choice.
    expect((await (await request.get(profileUrl, { headers })).json())[0]).toMatchObject({ avatar_url: null, avatar_emoji: "🐰" });
    await expect.poll(() => picker.locator("img").evaluateAll((imgs) => imgs.every((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await picker.getByRole("button", { name: "Đóm kể chuyện", exact: true }).click();
    await expect(picker.getByRole("button", { name: "Đóm kể chuyện", exact: true })).toHaveAttribute("aria-pressed", "true");
    // A failed save must not say "Đã lưu" or update Home's persisted portrait.
    await page.route("**/rest/v1/profiles?*", async (route) => {
      if (route.request().method() === "PATCH") await route.fulfill({ status: 500, json: { message: "test save failure" } });
      else await route.continue();
    });
    await page.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(page.getByTestId("profile-save-error")).toBeVisible();
    await expect(page.getByRole("button", { name: "Đã lưu", exact: true })).toHaveCount(0);
    await page.unroute("**/rest/v1/profiles?*");
    await page.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(page.getByRole("button", { name: "Đã lưu", exact: true })).toBeVisible();
    expect((await (await request.get(profileUrl, { headers })).json())[0]).toMatchObject({ avatar_url: "/mascot/dom-story.webp", avatar_emoji: null });
    const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(a11y.violations).toEqual([]);
    if (process.env.AVATAR_VISUAL_QA === "1") await page.screenshot({ path: "/data/avatar-profile-day.png", fullPage: true });
    const tabs = page.getByRole("navigation", { name: "Điều hướng chính" });
    await tabs.getByRole("button", { name: "Trang chủ", exact: true }).click();
    await expect(homeAvatar).toHaveAttribute("data-family-avatar", "story");
    if (process.env.AVATAR_VISUAL_QA === "1") await page.screenshot({ path: "/data/avatar-home.png" });
    await page.reload();
    await expect(homeAvatar).toHaveAttribute("data-family-avatar", "story");
    await tabs.getByRole("button", { name: "Bố mẹ", exact: true }).click();
    await passParentGate(page);
    const familyRow = page.getByRole("button", { name: /Hồ sơ gia đình/ });
    await expect(familyRow.locator("[data-family-avatar]")).toHaveAttribute("data-family-avatar", "story");
    await page.getByRole("button", { name: /Chế độ ngủ/ }).click(); // auto → always on
    await familyRow.click();
    await expect(picker.getByRole("button", { name: "Đóm kể chuyện", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.setViewportSize({ width: 320, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const nightA11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(nightA11y.violations).toEqual([]);
    if (process.env.AVATAR_VISUAL_QA === "1") await page.screenshot({ path: "/data/avatar-profile-night-320.png", fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (process.env.AVATAR_VISUAL_QA === "1") await page.screenshot({ path: "/data/avatar-profile-desktop.png", fullPage: true });
  } finally {
    await request.patch(profileUrl, { headers, data: { avatar_url: null, avatar_emoji: null } });
  }
});
