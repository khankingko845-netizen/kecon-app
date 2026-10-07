import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  MOCK_ADMIN_USER_ID,
  MOCK_VOICE_USER_ID,
  signInAsMockFamily,
} from "./support/fixtures";
const defaults = [
  {
    id: "00000000-0000-4000-8000-00000000ee01",
    voice_id: "previewVi",
    name: "Đóm Tiếng Việt",
    language: "vi",
    sort_order: 0,
    is_active: true,
  },
  {
    id: "00000000-0000-4000-8000-00000000ee02",
    voice_id: "previewEn",
    name: "Đóm English",
    language: "en",
    sort_order: 0,
    is_active: true,
  },
];
async function fakeAudio(page: Page) {
  await page.addInitScript(() => {
    const stats = { starts: 0, pauses: 0 };
    Object.assign(window, { __previewStats: stats });
    HTMLMediaElement.prototype.play = function () {
      stats.starts++;
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      stats.pauses++;
    };
  });
}
const wav = Buffer.alloc(44 + 1600);
wav.write("RIFF", 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(1600, 40);
const stats = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __previewStats: { starts: number; pauses: number };
        }
      ).__previewStats,
  );

test("Admin audition before add, stop on close/error, toggle persists without delete", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_ADMIN_USER_ID });
  await fakeAudio(page);
  let current = defaults.map((v) => ({ ...v }));
  let deletes = 0;
  const samples: Record<string, unknown>[] = [];
  await page.route(/\/api\/voice\/defaults(?:\?.*)?$/, async (r) => {
    const method = r.request().method();
    if (method === "DELETE") deletes++;
    if (method === "PATCH") {
      const b = r.request().postDataJSON();
      current = current.map((v) =>
        v.id === b.id ? { ...v, is_active: b.is_active } : v,
      );
      return r.fulfill({ json: { voice: current.find((v) => v.id === b.id) } });
    }
    return r.fulfill({ json: { voices: current } });
  });
  await page.route("**/api/admin/voice-catalog?*", (r) =>
    r.fulfill({
      json: {
        voices: [
          {
            voice_id: "libraryVi",
            name: "Giọng thư viện",
            category: "professional",
            source: "library",
            language: "vi",
          },
        ],
        warnings: [],
      },
    }),
  );
  await page.route("**/api/voice/preview", (r) => {
    samples.push(r.request().postDataJSON());
    return r.fulfill({ contentType: "audio/wav", body: wav });
  });
  await page.goto("/admin/settings");
  await page
    .getByRole("button", { name: "Thêm giọng vi", exact: true })
    .click();
  const modal = page.getByRole("dialog", { name: "Chọn giọng theo ngôn ngữ" });
  await modal
    .getByRole("button", { name: "Nghe thử: Giọng thư viện", exact: true })
    .click();
  await expect(
    modal.getByRole("button", {
      name: "Dừng nghe thử: Giọng thư viện",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(samples).toEqual([{ voiceId: "libraryVi", language: "vi" }]);
  await modal
    .getByRole("button", { name: "Dừng nghe thử: Giọng thư viện", exact: true })
    .click();
  await modal
    .getByRole("button", { name: "Nghe thử: Giọng thư viện", exact: true })
    .click();
  expect(samples).toHaveLength(1);
  await page.evaluate(() =>
    document.documentElement.classList.add("dark", "night"),
  );
  const a11y = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  if (process.env.NEXT_VISUAL_QA === "1")
    await page.screenshot({ path: "/data/voice-preview-admin-night.png" });
  const pauses = (await stats(page)).pauses;
  await modal.getByRole("button", { name: "Đóng chọn giọng" }).click();
  expect((await stats(page)).pauses).toBeGreaterThan(pauses);
  const toggle = page.getByRole("switch", {
    name: "Bật giọng: Đóm Tiếng Việt",
    exact: true,
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(
    page.getByText("Đã tắt · Đóm Tiếng Việt", { exact: true }),
  ).toBeVisible();
  expect(current[0].sort_order).toBe(0);
  expect(deletes).toBe(0);
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.unroute("**/api/voice/preview");
  await page.route("**/api/voice/preview", (r) =>
    r.fulfill({ status: 402, json: { error: "Hết hạn mức nghe thử" } }),
  );
  await page
    .getByRole("button", { name: "Nghe thử: Đóm Tiếng Việt", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Hết hạn mức nghe thử" }),
  ).toBeVisible();
});

test("User family/default auditions, per-family toggle, silent reading survives reload", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_VOICE_USER_ID });
  await fakeAudio(page);
  let active = true;
  const samples: Record<string, unknown>[] = [];
  await page.route("**/rest/v1/voice_profiles?*", async (r) => {
    if (r.request().method() === "PATCH") {
      const b = r.request().postDataJSON();
      if ("is_active" in b) active = b.is_active;
      return r.fulfill({ status: 204 });
    }
    const response = await r.fetch();
    let rows = await response.json();
    if (Array.isArray(rows))
      rows = rows
        .map((v) => ({ ...v, is_active: active, quality_score: 91 }))
        .filter(
          () => !r.request().url().includes("is_active=eq.true") || active,
        );
    await r.fulfill({ response, json: rows });
  });
  await page.route(/\/api\/voice\/defaults(?:\?.*)?$/, (r) =>
    r.fulfill({ json: { voices: defaults } }),
  );
  await page.route("**/api/voice/preview", (r) => {
    samples.push(r.request().postDataJSON());
    return r.fulfill({ contentType: "audio/wav", body: wav });
  });
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Điều hướng chính" })
    .getByRole("button", { name: "Giọng đọc", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Nghe thử: Bà của bé", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Dừng nghe thử: Bà của bé", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Nghe thử: Đóm Tiếng Việt", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Nghe thử: Bà của bé", exact: true }),
  ).toBeVisible();
  expect(samples.map((v) => v.voiceId)).toEqual(["familyGrandma", "previewVi"]);
  await expect(
    page.getByRole("button", { name: "Nghe thử: Đóm English", exact: true }),
  ).toHaveCount(0);
  const familySwitch = page.getByRole("switch", {
    name: "Bật giọng: Bà của bé",
    exact: true,
  });
  await familySwitch.click();
  await expect(familySwitch).toHaveAttribute("aria-checked", "false");
  expect(active).toBe(false);
  const narration = page.getByRole("switch", {
    name: "Giọng đọc truyện",
    exact: true,
  });
  await narration.click();
  await expect(narration).toHaveAttribute("aria-checked", "false");
  await page
    .getByRole("button", { name: "Nghe thử: Bà của bé", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Dừng nghe thử: Bà của bé", exact: true }),
  ).toBeVisible();
  if (process.env.NEXT_VISUAL_QA === "1") {
    await page.waitForTimeout(4500);
    await page.screenshot({
      path: "/data/voice-preview-user-day.png",
      fullPage: true,
    });
  }
  await page.reload();
  await page
    .getByRole("navigation", { name: "Điều hướng chính" })
    .getByRole("button", { name: "Giọng đọc", exact: true })
    .click();
  await expect(narration).toHaveAttribute("aria-checked", "false");
  await expect(familySwitch).toHaveAttribute("aria-checked", "false");
  await familySwitch.click();
  await expect(familySwitch).toHaveAttribute("aria-checked", "true");
  await page
    .getByRole("navigation", { name: "Điều hướng chính" })
    .getByRole("button", { name: "Trang chủ", exact: true })
    .click();
  await page.getByText("Sóc Nhỏ tìm hạt dẻ").first().click();
  await expect(
    page.getByRole("button", { name: "Phát", exact: true }),
  ).toBeDisabled();
  await expect(narration).toHaveAttribute("aria-checked", "false");
  await narration.click();
  await expect(
    page.getByRole("button", { name: "Phát", exact: true }),
  ).toBeEnabled();
});

test("Player off during pending TTS cannot start late audio; audition does not select voice", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_VOICE_USER_ID });
  await fakeAudio(page);
  await page.route(/\/api\/voice\/defaults(?:\?.*)?$/, (r) =>
    r.fulfill({ json: { voices: defaults } }),
  );
  await page.route("**/api/system/status", (r) =>
    r.fulfill({ json: { hasElevenLabs: true, hasStoryProvider: true } }),
  );
  await page.route("**/rest/v1/story_pages?*", async (r) => {
    const response = await r.fetch();
    let d = await response.json();
    if (Array.isArray(d)) d = d.map((p) => ({ ...p, audio_url: null }));
    await r.fulfill({ response, json: d });
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ttsCalls = 0;
  await page.route("**/api/voice/tts", async (r) => {
    ttsCalls++;
    await gate;
    await r.fulfill({ contentType: "audio/wav", body: wav }).catch(() => {});
  });
  await page.route("**/api/voice/preview", (r) =>
    r.fulfill({ contentType: "audio/wav", body: wav }),
  );
  await page.goto("/");
  await page.getByText("Sóc Nhỏ tìm hạt dẻ").first().click();
  await page
    .getByRole("button", { name: "Giọng: 🎙️ Bà của bé", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Nghe thử: Đóm Tiếng Việt", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Giọng: 🎙️ Bà của bé", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Phát", exact: true }).click();
  await expect.poll(() => ttsCalls).toBe(1);
  const before = (await stats(page)).starts;
  await page
    .getByRole("switch", { name: "Giọng đọc truyện", exact: true })
    .click();
  release();
  await expect(
    page.getByRole("button", { name: "Phát", exact: true }),
  ).toBeDisabled();
  await page.waitForTimeout(500);
  expect((await stats(page)).starts).toBe(before);
  expect(ttsCalls).toBe(1);
  if (process.env.NEXT_VISUAL_QA === "1") {
    await page.waitForTimeout(4500);
    await page.screenshot({
      path: "/data/voice-preview-player.png",
      fullPage: true,
    });
  }
});
