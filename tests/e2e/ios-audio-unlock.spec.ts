import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { signInAsMockFamily } from "./support/fixtures";

// iPhone/iPad: "NotAllowedError: The request is not allowed by the user agent or
// the platform in the current context…" under the player instead of the story.
// Every browser on iOS is WebKit, and WebKit lets script start an <audio> only if
// that very element was already started inside a tap. The player made a new
// Audio() per page, after awaits (voice synthesis), so page 1, the next page, the
// MiniPlayer and voice previews were refused — and the raw English text shown.
// Chromium has no such rule: it is emulated below, with WebKit's own error.
const STORY = "Sóc Nhỏ tìm hạt dẻ";
const WEBKIT_REFUSAL = "The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.";

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

interface IOS {
  /** Refuse every play(), even inside a tap (e.g. a start that never had a tap). */
  blockAll: boolean;
  /** Narration/sample sources refused (page-turn sounds under /audio/ left out). */
  refused: string[];
  /** Sources that really started (the unlock's silent data: URL left out). */
  played: string[];
}

/** WebKit's media rule on Chromium: play() from script only on an element already started inside a tap. */
async function emulateIPhoneAudio(page: Page, refusal: string) {
  await page.addInitScript((text: string) => {
    const ios: IOS & { gesture: boolean } = { gesture: false, blockAll: false, refused: [], played: [] };
    const w = window as unknown as { __ios: typeof ios; __media: HTMLMediaElement[] };
    w.__ios = ios;
    w.__media = [];
    if ("speechSynthesis" in window) speechSynthesis.speak = () => {};
    // A tap is "being handled" while its events are dispatched (and their microtasks run).
    let clear: ReturnType<typeof setTimeout> | undefined;
    const gesture = () => {
      ios.gesture = true;
      clearTimeout(clear);
      clear = setTimeout(() => {
        ios.gesture = false;
      }, 0);
    };
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "touchend", "keydown", "keyup"]) window.addEventListener(type, gesture, true);
    const allowed = new WeakSet<HTMLMediaElement>();
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const sound = this.src.includes("/audio/");
      if (!w.__media.includes(this)) w.__media.push(this);
      if (!ios.blockAll && (ios.gesture || allowed.has(this))) {
        allowed.add(this);
        if (!sound && !this.src.startsWith("data:")) ios.played.push(this.src);
        return play.call(this);
      }
      if (!sound) ios.refused.push(this.src);
      return Promise.reject(new DOMException(text, "NotAllowedError"));
    };
  }, refusal);
}

async function setup(page: Page, context: BrowserContext, baseURL: string, seconds: number) {
  await signInAsMockFamily(context, baseURL);
  await page.clock.setFixedTime(new Date("2025-06-02T10:00:00"));
  await emulateIPhoneAudio(page, WEBKIT_REFUSAL);
  await page.route("**/api/system/status", (r) => r.fulfill({ json: { hasElevenLabs: true, hasStoryProvider: true, elevenLabsModel: "eleven_multilingual_v2" } }));
  await page.route(/\/api\/voice\/defaults(?:\?.*)?$/, (r) =>
    r.fulfill({ json: { voices: [{ id: "defaultNew", voice_id: "newVietnamese", name: "Giọng Việt mới", language: "vi", sort_order: 0, is_active: true }] } }),
  );
  const clip = wav(seconds);
  await page.route("**/api/voice/tts", (r) => r.fulfill({ contentType: "audio/wav", body: clip }));
  await page.route("**/api/voice/preview", (r) => r.fulfill({ contentType: "audio/wav", body: clip }));
  // Stars/missions are covered elsewhere: leave the shared mock's mission state untouched.
  await page.route("**/api/missions/listen", (r) => r.fulfill({ json: {} }));
}

const ios = (page: Page) => page.evaluate(() => (window as unknown as { __ios: IOS }).__ios);
/** Narration elements that are sounding now (page-turn sounds under /audio/ left out). */
const audible = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __media: HTMLMediaElement[] }).__media.filter((m) => !m.src.includes("/audio/") && !m.src.startsWith("data:") && !m.paused && !m.ended).length,
  );
const slider = (page: Page) => page.getByRole("slider", { name: "Tiến độ" });

