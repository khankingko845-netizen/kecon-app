import AxeBuilder from "@axe-core/playwright";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { signInAsMockFamily } from "./support/fixtures";

// PR #61 — Trình nghe thu gọn (MiniPlayer) on phones. Before this PR, at
// 360–412 px the mini player covered the whole tab bar (no tab could be
// tapped), stopped after one page, restarted the page when reopened, and
// "Nghe tiếp" opened page 1 of a story heard up to page 2.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const STORY = "Sóc Nhỏ tìm hạt dẻ";
const OTHER = "Chú Cuội và cây đa";

function wav(seconds: number) {
  const rate = 8000;
  const n = Math.round(rate * seconds);
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 600), 44 + i * 2);
  return b;
}

/** Signed-in family, daytime, narration of `seconds` per page; every media element is tracked. */
async function setup(page: Page, context: BrowserContext, baseURL: string, seconds: number) {
  await signInAsMockFamily(context, baseURL);
  await page.clock.setFixedTime(new Date("2025-06-02T10:00:00"));
  await page.addInitScript(() => {
    const w = window as unknown as { __media: HTMLMediaElement[]; __spoken: string[] };
    w.__media = [];
    w.__spoken = [];
    if ("speechSynthesis" in window) speechSynthesis.speak = (u: SpeechSynthesisUtterance) => void w.__spoken.push(u.text);
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement & { __kid?: number }) {
      if (!this.__kid) {
        w.__media.push(this);
        this.__kid = w.__media.length;
      }
      return play.call(this);
    };
  });
  await page.route("**/api/system/status", (r) => r.fulfill({ json: { hasElevenLabs: true, hasStoryProvider: true, elevenLabsModel: "eleven_multilingual_v2" } }));
  await page.route(/\/api\/voice\/defaults(?:\?.*)?$/, (r) =>
    r.fulfill({ json: { voices: [{ id: "defaultNew", voice_id: "newVietnamese", name: "Giọng Việt mới", language: "vi", sort_order: 0, is_active: true }] } }),
  );
  const clip = wav(seconds);
  await page.route("**/api/voice/tts", (r) => r.fulfill({ contentType: "audio/wav", body: clip }));
}

interface Media {
  id: number;
  time: number;
  paused: boolean;
}
/** Story narration elements (page-turn sounds live under /audio/ and are left out). */
const narration = (page: Page): Promise<Media[]> =>
  page.evaluate(() =>
    (window as unknown as { __media: (HTMLMediaElement & { __kid: number })[] }).__media
      .filter((m) => !m.src.includes("/audio/"))
      .map((m) => ({ id: m.__kid, time: m.currentTime, paused: m.paused || m.ended })),
  );
const audible = async (page: Page) => (await narration(page)).filter((m) => !m.paused);

async function listen(page: Page, title = STORY) {
  await page.getByText(title).first().click();
  await expect(page.getByTestId("story-book")).toBeVisible();
  await page.getByRole("button", { name: "Phát", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tạm dừng", exact: true })).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await audible(page)).length).toBe(1);
}

const back = (page: Page) => page.getByRole("button", { name: "Quay lại", exact: true }).click();
const slider = (page: Page) => page.getByRole("slider", { name: "Tiến độ" });

for (const [w, h] of [
  [360, 640],
  [375, 667],
  [412, 915],
] as const) {
  test(`${w}×${h}: trình nghe thu gọn nằm trên thanh tab — cả 5 tab vẫn bấm được, không che nội dung`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: w, height: h });
    await setup(page, context, baseURL!, 30);
    await page.goto("/");
    await listen(page);
    await back(page);
    const mini = page.getByTestId("mini-player");
    await expect(mini).toHaveAttribute("data-status", "playing");
    await expect(mini.getByRole("progressbar", { name: "Tiến độ trang 1" })).toBeAttached();
    if (process.env.MINI_QA_DIR) await page.screenshot({ path: `${process.env.MINI_QA_DIR}/${w}-home-mini.png` });

    const facts = await page.evaluate(() => {
      const mini = document.querySelector('[data-testid="mini-player"]')!.getBoundingClientRect();
      const nav = document.querySelector('nav[aria-label="Điều hướng chính"]')!;
      const tabs = [...nav.querySelectorAll("button")].map((b) => {
        const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { label: b.textContent?.trim(), top: Math.round(r.top), tappable: !!hit && b.contains(hit) };
      });
      const controls = [...document.querySelectorAll('[data-testid="mini-player"] button')].map((b) => {
        const r = b.getBoundingClientRect();
        return { label: b.getAttribute("aria-label"), w: Math.round(r.width), h: Math.round(r.height) };
      });
      return { miniTop: mini.top, miniBottom: mini.bottom, navBottom: nav.getBoundingClientRect().bottom, vh: innerHeight, tabs, controls };
    });
    expect(facts.tabs.map((t) => t.label)).toEqual(["Trang chủ", "Thư viện", "Tạo", "Giọng đọc", "Bố mẹ"]);
    for (const t of facts.tabs) expect(t.tappable, `tab "${t.label}" bấm được`).toBe(true);
    expect(facts.miniBottom, "thẻ nằm trên nút Tạo nhô lên").toBeLessThanOrEqual(Math.min(...facts.tabs.map((t) => t.top)));
    expect(Math.round(facts.navBottom)).toBe(facts.vh);
    for (const c of facts.controls) expect(Math.min(c.w, c.h), `${c.label} ≥ 44px`).toBeGreaterThanOrEqual(44);

    // Scrolled to the end, the last row of Home sits above the dock (spacer).
    // Rows below the fold render/load as they come into view: scroll until the page stops growing.
    let height = -1;
    for (let i = 0; i < 10; i++) {
      const h2 = await page.evaluate(() => {
        scrollTo(0, document.scrollingElement!.scrollHeight);
        return document.scrollingElement!.scrollHeight;
      });
      if (h2 === height) break;
      height = h2;
      await page.waitForTimeout(500);
    }
    expect(await page.evaluate(() => Math.ceil(scrollY + innerHeight) >= document.scrollingElement!.scrollHeight - 1)).toBe(true);
    const hidden = await page.evaluate(() => {
      const top = document.querySelector('[data-testid="mini-player"]')!.getBoundingClientRect().top;
      return [...document.querySelectorAll("main button, main a")]
        .filter((e) => {
          const q = e.getBoundingClientRect();
          return q.height > 0 && q.bottom > top + 1 && q.top < innerHeight;
        })
        .map((e) => (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 40));
    });
    expect(hidden).toEqual([]);

    // Every tab still works with the story playing.
    await page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("button", { name: "Thư viện" }).click();
    await expect(page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("button", { name: "Thư viện" })).toHaveAttribute("aria-current", "page");
    await expect(mini).toHaveAttribute("data-status", "playing");
    if (w === 360) {
      expect((await new AxeBuilder({ page }).include('[data-testid="bottom-dock"]').withTags(TAGS).analyze()).violations).toEqual([]);
    }
    if (process.env.MINI_QA_DIR) await page.screenshot({ path: `${process.env.MINI_QA_DIR}/${w}-library-mini.png` });
  });
}

