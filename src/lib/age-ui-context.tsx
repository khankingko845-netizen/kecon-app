"use client";

/**
 * AgeUiProvider (UI-13): resolves the child's age band and mirrors it on
 * <html> — `data-age` (CSS sizes), `data-density` (text density) and
 * `data-say-labels` (FeedbackProvider reads `[data-say]` labels aloud).
 * The profile age also syncs to `settings.childAge`, so story creation,
 * drawing and recommendations follow the same band.
 */
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { AGE_UI, resolveChildBand, type AgeUi } from "@/lib/age-ui";
import { DEFAULT_AGE_BAND } from "@/lib/age-bands";

const AgeUiContext = createContext<AgeUi>(AGE_UI[DEFAULT_AGE_BAND]);

export function useAgeUi(): AgeUi {
  return useContext(AgeUiContext);
}

export function AgeUiProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const { settings, updateSettings } = useSettings();
  const ui = AGE_UI[resolveChildBand(profile?.child_age, settings.childAge)];

  useEffect(() => {
    if (ui.band !== settings.childAge) updateSettings({ childAge: ui.band });
  }, [ui.band, settings.childAge, updateSettings]);

  useEffect(() => {
    const html = document.documentElement;
    html.dataset.age = ui.band;
    html.dataset.density = ui.density;
    if (ui.speakLabels) html.dataset.sayLabels = "1";
    else delete html.dataset.sayLabels;
  }, [ui]);

  return <AgeUiContext.Provider value={ui}>{children}</AgeUiContext.Provider>;
}
