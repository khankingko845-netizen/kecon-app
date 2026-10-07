import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { signInAsMockFamily, MOCK_VOICE_USER_ID } from "./support/fixtures";
const defaults = [
  {
    id: "defaultNew",
    voice_id: "newVietnamese",
    name: "Giọng Việt mới",
    language: "vi",
    sort_order: 0,
    is_active: true,
  },
];
const wav = Buffer.alloc(1644);
wav.write("RIFF");
wav.writeUInt32LE(1636, 4);
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
test("new selected narrator survives reload; legacy caches/character voices never leak into play or merge", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_VOICE_USER_ID });
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {};
  });
  await page.route("**/api/system/status", (r) =>
    r.fulfill({
      json: {
        hasElevenLabs: true,
        hasStoryProvider: true,
        elevenLabsModel: "eleven_multilingual_v2",
      },
    }),
  );
  await page.route(/\/api\/voice\/defaults(?:\?.*)?$/, (r) =>
    r.fulfill({ json: { voices: defaults } }),
  );
  const bodies: Record<string, unknown>[] = [];
  let oldFetched = 0;
  let remembered: string | null = null;
  await page.route("**/rest/v1/stories?*", async (r) => {
    if (r.request().method() === "PATCH") {
      remembered = r.request().postDataJSON().last_voice_id;
      return r.fulfill({ status: 204 });
    }
    const response = await r.fetch();
    const data = await response.json();
    const change = (s: Record<string, unknown>) => ({
      ...s,
      last_voice_id: remembered,
      last_voice_name: remembered ? "Giọng Việt mới" : null,
    });
    return r.fulfill({
      response,
      json: Array.isArray(data) ? data.map(change) : change(data),
    });
  });
  await page.route("**/rest/v1/story_characters?*", (r) =>
    r.fulfill({
      json: [
        {
          name: "Thỏ",
          voice_id: "oldCharacter",
          voice_name: "Giọng nhân vật cũ",
        },
      ],
    }),
  );
  await page.route("**/rest/v1/story_pages?*", async (r) => {
    if (r.request().method() !== "GET") return r.fulfill({ status: 204 });
    const response = await r.fetch();
    let d = await response.json();
    if (Array.isArray(d))
      d = d.map((p) => ({
        ...p,
        content:
          "[narrator]Xin chào bé.[/narrator][character:Thỏ]Cùng chơi nào![/character]",
        audio_url: baseURL + "/oldVoice.mp3",
        audio_key: null,
      }));
    return r.fulfill({ response, json: d });
  });
  await page.route("**/oldVoice.mp3", (r) => {
    oldFetched++;
    return r.fulfill({ contentType: "audio/wav", body: wav });
  });
  await page.route("**/api/voice/tts", (r) => {
    bodies.push(r.request().postDataJSON());
    return r.fulfill({ contentType: "audio/wav", body: wav });
  });
  await page.goto("/");
  await page.getByText("Sóc Nhỏ tìm hạt dẻ").first().click();
  await page.getByRole("button", { name: /^Giọng:/ }).click();
  await page
    .getByRole("button", { name: "⭐ Giọng Việt mới", exact: true })
    .click();
  await expect(page.getByRole("button", { name: /^Giọng:/ })).toContainText(
    "Giọng Việt mới",
  );
  await page.getByRole("button", { name: "Phát", exact: true }).click();
  await expect.poll(() => bodies.length).toBeGreaterThan(0);
  await page.waitForTimeout(800);
  expect(
    bodies.every(
      (b) =>
        b.voiceId === "newVietnamese" &&
        b.language === "vi" &&
        !String(b.text).includes("[character"),
    ),
  ).toBe(true);
  expect(oldFetched).toBe(0);
  await page.reload();
  await page.getByText("Sóc Nhỏ tìm hạt dẻ").first().click();
  await expect(page.getByRole("button", { name: /^Giọng:/ })).toContainText(
    "Giọng Việt mới",
  );
  await page.getByRole("button", { name: "Phát", exact: true }).click();
  await page.waitForTimeout(500);
  expect(bodies.every((b) => b.voiceId === "newVietnamese")).toBe(true);
  expect(oldFetched).toBe(0);
  await page.getByRole("button", { name: "Âm nền", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Âm nền theo bối cảnh/ }),
  ).toContainText("TẮT");
  await page.getByRole("button",{name:/Âm nền theo bối cảnh/}).click();
  await page.getByRole("button",{name:"Mưa",exact:true}).click();
  await page.getByLabel("Âm lượng Mưa",{exact:true}).fill("0.3");
  const axe=await new AxeBuilder({page}).include('[aria-label="Trộn âm thanh"]').withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"]).analyze();expect(axe.violations).toEqual([]);
  if (process.env.VOICE_FIX_QA === "1")
    await page.screenshot({
      path: "/data/voice-fix-player.png",
      fullPage: true,
    });
});
