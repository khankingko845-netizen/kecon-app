"use client";

import { createContext, useContext, useState, useEffect, useCallback, useSyncExternalStore } from "react";
import {
  NIGHT_STORAGE_KEY,
  isWithinNightWindow,
  msUntilNextBoundary,
  parseNightPref,
  type NightPref,
} from "@/lib/night-mode";

type ThemeMode = "light" | "dark" | "system";

interface ThemeContextValue {
  mode: ThemeMode;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
  /** Night mode preference (UI-08): auto = 19:30 → 06:00. */
  nightPref: NightPref;
  /** Night palette currently active (implies dark). */
  isNight: boolean;
  setNightPref: (pref: NightPref) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "system",
  isDark: false,
  setMode: () => {},
  toggle: () => {},
  nightPref: "auto",
  isNight: false,
  setNightPref: () => {},
});

/* ── Night preference store (localStorage, synced across tabs) ── */
const nightPrefListeners = new Set<() => void>();
function subscribeNightPref(cb: () => void) {
  nightPrefListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === NIGHT_STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    nightPrefListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}
const getNightPref = (): NightPref => parseNightPref(localStorage.getItem(NIGHT_STORAGE_KEY));
const getServerNightPref = (): NightPref => "auto";

/* ── Clock store: re-evaluates exactly at 19:30 / 06:00 and when the tab wakes up ── */
function subscribeNightWindow(cb: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    clearTimeout(timer);
    // +1s so we land just after the boundary minute flips.
    timer = setTimeout(() => {
      cb();
      schedule();
    }, msUntilNextBoundary(new Date()) + 1000);
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") {
      cb();
      schedule();
    }
  };
  schedule();
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
const getInNightWindow = () => isWithinNightWindow(new Date());
const getServerInNightWindow = () => false;

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [systemDark, setSystemDark] = useState(false);

  // Load from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("kecon-theme") as ThemeMode | null;
    if (saved) setModeState(saved);

    // Detect system preference
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mql.matches);
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const nightPref = useSyncExternalStore(subscribeNightPref, getNightPref, getServerNightPref);
  const inNightWindow = useSyncExternalStore(subscribeNightWindow, getInNightWindow, getServerInNightWindow);
  const isNight = nightPref === "on" || (nightPref === "auto" && inNightWindow);
  const isDark = isNight || mode === "dark" || (mode === "system" && systemDark);

  // Apply to <html>: night ⇒ dark + warm bedtime palette (see globals.css `.night`).
  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle("dark", isDark);
    html.classList.toggle("night", isNight);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", isNight ? "#151233" : isDark ? "#0A0A0F" : "#FFF8EE");
  }, [isDark, isNight]);

  const setNightPref = useCallback((pref: NightPref) => {
    localStorage.setItem(NIGHT_STORAGE_KEY, pref);
    nightPrefListeners.forEach((cb) => cb());
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    localStorage.setItem("kecon-theme", m);
  }, []);

  const toggle = useCallback(() => {
    setMode(isDark ? "light" : "dark");
  }, [isDark, setMode]);

  return (
    <ThemeContext.Provider value={{ mode, isDark, setMode, toggle, nightPref, isNight, setNightPref }}>
      {children}
    </ThemeContext.Provider>
  );
}
