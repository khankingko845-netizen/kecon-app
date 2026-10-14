"use client";
/**
 * G-06 parent proof: a short-lived server session minted by the correct parent
 * PIN (open_parent_gate, migration 036). The raw token lives only in this
 * page's memory — never in storage, cookies or URLs — so a reload, the idle
 * lock or leaving the parent area drops it. The server keeps only its hash
 * (sliding 15 min, at most 60 min after the PIN) and rechecks it on every
 * parent action (confirm a habit, read together, reminders).
 */
import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";

/** Same hard cap as the server: a proof never outlives 60 min after the PIN. */
export const PROOF_MAX_MS = 60 * 60_000;

let token: string | null = null;
let mintedAt = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setParentProof(next: string, now: number = Date.now()): void {
  if (!/^[0-9a-f]{64}$/.test(next)) return;
  token = next;
  mintedAt = now;
  emit();
}

/** The current proof, or null when none / older than {@link PROOF_MAX_MS}. */
export function getParentProof(now: number = Date.now()): string | null {
  if (token && now - mintedAt >= PROOF_MAX_MS) {
    token = null;
    emit();
  }
  return token;
}

/**
 * Forget the proof. With `revoke`, also end it on the server (best effort —
 * it expires there within 15 minutes anyway).
 */
export function clearParentProof(opts: { revoke?: boolean } = {}): void {
  const old = token;
  if (!old) return;
  token = null;
  mintedAt = 0;
  emit();
  if (opts.revoke) {
    try {
      void createClient()
        .rpc("close_parent_gate", { p_token: old })
        .then(
          () => undefined,
          () => undefined,
        );
    } catch {
      /* offline / not configured: the server expiry still applies */
    }
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while this page holds a parent proof. */
export function useHasParentProof(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => token !== null && Date.now() - mintedAt < PROOF_MAX_MS,
    () => false,
  );
}
