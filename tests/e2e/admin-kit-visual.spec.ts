import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signInAsMockFamily, MOCK_A15_ADMIN_ID } from "./support/fixtures";
import { mkdir } from "node:fs/promises";
test.describe("A-15 visual and accessibility coverage", () => {
  test("all admin routes at desktop/mobile; dialogs and night theme", async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(180000);
    const issues: string[] = [];
    await signInAsMockFamily(context, baseURL!, { userId: MOCK_A15_ADMIN_ID });
    await page.route("**/rest/v1/story_categories*", (r) =>
      r.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "a15_qa",
            label: "Danh mục QA",
            emoji: "📚",
            description: "Dữ liệu thử độc lập",
            sort_order: 0,
            is_active: true,
          },
        ]),
      }),
    );
    await page.route("**/rest/v1/story_templates*", (r) =>
      r.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "00000000-0000-4000-8000-00000000f150",
            title: "Mẫu truyện QA",
            description: "Dữ liệu thử độc lập",
            category: "a15_qa",
            emoji: "📚",
            age_min: 3,
            age_max: 5,
            locale: "vi",
            pages: [{ content: "Ngày xửa ngày xưa" }],
            tags: [],
            is_active: true,
            sort_order: 0,
          },
        ]),
      }),
    );
    const dir = process.env.A15_SCREENSHOTS;
    if (dir) await mkdir(dir, { recursive: true });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 850 });
      for (const section of [
        "",
        "stories",
        "users",
        "analytics",
        "categories",
        "templates",
        "settings",
        "audit",
      ]) {
        await page.goto(`/admin/${section}`);
        await expect(page.locator("main h1")).toBeVisible();
        await page.waitForTimeout(400);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        const report = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        issues.push(
          ...report.violations.flatMap((v) =>
            v.nodes.map(
              (n) => `${section || "dashboard"} ${width}: ${v.id}: ${n.html}`,
            ),
          ),
        );
        if (dir)
          await page.screenshot({
            path: `${dir}/${section || "dashboard"}-${width}.png`,
            fullPage: true,
          });
      }
    }
    await page.goto("/admin/users");
    await page
      .getByRole("button", { name: /Chi tiết Gia đình Xác nhận/ })
      .click();
    if (dir) await page.screenshot({ path: `${dir}/drawer-390.png` });
    await page.keyboard.press("Escape");
    await page
      .getByLabel("Vai trò của Gia đình Xác nhận")
      .selectOption("editor");
    if (dir) await page.screenshot({ path: `${dir}/confirmation-390.png` });
    await page.keyboard.press("Escape");
    await page.goto("/admin/settings");
    await page.evaluate(() =>
      document.documentElement.classList.add("night", "dark"),
    );
    const night = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    issues.push(
      ...night.violations.flatMap((v) =>
        v.nodes.map((n) => `night: ${v.id}: ${n.html}`),
      ),
    );
    if (dir)
      await page.screenshot({
        path: `${dir}/settings-night-390.png`,
        fullPage: true,
      });
    expect(issues).toEqual([]);
  });
});
