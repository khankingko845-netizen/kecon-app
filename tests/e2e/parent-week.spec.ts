import AxeBuilder from "@axe-core/playwright";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { MOCK_AGE_USER_ID, MOCK_AVATAR_USER_ID, MOCK_PIN, MOCK_PIN_USER_ID, passParentGate, signInAsMockFamily } from "./support/fixtures";

// G-06 / G-07 (docs/missions-parent.md): "Tuần của bé" behind the parent gate.
// The PIN mints a proof kept in page memory only; every parent action sends it.
// Proof/unlock/ledger rules are covered by tests/db/missions-parent.test.ts.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SOC = "00000000-0000-4000-8000-0000000051a1";
const CUOI = "00000000-0000-4000-8000-0000000051a2";
const MOCK = "http://127.0.0.1:54321";
const nav = (page: Page) => page.getByRole("navigation", { name: "Điều hướng chính" });

async function reset(request: APIRequestContext, sub: string) {
  await request.post(`${MOCK}/__e2e/missions-reset`, { data: { sub } });
}
async function listen(page: Page, storyId: string) {
  const start = await page.request.post("/api/missions/listen", { data: { action: "start", storyId } });
  expect(start.ok()).toBe(true);
  const { session_id } = (await start.json()) as { session_id: string };
  const done = await page.request.post("/api/missions/listen", { data: { action: "complete", sessionId: session_id } });
  expect(((await done.json()) as { counted: boolean }).counted).toBe(true);
}
async function openParentWeek(page: Page, pin?: string) {
  await nav(page).getByRole("button", { name: "Bố mẹ", exact: true }).click();
  await passParentGate(page, pin);
  await page.getByRole("button", { name: "Tuần của bé" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tuần của bé" })).toBeVisible();
}

test("bố mẹ nhập PIN → ghi nhận thói quen (sao), cảm ơn việc tốt (không sao), đọc cùng, bật nhắc", async ({ page, context, baseURL, request }) => {
  await reset(request, MOCK_PIN_USER_ID);
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_PIN_USER_ID });
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/missions/parent") && r.method() === "POST") bodies.push(r.postDataJSON());
  });
  await page.goto("/");
  await listen(page, SOC);
  await listen(page, CUOI);
  await openParentWeek(page, MOCK_PIN);

  const week = page.getByTestId("parent-week");
  await expect(week.getByTestId("parent-proof-card")).toHaveCount(0);
  await expect(week.getByRole("heading", { name: "Tuần này bé nghe truyện 1 tối" })).toBeVisible();
  await expect(week.getByText("Việc tốt cho người khác chỉ được cảm ơn bằng lời, không đổi lấy sao.")).toBeVisible();
  await expect(week.getByText(/giỏi|thông minh|xuất sắc|liền|liên tục/)).toHaveCount(0);
  expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
  if (process.env.MISSIONS_QA === "1") await page.screenshot({ path: "/data/g06-e2e-week.png", fullPage: true });

  await week.getByRole("button", { name: "Bé đã làm hôm nay: Làm xong đúng giờ" }).click();
  await expect(page.getByText("Bé đã tự làm xong việc của mình đúng giờ, giống Su với chiếc đồng hồ cát!")).toBeVisible();
  await expect(week.locator('[data-habit="lam-dung-gio"]')).toContainText("Đã ghi nhận hôm nay");
  await week.getByRole("button", { name: "Ghi nhận: Giúp đỡ người khác" }).click();
  await expect(week.locator('[data-habit="giup-do"]')).toContainText("Đã cảm ơn bé hôm nay");

  await week.getByRole("button", { name: "Đánh dấu đã đọc cùng: Sóc Nhỏ tìm hạt dẻ" }).click();
  await expect(week.getByRole("img", { name: "Đã đọc cùng 1/3 truyện" })).toBeVisible();
  await expect(week.getByText("Hỏi bé: “Bạn thú trong truyện đã cảm thấy thế nào?”")).toBeVisible();

  const reminder = week.getByRole("switch", { name: "Nhắc bố mẹ mỗi tối" });
  await expect(reminder).toHaveAttribute("aria-checked", "false");
  await reminder.click();
  await expect(reminder).toHaveAttribute("aria-checked", "true");
  await week.getByRole("combobox").selectOption("20");
  await expect.poll(() => bodies.filter((b) => b.action === "notify").length).toBe(2);

  // Every write carried the PIN proof; nothing but taps (no text, no photo).
  expect(bodies.map((b) => b.action)).toEqual(["confirm", "confirm", "together", "notify", "notify"]);
  const proof = bodies[0].proof as string;
  expect(proof).toMatch(/^[0-9a-f]{64}$/);
  for (const b of bodies) expect(Object.keys(b).sort()).toEqual(Object.keys(b).filter((k) => ["action", "proof", "templateId", "sessionId", "enabled", "hour"].includes(k)).sort());
  // The proof never leaves page memory.
  const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie, location.href]));
  expect(stored).not.toContain(proof);
  expect((await context.cookies()).map((c) => c.value).join(" ")).not.toContain(proof);

  // The child sees it on Bầu trời: a habit with its star, a good deed with words only.
  await nav(page).getByRole("button", { name: "Trang chủ" }).click();
  await page.getByTestId("week-sky-chip").click();
  const habits = page.getByTestId("sky-habits");
  await expect(habits).toContainText("Làm xong đúng giờ");
  await expect(habits).toContainText("Cảm ơn bé đã giúp đỡ mọi người.");
  await expect(page.getByTestId("sky-family")).toContainText("Cả nhà đã đọc cùng nhau 1/3 truyện.");
  expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
  if (process.env.MISSIONS_QA === "1") await page.screenshot({ path: "/data/g06-e2e-sky.png", fullPage: true });
});

