/**
 * "Bầu trời của Đóm" — child-facing copy and pure helpers for the missions MVP
 * (G-01…G-05, docs/missions-mvp.md). The server (migration 034) decides what
 * was earned; this module only names it for the child. Client-safe: no zod,
 * no Supabase, no secrets.
 *
 * Copy rules (G-01, shared with Đóm's lines): praise names what the child did
 * ("đã nghe đến trang cuối"), never "giỏi/thông minh", never counts days in a
 * row, never scares, blames, guilts or sells. ≤ 12 words per spoken line.
 */
import type { DomLine } from "@/lib/dom-lines";

export const MISSION_IDS = ["nghe-het-truyen", "co-tich", "thoi-quen-tot", "con-vat", "truyen-moi"] as const;
export type MissionId = (typeof MISSION_IDS)[number];
export type MissionIcon = "book" | "castle" | "leaf" | "paw" | "sparkles";

export interface MissionCopy {
  /** Short task name shown on the mission card. */
  title: string;
  /** How to do it, for the parent reading along. */
  hint: string;
  /** Process praise Đóm says when this mission is completed. */
  praise: string;
  icon: MissionIcon;
}

export const MISSION_COPY: Record<MissionId, MissionCopy> = {
  "nghe-het-truyen": {
    title: "Nghe hết một truyện",
    hint: "Cùng nghe đến trang cuối nhé",
    praise: "Bé đã nghe trọn vẹn một câu chuyện!",
    icon: "book",
  },
  "co-tich": {
    title: "Nghe một truyện cổ tích",
    hint: "Chọn truyện ở kệ Cổ tích",
    praise: "Bé đã gặp thêm một nhân vật cổ tích!",
    icon: "castle",
  },
  "thoi-quen-tot": {
    title: "Nghe truyện thói quen tốt",
    hint: "Ví dụ truyện Bo và Su",
    praise: "Bé đã nghe xong một truyện thói quen tốt!",
    icon: "leaf",
  },
  "con-vat": {
    title: "Nghe truyện về con vật",
    hint: "Chọn truyện có các bạn thú",
    praise: "Bé đã làm quen thêm một bạn thú!",
    icon: "paw",
  },
  "truyen-moi": {
    title: "Nghe một truyện mới",
    hint: "Chọn truyện bé chưa nghe",
    praise: "Bé đã khám phá một câu chuyện mới!",
    icon: "sparkles",
  },
};

/** A template added on the server before the app knows it still reads well. */
export const FALLBACK_MISSION: MissionCopy = {
  title: "Nhiệm vụ nghe truyện",
  hint: "Cùng nghe đến trang cuối nhé",
  praise: "Bé đã nghe trọn vẹn một câu chuyện!",
  icon: "book",
};

export function isMissionId(v: unknown): v is MissionId {
  return typeof v === "string" && (MISSION_IDS as readonly string[]).includes(v);
}

export function missionCopy(id: string): MissionCopy {
  return isMissionId(id) ? MISSION_COPY[id] : FALLBACK_MISSION;
}

export const ALL_DONE_LINE = "Hôm nay xong hết nhiệm vụ rồi. Mình nghỉ ngơi nhé!";
export const STICKER_LINE = "Album của bé có thêm một bạn mới!";

/** Total stories listened together (not consecutive days — G-01). */
export function milestoneLine(n: number): string {
  return n <= 1 ? "Ngôi sao đầu tiên đã sáng trên bầu trời!" : `Bé đã nghe trọn ${n} câu chuyện cùng tớ!`;
}

export const WEEKDAY_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"] as const;
export const WEEKDAY_NAMES = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật"] as const;

/** Home chip, two short lines (G-02). Counts nights this week; resets quietly each Monday. */
export function weekChipParts(nights: number): [string, string] {
  return nights > 0 ? ["Tuần này", `${nights} tối`] : ["Bầu trời", "của Đóm"];
}

export function weekChipLabel(nights: number): string {
  return weekChipParts(nights).join(" ");
}

/** Accessible name keeps the visible words first (WCAG 2.5.3 label in name). */
export function weekChipAria(nights: number): string {
  return nights > 0 ? `Tuần này ${nights} tối nghe truyện, mở Bầu trời của Đóm` : "Mở Bầu trời của Đóm";
}

/** Weekly goal copy: celebrates progress, never warns about a "lost" week. */
export function weekGoalLine(nights: number, goal: number): string {
  if (nights >= goal) return "Bầu trời tuần này sáng rực rồi!";
  if (nights === 0) return "Tối nào nghe truyện, bầu trời thêm một ngôi sao.";
  return `Đã sáng ${nights}/${goal} tối trong tuần này.`;
}

export interface MissionStatus {
  id: string;
  done: boolean;
}
export interface WeekDay {
  date: string;
  stars: number;
  listened: boolean;
}
export interface MissionsToday {
  date: string;
  missions: MissionStatus[];
  week: { start: string; goal: number; nights: number; days: WeekDay[] };
  totals: { stories: number; stars: number; stickers: number };
}
export interface MissionSticker {
  story_id: string;
  title: string | null;
  cover_image_url: string | null;
  earned_on?: string;
}
export interface MissionsAlbum {
  stickers: MissionSticker[];
  milestones: number[];
}
export type CompleteReason = "too_fast" | "expired" | "already_completed";
export interface CompleteResult {
  counted: boolean;
  reason?: CompleteReason;
  completed: string[];
  sticker: MissionSticker | null;
  milestone: number | null;
  today: MissionsToday | null;
}
export interface StartResult {
  session_id: string;
  min_seconds: number;
}

export interface Celebration {
  /** Stars earned by this story (one per mission completed). */
  stars: number;
  /** Đóm's spoken line: the most specific process praise. */
  line: DomLine;
  missions: { id: string; title: string }[];
  sticker: MissionSticker | null;
  milestone: number | null;
  allDone: boolean;
  nights: number | null;
}

/**
 * What to celebrate after a counted story. Nothing new earned (e.g. the same
 * story again tonight) → null, and the player keeps its usual story-end line.
 */
export function buildCelebration(r: CompleteResult): Celebration | null {
  if (!r.counted) return null;
  const done = r.completed;
  if (done.length === 0 && !r.sticker && !r.milestone) return null;
  const themed = done.find((id) => id !== "nghe-het-truyen");
  const missions = r.today?.missions ?? [];
  const allDone = done.length > 0 && missions.length > 0 && missions.every((m) => m.done);
  const text = themed
    ? missionCopy(themed).praise
    : done.length > 0
      ? missionCopy(done[0]).praise
      : r.milestone
        ? milestoneLine(r.milestone)
        : STICKER_LINE;
  return {
    stars: done.length,
    line: { moment: "story-end", mascot: "celebrate", text, speak: true },
    missions: done.map((id) => ({ id, title: missionCopy(id).title })),
    sticker: r.sticker,
    milestone: r.milestone,
    allDone,
    nights: r.today?.week.nights ?? null,
  };
}
