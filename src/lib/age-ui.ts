/**
 * "Lớn cùng bé" UI profiles (UI v2, ticket UI-13).
 *
 * The child's age band (from the family profile) drives how the kid screens
 * look — docs/design/ui-v2/README.md §6:
 * - 3–5 "Mầm": little text, big buttons (≥ 64px), tapping an icon makes Đóm
 *   read its name, fewer choices per screen ("1 việc/màn").
 * - 6–8 "Chồi": short text, more choices (the v1 baseline).
 * - 9–12 "Lá": more text, compact buttons, Đóm shrinks to a companion.
 *
 * Pixel sizes are mirrored as CSS variables in globals.css (`html[data-age]`)
 * so every Button3D / Mascot follows without per-screen code; structural
 * choices (columns, which shortcuts) come from `useAgeUi()`.
 */
import { AGE_BANDS, DEFAULT_AGE_BAND, normalizeAgeBand, type AgeBandId } from "@/lib/age-bands";
import type { Screen } from "@/lib/types";

export type TextDensity = "low" | "medium" | "high";

export interface AgeUi {
  band: AgeBandId;
  /** "3–5 tuổi" */
  label: string;
  /** "Mầm" / "Chồi" / "Lá" */
  short: string;
  /** low → secondary lines hidden; high → extra detail (descriptions) shown. */
  density: TextDensity;
  /** Minimum tap target for kid controls (px) — CSS `--kid-tap`. */
  tap: number;
  /** Button3D heights (px) — CSS `--kid-btn-lg|md|sm`. */
  button: { lg: number; md: number; sm: number };
  /** Đóm size multiplier — CSS `--dom-scale`. */
  domScale: number;
  /** Tap an icon/label → Đóm reads it aloud (pre-readers). */
  speakLabels: boolean;
  /** Home "Chủ đề" grid. */
  topicColumns: 2 | 3;
  topicIcon: number;
  /** Home "Khám phá thêm" shortcuts; `null` = all. */
  explore: readonly Screen[] | null;
  /** One-line explanation for parents (Hồ sơ gia đình). */
  summary: string;
}

const band = (id: AgeBandId) => AGE_BANDS.find((b) => b.id === id)!;

export const AGE_UI: Record<AgeBandId, AgeUi> = {
  "3-5": {
    band: "3-5",
    label: band("3-5").label,
    short: band("3-5").short,
    density: "low",
    tap: 64,
    button: { lg: 68, md: 56, sm: 48 },
    domScale: 1,
    speakLabels: true,
    topicColumns: 2,
    topicIcon: 96,
    explore: ["favorites", "draw-story", "scan-book"],
    summary: "Ít chữ, nút to, chạm biểu tượng là Đóm đọc tên",
  },
  "6-8": {
    band: "6-8",
    label: band("6-8").label,
    short: band("6-8").short,
    density: "medium",
    tap: 56,
    button: { lg: 64, md: 48, sm: 44 },
    domScale: 1,
    speakLabels: false,
    topicColumns: 3,
    topicIcon: 70,
    explore: null,
    summary: "Chữ ngắn, nhiều lựa chọn hơn, bé tự đọc tên chủ đề",
  },
  "9-12": {
    band: "9-12",
    label: band("9-12").label,
    short: band("9-12").short,
    density: "high",
    tap: 48,
    button: { lg: 56, md: 46, sm: 44 },
    domScale: 0.78,
    speakLabels: false,
    topicColumns: 3,
    topicIcon: 56,
    explore: null,
    summary: "Nhiều chữ hơn, nút gọn, Đóm nhỏ lại thành bạn đồng hành",
  },
};

export function ageUiFor(value: string | number | null | undefined): AgeUi {
  return AGE_UI[normalizeAgeBand(value)];
}

/**
 * The family profile's age wins (it is what parents edit in "Hồ sơ gia đình");
 * the device setting is the fallback; default 3–5.
 */
export function resolveChildBand(profileAge: number | null | undefined, settingsAge: string | null | undefined): AgeBandId {
  if (typeof profileAge === "number" && Number.isFinite(profileAge) && profileAge > 0) return normalizeAgeBand(profileAge);
  return settingsAge ? normalizeAgeBand(settingsAge) : DEFAULT_AGE_BAND;
}

/** Filter Home shortcuts for the band. */
export function exploreFor<T extends { screen: Screen }>(items: readonly T[], ui: AgeUi): T[] {
  if (!ui.explore) return [...items];
  const allowed = new Set<Screen>(ui.explore);
  return items.filter((i) => allowed.has(i.screen));
}
