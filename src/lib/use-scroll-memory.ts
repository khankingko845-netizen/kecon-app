"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Window scroll position per screen (UI mobile).
 *
 * The app swaps screens inside one page and the window is what scrolls, so
 * without this a new screen inherits the old offset: tapping “Đăng nhập” at
 * the bottom of the intro opened Login 142 px down (mascot and title cut off),
 * and Back always landed at the top of Home instead of where the kid was.
 *
 * - `entry` is the history entry on screen (compared by identity — Back pops
 *   the stack and gets the same object again) or a string for overlays such
 *   as the parent gate, which always start at the top and are not remembered.
 * - `screen` is what is actually drawn: when it changes under the same entry
 *   (signed in on Login → Home), the page starts at the top too.
 *
 * A first visit starts at the top; a revisited entry gets its last position
 * back, waiting a few frames if its content is still growing.
 */
export function useScrollMemory(entry: object | string, screen: string) {
  const saved = useRef(new WeakMap<object, number>());
  const shown = useRef<{ entry: object | string; screen: string } | null>(null);

  useEffect(() => {
    const onScroll = () => {
      const now = shown.current?.entry;
      if (now && typeof now === "object") saved.current.set(now, window.scrollY);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const before = shown.current;
    if (before && before.entry === entry && before.screen === screen) return;
    shown.current = { entry, screen };
    const sameEntry = before?.entry === entry;
    const y = !sameEntry && typeof entry === "object" ? (saved.current.get(entry) ?? 0) : 0;
    window.scrollTo(0, y);
    if (y <= 0) return;
    // Lists and images may still be arriving: retry until the page is tall enough.
    let frames = 0;
    let raf = 0;
    const settle = () => {
      if (shown.current?.entry !== entry) return;
      const room = document.documentElement.scrollHeight - window.innerHeight;
      if (room >= y - 1) {
        if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
        return;
      }
      if (++frames < 60) raf = requestAnimationFrame(settle);
    };
    raf = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(raf);
  }, [entry, screen]);
}
