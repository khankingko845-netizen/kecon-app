import { test, expect, type Page } from "@playwright/test";
import { signInAsMockFamily, MOCK_ADMIN_USER_ID } from "./support/fixtures";

// PR #49 — story cards show small thumbnails (scene/cover) instead of only the
// topic icon; own stories without one are thumbnailed lazily by the server.
const SOC = "00000000-0000-4000-8000-0000000051a1";

async function cardImage(page: Page, title: string) {
  const img = page.locator("button", { hasText: title }).locator("img").first();
  await expect(img).toHaveAttribute("src", /\/scenes\/v1\/thumbs\/[a-z-]+\.webp$/);
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth))
    .toBe(480);
}

test("Thư viện: ảnh nhỏ thay biểu tượng, truyện chưa có được tạo tự động", async ({ page, context, baseURL }) => {
  await signInAsMockFamily(context, baseURL!);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("home-topics").waitFor();
  await page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("button", { name: "Thư viện" }).click();
  await expect(page.getByText("Chú Cuội và cây đa")).toBeVisible();
  await cardImage(page, "Chú Cuội và cây đa");
  await cardImage(page, "Sóc Nhỏ tìm hạt dẻ");
  // No layout jump: the picture box keeps the card height.
  const box = await page.locator("button", { hasText: "Sóc Nhỏ tìm hạt dẻ" }).locator("[data-thumb]").first().boundingBox();
  expect(Math.round(box?.height ?? 0)).toBe(104);
});

test("API warm-up: chỉ truyện của mình, tối đa 12, không lặp lại", async ({ context, baseURL }) => {
  await signInAsMockFamily(context, baseURL!);
  expect((await context.request.post("/api/story/thumbnails", { data: { ids: Array(13).fill(SOC) } })).status()).toBe(400);
  expect((await context.request.post("/api/story/thumbnails", { data: { ids: ["../../etc"] } })).status()).toBe(400);
  const first = await context.request.post("/api/story/thumbnails", { data: { ids: [SOC] } });
  expect(first.status()).toBe(200);
  const items = (await first.json()).items as { id: string; thumbnail_source: string }[];
  // [] when the Library visit already thumbnailed it, else exactly this story (scene of page 1)
  expect(items.every((i) => i.id === SOC && i.thumbnail_source === "scene")).toBe(true);
  const again = await context.request.post("/api/story/thumbnails", { data: { ids: [SOC] } });
  expect((await again.json()).items).toEqual([]);
});

test("Quản trị: thẻ Ảnh bìa & thumbnail trong Cài đặt hệ thống", async ({ browser, baseURL }) => {
  const admin = await browser.newContext({ baseURL });
  await signInAsMockFamily(admin, baseURL!, { userId: MOCK_ADMIN_USER_ID });
  const page = await admin.newPage();
  await page.goto("/admin/settings");
  const card = page.locator("section#thumbnails");
  await expect(card.getByRole("heading", { name: "Ảnh bìa & thumbnail truyện" })).toBeVisible();
  await expect(card.getByText(/Truyện gia đình: \d+\/\d+ có thumbnail/)).toBeVisible();
  await expect(card.getByRole("checkbox", { name: /Tự tạo thumbnail/ })).toBeChecked();
  await card.getByLabel("Kích thước").selectOption("640");
  await expect(page.getByText("Có thay đổi chưa lưu")).toBeVisible();
  await card.getByRole("button", { name: "Tạo thumbnail còn thiếu" }).click();
  await expect(page.getByText(/Không còn truyện nào thiếu thumbnail|Đã tạo \d+\/\d+ thumbnail/)).toBeVisible();
  expect((await admin.request.post("/api/admin/thumbnails", { data: { mode: "all" } })).status()).toBe(400);
  await admin.close();
});

test("Gia đình không gọi được API quản trị ảnh bìa", async ({ context, baseURL }) => {
  await signInAsMockFamily(context, baseURL!);
  expect((await context.request.get("/api/admin/thumbnails")).status()).toBe(403);
  expect((await context.request.post("/api/admin/thumbnails", { data: { mode: "missing" } })).status()).toBe(403);
  expect(
    (await context.request.post("/api/admin/story-cover", { data: { storyId: SOC, choice: { type: "auto" } } })).status(),
  ).toBe(403);
});
