"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getParentalControls } from "@/lib/db";
import { useAudioPlayer } from "@/lib/audio-player-context";
import {
  addUsage,
  evaluateScreenTime,
  grantExtraTime,
  parseUsage,
  SCREEN_TIME_KEY,
  TICK_SECONDS,
  type ScreenTimeRules,
  type ScreenTimeVerdict,
} from "@/lib/screen-time";

/** Fired by Parental controls after saving so limits apply without a reload. */
export const PARENTAL_CONTROLS_EVENT = "kecon:parental-controls-changed";

function readUsage(now: Date) {
  try {
    return parseUsage(localStorage.getItem(SCREEN_TIME_KEY), now);
  } catch {
    return parseUsage(null, now);
  }
}

function writeUsage(value: ReturnType<typeof parseUsage>) {
  try {
    localStorage.setItem(SCREEN_TIME_KEY, JSON.stringify(value));
  } catch {
    /* storage full / disabled: limits just won't persist */
  }
}

const same = (a: ScreenTimeVerdict, b: ScreenTimeVerdict) =>
  a.blocked === b.blocked && (!a.blocked || !b.blocked || a.reason === b.reason);

/**
 * Counts kid-area usage on this device and decides whether kid screens must be
 * locked (daily limit / bedtime from Parental controls). `paused` = parent
 * area is open, so the parent's own time is not counted.
 */
export function useScreenTime({ userId, paused }: { userId?: string; paused: boolean }) {
  const { isPlaying } = useAudioPlayer();
  const playing = useRef(isPlaying);
  const [rules, setRules] = useState<ScreenTimeRules | null>(null);
  const [verdict, setVerdict] = useState<ScreenTimeVerdict>({ blocked: false });

  useEffect(() => {
    playing.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    if (!userId) {
      setRules(null);
      return;
    }
    let alive = true;
    const load = () => {
      getParentalControls(userId)
        .then((c) => {
          if (!alive) return;
          setRules(
            c
              ? {
                  is_enabled: Boolean(c.is_enabled),
                  daily_limit_minutes: Number(c.daily_limit_minutes) || 0,
                  bedtime_start: c.bedtime_start ?? null,
                  bedtime_end: c.bedtime_end ?? null,
                }
              : null
          );
        })
        .catch(() => {});
    };
    load();
    window.addEventListener(PARENTAL_CONTROLS_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(PARENTAL_CONTROLS_EVENT, load);
    };
  }, [userId]);

  const evaluate = useCallback(() => {
    const now = new Date();
    const next = evaluateScreenTime(rules, readUsage(now), now);
    setVerdict((prev) => (same(prev, next) ? prev : next));
    return next;
  }, [rules]);

  useEffect(() => {
    if (!userId) return;
    evaluate();
    const id = window.setInterval(() => {
      const now = new Date();
      const current = evaluate();
      const active = !paused && !current.blocked && (document.visibilityState === "visible" || playing.current);
      if (active) {
        writeUsage(addUsage(readUsage(now), TICK_SECONDS, now));
        evaluate();
      }
    }, TICK_SECONDS * 1000);
    document.addEventListener("visibilitychange", evaluate);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", evaluate);
    };
  }, [userId, paused, evaluate]);

  const grant = useCallback(
    (minutes: number) => {
      const now = new Date();
      writeUsage(grantExtraTime(readUsage(now), minutes, now));
      evaluate();
    },
    [evaluate]
  );

  return { verdict, rules, grant };
}
