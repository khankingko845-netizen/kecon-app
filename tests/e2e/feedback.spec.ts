import { expect, test, type Page } from "@playwright/test";
import { DOM_LINES } from "../../src/lib/dom-lines";
import { passParentGate, pureWhiteElements, signInAsMockFamily } from "./support/fixtures";

/**
 * UI-11 — Âm thanh, haptic + câu thoại của Đóm: tắt được trong tab Bố mẹ,
 * im lặng ở Chế độ ngủ. Web Audio / rung / giọng đọc được "nghe lén" bằng
 * init script (headless Chromium không có loa, không có giọng tiếng Việt).
 */

type Probe = { vib: unknown[]; osc: number; spoken: string[] };

async function instrument(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & { __fb: Probe };
    w.__fb = { vib: [], osc: 0, spoken: [] };
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (p: unknown) => {
        w.__fb.vib.push(p);
        return true;
      },
    });
    const AC = window.AudioContext;
    if (AC) {
      const orig = AC.prototype.createOscillator;
      AC.prototype.createOscillator = function (this: AudioContext) {
        w.__fb.osc++;
        return orig.call(this);
      };
    }
    const voice = { lang: "vi-VN", name: "Đóm (test)", localService: true, default: true, voiceURI: "dom-test" };
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => [voice],
        speak: (u: { text: string }) => w.__fb.spoken.push(u.text),
        cancel: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
    w.SpeechSynthesisUtterance = class {
      text: string;
      lang = "";
      voice: unknown = null;
      rate = 1;
      pitch = 1;
      volume = 1;
      constructor(text: string) {
        this.text = text;
      }
    };
  });
}

const probe = (page: Page) => page.evaluate(() => (window as unknown as { __fb: Probe }).__fb);
const resetProbe = (page: Page) =>
  page.evaluate(() => {
    const fb = (window as unknown as { __fb: Probe }).__fb;
    fb.vib.length = 0;
    fb.spoken.length = 0;
    fb.osc = 0;
  });
const tabBar = (page: Page) => page.getByRole("navigation", { name: "Điều hướng chính" });
const pokeDom = (page: Page) => page.getByRole("button", { name: "Chạm để nghe Đóm nói" }).click();

test.describe("UI-11 · âm thanh, rung, Đóm nói", () => {
  test.beforeEach(async ({ context, baseURL, page }) => {
    await signInAsMockFamily(context, baseURL!);
    await instrument(page);
  });

  test("ban ngày: Đóm chào, chạm Đóm → bong bóng + giọng + rung + âm", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2025-06-02T10:00:00"));
    await page.goto("/");
    const bubble = page.getByTestId("dom-speech");
    // Lời chào một lần mỗi phiên (sáng, hoặc khen chuỗi ≥ 3 đêm)
    await expect(bubble).toBeVisible();
    await expect(bubble).toContainText(/Chào buổi sáng|đêm liền/);
    await expect.poll(async () => (await probe(page)).spoken.length).toBe(1);

    await resetProbe(page);
    await pokeDom(page);
    await expect(bubble).toContainText(DOM_LINES.poke.text);
    const p = await probe(page);
    expect(p.spoken).toEqual([DOM_LINES.poke.text]);
    expect(p.vib).toEqual([12]); // "pop"
    expect(p.osc).toBeGreaterThan(0);

    // Chạm bong bóng để đóng; về Trang chủ lần nữa không chào lại
    await bubble.click();
    await expect(bubble).toHaveCount(0);
    await tabBar(page).getByRole("button", { name: "Thư viện" }).click();
    await tabBar(page).getByRole("button", { name: "Trang chủ" }).click();
    await expect(page.getByRole("button", { name: "Chạm để nghe Đóm nói" })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(bubble).toHaveCount(0);
  });

  test("tắt trong tab Bố mẹ → im lặng hẳn, vẫn hiện chữ", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2025-06-02T10:00:00"));
    await page.goto("/");
    await expect(page.getByTestId("dom-speech")).toBeVisible();
    await resetProbe(page);

    await tabBar(page).getByRole("button", { name: "Bố mẹ", exact: true }).click();
    // Cổng phụ huynh: Đóm đọc to cho bé chưa biết chữ
    await expect.poll(async () => (await probe(page)).spoken).toEqual([DOM_LINES["parent-only"].text]);
    await passParentGate(page);
    await expect(page.getByRole("heading", { level: 1, name: "Bố mẹ", exact: true })).toBeVisible();

    const card = page.getByTestId("feedback-settings");
    await card.scrollIntoViewIfNeeded();
    for (const name of ["Âm thanh khi chạm", "Rung nhẹ", "Đóm nói chuyện"]) {
      const sw = card.getByRole("switch", { name: new RegExp(name) });
      await expect(sw).toHaveAttribute("aria-checked", "true");
      await sw.click();
      await expect(sw).toHaveAttribute("aria-checked", "false");
    }
    expect(await page.evaluate(() => localStorage.getItem("kecon-feedback"))).toBe('{"sound":false,"haptics":false,"voice":false}');

    await resetProbe(page);
    await tabBar(page).getByRole("button", { name: "Trang chủ" }).click();
    await pokeDom(page);
    await expect(page.getByTestId("dom-speech")).toContainText(DOM_LINES.poke.text);
    expect(await probe(page)).toEqual({ vib: [], osc: 0, spoken: [] });
  });

  test("Chế độ ngủ: không âm, không giọng; rung nhẹ vẫn có; không #FFF", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kecon-night-mode", "on"));
    await page.goto("/");
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("bedtime"))).toBe(true);
    await expect(page.getByRole("button", { name: "Chạm để nghe Đóm nói" })).toBeVisible();
    await resetProbe(page);

    await pokeDom(page);
    await expect(page.getByTestId("dom-speech")).toContainText(DOM_LINES.poke.text);
    await expect(page.getByTestId("dom-speech").locator("[data-tone]")).toHaveAttribute("data-tone", "night");
    const p = await probe(page);
    expect(p.spoken).toEqual([]);
    expect(p.osc).toBe(0);
    expect(p.vib).toEqual([12]);
    expect(await pureWhiteElements(page)).toEqual([]);
  });

  test("tự động 21:00: lời chào chỉ hiện chữ, bong bóng tông đêm", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2025-06-02T21:00:00"));
    await page.goto("/");
    const bubble = page.getByTestId("dom-speech");
    await expect(bubble).toBeVisible();
    await expect(bubble.locator("[data-tone]")).toHaveAttribute("data-tone", "night");
    expect((await probe(page)).spoken).toEqual([]);
    expect((await probe(page)).osc).toBe(0);
  });
});
