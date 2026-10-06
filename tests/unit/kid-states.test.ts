import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GlowDots, KidError, KidLoading, KidSuccess } from "@/components/ui/states";

/** Screens a child uses — UI-06 acceptance: no bare spinner left in them. */
const KID_SCREENS = [
  "Home", "Library", "StoryPlayer", "CreateStory", "Lullaby", "Adventure", "Favorites",
  "Collections", "DrawStory", "VocabQuiz", "DailyChallenges", "Achievements", "Downloads", "ScanBook",
];

describe("kid states (UI-06)", () => {
  it.each(KID_SCREENS)("%s không dùng Loader2 / animate-spin", (name) => {
    const src = readFileSync(join(process.cwd(), "src/components/screens", `${name}.tsx`), "utf8");
    expect(src).not.toMatch(/\bLoader2\b/);
    expect(src).not.toMatch(/animate-spin/);
  });

  it("KidLoading: Đóm suy nghĩ + role=status", () => {
    const html = renderToStaticMarkup(createElement(KidLoading, { title: "Đóm đang mở truyện…" }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-mascot="thinking"');
    expect(html).toContain("Đóm đang mở truyện…");
    expect(html).toContain("data-glow-dots");
  });

  it("KidLoading tone night dùng màu đêm", () => {
    const html = renderToStaticMarkup(createElement(KidLoading, { fullScreen: true, tone: "night" }));
    expect(html).toContain("bg-night");
    expect(html).toContain("text-moon");
  });

  it("KidError: Đóm bối rối + nút thử lại khi có onRetry", () => {
    const html = renderToStaticMarkup(createElement(KidError, { onRetry: vi.fn() }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-mascot="oops"');
    expect(html).toContain("Thử lại");
    expect(renderToStaticMarkup(createElement(KidError, {}))).not.toContain("<button");
  });

  it("KidSuccess: Đóm ăn mừng + hành động tiếp theo", () => {
    const html = renderToStaticMarkup(
      createElement(KidSuccess, { title: "Xong rồi!", action: { label: "Nghe ngay", onClick: vi.fn() } })
    );
    expect(html).toContain('data-mascot="celebrate"');
    expect(html).toContain("Nghe ngay");
  });

  it("GlowDots: ẩn với SR khi không có nhãn, có role=status khi có nhãn", () => {
    expect(renderToStaticMarkup(createElement(GlowDots))).toContain('aria-hidden="true"');
    const labelled = renderToStaticMarkup(createElement(GlowDots, { label: "Đang tải" }));
    expect(labelled).toContain('role="status"');
    expect(labelled).toContain('aria-label="Đang tải"');
  });
});
