import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { passParentGate, signInAsMockFamily } from "./support/fixtures";

/**
 * UI-12 — QA accessibility: axe-core (WCAG 2.1 A/AA + landmark best practices)
 * on every main screen, day and night, plus Vietnamese text checks.
 */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
/** Best-practice rules we also hold the app to. */
const BEST = ["landmark-one-main", "region", "page-has-heading-one", "heading-order", "button-name", "meta-viewport"];

async function expectAccessible(page: Page, screen: string) {
  await page.waitForTimeout(400); // let screen-enter animations settle (contrast is computed on the final colours)
  const wcag = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const best = await new AxeBuilder({ page }).withRules(BEST).analyze(); // axe can't run twice at once
  const problems = [...wcag.violations, ...best.violations].map(
    (v) => `${v.impact} ${v.id}: ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(", ")}`
  );
  expect(problems, `${screen}:\n${problems.join("\n")}`).toEqual([]);
}

/** Vietnamese must be precomposed (NFC): decomposed marks render as floating accents in some fonts. */
async function expectNfcText(page: Page) {
  const bad = await page.evaluate(() => {
    const text = document.body.innerText;
    return text === text.normalize("NFC") ? [] : Array.from(text.matchAll(/\S*[\u0300-\u036f]\S*/g)).map((m) => m[0]).slice(0, 5);
  });
  expect(bad).toEqual([]);
}

const tabBar = (page: Page) => page.getByRole("navigation", { name: "Điều hướng chính" });

test.describe("UI-12 · a11y — chưa đăng nhập", () => {
  test("onboarding 3 bước, đăng ký, đăng nhập", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "vi");
    for (const step of [1, 2, 3]) {
      await expectAccessible(page, `onboarding-${step}`);
      await expectNfcText(page);
      if (step < 3) await page.getByRole("button", { name: /Bắt đầu nào!|Tiếp tục/ }).click();
    }
    await page.getByRole("button", { name: "Tạo tài khoản cho bé" }).click();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expectAccessible(page, "signup");
    await page.getByRole("button", { name: "Hiện mật khẩu" }).click();
    await expect(page.getByRole("button", { name: "Ẩn mật khẩu" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: /Đăng nhập/ }).last().click();
    await expect(page.getByRole("button", { name: "Hiện mật khẩu" })).toBeVisible();
    await expectAccessible(page, "login");
  });

  test("phụ huynh phóng to được (không khoá zoom)", async ({ page }) => {
    await page.goto("/");
    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewport).not.toMatch(/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/);
  });
});

test.describe("UI-12 · a11y — đã đăng nhập", () => {
  test.beforeEach(async ({ context, baseURL, page }) => {
    await signInAsMockFamily(context, baseURL!);
    await page.clock.setFixedTime(new Date("2025-06-02T10:00:00"));
  });

  test("màn của bé: Trang chủ, Thư viện, Giọng đọc, Tạo truyện, Player", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/");
    await page.getByTestId("home-topics").waitFor();
    await expectAccessible(page, "home");
    await expectNfcText(page);
    await tabBar(page).getByRole("button", { name: "Thư viện" }).click();
    await expect(page.getByText("Chú Cuội và cây đa")).toBeVisible();
    await expectAccessible(page, "library");
    await tabBar(page).getByRole("button", { name: "Giọng đọc" }).click();
    await expectAccessible(page, "voice");
    await tabBar(page).getByRole("button", { name: "Tạo" }).click();
    await expect(page.getByRole("progressbar")).toBeVisible();
    await expectAccessible(page, "create");
    await page.goto("/");
    await page.getByTestId("home-topics").waitFor();
    await page.getByText("Sóc Nhỏ tìm hạt dẻ").first().click();
    await expect(page.getByText(/Trang 1/).first()).toBeVisible();
    await expectAccessible(page, "player");
  });

  test("vùng phụ huynh: cổng, Bố mẹ, Hồ sơ gia đình, Kiểm soát phụ huynh", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/");
    await page.getByTestId("home-topics").waitFor();
    await tabBar(page).getByRole("button", { name: "Bố mẹ", exact: true }).click();
    await expect(page.locator("[data-parent-gate]")).not.toHaveAttribute("data-parent-gate", "loading");
    await expectAccessible(page, "parent-gate");
    await passParentGate(page);
    await expectAccessible(page, "parent");
    await page.getByRole("button", { name: /Hồ sơ gia đình/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Hồ sơ gia đình" })).toBeVisible();
    await expectAccessible(page, "profile-edit");
    await page.getByRole("button", { name: "Quay lại" }).click();
    await page.getByRole("button", { name: /Kiểm soát phụ huynh/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Kiểm soát phụ huynh" })).toBeVisible();
    await expectAccessible(page, "parental-controls");
  });

  test("Chế độ ngủ (luôn bật): Trang chủ + Thư viện đọc rõ trên nền đêm", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kecon-night-mode", "on"));
    await page.goto("/");
    await page.getByTestId("home-topics").waitFor();
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("night"))).toBe(true);
    await expectAccessible(page, "home-night");
    await tabBar(page).getByRole("button", { name: "Thư viện" }).click();
    await expect(page.getByText("Chú Cuội và cây đa")).toBeVisible();
    await expectAccessible(page, "library-night");
  });
});