async function openStory(page: Page) {
  await page.goto("/");
  await page.getByText(STORY).first().click();
  await expect(page.getByTestId("story-book")).toBeVisible();
}

/** The player's message line (Next's empty route announcer is an alert too). */
const playerAlert = (page: Page) => page.locator('p[role="alert"]');

/** Nowhere does the page show the browser's English error. */
async function noRawError(page: Page) {
  const text = await page.locator("body").innerText();
  expect(text).not.toContain("not allowed");
  expect(text).not.toContain("NotAllowedError");
}

test("iPhone: một lần chạm Phát → đọc trang 1 rồi tự sang trang 2 tới hết truyện, không báo lỗi", async ({ page, context, baseURL }) => {
  await setup(page, context, baseURL!, 1.5);
  await openStory(page);
  await page.getByRole("button", { name: "Phát", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tạm dừng", exact: true })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => audible(page)).toBe(1);
  // Page 2 starts on its own — no second tap — and its narration really plays.
  await expect(slider(page)).toHaveAttribute("aria-valuetext", "Trang 2/2", { timeout: 15_000 });
  await expect.poll(async () => new Set((await ios(page)).played).size, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  if (process.env.IOS_QA_DIR) await page.screenshot({ path: `${process.env.IOS_QA_DIR}/page-2-playing.png` });
  // …to the end of the story.
  await expect(page.getByRole("button", { name: "Phát", exact: true })).toBeVisible({ timeout: 15_000 });
  expect((await ios(page)).refused).toEqual([]);
  await expect(playerAlert(page)).toHaveCount(0);
  await noRawError(page);
});

test("iPhone: rời trình nghe khi đang đọc → trình nghe thu gọn tự sang trang 2 tới hết truyện", async ({ page, context, baseURL }) => {
  await setup(page, context, baseURL!, 1.5);
  await openStory(page);
  await page.getByRole("button", { name: "Phát", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tạm dừng", exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Quay lại", exact: true }).click();
  const mini = page.getByTestId("mini-player");
  await expect(mini).toHaveAttribute("data-status", "playing");
  await expect(mini).toContainText("Trang 2/2", { timeout: 15_000 });
  await expect(mini).toHaveAttribute("data-status", "ended", { timeout: 15_000 });
  const { refused, played } = await ios(page);
  expect(refused).toEqual([]);
  expect(new Set(played).size).toBeGreaterThanOrEqual(2);
});

test("iPhone: trình duyệt chặn lần phát đầu → 'Bấm ▶ để nghe nhé.' (không hiện chữ tiếng Anh); chạm ▶ → đọc", async ({ page, context, baseURL }) => {
  await setup(page, context, baseURL!, 30);
  await openStory(page);
  await page.evaluate(() => {
    (window as unknown as { __ios: IOS }).__ios.blockAll = true;
  });
  await page.getByRole("button", { name: "Phát", exact: true }).click();
  await expect(playerAlert(page)).toHaveText("Bấm ▶ để nghe nhé.", { timeout: 10_000 });
  await noRawError(page);
  if (process.env.IOS_QA_DIR) await page.screenshot({ path: `${process.env.IOS_QA_DIR}/blocked-hint.png` });
  expect((await ios(page)).refused.length).toBeGreaterThan(0);
  // The next tap is a real one: the page that was ready plays.
  await page.evaluate(() => {
    (window as unknown as { __ios: IOS }).__ios.blockAll = false;
  });
  await page.getByRole("button", { name: "Phát", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tạm dừng", exact: true })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => audible(page)).toBe(1);
  await expect(playerAlert(page)).toHaveCount(0);
});

test("iPhone: Nghe thử giọng trong trình nghe → phát được mẫu giọng, không báo lỗi", async ({ page, context, baseURL }) => {
  await setup(page, context, baseURL!, 2);
  await openStory(page);
  await page.getByRole("button", { name: /^Giọng: / }).click();
  await page.getByRole("button", { name: "Nghe thử: Giọng Việt mới", exact: true }).click();
  await expect(page.getByRole("button", { name: "Dừng nghe thử: Giọng Việt mới", exact: true })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => audible(page)).toBe(1);
  expect((await ios(page)).refused).toEqual([]);
  await expect(playerAlert(page)).toHaveCount(0);
  await noRawError(page);
});
