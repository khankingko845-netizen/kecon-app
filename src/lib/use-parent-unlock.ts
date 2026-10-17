"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { UNLOCK_IDLE_MS } from "@/lib/parent-gate";
import { clearParentProof } from "@/lib/parent-proof";

/**
 * In-memory unlock for the parent area (never persisted: a reload locks it,
 * and the G-06 parent proof is dropped with it).
 * Each tap/keypress inside the parent area pushes the deadline back; after
 * {@link UNLOCK_IDLE_MS} without one the gate closes again.
 */
export function useParentUnlock(inParentArea: boolean) {
  const [unlocked, setUnlocked] = useState(false);
  const deadline = useRef(0);

  const unlock = useCallback(() => {
    deadline.current = Date.now() + UNLOCK_IDLE_MS;
    setUnlocked(true);
  }, []);

  // Locking also drops the parent proof (G-06) and ends it on the server.
  const lock = useCallback(() => {
    deadline.current = 0;
    setUnlocked(false);
    clearParentProof({ revoke: true });
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    const bump = () => {
      if (inParentArea) deadline.current = Date.now() + UNLOCK_IDLE_MS;
    };
    const check = () => {
      if (Date.now() < deadline.current) return;
      setUnlocked(false);
      clearParentProof({ revoke: true });
    };
    window.addEventListener("pointerdown", bump, { passive: true });
    window.addEventListener("keydown", bump);
    document.addEventListener("visibilitychange", check);
    const id = window.setInterval(check, 5_000);
    return () => {
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
      document.removeEventListener("visibilitychange", check);
      window.clearInterval(id);
    };
  }, [unlocked, inParentArea]);

  return { unlocked, unlock, lock };
}
