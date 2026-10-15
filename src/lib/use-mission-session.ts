"use client";
/**
 * G-03: one server-timed listening session per opened story. The player calls
 * `finish()` when the last page ends; the server decides whether enough time
 * passed and what was earned (docs/missions-mvp.md). Failures are silent — a
 * missed reward must never break or delay the story.
 */
import { useCallback, useEffect, useRef } from "react";
import { buildCelebration, type Celebration, type CompleteResult, type StartResult } from "@/lib/missions";

const post = async <T>(body: unknown): Promise<T | null> => {
  const r = await fetch("/api/missions/listen", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.ok ? ((await r.json()) as T) : null;
};

/** One listening session: the server's id once `start` answered (null = off / offline). */
export type MissionSession = Promise<string | null>;

async function complete(pending: MissionSession | null): Promise<{ celebration: Celebration | null; again: boolean }> {
  if (!pending) return { celebration: null, again: false };
  const sessionId = await pending;
  if (!sessionId) return { celebration: null, again: false };
  try {
    const r = await post<CompleteResult>({ action: "complete", sessionId });
    if (!r) return { celebration: null, again: false };
    // Skipped through: keep timing the same session in case the story is replayed.
    return { celebration: buildCelebration(r), again: r.reason !== "too_fast" };
  } catch {
    return { celebration: null, again: false };
  }
}

/** The story ended in the MiniPlayer, after its player closed: same server check, same reward. */
export async function completeDetachedSession(pending: MissionSession | null): Promise<Celebration | null> {
  return (await complete(pending)).celebration;
}

export function useMissionSession(storyId: string | undefined, enabled: boolean) {
  const sessionRef = useRef<Promise<string | null> | null>(null);

  const begin = useCallback(() => {
    if (!enabled || !storyId) {
      sessionRef.current = null;
      return;
    }
    sessionRef.current = post<StartResult>({ action: "start", storyId })
      .then((d) => d?.session_id ?? null)
      .catch(() => null);
  }, [enabled, storyId]);

  useEffect(() => {
    begin();
    return () => {
      sessionRef.current = null;
    };
  }, [begin]);

  /** Resolve what this finished story earned, or null (nothing new / off / offline). */
  const finish = useCallback(async (): Promise<Celebration | null> => {
    const { celebration, again } = await complete(sessionRef.current);
    if (again) begin();
    return celebration;
  }, [begin]);

  /** Hand the running session to the MiniPlayer (the player is closing while the story plays). */
  const detach = useCallback((): MissionSession | null => {
    const pending = sessionRef.current;
    sessionRef.current = null;
    return pending;
  }, []);

  /** The player opened again from the MiniPlayer: keep timing the session that already runs. */
  const attach = useCallback((pending: MissionSession | null) => {
    if (pending) sessionRef.current = pending;
  }, []);

  return { finish, detach, attach };
}
