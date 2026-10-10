import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  signInAsMockFamily,
  MOCK_A15_ADMIN_ID,
  MOCK_A15_TARGET_ID,
  MOCK_ADMIN_USER_ID,
} from "./support/fixtures";
test.describe("A-15 admin kit", () => {
  test.describe.configure({ mode: "serial" });
  test.use({
    viewport: { width: 1280, height: 850 },
    isMobile: false,
    hasTouch: false,
  });
  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsMockFamily(context, baseURL!, { userId: MOCK_A15_ADMIN_ID });
  });
  test("role confirmation requires reason, Escape cancels, one confirmed request changes role", async ({
    page,
  }) => {
    await page.goto("/admin/users");
    const picker = page.getByLabel("Vai trò của Gia đình Xác nhận");
    await expect(picker).toHaveValue("user");
    const calls: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/admin/confirmed-action"))
        calls.push(r.postData() || "");
    });
    await picker.selectOption("editor");
    const dialog = page.getByRole("dialog", {
      name: "Đổi vai trò của Gia đình Xác nhận?",
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Đổi vai trò", exact: true }),
    ).toBeDisabled();
    await dialog.getByLabel("Lý do thao tác").fill("ngắn");
    await expect(
      dialog.getByRole("button", { name: "Đổi vai trò", exact: true }),
    ).toBeDisabled();
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    expect(calls).toHaveLength(0);
    await expect(picker).toHaveValue("user");
    await picker.selectOption("editor");
    await dialog
      .getByLabel("Lý do thao tác")
      .fill("Phân công biên tập thử nghiệm A15");
    await dialog
      .getByRole("button", { name: "Đổi vai trò", exact: true })
      .click();
    await expect(picker).toHaveValue("editor");
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0])).toEqual({
      action: "role.change",
      ids: [MOCK_A15_TARGET_ID],
      reason: "Phân công biên tập thử nghiệm A15",
      role: "editor",
    });
    await picker.selectOption("user");
    await dialog
      .getByLabel("Lý do thao tác")
      .fill("Hoàn lại quyền sau kiểm thử A15");
    await dialog
      .getByRole("button", { name: "Đổi vai trò", exact: true })
      .click();
    await expect(picker).toHaveValue("user");
  });
  test("table/filter/drawer keyboard navigation and request failure remain visible", async ({
    page,
  }) => {
    await page.goto("/admin/users");
    await page.getByLabel("Tìm người dùng").fill("Xác nhận");
    await expect(page.getByRole("table")).toContainText("Gia đình Xác nhận");
    const details = page.getByRole("button", {
      name: "Chi tiết Gia đình Xác nhận",
    });
    await details.click();
    const drawer = page.getByRole("dialog", { name: "Chi tiết người dùng" });
    await expect(drawer).toContainText("QA Xác nhận");
    await page.keyboard.press("Escape");
    await expect(drawer).not.toBeVisible();
    await expect(details).toBeFocused();
    await page.route("**/api/admin/confirmed-action", (r) =>
      r.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Đối tượng đã thay đổi. Tải lại để thử lại.",
        }),
      }),
    );
    await page
      .getByLabel("Vai trò của Gia đình Xác nhận")
      .selectOption("editor");
    const dialog = page.getByRole("dialog", {
      name: "Đổi vai trò của Gia đình Xác nhận?",
    });
    await dialog
      .getByLabel("Lý do thao tác")
      .fill("Kiểm tra lỗi thao tác trên giao diện");
    await dialog
      .getByRole("button", { name: "Đổi vai trò", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Đối tượng đã thay đổi" }),
    ).toBeVisible();
    await expect(page.getByLabel("Vai trò của Gia đình Xác nhận")).toHaveValue(
      "user",
    );
  });
  test("mobile table scroll stays inside its region, settings keep all provider sections", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/users");
    await expect(page.getByRole("table")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Chi tiết Gia đình Xác nhận" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Chi tiết người dùng" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Đóng chi tiết" }).click();
    await page.goto("/admin/settings");
    await expect(
      page.getByRole("navigation", { name: "Các phần cài đặt" }),
    ).toBeVisible();
    await expect(page.getByLabel("Model TTS ElevenLabs")).toBeVisible();
    await expect(page.getByLabel("Model TTS Fish Audio")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Lưu Cài Đặt" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
  });
  test("legacy admin without roles.manage cannot see editable role controls", async ({
    context,
    page,
    baseURL,
  }) => {
    await signInAsMockFamily(context, baseURL!, { userId: MOCK_ADMIN_USER_ID });
    await page.goto("/admin/users");
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByLabel(/^Vai trò của/)).toHaveCount(0);
  });
});
