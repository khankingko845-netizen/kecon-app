import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { MOCK_AGE_USER_ID, mockAccessToken, passParentGate, signInAsMockFamily } from "./support/fixtures";

/**
 * UI-13 — "Lớn cùng bé": nhóm tuổi 3–5 / 6–8 / 9–12 điều khiển mật độ chữ,
 * cỡ nút, nhãn âm thanh. T10: tuổi tính từ năm sinh trong Hồ sơ bé → UI đổi
 * theo; mặc định 3–5. Giọng đọc được "nghe lén" như feedback.spec.ts.
 */

const AGE_EMAIL = "e2e-age@kecon.test";
/** page.clock below pins the browser to 2025 → ages are computed against this year. */
const BROWSER_YEAR = 2025;

const REST = "http://127.0.0.1:54321/rest/v1";
const PROFILE_URL = `${REST}/profiles?id=eq.${MOCK_AGE_USER_ID}`;
const authHeader = () => ({ Authorization: `Bearer ${mockAccessToken(MOCK_AGE_USER_ID, AGE_EMAIL)}` });

type StoredChild = { id: string; display_name: string; birth_year: number | null; interests: string[] };

async function storedChild(request: APIRequestContext): Promise<StoredChild> {
  const res = await request.get(`${REST}/child_profiles?select=id,display_name,birth_year,interests`, { headers: authHeader() });
  expect(res.status()).toBe(200);
  const rows = (await res.json()) as StoredChild[];
  expect(rows).toHaveLength(1); // the UI-13 family has exactly one child (Mít)
  return rows[0];
}

/** Put the UI-13 family's only child back to 4 tuổi (mock keeps rows in memory). */
async function setChildAge(request: APIRequestContext, age: number) {
  const { id } = await storedChild(request);
  const child = await request.patch(`${REST}/child_profiles?id=eq.${id}`, {
    headers: authHeader(),
    data: { display_name: "Mít", birth_year: BROWSER_YEAR - age, interests: [] },
  });
  expect(child.status()).toBe(204);
  const res = await request.patch(PROFILE_URL, { headers: authHeader(), data: { family_name: "Gia đình Mèo" } });
  expect(res.status()).toBe(204);
}

async function storedProfile(request: APIRequestContext) {
  const res = await request.get(PROFILE_URL, { headers: authHeader() });
  return ((await res.json()) as { family_name: string }[])[0];
}

async function listenToDom(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & { __spoken: string[] };
    w.__spoken = [];
    const voice = { lang: "vi-VN", name: "Đóm (test)", localService: true, default: true, voiceURI: "dom-test" };
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => [voice],
        speak: (u: { text: string }) => w.__spoken.push(u.text),
        cancel: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
    w.SpeechSynthesisUtterance = class {
      text: string;
      lang = "";
      voice: unknown = null;
      rate = 1;
      pitch = 1;
      volume = 1;
      constructor(text: string) {
        this.text = text;
      }
    };
  });
}

const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.slice());
const clearSpoken = (page: Page) => page.evaluate(() => void ((window as unknown as { __spoken: string[] }).__spoken.length = 0));
const html = (page: Page) => page.locator("html");
const tabBar = (page: Page) => page.getByRole("navigation", { name: "Điều hướng chính" });
const cssVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const domWidth = (page: Page) =>
  page
    .getByRole("button", { name: "Chạm để nghe Đóm nói" })
    .locator(":scope > *")
    .first()
    .evaluate((el) => el.getBoundingClientRect().width);

