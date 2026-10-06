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

export function saveLastPlayed(v: Omit<LastPlayed, "updatedAt">) {
  try {
    localStorage.setItem(LAST_PLAYED_KEY, JSON.stringify({ ...v, updatedAt: Date.now() }));
  } catch {
    /* storage full / private mode — not critical */
  }
}

/** Progress shown on the "Nghe tiếp" bar (0–100). Page 1 of 4 → 25. */
export function lastPlayedProgress(v: Pick<LastPlayed, "page" | "totalPages">): number {
  return Math.round((v.page / Math.max(1, v.totalPages)) * 100);
}
