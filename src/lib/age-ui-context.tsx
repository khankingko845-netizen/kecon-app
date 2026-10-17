"use client";

/**
 * AgeUiProvider (UI-13): resolves the child's age band and mirrors it on
 * <html> — `data-age` (CSS sizes), `data-density` (text density) and
 * `data-say-labels` (FeedbackProvider reads `[data-say]` labels aloud).
 * T10: the band comes from the child chosen on this device (Hồ sơ bé, birth
 * year); without a child or a birth year the device setting is the fallback.
 * The band also syncs to `settings.childAge`, so story creation, drawing and
 * recommendations follow the same band.
 */
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useSettings } from "@/lib/settings-context";
import { useChildProfiles } from "@/lib/child-profiles-context";
import { childAge } from "@/lib/child-profiles";
import { AGE_UI, resolveChildBand, type AgeUi } from "@/lib/age-ui";
import { DEFAULT_AGE_BAND } from "@/lib/age-bands";

const AgeUiContext = createContext<AgeUi>(AGE_UI[DEFAULT_AGE_BAND]);

export function useAgeUi(): AgeUi {
  return useContext(AgeUiContext);
}

export function AgeUiProvider({ children }: { children: ReactNode }) {
  const { activeChild } = useChildProfiles();
  const { settings, updateSettings } = useSettings();
  const ui = AGE_UI[resolveChildBand(childAge(activeChild?.birth_year), settings.childAge)];

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
