"use client";
/**
 * Plays the bundled short story effects (public/audio/sfx/v1) with plain
 * HTMLAudio elements — tiny files, no decoding pipeline, overlapping plays
 * clone the element. Best-effort: autoplay refusals are ignored.
 */
import { isSfxId, sfxEffect, type SfxId } from "@/lib/sfx-library";

const cache = new Map<SfxId, HTMLAudioElement>();

function element(id: SfxId): HTMLAudioElement {
  let el = cache.get(id);
  if (!el) {
    el = new Audio(sfxEffect(id).url);
    el.preload = "auto";
    cache.set(id, el);
  }
  return el;
}

export function preloadSfx(ids: readonly string[]): void {
  if (typeof window === "undefined" || typeof Audio === "undefined") return;
  for (const id of ids) if (isSfxId(id)) element(id);
}

export function playSfx(id: string, volume = 0.5): void {
  if (typeof window === "undefined" || typeof Audio === "undefined" || !isSfxId(id)) return;
  try {
    const base = element(id);
    const el = base.paused || base.ended ? base : (base.cloneNode(true) as HTMLAudioElement);
    el.volume = Math.max(0, Math.min(1, volume));
    el.currentTime = 0;
    void el.play()?.catch?.(() => {});
  } catch {
    /* audio unavailable — effects are decoration */
  }
}