test("hết phiên PIN → mời nhập lại; nhập lại mở đúng Tuần của bé", async ({ page, context, baseURL, request }) => {
  await reset(request, MOCK_PIN_USER_ID);
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_PIN_USER_ID });
  await page.goto("/");
  await listen(page, SOC);
  await openParentWeek(page, MOCK_PIN);
  await page.route("**/api/missions/parent", (r) =>
    r.request().method() === "POST" ? r.fulfill({ status: 403, json: { error: "Cần nhập lại mã PIN phụ huynh", code: "parent_proof" } }) : r.continue(),
  );
  await page.getByRole("button", { name: "Bé đã làm hôm nay: Làm xong đúng giờ" }).click();
  await expect(page.getByText("Phiên mã PIN đã hết. Bố mẹ nhập lại mã PIN nhé.")).toBeVisible();
  const card = page.getByTestId("parent-proof-card");
  await expect(card).toBeVisible();
  await expect(page.getByRole("button", { name: "Bé đã làm hôm nay: Làm xong đúng giờ" })).toBeDisabled();
  await page.unroute("**/api/missions/parent");
  await card.getByRole("button", { name: "Nhập mã PIN" }).click();
  await passParentGate(page, MOCK_PIN);
  await expect(page.getByRole("heading", { level: 1, name: "Tuần của bé" })).toBeVisible();
  await expect(page.getByTestId("parent-proof-card")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Bé đã làm hôm nay: Làm xong đúng giờ" })).toBeEnabled();
});

test("chưa đặt PIN: xem được tuần nhưng không ghi nhận được, có lối đặt PIN", async ({ page, context, baseURL, request }) => {
  await reset(request, MOCK_AGE_USER_ID);
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_AGE_USER_ID });
  await page.goto("/");
  await openParentWeek(page);
  const card = page.getByTestId("parent-proof-card");
  await expect(card).toContainText("Đặt mã PIN để ghi nhận");
  await expect(page.getByRole("button", { name: "Ghi nhận: Giúp đỡ người khác" })).toBeDisabled();
  await expect(page.getByRole("switch", { name: "Nhắc bố mẹ mỗi tối" })).toBeDisabled();
  await card.getByRole("button", { name: "Đặt mã PIN" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Kiểm soát phụ huynh" })).toBeVisible();
});

