/**
 * T19 · Giới hạn thời gian/ngày + giờ đi ngủ (pure logic, no React).
 *
 * Usage is counted on this device (localStorage) per local calendar day,
 * only while the kid area is in use (visible or playing audio). When the
 * parent's controls are on and the daily budget is spent — or it is inside
 * the bedtime window — kid screens are replaced by a lock screen that only
 * the parent gate can lift, by granting extra minutes.
 */

export const SCREEN_TIME_KEY = "kecon-screen-time-v1";
/** Usage is sampled at this interval. */
export const TICK_SECONDS = 15;
export const GRANT_OPTIONS = [15, 30] as const;

export interface ScreenTimeUsage {
  /** Local date, YYYY-MM-DD. */
  date: string;
  seconds: number;
  /** Epoch ms until which the parent lifted the lock (extra time). */
  grantUntil: number;
}

export interface ScreenTimeRules {
  is_enabled: boolean;
  daily_limit_minutes: number;
  bedtime_start: string | null;
  bedtime_end: string | null;
}

export type ScreenTimeVerdict =
  | { blocked: false }
  | { blocked: true; reason: "limit" | "bedtime" };

const pad = (n: number) => String(n).padStart(2, "0");

export function localDateKey(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function emptyUsage(now: Date): ScreenTimeUsage {
  return { date: localDateKey(now), seconds: 0, grantUntil: 0 };
}

/** Parse stored usage; a new day (or bad data) starts from zero but keeps an active grant. */
export function parseUsage(raw: string | null, now: Date): ScreenTimeUsage {
  const fresh = emptyUsage(now);
  if (!raw) return fresh;
  try {
    const v = JSON.parse(raw) as Partial<ScreenTimeUsage>;
    const grantUntil = typeof v.grantUntil === "number" && Number.isFinite(v.grantUntil) ? v.grantUntil : 0;
    if (v.date !== fresh.date) return { ...fresh, grantUntil };
    const secs = typeof v.seconds === "number" && Number.isFinite(v.seconds) && v.seconds > 0 ? Math.floor(v.seconds) : 0;
    return { date: fresh.date, seconds: secs, grantUntil };
  } catch {
    return fresh;
  }
}

export function addUsage(usage: ScreenTimeUsage, secs: number, now: Date): ScreenTimeUsage {
  const base = usage.date === localDateKey(now) ? usage : { ...emptyUsage(now), grantUntil: usage.grantUntil };
  return { ...base, seconds: base.seconds + Math.max(0, Math.floor(secs)) };
}

export function grantExtraTime(usage: ScreenTimeUsage, minutes: number, now: Date): ScreenTimeUsage {
  const from = Math.max(now.getTime(), usage.grantUntil);
  return { ...usage, grantUntil: from + minutes * 60_000 };
}

/** "HH:MM" or "HH:MM:SS" → minutes after midnight; null when invalid. */
export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Inside [start, end) — the window may cross midnight (e.g. 20:30–06:00). */
export function isWithinBedtime(start: string | null, end: string | null, now: Date): boolean {
  const s = parseClock(start);
  const e = parseClock(end);
  if (s === null || e === null || s === e) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  return s < e ? t >= s && t < e : t >= s || t < e;
}

export function minutesLeft(rules: ScreenTimeRules | null, usage: ScreenTimeUsage): number | null {
  if (!rules?.is_enabled || !(rules.daily_limit_minutes > 0)) return null;
  return Math.max(0, Math.ceil(rules.daily_limit_minutes - usage.seconds / 60));
}

export function evaluateScreenTime(
  rules: ScreenTimeRules | null,
  usage: ScreenTimeUsage,
  now: Date
): ScreenTimeVerdict {
  if (!rules?.is_enabled) return { blocked: false };
  if (usage.grantUntil > now.getTime()) return { blocked: false };
  if (isWithinBedtime(rules.bedtime_start, rules.bedtime_end, now)) return { blocked: true, reason: "bedtime" };
  if (rules.daily_limit_minutes > 0 && usage.seconds >= rules.daily_limit_minutes * 60) {
    return { blocked: true, reason: "limit" };
  }
  return { blocked: false };
}
