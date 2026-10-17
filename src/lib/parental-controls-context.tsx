"use client";

/**
 * Parental controls loaded once per session and shared by the screen-time
 * lock (T19) and the kid content filter. Parental controls dispatch
 * {@link PARENTAL_CONTROLS_EVENT} after saving so changes apply at once.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { useData } from "@/lib/data-context";
import { getParentalControls, type ParentalControls } from "@/lib/db";
import { filterAllowed, toContentRules, type ContentRules } from "@/lib/content-filter";
import type { ScreenTimeRules } from "@/lib/screen-time";

export const PARENTAL_CONTROLS_EVENT = "kecon:parental-controls-changed";

interface ParentalControlsValue {
  controls: ParentalControls | null;
  screenRules: ScreenTimeRules | null;
  contentRules: ContentRules | null;
  refresh: () => void;
}

const Ctx = createContext<ParentalControlsValue>({
  controls: null,
  screenRules: null,
  contentRules: null,
  refresh: () => {},
});

export function useParentalControls() {
  return useContext(Ctx);
}

export function ParentalControlsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const [controls, setControls] = useState<ParentalControls | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!userId) {
      setControls(null);
      return;
    }
    let alive = true;
    getParentalControls(userId)
      .then((c) => alive && setControls(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId, version]);

  useEffect(() => {
    window.addEventListener(PARENTAL_CONTROLS_EVENT, refresh);
    return () => window.removeEventListener(PARENTAL_CONTROLS_EVENT, refresh);
  }, [refresh]);

  const value = useMemo<ParentalControlsValue>(() => {
    const screenRules: ScreenTimeRules | null = controls
      ? {
          is_enabled: Boolean(controls.is_enabled),
          daily_limit_minutes: Number(controls.daily_limit_minutes) || 0,
          bedtime_start: controls.bedtime_start ?? null,
          bedtime_end: controls.bedtime_end ?? null,
        }
      : null;
    return { controls, screenRules, contentRules: toContentRules(controls), refresh };
  }, [controls, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Library stories the kid may see (blocked categories / age cap removed). */
export function useKidStories() {
  const { stories, loading } = useData();
  const { contentRules } = useParentalControls();
  const visible = useMemo(() => filterAllowed(stories, contentRules), [stories, contentRules]);
  return { stories: visible, hidden: stories.length - visible.length, loading, contentRules };
}
