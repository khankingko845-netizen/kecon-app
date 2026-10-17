import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as Icons from "@/components/ui/icons";
import { resolveWeight } from "@/components/ui/icons";
import Mascot, { MASCOT_STATES, mascotAlt, mascotSrc } from "@/components/ui/Mascot";
import { CategoryIcon, ICON3D_NAMES, Icon3D, categoryIcon, icon3dSrc } from "@/components/ui/Icon3D";

const PUBLIC = join(process.cwd(), "public");

describe("icons wrapper (UI-02, Phosphor)", () => {
  it.each([
    [{ weight: "thin" as const }, undefined, "thin"],
    [{ fill: "currentColor" }, undefined, "fill"],
    [{ fill: "none" }, undefined, "bold"],
    [{ strokeWidth: 3 }, undefined, "bold"],
    [{ strokeWidth: 2 }, undefined, "duotone"],
    [{}, "bold" as const, "bold"],
    [{ size: 16 }, undefined, "bold"],
    [{ className: "w-4 h-4" }, undefined, "bold"],
    [{ size: 24 }, undefined, "duotone"],
    [{ size: 40 }, undefined, "duotone"],
  ])("resolveWeight(%j, %s) → %s", (props, fallback, expected) => {
    expect(resolveWeight(props, fallback)).toBe(expected);
  });

  it("weight prop luôn thắng", () => {
    expect(resolveWeight({ weight: "regular", fill: "red", size: 12 }, "bold")).toBe("regular");
  });

  it("export đủ tên tương thích lucide đang dùng trong app", () => {
    for (const name of ["Loader2", "Sparkles", "Home", "Settings", "ChevronLeft", "Mic", "BookOpen", "Moon"]) {
      expect(Icons).toHaveProperty(name);
    }
  });

  it("icon trang trí có aria-hidden, icon có nhãn thì không", () => {
    const decorative = renderToStaticMarkup(createElement(Icons.Mic, { size: 20 }));
    expect(decorative).toMatch(/^<svg/);
    expect(decorative).toContain('aria-hidden="true"');
    expect(decorative).toContain('width="20"');

    const labelled = renderToStaticMarkup(createElement(Icons.Mic, { "aria-label": "Ghi âm" }));
    expect(labelled).toContain('aria-label="Ghi âm"');
    expect(labelled).not.toContain("aria-hidden");
  });
});

describe("Mascot Đóm (UI-04)", () => {
  it("có đủ 8 tư thế và file ảnh nhẹ (<40 KB)", () => {
    expect(MASCOT_STATES).toHaveLength(8);
    for (const state of MASCOT_STATES) {
      const file = join(PUBLIC, mascotSrc(state));
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size).toBeLessThan(40 * 1024);
      expect(mascotAlt(state)).toMatch(/Đóm/);
    }
  });

  it("render ảnh với alt mặc định + data-mascot", () => {
    const html = renderToStaticMarkup(createElement(Mascot, { state: "sleepy", size: 120 }));
    expect(html).toContain('src="/mascot/dom-sleepy.webp"');
    expect(html).toContain(`alt="${mascotAlt("sleepy")}"`);
    expect(html).toContain('data-mascot="sleepy"');
    expect(html).toContain("dom-anim-breathe");
    expect(html).toContain('loading="lazy"');
  });

  it("label={null} → trang trí (alt rỗng, aria-hidden); still → không animation; priority → eager", () => {
    const html = renderToStaticMarkup(
      createElement(Mascot, { state: "happy", label: null, still: true, priority: true, glow: false })
    );
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("dom-anim-");
    expect(html).not.toContain("dom-glow");
    expect(html).toContain('loading="eager"');
  });

  it("label tuỳ chỉnh", () => {
    const html = renderToStaticMarkup(createElement(Mascot, { state: "listen", label: "Đóm nghe bé nói" }));
    expect(html).toContain('alt="Đóm nghe bé nói"');
  });
});

describe("Icon 3D (UI-03)", () => {
  it("mọi icon 3D đều có file trong public/icons/3d", () => {
    for (const name of ICON3D_NAMES) {
      const file = join(PUBLIC, icon3dSrc(name));
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size).toBeLessThan(20 * 1024);
    }
  });

  it.each([
    ["all", "books"],
    ["fairy_tale", "castle"],
    ["cotich", "castle"],
    ["adventure", "rocket"],
    ["bedtime", "moon"],
    ["animal", "paw"],
    ["educational", "blocks"],
    ["festival", "lantern"],
    ["unknown-category", "book"],
    [null, "book"],
  ])("categoryIcon(%s) → %s", (category, expected) => {
    expect(categoryIcon(category)).toBe(expected);
  });

  it("Icon3D trang trí mặc định, có nhãn khi truyền label", () => {
    const deco = renderToStaticMarkup(createElement(Icon3D, { name: "moon", size: 32 }));
    expect(deco).toContain('src="/icons/3d/moon.webp"');
    expect(deco).toContain('alt=""');
    expect(deco).toContain('aria-hidden="true"');

    const named = renderToStaticMarkup(createElement(CategoryIcon, { category: "animal", label: "Động vật" }));
    expect(named).toContain('src="/icons/3d/paw.webp"');
    expect(named).toContain('alt="Động vật"');
  });
});
