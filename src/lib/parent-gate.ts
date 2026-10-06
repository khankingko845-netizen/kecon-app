/**
 * T19 / UI-10 · Cổng phụ huynh (pure logic, no React).
 *
 * The "Bố mẹ" tab and every screen reachable only from it are adult-only.
 * They open after the parent PIN (server-verified, T03) or — when no PIN is
 * set yet — an adult question a 3–8 year old can't answer (two-digit ×
 * one-digit multiplication; a new question after every wrong answer, so
 * guessing doesn't help). The unlock is in-memory only and expires after
 * {@link UNLOCK_IDLE_MS} without interaction or when a kid tab is opened.
 */
import type { Screen } from "@/lib/types";

/** Screens that require the parent gate (Settings + everything under it). */
export const PARENT_SCREENS: readonly Screen[] = [
  "settings",
  "parental-controls",
  "parent-analytics",
  "subscription",
  "profile-edit",
  "notifications",
  "admin",
  "admin-stories",
  "admin-users",
  "admin-analytics",
  "admin-settings",
  "admin-categories",
  "admin-templates",
];

export function isParentArea(screen: Screen): boolean {
  return PARENT_SCREENS.includes(screen);
}

/** Unlock lasts this long after the last tap/keypress inside the parent area. */
export const UNLOCK_IDLE_MS = 5 * 60_000;

/** Wrong adult answers in a row before a short cool-down. */
export const MAX_CHALLENGE_ATTEMPTS = 3;
export const CHALLENGE_COOLDOWN_MS = 30_000;

export interface AdultChallenge {
  a: number;
  b: number;
  /** Display text, e.g. "14 × 7". */
  question: string;
  /** Screen-reader text, e.g. "14 nhân 7 bằng bao nhiêu?". */
  spoken: string;
  answer: number;
}

/** Random 12–19 × 3–9 (answers 36–171): trivial for adults, not for young kids. */
export function createAdultChallenge(rand: () => number = Math.random): AdultChallenge {
  const pick = (min: number, max: number) => min + Math.min(max - min, Math.floor(rand() * (max - min + 1)));
  const a = pick(12, 19);
  const b = pick(3, 9);
  return { a, b, question: `${a} × ${b}`, spoken: `${a} nhân ${b} bằng bao nhiêu?`, answer: a * b };
}

export function isChallengeAnswerCorrect(challenge: AdultChallenge, input: string): boolean {
  const trimmed = input.trim();
  if (!/^\d{1,4}$/.test(trimmed)) return false;
  return Number(trimmed) === challenge.answer;
}

/** Digits-only input helper for the on-screen keypad (max length). */
export function appendDigit(value: string, digit: string, maxLength: number): string {
  if (!/^\d$/.test(digit) || value.length >= maxLength) return value;
  return value + digit;
}

export function seconds(ms: number): number {
  return Math.max(0, Math.ceil(ms / 1000));
}