test("chip Bầu trời không nháy chữ dự phòng khi đang tải", async ({ page, context, baseURL, request }) => {
  await reset(request, MOCK_AVATAR_USER_ID);
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_AVATAR_USER_ID });
  await page.goto("/");
  await listen(page, SOC);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/missions", async (r) => {
    await gate;
    await r.continue();
  });
  const seen: string[] = [];
  await page.exposeFunction("__chipText", (t: string) => void seen.push(t));
  await page.addInitScript(() => {
    const w = window as unknown as { __chipText: (t: string) => void };
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid="week-sky-chip"]');
      if (el) w.__chipText(el.textContent ?? "");
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.reload();
  const chip = page.getByTestId("week-sky-chip");
  await expect(chip.getByTestId("week-sky-chip-skeleton")).toBeVisible();
  await expect(chip).toHaveAttribute("aria-busy", "true");
  release();
  await expect(chip).toContainText("Tuần này");
  await expect(chip).toContainText("1 tối");
  await expect(chip).not.toHaveAttribute("aria-busy", "true");
  expect(seen.some((t) => t.includes("của Đóm"))).toBe(false);
});

// G-07: the reminder opens "Tuần của bé" — the service worker posts the URL to
// an open window (public/sw.js notificationclick) or opens it cold.
const swClick = (page: Page, url: string) =>
  page.evaluate((u) => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "NOTIFICATION_CLICK", url: u } })), url);

test("bấm lời nhắc khi app đang mở → cổng PIN → Tuần của bé; link lạ bị bỏ qua", async ({ page, context, baseURL, request }) => {
  await reset(request, MOCK_PIN_USER_ID);
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_PIN_USER_ID });
  await page.goto("/");
  await expect(page.getByTestId("home-explore")).toBeVisible();
  const gate = page.locator("[data-parent-gate]");
  await swClick(page, "https://evil.example/?screen=parent-week");
  await swClick(page, "/?screen=settings");
  await page.waitForTimeout(400);
  await expect(gate).toHaveCount(0);
  await expect(page.getByTestId("home-explore")).toBeVisible();
  await expect(async () => {
    await swClick(page, "/?screen=parent-week");
    await expect(gate).toBeVisible({ timeout: 1000 });
  }).toPass();
  await passParentGate(page, MOCK_PIN);
  await expect(page.getByRole("heading", { level: 1, name: "Tuần của bé" })).toBeVisible();
  await swClick(page, "/?screen=parent-week");
  await page.getByRole("button", { name: "Quay lại", exact: true }).click();
  await expect(page.getByTestId("home-explore")).toBeVisible();
});

test("mở lời nhắc khi app đang tắt → cổng PIN → Tuần của bé; Quay lại về Bố mẹ", async ({ page, context, baseURL, request }) => {
  await reset(request, MOCK_PIN_USER_ID);
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_PIN_USER_ID });
  await page.goto("/?screen=parent-week");
  await passParentGate(page, MOCK_PIN);
  await expect(page.getByRole("heading", { level: 1, name: "Tuần của bé" })).toBeVisible();
  await page.getByRole("button", { name: "Quay lại", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Bố mẹ", exact: true })).toBeVisible();
});

test("máy đã đăng xuất: mở lời nhắc → màn chào như thường (không 404, không mở màn bố mẹ); màn lạ vẫn 404", async ({ page }) => {
  expect((await page.goto("/?screen=parent-week"))?.status()).toBe(200);
  await expect(page.getByRole("button", { name: /Bắt đầu nào!/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Tuần của bé" })).toHaveCount(0);
  await expect(page.locator("[data-parent-gate]")).toHaveCount(0);
  expect((await page.goto("/?screen=khong-co"))?.status()).toBe(404);
});
