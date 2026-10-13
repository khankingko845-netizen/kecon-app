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
    const pending = sessionRef.current;
    if (!pending) return null;
    const sessionId = await pending;
    if (!sessionId) return null;
    try {
      const r = await post<CompleteResult>({ action: "complete", sessionId });
      if (!r) return null;
      // Skipped through: keep timing the same session in case the story is replayed.
      if (r.reason !== "too_fast") begin();
      return buildCelebration(r);
    } catch {
      return null;
    }
  }, [begin]);

  return { finish };
}
