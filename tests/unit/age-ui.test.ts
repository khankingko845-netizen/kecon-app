/**
 * UI-13 · "Lớn cùng bé": nhóm tuổi 3–5 / 6–8 / 9–12 điều khiển mật độ chữ,
 * cỡ nút, nhãn âm thanh. Mặc định 3–5.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGE_BANDS, DEFAULT_AGE_BAND } from "@/lib/age-bands";
import { AGE_UI, ageUiFor, exploreFor, resolveChildBand } from "@/lib/age-ui";
import type { Screen } from "@/lib/types";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function cssVars(selector: string): Record<string, string> {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

describe("AGE_UI", () => {
  it("covers every age band, default 3–5", () => {
    expect(Object.keys(AGE_UI).sort()).toEqual(AGE_BANDS.map((b) => b.id).sort());
    expect(DEFAULT_AGE_BAND).toBe("3-5");
    for (const b of AGE_BANDS) {
      expect(AGE_UI[b.id].band).toBe(b.id);
      expect(AGE_UI[b.id].label).toBe(b.label);
      expect(AGE_UI[b.id].summary.length).toBeGreaterThan(10);
    }
  });

  it("younger → bigger targets, less text, spoken labels", () => {
    const [small, mid, big] = (["3-5", "6-8", "9-12"] as const).map((id) => AGE_UI[id]);
    expect(small.tap).toBeGreaterThanOrEqual(64); // README §6: nút ≥ 64px cho 3–5
    expect(small.tap).toBeGreaterThan(mid.tap);
    expect(mid.tap).toBeGreaterThan(big.tap);
    expect(small.button.lg).toBeGreaterThan(big.button.lg);
    for (const ui of Object.values(AGE_UI)) {
      expect(ui.tap).toBeGreaterThanOrEqual(44); // WCAG 2.5.5 floor
      expect(ui.button.sm).toBeGreaterThanOrEqual(44);
    }
    expect([small.density, mid.density, big.density]).toEqual(["low", "medium", "high"]);
    expect([small.speakLabels, mid.speakLabels, big.speakLabels]).toEqual([true, false, false]);
    expect(small.topicColumns).toBe(2);
    expect(big.domScale).toBeLessThan(1);
  });

  it("CSS variables in globals.css mirror AGE_UI", () => {
    for (const ui of Object.values(AGE_UI)) {
      expect(cssVars(`html[data-age="${ui.band}"]`)).toEqual({
        "--kid-tap": `${ui.tap}px`,
        "--kid-btn-lg": `${ui.button.lg}px`,
        "--kid-btn-md": `${ui.button.md}px`,
        "--kid-btn-sm": `${ui.button.sm}px`,
        "--dom-scale": String(ui.domScale),
      });
    }
    // First paint (before React sets data-age) uses the default band.
    expect(cssVars(":root")).toEqual(cssVars(`html[data-age="${DEFAULT_AGE_BAND}"]`));
    expect(css).toMatch(/html\[data-density="low"\] \[data-kid-detail\]\s*\{\s*display:\s*none/);
    expect(css).toMatch(/html:not\(\[data-density="high"\]\) \[data-kid-extra\]\s*\{\s*display:\s*none/);
  });
});

describe("resolveChildBand / ageUiFor", () => {
  it("profile age wins, then the device setting, then 3–5", () => {
    expect(resolveChildBand(4, "9-12")).toBe("3-5");
    expect(resolveChildBand(7, null)).toBe("6-8");
    expect(resolveChildBand(10, "3-5")).toBe("9-12");
    expect(resolveChildBand(null, "6-8")).toBe("6-8");
    expect(resolveChildBand(undefined, "4-6")).toBe("3-5"); // legacy value
    expect(resolveChildBand(0, "")).toBe("3-5");
    expect(resolveChildBand(Number.NaN, undefined)).toBe("3-5");
  });

  it("maps single ages to bands", () => {
    expect([1, 3, 5, 6, 8, 9, 12].map((a) => ageUiFor(a).band)).toEqual(["3-5", "3-5", "3-5", "6-8", "6-8", "9-12", "9-12"]);
    expect(ageUiFor(null).band).toBe("3-5");
  });
});

describe("exploreFor", () => {
  const items: { screen: Screen }[] = (
    ["favorites", "daily-challenges", "scan-book", "draw-story", "collections", "upload", "admin"] as Screen[]
  ).map((screen) => ({ screen }));

  it("3–5: a few big shortcuts, order kept, admin always stays", () => {
    expect(exploreFor(items, AGE_UI["3-5"]).map((i) => i.screen)).toEqual(["favorites", "scan-book", "draw-story", "admin"]);
  });

  it("6–8 and 9–12: everything", () => {
    expect(exploreFor(items, AGE_UI["6-8"])).toHaveLength(items.length);
    expect(exploreFor(items, AGE_UI["9-12"])).toHaveLength(items.length);
    expect(exploreFor(items, AGE_UI["9-12"])).not.toBe(items);
  });
});