test("bấm vào trình nghe thu gọn → mở lại đúng trang, giọng đọc chạy tiếp (không phát lại từ đầu)", async ({ page, context, baseURL }) => {
  await setup(page, context, baseURL!, 30);
  await page.goto("/");
  await listen(page);
  await page.waitForTimeout(1200);
  const [inPlayer] = await audible(page);
  await back(page);
  const mini = page.getByTestId("mini-player");
  await expect(mini).toHaveAttribute("data-status", "playing");
  await page.waitForTimeout(800);
  const inMini = await audible(page);
  expect(inMini).toEqual([expect.objectContaining({ id: inPlayer.id })]); // the very same element
  expect(inMini[0].time).toBeGreaterThan(inPlayer.time);

  // Pause / resume in the mini player keeps the place in the page.
  await mini.getByRole("button", { name: "Tạm dừng" }).click();
  await expect(mini).toHaveAttribute("data-status", "paused");
  const paused = (await narration(page)).find((m) => m.id === inPlayer.id)!;
  expect(paused.paused).toBe(true);
  await mini.getByRole("button", { name: "Nghe tiếp" }).click();
  await expect(mini).toHaveAttribute("data-status", "playing");
  const resumed = await audible(page);
  expect(resumed).toEqual([expect.objectContaining({ id: inPlayer.id })]);
  expect(resumed[0].time).toBeGreaterThanOrEqual(paused.time);

  await mini.getByRole("button", { name: `Mở trình nghe: ${STORY}, trang 1/2` }).click();
  await expect(page.getByTestId("story-book")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tạm dừng", exact: true })).toBeVisible();
  await expect(slider(page)).toHaveAttribute("aria-valuetext", /trang 1\/2$/);
  await expect(page.getByTestId("mini-player")).toHaveCount(0);
  const reopened = await audible(page);
  expect(reopened).toEqual([expect.objectContaining({ id: inPlayer.id })]);
  expect(reopened[0].time).toBeGreaterThanOrEqual(resumed[0].time);

  // Pause / resume in the full player keeps the place too (was: the page restarted).
  await page.getByRole("button", { name: "Tạm dừng", exact: true }).click();
  await expect(page.getByRole("button", { name: "Phát", exact: true })).toBeVisible();
  const held = (await narration(page)).find((m) => m.id === inPlayer.id)!;
  expect(held.paused).toBe(true);
  await page.getByRole("button", { name: "Phát", exact: true }).click();
  await expect.poll(async () => (await audible(page)).map((m) => m.id)).toEqual([inPlayer.id]);
  expect((await audible(page))[0].time).toBeGreaterThanOrEqual(held.time);
});

test("rời trình nghe khi đang đọc → tự sang trang sau tới hết truyện, rồi được ghi sao như trình nghe đầy đủ", async ({ page, context, baseURL }) => {
  await setup(page, context, baseURL!, 1.5);
  const calls: { action: string; sessionId?: string; storyId?: string }[] = [];
  await page.route("**/api/missions/listen", async (r) => {
    const body = r.request().postDataJSON();
    calls.push(body);
    if (body.action === "start") return r.fulfill({ json: { session_id: `sess-${calls.length}`, min_seconds: 0 } });
    return r.fulfill({ json: { counted: true, completed: ["nghe-het-truyen"], sticker: null, milestone: null, today: null } });
  });
  await page.goto("/");
  await listen(page);
  await back(page);
  const mini = page.getByTestId("mini-player");
  await expect(mini).toContainText("Trang 1/2");
  await expect(mini).toContainText(/Sang trang 2…|Trang 2\/2/, { timeout: 10_000 });
  await expect(mini).toContainText("Trang 2/2", { timeout: 10_000 });
  await expect(mini.getByRole("button", { name: "Trang sau" })).toBeDisabled();
  await expect(mini).toHaveAttribute("data-status", "ended", { timeout: 10_000 });
  await expect(mini).toContainText("Hết truyện rồi!");
  const card = page.getByTestId("mission-celebration");
  await expect(card).toBeVisible();
  await expect(card).toContainText("+1");
  const started = calls.find((c) => c.action === "start");
  expect(calls.filter((c) => c.action === "complete")).toEqual([{ action: "complete", sessionId: started && `sess-${calls.indexOf(started) + 1}` }]);
  // The celebration sits above the mini player; the tab bar stays free.
  const [cardBox, miniBox, navBox] = await Promise.all([card.boundingBox(), mini.boundingBox(), page.getByRole("navigation", { name: "Điều hướng chính" }).boundingBox()]);
  expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(miniBox!.y + 1);
  expect(miniBox!.y + miniBox!.height).toBeLessThanOrEqual(navBox!.y);
  if (process.env.MINI_QA_DIR) await page.screenshot({ path: `${process.env.MINI_QA_DIR}/ended-celebration.png` });
  await card.getByRole("button", { name: "Đóng" }).click();
  await expect(card).toHaveCount(0);

  // "Nghe tiếp" on Home followed the mini player to page 2.
  await expect(page.getByRole("button", { name: `Nghe tiếp ${STORY}` })).toBeVisible();
  await expect(page.locator("main")).toContainText("Trang 2/2");
  await mini.getByRole("button", { name: "Nghe lại từ đầu" }).click();
  await expect(mini).toContainText("Trang 1/2");
  await expect(mini).toHaveAttribute("data-status", "playing");
});

test("Nghe tiếp mở đúng trang đã nghe tới (không về trang 1)", async ({ page, context, baseURL }) => {
  await setup(page, context, baseURL!, 30);
  await page.goto("/");
  await page.getByText(STORY).first().click();
  await expect(page.getByTestId("story-book")).toBeVisible();
  await page.getByRole("button", { name: "Trang sau", exact: true }).click();
  await expect(slider(page)).toHaveAttribute("aria-valuetext", "Trang 2/2");
  await back(page);
  await expect(page.locator("main")).toContainText("Trang 2/2");
  await page.getByRole("button", { name: `Nghe tiếp ${STORY}` }).click();
  await expect(page.getByTestId("story-book")).toBeVisible();
  await expect(slider(page)).toHaveAttribute("aria-valuetext", "Trang 2/2");
});

test("mở truyện khác hoặc vào Tạo khi trình nghe thu gọn đang đọc → không bao giờ hai giọng cùng lúc", async ({ page, context, baseURL }) => {
  await setup(page, context, baseURL!, 30);
  await page.goto("/");
  await listen(page);
  const [first] = await audible(page);
  await back(page);
  const mini = page.getByTestId("mini-player");
  await expect(mini).toHaveAttribute("data-status", "playing");

  // Tạo is a full-screen task (own sounds, microphone): the story pauses there.
  await page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("button", { name: "Tạo" }).click();
  await expect.poll(async () => (await audible(page)).length).toBe(0);
  await back(page);
  await expect(mini).toHaveAttribute("data-status", "paused");
  await mini.getByRole("button", { name: "Nghe tiếp" }).click();
  await expect.poll(async () => (await audible(page)).map((m) => m.id)).toEqual([first.id]);

  // Another story: the first one stops as soon as its player opens.
  await page.getByText(OTHER).first().click();
  await expect(page.getByTestId("story-book")).toBeVisible();
  await expect.poll(async () => (await audible(page)).length).toBe(0);
  await page.getByRole("button", { name: "Phát", exact: true }).click();
  await expect.poll(async () => (await audible(page)).length).toBe(1);
  const [second] = await audible(page);
  expect(second.id).not.toBe(first.id);
  await back(page);
  await expect(mini).toContainText(OTHER);
  await expect(mini).toHaveAttribute("data-status", "playing");
  await page.waitForTimeout(500);
  expect((await audible(page)).map((m) => m.id)).toEqual([second.id]);

  // Closing the mini player silences the story.
  await mini.getByRole("button", { name: "Tắt trình phát" }).click();
  await expect(page.getByTestId("mini-player")).toHaveCount(0);
  await expect(page.getByTestId("mini-player-spacer")).toHaveCount(0);
  await expect.poll(async () => (await audible(page)).length).toBe(0);
});
