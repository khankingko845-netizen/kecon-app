import { expect, test } from "@playwright/test";
import { signInAsMockFamily } from "./support/fixtures";

/** Story Studio v2 — custom cast in the Create wizard and the page-turning book in the player. */

const defaults = [
  { id: "00000000-0000-4000-8000-00000000dd01", voice_id: "defaultViA", name: "Vi A", language: "vi", sort_order: 0, is_active: true },
  { id: "00000000-0000-4000-8000-00000000dd02", voice_id: "defaultViB", name: "Vi B", language: "vi", sort_order: 1, is_active: true },
];

test.beforeEach(async ({ context, baseURL }) => {
  await signInAsMockFamily(context, baseURL!);
});

test("Tạo truyện: tự tạo nhân vật, không bị giới hạn bởi gợi ý, gửi đủ brief v2", async ({ page }) => {
  await page.route(/\/api\/voice\/defaults(?:\?.*)?$/, (r) => r.fulfill({ json: { voices: defaults } }));
  await page.route("**/api/system/status", (r) =>
    r.fulfill({ json: { hasStoryProvider: true, hasElevenLabs: true, defaultStoryProvider: "custom" } })
  );
  let generated: Record<string, unknown> | null = null;
  await page.route("**/api/story/generate", (r) => {
    generated = r.request().postDataJSON();
    return r.fulfill({ status: 422, json: { error: "Không tạo truyện trong ca thử" } });
  });

  await page.goto("/");
  await page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("button", { name: "Tạo", exact: true }).click();
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Nhân vật chính của mình là ai nhỉ?" })).toBeVisible();

  // Preset portraits are character art, not the story-type tiles.
  const astronaut = page.getByRole("button", { name: /Phi hành gia/ });
  await expect(astronaut.locator("img")).toHaveAttribute("src", /\/characters\/v1\/astronaut\.webp/);
  await astronaut.click();
  await expect(astronaut).toHaveAttribute("aria-pressed", "true");

  // A fully custom character.
  await page.getByRole("button", { name: /Tự tạo/ }).click();
  await page.getByLabel("Tên nhân vật", { exact: true }).fill("Mèo Mướp");
  await page.getByLabel("Là ai, con gì?").fill("chú mèo mướp thích nấu ăn");
  await page.getByRole("button", { name: "tốt bụng", exact: true }).click();
  await page.getByRole("button", { name: "Ông", exact: true }).click();
  await page.getByRole("button", { name: "Thêm vào truyện" }).click();
  await expect(page.getByText("Nhân vật trong truyện (2/3)")).toBeVisible();

  // Rename the preset and make the custom friend the hero.
  await page.getByLabel("Tên nhân vật 1").fill("Phi hành gia Bin");
  await page.getByRole("button", { name: "Chọn nhân vật 2 làm nhân vật chính" }).click();
  await expect(page.getByLabel("Tên nhân vật 1")).toHaveValue("Mèo Mướp");

  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ai sẽ kể cho bé nghe đây?" })).toBeVisible();
  await page.getByRole("button", { name: /Chậm rãi/ }).click();
  await expect(page.getByRole("switch", { name: /Nhân vật có giọng riêng/ })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();

  await expect(page.getByText("Mèo Mướp, Phi hành gia Bin")).toBeVisible();
  await page.getByRole("button", { name: /^Dài/ }).click();
  await page.getByRole("switch", { name: /Âm thanh khung cảnh/ }).click();
  await expect(page.getByRole("switch", { name: /Âm thanh khung cảnh/ })).toHaveAttribute("aria-checked", "false");
  // No illustration provider on this deployment → the toggle is not offered.
  await expect(page.getByRole("switch", { name: /Tranh vẽ riêng/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Tạo truyện cùng Đóm/ }).click();

  await expect.poll(() => generated).not.toBeNull();
  expect(generated).toMatchObject({
    length: "long",
    pace: "calm",
    castVoices: true,
    ambience: false,
    illustrate: false,
    characters: [
      { name: "Mèo Mướp", role: "hero", voiceType: "grandpa", description: expect.stringContaining("thích nấu ăn") },
      { name: "Phi hành gia Bin", role: "friend", presetId: "astronaut", voiceType: "boy" },
    ],
  });
  await expect(page.getByText("Không tạo truyện trong ca thử")).toBeVisible();
});

test("Trình đọc: truyện như cuốn sách — tranh cảnh theo trang và lật trang", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Sóc Nhỏ tìm hạt dẻ").first().click();
  const book = page.getByTestId("story-book");
  await expect(book).toHaveAttribute("aria-label", "Trang 1 trên 2");
  // Bundled scene art (not the category tile) until an AI illustration exists.
  await expect(book.locator("img").first()).toHaveAttribute("src", /\/scenes\/v1\/.+\.webp/);
  // Long v2 pages scroll inside the page instead of pushing the controls off screen.
  expect(await book.locator(".kc-page-text").first().evaluate((e) => getComputedStyle(e).maxHeight)).not.toBe("none");

  await page.evaluate(() => {
    const w = window as unknown as { __sawFlip?: boolean };
    w.__sawFlip = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="page-flip"]')) w.__sawFlip = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.getByRole("button", { name: "Trang sau" }).click();
  await expect(book).toHaveAttribute("aria-label", "Trang 2 trên 2");
  await expect(book.getByText(/Trang 2: ngày xưa có một chú sóc nhỏ/)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __sawFlip?: boolean }).__sawFlip)).toBe(true);
  await expect(page.getByTestId("page-flip")).toHaveCount(0, { timeout: 3000 });
});
