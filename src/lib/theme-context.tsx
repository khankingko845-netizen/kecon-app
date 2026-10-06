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
  /** Sleep-mode preference (UI-08): auto = 19:30 → 06:00 on bedtime surfaces. */
  nightPref: NightPref;
  /** App-wide night palette (pref "on" or dark appearance) — never pure white. */
  isNight: boolean;
  /** Bedtime surfaces (Player, Ru ngủ) are in sleep mode: pref "on", or "auto" inside 19:30–06:00. */
  isBedtime: boolean;
  setNightPref: (pref: NightPref) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "system",
  isDark: false,
  setMode: () => {},
  toggle: () => {},
  nightPref: "auto",
  isNight: false,
  isBedtime: false,
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
  const isBedtime = nightPref === "on" || (nightPref === "auto" && inNightWindow);
  // One dark look only: any dark appearance uses the night palette (concept board: Ngày / Đêm).
  // "auto" keeps the cream day UI in the evening (board screen 2, 19:45) and only puts
  // the bedtime surfaces to sleep.
  const isDark = nightPref === "on" || mode === "dark" || (mode === "system" && systemDark);
  const isNight = isDark;

  // Apply to <html>: night ⇒ dark + warm bedtime palette (see globals.css `.night`).
  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle("dark", isDark);
    html.classList.toggle("night", isNight);
    html.classList.toggle("bedtime", isBedtime);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", isNight ? "#151233" : isDark ? "#0A0A0F" : "#FFF8EE");
  }, [isDark, isNight, isBedtime]);

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
    <ThemeContext.Provider value={{ mode, isDark, setMode, toggle, nightPref, isNight, isBedtime, setNightPref }}>
      {children}
    </ThemeContext.Provider>
  );
}
