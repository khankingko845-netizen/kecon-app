/**
 * Night mode (UI v2, ticket UI-08).
 *
 * Bedtime palette (no pure white, warm "moon" text, dimmed visuals) that turns
 * on automatically in the evening. Pure helpers live here so they can be unit
 * tested; ThemeProvider wires them to the DOM (`html.night.dark`).
 */
export type NightPref = "auto" | "on" | "off";

export const NIGHT_PREFS: readonly NightPref[] = ["auto", "on", "off"] as const;
export const NIGHT_STORAGE_KEY = "kecon-night-mode";

/** Default bedtime window — 19:30 → 06:00 the next morning. */
export const DEFAULT_NIGHT_WINDOW = { start: "19:30", end: "06:00" } as const;
export type NightWindow = { start: string; end: string };

export function parseNightPref(value: string | null | undefined): NightPref {
  return value === "on" || value === "off" || value === "auto" ? value : "auto";
}

/** "HH:MM" → minutes after midnight (invalid → NaN). */
export function parseHm(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return Number.NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return Number.NaN;
  return h * 60 + min;
}

/** True when `date` (local time) falls inside the window; handles windows crossing midnight. */
export function isWithinNightWindow(date: Date, window: NightWindow = DEFAULT_NIGHT_WINDOW): boolean {
  const start = parseHm(window.start);
  const end = parseHm(window.end);
  if (Number.isNaN(start) || Number.isNaN(end) || start === end) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  return start < end ? now >= start && now < end : now >= start || now < end;
}

export function resolveNight(pref: NightPref, date: Date, window: NightWindow = DEFAULT_NIGHT_WINDOW): boolean {
  if (pref === "on") return true;
  if (pref === "off") return false;
  return isWithinNightWindow(date, window);
}

/** Milliseconds until the next window boundary (start or end) — used to re-evaluate "auto". */
export function msUntilNextBoundary(date: Date, window: NightWindow = DEFAULT_NIGHT_WINDOW): number {
  const marks = [parseHm(window.start), parseHm(window.end)].filter((n) => !Number.isNaN(n));
  if (marks.length === 0) return 60 * 60 * 1000;
  const nowMs =
    ((date.getHours() * 60 + date.getMinutes()) * 60 + date.getSeconds()) * 1000 + date.getMilliseconds();
  const day = 24 * 60 * 60 * 1000;
  let best = day;
  for (const mark of marks) {
    let diff = mark * 60 * 1000 - nowMs;
    if (diff <= 0) diff += day;
    best = Math.min(best, diff);
  }
  return best;
}

/** Sleep-timer choices offered in Player & Lullaby (minutes). */
export const SLEEP_TIMER_OPTIONS = [5, 10, 15, 30, 45] as const;

export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