test.describe("UI-13 · Lớn cùng bé", () => {
  test.beforeEach(async ({ context, baseURL, page, request }) => {
    await setChildAge(request, 4);
    await signInAsMockFamily(context, baseURL!, { userId: MOCK_AGE_USER_ID });
    await listenToDom(page);
    await page.clock.setFixedTime(new Date("2025-06-02T10:00:00")); // ban ngày: giọng bật
  });

  test.afterEach(async ({ request }) => {
    await setChildAge(request, 4);
  });

  test("3–5 mặc định → đổi năm sinh (10 tuổi) trong Hồ sơ bé → UI 9–12", async ({ page, request }) => {
    await page.goto("/");
    // ── 3–5 "Mầm": ít chữ, nút to, chạm biểu tượng là Đóm đọc tên ──
    await expect(html(page)).toHaveAttribute("data-age", "3-5");
    await expect(html(page)).toHaveAttribute("data-density", "low");
    await expect(html(page)).toHaveAttribute("data-say-labels", "1");
    expect(await cssVar(page, "--kid-tap")).toBe("64px");
    const topics = page.getByTestId("home-topics");
    await expect(topics).toHaveAttribute("data-cols", "2");
    await expect(page.getByTestId("home-explore").getByRole("button")).toHaveText(["Yêu thích", "Chụp sách", "Vẽ truyện"]);
    await expect(page.locator("[data-kid-detail]").first()).toBeHidden();
    const bigDom = await domWidth(page);
    expect(bigDom).toBeGreaterThan(140);

    await clearSpoken(page);
    await topics.getByRole("button", { name: "Cổ tích" }).click();
    await expect.poll(() => spoken(page)).toContain("Cổ tích");
    await expect(page.getByText("Chú Cuội và cây đa")).toBeVisible();
    await expect(page.getByText("Truyện mẫu cho E2E")).toBeHidden(); // mô tả chỉ cho 9–12

    // ── Bố mẹ → Hồ sơ bé → năm sinh 2015 (10 tuổi) ──
    await tabBar(page).getByRole("button", { name: "Bố mẹ", exact: true }).click();
    await passParentGate(page);
    const kidsRow = page.getByRole("button", { name: /Hồ sơ bé/ });
    await expect(kidsRow).toContainText("Mít · Mầm · 3–5 tuổi");
    await kidsRow.click();
    const card = page.getByRole("article", { name: "Hồ sơ bé Mít" });
    await expect(card).toContainText("4 tuổi");
    await card.getByRole("button", { name: "Sửa hồ sơ Mít" }).click();
    const birthYear = page.getByLabel("Năm sinh");
    await expect(birthYear).toHaveValue(String(BROWSER_YEAR - 4));
    const summary = page.getByTestId("age-band-summary");
    await expect(summary).toHaveAttribute("data-band", "3-5");
    await birthYear.selectOption(String(BROWSER_YEAR - 10));
    await expect(summary).toHaveAttribute("data-band", "9-12");
    await expect(summary).toContainText("Lá · 9–12 tuổi");
    await page.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(page.getByText("Đã lưu hồ sơ bé Mít.")).toBeVisible();
    await expect(card).toContainText("10 tuổi");
    expect(await storedChild(request)).toMatchObject({ display_name: "Mít", birth_year: BROWSER_YEAR - 10 });

    // ── Hồ sơ gia đình: tên gia đình để trống vẫn lưu được (cột NOT NULL → gửi "" chứ không phải null) ──
    await page.getByRole("button", { name: "Quay lại", exact: true }).first().click();
    await page.getByRole("button", { name: /Hồ sơ gia đình/ }).click();
    await page.getByPlaceholder("VD: Gia đình Gấu, Nhà Mít...").fill("");
    await page.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(page.getByRole("button", { name: "Đã lưu", exact: true })).toBeVisible();
    await expect(page.getByTestId("profile-save-error")).toHaveCount(0);
    expect(await storedProfile(request)).toMatchObject({ family_name: "" });

    // ── 9–12 "Lá": nhiều chữ hơn, nút gọn, Đóm nhỏ lại, không đọc nhãn ──
    await expect(html(page)).toHaveAttribute("data-age", "9-12");
    await expect(html(page)).toHaveAttribute("data-density", "high");
    await expect(html(page)).not.toHaveAttribute("data-say-labels", /.*/);
    expect(await cssVar(page, "--kid-tap")).toBe("48px");
    // Tạo truyện / Vẽ truyện / gợi ý dùng cùng nhóm tuổi
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("kecon-settings") ?? "{}").childAge)).toBe("9-12");

    await tabBar(page).getByRole("button", { name: "Trang chủ" }).click();
    await expect(topics).toHaveAttribute("data-cols", "3");
    // Upload is staff-only even when its flag is enabled; "Thử thách" left with the old gamification (G-09).
    await expect(page.getByTestId("home-explore").getByRole("button")).toHaveText(["Yêu thích", "Chụp sách", "Vẽ truyện", "Bộ sưu tập"]);
    await expect(page.locator("[data-kid-detail]").first()).toBeVisible();
    await expect.poll(() => domWidth(page)).toBeLessThan(bigDom * 0.85);

    await clearSpoken(page);
    await topics.getByRole("button", { name: "Cổ tích" }).click();
    await expect(page.getByText("Chú Cuội và cây đa")).toBeVisible();
    await expect(page.getByText("Truyện mẫu cho E2E").first()).toBeVisible();
    expect(await spoken(page)).not.toContain("Cổ tích");

    // Vào lại khu Bố mẹ: tuổi đã lưu
    await tabBar(page).getByRole("button", { name: "Bố mẹ", exact: true }).click();
    await passParentGate(page);
    await expect(page.getByRole("button", { name: /Hồ sơ bé/ })).toContainText("Mít · Lá · 9–12 tuổi");
  });
});
