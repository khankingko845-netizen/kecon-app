import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { signInAsMockFamily, MOCK_PHOTO_USER_ID } from "./support/fixtures";

// G-02…G-05 MVP (docs/missions-mvp.md): Home week chip → "Bầu trời của Đóm";
// finishing a story shows the server-recorded stars. Timing/eligibility rules
// live in tests/db/missions.test.ts — the mock records every completion.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
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

/** Every narration clip "finishes" right away so the story reaches its last page; Đóm's voice is recorded. */
async function finishInstantly(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __spoken: string[] };
    w.__spoken = [];
    if ("speechSynthesis" in window) speechSynthesis.speak = (u: SpeechSynthesisUtterance) => void w.__spoken.push(u.text);
    HTMLMediaElement.prototype.play = function () {
      setTimeout(() => this.onended?.(new Event("ended")), 30);
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {};
  });
  await page.route("**/api/system/status", (r) =>
    r.fulfill({ json: { hasElevenLabs: true, hasStoryProvider: true, elevenLabsModel: "eleven_v3" } }),
  );
  await page.route(/\/api\/voice\/defaults(?:\?.*)?$/, (r) =>
    r.fulfill({ json: { voices: [{ id: "d1", voice_id: "viVoice", name: "Giọng Việt", language: "vi", sort_order: 0, is_active: true }] } }),
  );
  await page.route("**/api/voice/tts", (r) => r.fulfill({ contentType: "audio/wav", body: wav }));
}

test("chip tuần → Bầu trời của Đóm; nghe hết truyện → sao, nhiệm vụ xong, không dùng chữ 'đêm liền'", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsMockFamily(context, baseURL!);
  await finishInstantly(page);
  const listen: Record<string, unknown>[] = [];
  page.on("request", (req) => {
    if (req.url().endsWith("/api/missions/listen")) listen.push(req.postDataJSON());
  });

  await page.goto("/");
  const chip = page.getByTestId("week-sky-chip");
  await expect(chip).toBeVisible();
  await expect(page.getByText(/đêm liền/)).toHaveCount(0);
  if (process.env.MISSIONS_QA === "1") await page.screenshot({ path: "/data/g-e2e-home.png" });
  await chip.click();
  await expect(page.getByRole("heading", { name: "Bầu trời của Đóm", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nhiệm vụ hôm nay" })).toBeVisible();
  await expect(page.getByText("Nghe hết một truyện", { exact: true })).toBeVisible();
  await expect(page.getByText("Nghe một truyện cổ tích", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Các tối trong tuần" }).getByRole("listitem")).toHaveCount(7);
  expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Quay lại" }).click();
  await page.getByText("Chú Cuội và cây đa").first().click();
  await expect.poll(() => listen.filter((b) => b.action === "start").length).toBe(1);
  await page.getByRole("button", { name: "Phát", exact: true }).click();
  const card = page.getByTestId("mission-celebration");
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toHaveAttribute("role", "status");
  await expect(card).toContainText("+2");
  await expect(card).toContainText("Bé đã gặp thêm một nhân vật cổ tích!");
  await expect(card).not.toContainText(/giỏi|thông minh|liền/);
  if (process.env.MISSIONS_QA === "1") await page.screenshot({ path: "/data/g-e2e-card.png" });
  expect(listen.some((b) => b.action === "complete" && typeof b.sessionId === "string")).toBe(true);
  expect((await new AxeBuilder({ page }).include('[data-testid="mission-celebration"]').withTags(TAGS).analyze()).violations).toEqual([]);

  await card.getByRole("button", { name: "Xem bầu trời của Đóm" }).click();
  await expect(page.getByRole("heading", { name: /^Tuần này [1-7] tối$/ })).toBeVisible();
  await expect(page.getByText("Xong", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Hôm nay xong hết nhiệm vụ rồi. Mình nghỉ ngơi nhé!")).toBeVisible();
  await expect(page.getByRole("list", { name: "Cột mốc đã đạt" })).toContainText("1 truyện");
  if (process.env.MISSIONS_QA === "1") await page.screenshot({ path: "/data/g-e2e-sky.png", fullPage: true });
  await page.goto("/");
  await expect(page.getByTestId("week-sky-chip")).toHaveAccessibleName(/^Tuần này [1-7] tối nghe truyện/);
  if (process.env.MISSIONS_QA === "1") await page.screenshot({ path: "/data/g-e2e-home2.png" });
});

test("Chế độ ngủ: thẻ chúc mừng mờ, không giọng Đóm, không chuyển động", async ({ page, context, baseURL }) => {
  // Separate family: the mock keeps rewards per account, like the real ledger.
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_PHOTO_USER_ID });
  await page.clock.setFixedTime(new Date("2025-06-02T21:00:00"));
  await finishInstantly(page);
  await page.goto("/");
  await page.getByText("Sóc Nhỏ tìm hạt dẻ").first().click();
  await page.getByRole("button", { name: "Phát", exact: true }).click();
  const card = page.getByTestId("mission-celebration");
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toHaveClass(/night-dim/);
  await expect(card).not.toHaveClass(/animate-/);
  expect(await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)).toEqual([]);
  await card.getByRole("button", { name: "Đóng" }).click();
  await expect(card).toHaveCount(0);
});
