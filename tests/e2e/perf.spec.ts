import { expect, test, type Page } from "@playwright/test";
import { signInAsMockFamily } from "./support/fixtures";

/**
 * UI-12 — hiệu năng: LCP < 2,5 s trên 4G, CLS < 0,1 (docs/plan.md).
 *
 * Mạng = "Slow 4G" của Lighthouse mobile (RTT 150 ms, 1,6 Mbps xuống / 750 kbps
 * lên, giả lập qua CDP — chặt hơn 4G thật ở VN) + CPU chậm 4× (PERF_CPU_SLOWDOWN),
 * đo bằng PerformanceObserver trên bản build production.
 *
 * - Lần đầu mở app (onboarding, render sẵn từ server): LCP < 2,5 s, CLS < 0,1.
 * - Gia đình đã đăng nhập: Đóm (màn chờ, render từ server) hiện < 2,5 s; Trang
 *   chủ vẽ trên client sau khi tải JS — ngân sách tạm 5 s để chặn hồi quy
 *   (mục tiêu 2,5 s cần render Trang chủ phía server — xem docs/plan.md, UI-12).
 */

const LCP_BUDGET_MS = 2500;
const HOME_LCP_GUARD_MS = 5000;
const CLS_BUDGET = 0.1;

type Vitals = { fcp: number; lcp: number; lcpEl: string; cls: number };

async function throttleSlow4G(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.PERF_CPU_SLOWDOWN ?? 4) });
}

async function observeVitals(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __vitals: Vitals };
    w.__vitals = { fcp: 0, lcp: 0, lcpEl: "", cls: 0 };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name === "first-contentful-paint") w.__vitals.fcp = e.startTime;
    }).observe({ type: "paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & { element?: Element })[]) {
        w.__vitals.lcp = e.startTime;
        w.__vitals.lcpEl = e.element ? `${e.element.tagName.toLowerCase()}.${String(e.element.className).slice(0, 40)}` : "";
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (!e.hadRecentInput) w.__vitals.cls += e.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

async function vitals(page: Page, label: string): Promise<Vitals> {
  const v = await page.evaluate(() => (window as unknown as { __vitals: Vitals }).__vitals);
  const rounded = { ...v, fcp: Math.round(v.fcp), lcp: Math.round(v.lcp), cls: Number(v.cls.toFixed(4)) };
  test.info().annotations.push({ type: "vitals", description: JSON.stringify(rounded) });
  console.log(`${label} vitals`, JSON.stringify(rounded));
  return v;
}

test.describe("UI-12 · hiệu năng (Slow 4G + CPU 4×)", () => {
  test.describe.configure({ mode: "serial" }); // one throttled page at a time
  test.setTimeout(90_000);

  test("lần đầu mở app (onboarding)", async ({ page }) => {
    await observeVitals(page);
    await throttleSlow4G(page);
    await page.goto("/", { waitUntil: "load", timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Bắt đầu nào!" })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    const v = await vitals(page, "onboarding");
    expect(v.lcp).toBeGreaterThan(0);
    expect(v.lcp).toBeLessThan(LCP_BUDGET_MS);
    expect(v.cls).toBeLessThan(CLS_BUDGET);
  });

  test("gia đình đã đăng nhập (Đóm chờ → Trang chủ)", async ({ context, baseURL, page }) => {
    await signInAsMockFamily(context, baseURL!);
    await page.clock.setFixedTime(new Date("2025-06-02T10:00:00"));
    await observeVitals(page);
    await throttleSlow4G(page);
    await page.goto("/", { waitUntil: "load", timeout: 60_000 });
    await expect(page.getByTestId("home-topics")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2000);
    const v = await vitals(page, "home");
    expect(v.fcp).toBeGreaterThan(0);
    expect(v.fcp).toBeLessThan(LCP_BUDGET_MS);
    expect(v.lcp).toBeLessThan(HOME_LCP_GUARD_MS);
    expect(v.cls).toBeLessThan(CLS_BUDGET);
  });
});
