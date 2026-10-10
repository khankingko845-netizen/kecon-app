/**
 * Admin v2 · A-04 — quét tự động: không response nào tới trình duyệt chứa API key.
 *
 * The mock Vault is planted with a key in EVERY slot (`sk-e2e-PLANTED-<key>-Zq7w`),
 * plus a planted voice key pool (A-04b: 2 ElevenLabs keys — the first out of quota —
 * and 1 Fish Audio key), and the Next server reads them with the service role,
 * exactly like production. Then every response the browser receives (HTML, RSC payloads,
 * JS chunks, API JSON, PostgREST) is scanned for the marker.
 * Runs in its own serial project after every other spec (playwright.config.ts).
 */
import { expect, test } from "@playwright/test";
import { MOCK_ADMIN_USER_ID, signInAsMockFamily } from "./support/fixtures";

const MOCK_SUPABASE = "http://127.0.0.1:54321";
const MARKER = "PLANTED";

async function setScanMode(on: boolean) {
  const res = await fetch(`${MOCK_SUPABASE}/__e2e/secrets-scan`, { method: "POST", body: JSON.stringify({ on }) });
  expect(res.ok).toBe(true);
}

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
test.beforeAll(() => setScanMode(true));
test.afterAll(() => setScanMode(false));

test("không response nào (trang, RSC, API, PostgREST) chứa key — dù server đang giữ key", async ({ page, context, baseURL }) => {
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_ADMIN_USER_ID });
  const scanned: Promise<{ url: string; leaked: boolean }>[] = [];
  page.on("response", (r) =>
    scanned.push(
      r.body().then(
        (b) => ({ url: r.url(), leaked: b.includes(MARKER) }),
        () => ({ url: r.url(), leaked: false }) // redirects / aborted: no body
      )
    )
  );

  // 1. The server really holds the keys — otherwise the scan proves nothing.
  const status = await context.request.get("/api/system/status");
  const statusText = await status.text();
  expect(JSON.parse(statusText)).toMatchObject({ hasElevenLabs: true, hasFishAudio: true, hasStoryProvider: true });
  expect(statusText).not.toContain(MARKER);

  // 1b. A-04b: TTS goes through the pool (mock providers). ElevenLabs key 1 is out of quota →
  // the request fails over to key 2 and key 1 is marked "exhausted"; Fish voices use the Fish pool.
  for (let i = 0; i < 2; i++) {
    const tts = await context.request.post("/api/voice/tts", { data: { voiceId: "e2eVoice1", text: `Xin chào ${i}` } });
    expect(tts.status()).toBe(200);
    expect(tts.headers()["content-type"]).toContain("audio/mpeg");
    expect(await tts.text()).not.toContain(MARKER);
  }
  const fishTts = await context.request.post("/api/voice/tts", { data: { voiceId: "fish:e2efishvoice01", text: "Xin chào" } });
  expect(fishTts.status()).toBe(200);
  expect(await fishTts.text()).not.toContain(MARKER);

  // 2. Every admin screen.
  for (const url of ["/admin", "/admin/users", "/admin/audit", "/admin/settings"]) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBe(200);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    expect(await page.content(), url).not.toContain(MARKER);
  }

  // 3. The settings screen shows status + last 4 only.
  for (const key of ["openai_api_key", "dalle_api_key"]) {
    await expect(page.getByTestId(`secret-status-${key}`)).toContainText("Đã đặt · …Zq7w");
  }
  await expect(page.getByLabel("API key OpenAI")).toHaveValue("");
  const eleven = page.getByTestId("key-pool-elevenlabs");
  await expect(eleven).toContainText("2 key · 1 đang dùng");
  await expect(eleven.getByRole("listitem").filter({ hasText: "Quét 1" })).toContainText("Hết credit · thử lại");
  await expect(eleven.getByRole("listitem").filter({ hasText: "Quét 2" })).toContainText("Đang dùng");
  await expect(page.getByTestId("key-pool-fishaudio").getByRole("listitem")).toContainText("…Zq7w");

  // 4. "Test Kết Nối" with the stored key runs on the server; answers are scrubbed.
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await page.getByRole("button", { name: "Test Kết Nối" }).nth(1).click();
  await expect(page.getByText("Chưa lưu Base URL cho Custom provider")).toBeVisible();
  for (const provider of ["openai", "custom"]) {
    const res = await context.request.post("/api/admin/test-provider", { data: { provider } });
    expect(res.status(), provider).toBe(200);
    expect(await res.text(), provider).not.toContain(MARKER);
  }

  const results = await Promise.all(scanned);
  expect(results.length).toBeGreaterThan(20);
  expect(results.filter((r) => r.leaked).map((r) => r.url)).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toContain(MARKER);
});
