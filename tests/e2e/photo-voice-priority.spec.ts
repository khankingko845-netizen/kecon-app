import { expect, test } from "@playwright/test";
import sharp from "sharp";
import {
  MOCK_PHOTO_USER_ID,
  MOCK_VOICE_USER_ID,
  MOCK_ADMIN_USER_ID,
  mockAccessToken,
  passParentGate,
  signInAsMockFamily,
} from "./support/fixtures";
const defaults = [
  {
    id: "00000000-0000-4000-8000-00000000dd01",
    voice_id: "defaultViA",
    name: "Vi A",
    language: "vi",
    sort_order: 0,
    is_active: true,
  },
  {
    id: "00000000-0000-4000-8000-00000000dd02",
    voice_id: "defaultViB",
    name: "Vi B",
    language: "vi",
    sort_order: 1,
    is_active: true,
  },
  {
    id: "00000000-0000-4000-8000-00000000dd03",
    voice_id: "defaultEn",
    name: "English A",
    language: "en",
    sort_order: 0,
    is_active: true,
  },
  {
    id: "00000000-0000-4000-8000-00000000dd04",
    voice_id: "defaultJa",
    name: "Japanese A",
    language: "ja",
    sort_order: 0,
    is_active: true,
  },
];
test("Ảnh riêng: xem nháp, lỗi lưu dọn ảnh, lưu/tải lại, chặn nhà khác, đổi Đóm", async ({
  page,
  context,
  request,
  browser,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const headers = {
    Authorization: `Bearer ${mockAccessToken(MOCK_PHOTO_USER_ID)}`,
  };
  const profileUrl = `http://127.0.0.1:54321/rest/v1/profiles?id=eq.${MOCK_PHOTO_USER_ID}`;
  await request.patch(profileUrl, {
    headers,
    data: { avatar_url: null, avatar_emoji: null },
  });
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_PHOTO_USER_ID });
  await page.goto("/");
  await page.getByRole("button", { name: "Hồ sơ của bé" }).click();
  await passParentGate(page);
  const portrait = page
    .getByRole("region", { name: "Ảnh đại diện gia đình" })
    .locator("[data-family-avatar]")
    .first();
  const photo = await sharp({
    create: { width: 700, height: 500, channels: 3, background: "#b4daca" },
  })
    .jpeg()
    .toBuffer();
  const input = page.getByLabel("Tải ảnh gia đình");
  await input.setInputFiles({
    name: "bad.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg/>"),
  });
  await expect(page.getByTestId("photo-error")).toContainText("JPG");
  await input.setInputFiles({
    name: "family.jpg",
    mimeType: "image/jpeg",
    buffer: photo,
  });
  await expect(portrait).toHaveAttribute("data-family-avatar", "custom");
  expect(
    (await (await request.get(profileUrl, { headers })).json())[0].avatar_url,
  ).toBeNull();
  await page.route("**/rest/v1/profiles?*", async (r) => {
    if (r.request().method() === "PATCH")
      await r.fulfill({ status: 500, json: { message: "test save failure" } });
    else await r.continue();
  });
  const upload = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/profile/avatar") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  const failedUrl = (await (await upload).json()).avatarUrl;
  await expect(page.getByTestId("profile-save-error")).toBeVisible();
  expect((await context.request.get(`${baseURL}${failedUrl}`)).status()).toBe(
    404,
  );
  await page.unroute("**/rest/v1/profiles?*");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Đã lưu", exact: true }),
  ).toBeVisible();
  const url = (await (await request.get(profileUrl, { headers })).json())[0]
    .avatar_url;
  expect(url).toMatch(/^\/api\/profile\/avatar\//);
  const read = await context.request.get(`${baseURL}${url}`);
  expect(read.status()).toBe(200);
  expect(read.headers()["cache-control"]).toContain("private");
  expect((await sharp(await read.body()).metadata()).width).toBe(512);
  expect((await context.request.delete(`${baseURL}${url}`)).status()).toBe(409);
  const other = await browser.newContext();
  await signInAsMockFamily(other, baseURL!);
  expect((await other.request.get(`${baseURL}${url}`)).status()).toBe(404);
  await other.close();
  expect((await request.get(`${baseURL}${url}`)).status()).toBe(401);
  if (process.env.NEXT_VISUAL_QA === "1")
    await page.screenshot({ path: "/data/next-photo-day.png", fullPage: true });
  await page.reload();
  await page.getByRole("button", { name: "Hồ sơ của bé" }).click();
  await passParentGate(page);
  await expect(portrait).toHaveAttribute("data-family-avatar", "custom");
  await page.getByRole("button", { name: "Đóm chào", exact: true }).click();
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Đã lưu", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await context.request.get(`${baseURL}${url}`)).status())
    .toBe(404);
});

