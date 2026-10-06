/**
 * Admin v2 · A-04 — quét tự động: không response nào tới trình duyệt chứa API key.
 *
 * The mock Vault is planted with a key in EVERY slot (`sk-e2e-PLANTED-<key>-Zq7w`)
 * and the Next server reads them with the service role, exactly like
 * production. Then every response the browser receives (HTML, RSC payloads,
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
  expect(JSON.parse(statusText)).toMatchObject({ hasElevenLabs: true, hasStoryProvider: true });
  expect(statusText).not.toContain(MARKER);

  // 2. Every admin screen.
  for (const url of ["/admin", "/admin/users", "/admin/audit", "/admin/settings"]) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBe(200);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    expect(await page.content(), url).not.toContain(MARKER);
  }

  // 3. The settings screen shows status + last 4 only.
  for (const key of ["elevenlabs_api_key", "openai_api_key", "dalle_api_key"]) {
    await expect(page.getByTestId(`secret-status-${key}`)).toContainText("Đã đặt · …Zq7w");
  }
  await expect(page.getByLabel("API key OpenAI")).toHaveValue("");

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
