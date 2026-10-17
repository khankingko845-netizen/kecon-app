/**
 * T11 · Đồng ý của bố mẹ có phiên bản, lưu ở máy chủ (migration 042, docs/parent-consent.md).
 * Tiêu chí: tài khoản chưa đồng ý không mở được app; đồng ý cần xác nhận người lớn
 * (phép tính hoặc PIN) và được ghi kèm phiên bản + mã băm văn bản; chính sách đổi bản
 * → hỏi lại; rút đồng ý trong Bố mẹ › Cài đặt → app khoá lại và API ghi dữ liệu trả 403.
 * Trạng thái đồng ý nằm trong mock Supabase (POST /__e2e/consent-reset, GET /__e2e/consent-state).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  MOCK_CONSENT_PIN_USER_ID,
  MOCK_CONSENT_USER_ID,
  MOCK_PIN,
  passParentGate,
  signInAsMockFamily,
} from "./support/fixtures";

const MOCK = "http://127.0.0.1:54321";
type ConsentRecord = { version: number; method: string; withdrawn_at: string | null; withdraw_method?: string };
type ConsentState = { current: number; records: ConsentRecord[]; calls: { name: string; body: Record<string, unknown> | null }[] };

// Hai tài khoản mẫu dùng chung trạng thái trong mock → chạy tuần tự.
test.describe.configure({ mode: "serial" });

async function resetConsent(request: APIRequestContext, sub: string, current: number, accepted: number | null) {
  const r = await request.post(`${MOCK}/__e2e/consent-reset`, { data: { sub, current, accepted } });
  expect(r.ok()).toBe(true);
}
async function consentState(request: APIRequestContext, sub: string): Promise<ConsentState> {
  return (await request.get(`${MOCK}/__e2e/consent-state?sub=${sub}`)).json();
}

const gate = (page: Page) => page.locator("[data-consent-gate]");
const nav = (page: Page) => page.getByRole("navigation", { name: "Điều hướng chính" });
const agreeBox = (page: Page) => page.getByRole("checkbox", { name: /Tôi là bố\/mẹ hoặc người giám hộ/ });
const agreeButton = (page: Page) => page.getByRole("button", { name: "Đồng ý và tiếp tục" });

async function agreeAsAdult(page: Page, pin?: string) {
  await agreeBox(page).check();
  await agreeButton(page).click();
  await expect(page.getByRole("heading", { level: 1, name: "Bố mẹ xác nhận" })).toBeVisible();
  await passParentGate(page, pin);
  await expect(gate(page)).toHaveCount(0);
  await expect(nav(page)).toBeVisible();
}

test("lần đầu: cổng đồng ý chặn app; đọc toàn văn; xác nhận người lớn → mở app và ghi phiên bản + mã băm", async ({ page, context, baseURL, request }) => {
  await resetConsent(request, MOCK_CONSENT_USER_ID, 1, null);
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_CONSENT_USER_ID });
  await page.goto("/");

  await expect(gate(page)).toHaveAttribute("data-consent-gate", "first");
  await expect(page.getByRole("heading", { level: 1, name: "Chào bố mẹ!" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Chính sách quyền riêng tư cho bố mẹ" })).toBeVisible();
  await expect(page.getByText(/^Bản 1 · áp dụng từ/)).toBeVisible();
  // Không lộ app của bé trước khi đồng ý
  await expect(nav(page)).toHaveCount(0);
  await expect(agreeButton(page)).toBeDisabled();

  await page.getByRole("button", { name: "Đọc toàn văn chính sách" }).click();
  const full = page.getByLabel("Toàn văn chính sách");
  await expect(full).toContainText("Nhà cung cấp dịch vụ nhận dữ liệu");
  await expect(full).toContainText("ElevenLabs");

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => `${v.impact} ${v.id}`)).toEqual([]);

  // Huỷ xác nhận → quay lại văn bản, chưa ghi gì
  await agreeBox(page).check();
  await agreeButton(page).click();
  await page.getByRole("button", { name: "Quay lại" }).click();
  await expect(gate(page)).toHaveAttribute("data-consent-gate", "first");
  expect((await consentState(request, MOCK_CONSENT_USER_ID)).records).toHaveLength(0);

  await agreeAsAdult(page);
  const state = await consentState(request, MOCK_CONSENT_USER_ID);
  expect(state.records).toMatchObject([{ version: 1, method: "account_holder", withdrawn_at: null }]);
  const accept = state.calls.find((c) => c.name === "consent_accept");
  expect(String(accept?.body?.p_body_sha256)).toMatch(/^[0-9a-f]{64}$/);

  // Tải lại: máy chủ đã có đồng ý → vào thẳng app
  await page.reload();
  await expect(nav(page)).toBeVisible();
  await expect(gate(page)).toHaveCount(0);
});

test("chính sách lên bản 2: app đang mở bằng gợi ý cũ vẫn bị khoá và hỏi lại", async ({ page, context, baseURL, request }) => {
  await resetConsent(request, MOCK_CONSENT_USER_ID, 2, 1);
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_CONSENT_USER_ID });
  // Máy này từng đồng ý bản 1 (gợi ý cục bộ) — máy chủ mới là nơi quyết định.
  await context.addInitScript((uid) => {
    localStorage.setItem("kecon-consent-v2", JSON.stringify({ uid, version: 1 }));
  }, MOCK_CONSENT_USER_ID);
  await page.goto("/");

  await expect(gate(page)).toHaveAttribute("data-consent-gate", "updated");
  await expect(page.getByRole("heading", { level: 1, name: "Chính sách đã cập nhật" })).toBeVisible();
  await expect(page.getByText(/^Bản 2 · áp dụng từ/)).toBeVisible();
  await expect(nav(page)).toHaveCount(0);

  await agreeAsAdult(page);
  const state = await consentState(request, MOCK_CONSENT_USER_ID);
  expect(state.records.map((r) => r.version)).toEqual([1, 2]);
});

test("gia đình có PIN: đồng ý phải nhập PIN của bố mẹ (ghi parent_pin)", async ({ page, context, baseURL, request }) => {
  await resetConsent(request, MOCK_CONSENT_PIN_USER_ID, 1, null);
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_CONSENT_PIN_USER_ID });
  await page.goto("/");

  await expect(gate(page)).toHaveAttribute("data-consent-gate", "first");
  await agreeBox(page).check();
  await agreeButton(page).click();
  await expect(page.locator("[data-parent-gate]")).toHaveAttribute("data-parent-gate", "pin");
  await passParentGate(page, MOCK_PIN);
  await expect(nav(page)).toBeVisible();

  const state = await consentState(request, MOCK_CONSENT_PIN_USER_ID);
  expect(state.records).toMatchObject([{ version: 1, method: "parent_pin", withdrawn_at: null }]);
});

test("rút đồng ý trong Bố mẹ › Cài đặt → app khoá lại, API ghi dữ liệu trả 403; đồng ý lại để dùng tiếp", async ({ page, context, baseURL, request }) => {
  await resetConsent(request, MOCK_CONSENT_USER_ID, 1, 1);
  await signInAsMockFamily(context, baseURL!, { userId: MOCK_CONSENT_USER_ID });
  await page.goto("/");
  await expect(nav(page)).toBeVisible();
  expect((await page.request.post("/api/analytics/event", { data: { event: "home_view" } })).status()).toBe(200);

  await nav(page).getByRole("button", { name: "Bố mẹ", exact: true }).click();
  await passParentGate(page);
  await page.getByRole("button", { name: /Chính sách & đồng ý/ }).click();
  const panel = page.getByTestId("privacy-consent");
  await expect(panel.getByRole("heading", { name: "Lịch sử đồng ý" })).toBeVisible();
  await expect(panel).toContainText("đang hiệu lực");

  await panel.getByRole("button", { name: "Rút đồng ý", exact: true }).click();
  await panel.getByRole("button", { name: "Giữ đồng ý" }).click();
  expect((await consentState(request, MOCK_CONSENT_USER_ID)).records[0].withdrawn_at).toBeNull();
  await panel.getByRole("button", { name: "Rút đồng ý", exact: true }).click();
  await panel.getByRole("button", { name: "Xác nhận rút" }).click();

  await expect(gate(page)).toHaveAttribute("data-consent-gate", "withdrawn");
  await expect(page.getByRole("heading", { level: 1, name: "Bố mẹ đã rút đồng ý" })).toBeVisible();
  await expect(nav(page)).toHaveCount(0);
  expect((await consentState(request, MOCK_CONSENT_USER_ID)).records[0]).toMatchObject({
    version: 1,
    withdraw_method: "account_holder",
  });

  // Máy chủ chặn ghi dữ liệu dù có gọi thẳng API
  const denied = await page.request.post("/api/analytics/event", { data: { event: "home_view" } });
  expect(denied.status()).toBe(403);
  expect((await denied.json()).code).toBe("consent_required");

  // Tải lại vẫn khoá (gợi ý cục bộ đã bị xoá)
  await page.reload();
  await expect(gate(page)).toHaveAttribute("data-consent-gate", "withdrawn");

  await agreeAsAdult(page);
  expect((await page.request.post("/api/analytics/event", { data: { event: "home_view" } })).status()).toBe(200);
});