test("Admin: lọc native/verified/category, cảnh báo, thứ tự từng ngôn ngữ", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_ADMIN_USER_ID });
  let current = defaults.map((v) => ({ ...v }));
  await page.route("**/api/voice/defaults", async (r) => {
    if (r.request().method() === "PATCH") {
      const data = r.request().postDataJSON();
      expect(data.language).toBe("vi");
      current = current.map((v) =>
        data.ids.includes(v.id)
          ? { ...v, sort_order: data.ids.indexOf(v.id) }
          : v,
      );
      await r.fulfill({ json: { ok: true } });
    } else await r.fulfill({ json: { voices: current } });
  });
  await page.route("**/api/admin/voice-catalog?*", (r) =>
    r.fulfill({
      json: {
        voices: [
          {
            voice_id: "viNative",
            name: "Vietnamese native",
            category: "generated",
            source: "own",
            language: "Vietnamese",
          },
          {
            voice_id: "verifiedVi",
            name: "Professional verified",
            category: "professional",
            source: "own",
            language: "English",
            verified_languages: [{ language: "vi-VN" }],
          },
          {
            voice_id: "enNative",
            name: "English native",
            category: "premade",
            source: "own",
            language: "en-US",
          },
          {
            voice_id: "jaNative",
            name: "Japanese native",
            category: "cloned",
            source: "own",
            language: "ja",
          },
          {
            voice_id: "unknown",
            name: "No metadata",
            category: "cloned",
            source: "own",
            language: "",
          },
        ],
        warnings: ["Thư viện tạm thời không tải được; giọng tài khoản vẫn có."],
      },
    }),
  );
  await page.goto("/admin/settings");
  await page
    .getByRole("button", { name: "Thêm giọng vi", exact: true })
    .click();
  const modal = page.getByRole("dialog", { name: "Chọn giọng theo ngôn ngữ" });
  await expect(
    modal.getByText("Vietnamese native", { exact: true }),
  ).toBeVisible();
  await expect(
    modal.getByText("Professional verified", { exact: true }),
  ).toBeVisible();
  await expect(modal.getByText("English native", { exact: true })).toHaveCount(
    0,
  );
  await expect(modal.getByText("Japanese native", { exact: true })).toHaveCount(
    0,
  );
  await expect(modal.getByText(/Chưa có nhãn ngôn ngữ —/)).toBeVisible();
  await modal.getByLabel("Hiện giọng chưa có nhãn ngôn ngữ").uncheck();
  await expect(modal.getByText("No metadata", { exact: true })).toHaveCount(0);
  await expect(modal.getByText(/Thư viện tạm thời/)).toBeVisible();
  if (process.env.NEXT_VISUAL_QA === "1") {
    await page.setViewportSize({ width: 414, height: 896 });
    await page.screenshot({ path: "/data/next-voice-filter.png" });
  }
  await modal.getByRole("button", { name: "Đóng chọn giọng" }).click();
  await page
    .getByRole("button", { name: "Ưu tiên lên: Vi B", exact: true })
    .click();
  await expect(page.getByText("1. Vi B", { exact: true })).toBeVisible();
  await expect(page.getByText("1. English A", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("1. Vi B", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Thêm giọng en", exact: true })
    .click();
  await expect(
    modal.getByText("English native", { exact: true }),
  ).toBeVisible();
  await expect(
    modal.getByText("Vietnamese native", { exact: true }),
  ).toHaveCount(0);
  await modal.getByRole("button", { name: "Đóng chọn giọng" }).click();
  await page
    .getByRole("button", { name: "Thêm giọng ja", exact: true })
    .click();
  await expect(
    modal.getByText("Japanese native", { exact: true }),
  ).toBeVisible();
  await expect(
    modal.getByText("Professional verified", { exact: true }),
  ).toHaveCount(0);
});

test("Tạo truyện: clone trước, lựa chọn riêng không bị ghi đè, đổi tiếng lọc giọng", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_VOICE_USER_ID });
  await page.route("**/api/voice/defaults", (r) =>
    r.fulfill({ json: { voices: defaults } }),
  );
  await page.route("**/api/system/status", (r) =>
    r.fulfill({
      json: {
        hasStoryProvider: true,
        hasElevenLabs: true,
        defaultStoryProvider: "custom",
      },
    }),
  );
  let generated: Record<string, unknown> | null = null;
  await page.route("**/api/story/generate", (r) => {
    generated = r.request().postDataJSON();
    return r.fulfill({
      status: 422,
      json: { error: "Không tạo truyện trong ca thử" },
    });
  });
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Điều hướng chính" })
    .getByRole("button", { name: "Tạo", exact: true })
    .click();
  await page.getByRole("button", { name: /Tiếp tục/ }).click();
  await page.getByRole("button", { name: /Tiếp tục/ }).click();
  const clone = page.getByRole("button", { name: /Bà của bé Giọng nhà mình/ });
  await expect(clone).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Vi B Giọng của Đóm/ }).click();
  await expect(clone).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: /Tiếp tục/ }).click();
  await page.getByRole("button", { name: /Tạo truyện cùng Đóm/ }).click();
  await expect.poll(() => generated).not.toBeNull();
  expect(generated).toMatchObject({
    voiceId: null,
    narratorVoiceId: "defaultViB",
    language: "vi",
  });
  await page.getByRole("button", { name: "Bước trước" }).click();
  await page.getByRole("button", { name: /English/ }).click();
  await expect(
    page.getByRole("button", { name: /Vi B Giọng của Đóm/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /English A Giọng của Đóm/ }),
  ).toBeVisible();
  await expect(clone).toHaveAttribute("aria-pressed", "true");
  if (process.env.NEXT_VISUAL_QA === "1")
    await page.screenshot({
      path: "/data/next-create-voice.png",
      fullPage: true,
    });
  expect(
    (
      await context.request.patch(`${baseURL}/api/voice/defaults`, {
        data: { language: "vi", ids: [defaults[0].id, defaults[1].id] },
      })
    ).status(),
  ).toBe(403);
});

test("Player: lựa chọn narrator được giữ dù gia đình có clone; picker chỉ đúng ngôn ngữ", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_VOICE_USER_ID });
  await page.route("**/api/voice/defaults", (r) =>
    r.fulfill({ json: { voices: defaults } }),
  );
  await page.route("**/rest/v1/stories?*", async (r) => {
    const response = await r.fetch();
    let data = await response.json();
    const withNarrator = (s: Record<string, unknown>) => ({
      ...s,
      narrator_voice_id: "defaultViB",
      narrator_voice_name: "Vi B",
      voice_id: null,
      last_voice_id: null,
      locale: "vi",
    });
    data = Array.isArray(data) ? data.map(withNarrator) : withNarrator(data);
    await r.fulfill({ response, json: data });
  });
  await page.goto("/");
  await page.getByText("Sóc Nhỏ tìm hạt dẻ").first().click();
  const current = page.getByRole("button", {
    name: "Giọng: Vi B",
    exact: true,
  });
  await expect(current).toBeVisible();
  await current.click();
  await expect(
    page.getByRole("button", { name: "Bà của bé", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Vi A", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "English A", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Bà của bé", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Giọng: Bà của bé", exact: true }),
  ).toBeVisible();
});
