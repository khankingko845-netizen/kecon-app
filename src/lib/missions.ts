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
/** G-06: what a parent confirmed today — a habit (one star) or a good deed (thanks only). */
export type HabitKind = "habit" | "kindness";
export interface HabitToday {
  id: string;
  kind: HabitKind;
  title: string;
  line: string;
}
/** G-07: "cả nhà đọc cùng nhau" — stories a parent marked as read together this week. */
export interface FamilyProgress {
  id: string;
  title: string;
  target: number;
  progress: number;
  done: boolean;
}
export interface MissionsToday {
  date: string;
  missions: MissionStatus[];
  habits: HabitToday[];
  family: FamilyProgress | null;
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
  constellations: { week_start: string; earned_on: string }[];
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

// ── G-06 / G-07: the parent's week (behind the parent gate) ────────────────
export interface ParentWeekStory {
  session_id: string;
  story_id: string | null;
  title: string | null;
  category: string | null;
  date: string;
  together: boolean;
  prompt: string | null;
}
export interface ParentHabit {
  id: string;
  kind: HabitKind;
  title: string;
  label: string;
  prompt: string | null;
  today: boolean;
  week: number;
}
export interface ParentNotify {
  enabled: boolean;
  hour: number;
  devices: number;
}
export interface ParentWeek {
  summary: MissionsToday;
  stories: ParentWeekStory[];
  habits: ParentHabit[];
  family: (FamilyProgress & { label: string }) | null;
  notify: ParentNotify;
}
/** GET /api/missions/parent adds whether this server can send reminders. */
export interface ParentWeekResponse extends ParentWeek {
  push: { publicKey: string | null };
}
export interface ConfirmResult {
  confirmed: boolean;
  kind: HabitKind;
  star: boolean;
  line: string | null;
  reason?: "already_confirmed";
}
export interface TogetherResult {
  marked: boolean;
  progress: number;
  target: number;
  done: boolean;
  constellation: boolean;
  line: string | null;
}

/** Copy for good deeds (rule 9): thanked in words, never traded for a star or sticker. */
export const KINDNESS_NOTE = "Việc tốt cho người khác chỉ được cảm ơn bằng lời, không đổi lấy sao.";
export const HABIT_NOTE = "Bố mẹ thấy bé làm thật thì mới bấm. Mỗi thói quen được một ngôi sao mỗi ngày.";
export const REMINDER_NOTE = "Tối đa 1 lần mỗi ngày, chỉ gửi đến máy bố mẹ đăng ký ở đây — không gửi khi bé đang dùng chế độ của bé.";

/** Conversation starters when a story has no prompt of its own (no right answers, no quiz). */
const GENERIC_PROMPTS: Record<string, string> = {
  fairy_tale: "Hỏi bé: “Nếu con ở trong truyện, con sẽ làm gì?”",
  folk: "Hỏi bé: “Nhân vật nào làm con nhớ nhất? Vì sao?”",
  animal: "Hỏi bé: “Bạn thú trong truyện đã cảm thấy thế nào?”",
  bedtime: "Hỏi bé: “Đoạn nào trong truyện làm con thấy dễ chịu nhất?”",
  adventure: "Hỏi bé: “Nếu được đi cùng, con sẽ mang theo gì?”",
  educational: "Hỏi bé: “Bạn nhỏ trong truyện đã thử cách nào? Con muốn thử không?”",
};
export const DEFAULT_PROMPT = "Hỏi bé: “Con thích nhân vật nào nhất? Vì sao?”";

export function conversationPrompt(story: Pick<ParentWeekStory, "prompt" | "category">): string {
  return story.prompt ?? (story.category ? GENERIC_PROMPTS[story.category] : undefined) ?? DEFAULT_PROMPT;
}

/** Family progress, counting stories read together — never what was missed. */
export function familyLine(progress: number, target: number): string {
  if (progress >= target) return "Chòm sao của nhà mình đã sáng tuần này!";
  if (progress === 0) return `Đọc cùng bé ${target} truyện trong tuần để thắp chòm sao của nhà mình.`;
  return `Đã đọc cùng ${progress}/${target} truyện tuần này.`;
}

/** Child-facing line on Bầu trời for the family constellation. */
export function familySkyLine(progress: number, target: number): string {
  if (progress >= target) return "Cả nhà đã đọc cùng nhau đủ truyện. Chòm sao sáng rồi!";
  if (progress === 0) return `Đọc cùng bố mẹ ${target} truyện để thắp chòm sao của nhà mình.`;
  return `Cả nhà đã đọc cùng nhau ${progress}/${target} truyện.`;
}

export const REMINDER_HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21] as const;
export function hourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}
