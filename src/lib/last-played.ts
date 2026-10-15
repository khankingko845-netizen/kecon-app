/** "Nghe tiếp" on Home: the story the child was last listening to (device-local). */
export const LAST_PLAYED_KEY = "kecon-last-played";

export interface LastPlayed {
  storyId: string;
  title: string;
  page: number; // 1-based
  totalPages: number;
  voice?: string;
  category?: string | null;
  updatedAt: number;
}

export function readLastPlayed(raw: string | null): LastPlayed | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<LastPlayed>;
    if (typeof v.storyId !== "string" || typeof v.title !== "string") return null;
    const totalPages = Math.max(1, Number(v.totalPages) || 1);
    const page = Math.min(totalPages, Math.max(1, Number(v.page) || 1));
    return { storyId: v.storyId, title: v.title, page, totalPages, voice: v.voice, category: v.category ?? null, updatedAt: Number(v.updatedAt) || 0 };
  } catch {
    return null;
  }
}

export function getLastPlayed(): LastPlayed | null {
  if (typeof localStorage === "undefined") return null;
  return readLastPlayed(localStorage.getItem(LAST_PLAYED_KEY));
}

/** Fired on `window` after every save, so an open Home card follows the mini player. */
export const LAST_PLAYED_EVENT = "kecon:last-played";

export function saveLastPlayed(v: Omit<LastPlayed, "updatedAt">) {
  try {
    localStorage.setItem(LAST_PLAYED_KEY, JSON.stringify({ ...v, updatedAt: Date.now() }));
  } catch {
    /* storage full / private mode — not critical */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LAST_PLAYED_EVENT));
}

/**
 * The mini player turned the page: keep "Nghe tiếp" in step. Voice/category
 * come from the full player's save of the same story (kept as they were).
 */
export function updateLastPlayedPage(v: { storyId: string; title: string; page: number; totalPages: number }) {
  const prev = getLastPlayed();
  const same = prev?.storyId === v.storyId;
  if (same && prev.page === v.page && prev.totalPages === v.totalPages) return;
  saveLastPlayed({ ...v, voice: same ? prev.voice : undefined, category: same ? prev.category : null });
}

/** 1-based page to open from "Nghe tiếp" (clamped; 1 when nothing was heard yet). */
export function resumePage(v: Pick<LastPlayed, "page" | "totalPages"> | null | undefined): number {
  if (!v) return 1;
  const total = Math.max(1, Math.floor(Number(v.totalPages) || 1));
  return Math.min(total, Math.max(1, Math.floor(Number(v.page) || 1)));
}

/** Progress shown on the "Nghe tiếp" bar (0–100). Page 1 of 4 → 25. */
export function lastPlayedProgress(v: Pick<LastPlayed, "page" | "totalPages">): number {
  return Math.round((v.page / Math.max(1, v.totalPages)) * 100);
}
