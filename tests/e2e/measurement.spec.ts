import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signInAsMockFamily, MOCK_A15_ADMIN_ID } from "./support/fixtures";
test("T07 admin cost/funnel explain unknown coverage; period and failure remain visible", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_A15_ADMIN_ID });
  await page.goto("/admin/analytics");
  const panel = page.getByRole("region", { name: "Đo lường first-party" });
  await expect(panel).toContainText("Tổng ước tính chưa đầy đủ");
  await expect(panel).toContainText("$0.000140");
  await expect(panel).toContainText("Funnel tài khoản mới");
  await panel.getByLabel("Khoảng ngày UTC").selectOption("7");
  await expect(panel).toContainText("Chưa xác định");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const a = await new AxeBuilder({ page })
    .include('section[aria-label="Đo lường first-party"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(a.violations).toEqual([]);
  await page.screenshot({
    path: process.env.T07_SCREENSHOT || "/data/t07-analytics-mobile.png",
  });
  await page.route("**/api/admin/measurement?*", (r) =>
    r.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await panel.getByLabel("Khoảng ngày UTC").selectOption("30");
  await expect(panel.getByRole("alert")).toContainText("Không tải được");
});
test("T07 staff pricing accepts explicit valid rates, not a provider/key change", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_A15_ADMIN_ID });
  await page.goto("/admin/settings");
  const panel = page.locator("#ai-pricing");
  await expect(panel).toBeVisible();
  await panel.getByLabel("Mã model chính xác").fill("test-metering-model");
  await panel
    .getByLabel("Nguồn giá HTTPS")
    .fill("https://provider.example/pricing");
  await panel.getByLabel("USD / 1M input token").fill("1");
  await panel.getByLabel("USD / 1M output token").fill("2");
  await panel.getByRole("button", { name: "Lưu đơn giá" }).click();
  await expect(panel.getByRole("status")).toContainText(
    "Chỉ áp dụng cho lần gọi mới",
  );
  const a = await new AxeBuilder({ page })
    .include("#ai-pricing")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(a.violations).toEqual([]);
});
test("T07 real hermetic provider path reserves and finalizes a private ledger row; event actor is strict", async ({
  context,
  baseURL,
}) => {
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_A15_ADMIN_ID });
  const bad = await context.request.post(baseURL! + "/api/analytics/event", {
    data: { event: "home_view", user_id: "spoof" },
  });
  expect(bad.status()).toBe(400);
  const r = await context.request.post(baseURL! + "/api/voice/tts", {
    data: {
      voiceId: "previewVi",
      language: "vi",
      text: "Câu mẫu kiểm thử T07",
      apiKey: "sk_e2e-stored-elevenlabs-x9Qz",
    },
  });
  expect(r.status()).toBe(200);
  const rows = await context.request.get(
    "http://127.0.0.1:54321/rest/v1/ai_cost_ledger?user_id=eq." +
      MOCK_A15_ADMIN_ID +
      "&feature=eq.voice.tts",
    { headers: { Authorization: "Bearer e2e-fake-service-role-key" } },
  );
  const data = await rows.json();
  expect(data.length).toBeGreaterThan(0);
  expect(data.some((x: { status: string }) => x.status === "succeeded")).toBe(
    true,
  );
  const raw = JSON.stringify(data);
  expect(raw).not.toContain("previewVi");
  expect(raw).not.toContain("xi-api-key");
  expect(raw).not.toContain("prompt");
});
