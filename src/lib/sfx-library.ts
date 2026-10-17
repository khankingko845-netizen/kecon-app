/**
 * Short story sound effects (CC0, Kenney) shipped as same-origin files.
 * Pure data: shared by the story writer (allowed ids) and the player.
 */
import manifest from "../../public/audio/sfx/v1/manifest.json";

export const SFX_IDS = [
  "page-turn",
  "book-close",
  "door-open",
  "door-knock",
  "footsteps",
  "magic-sparkle",
  "happy-jingle",
  "coins",
  "bell",
  "creak",
  "water-drop",
] as const;
export type SfxId = (typeof SFX_IDS)[number];

export interface SfxEffect {
  id: SfxId;
  label: string;
  url: string;
  author: string;
  source: string;
  original: string;
  license: string;
  licenseUrl: string;
  sha256: string;
  bytes: number;
  duration: number;
}

export const SFX_EFFECTS = manifest.effects as SfxEffect[];

/** Effects the story writer may place on a page (UI cues like page-turn are the player's job). */
export const STORY_SFX_IDS = SFX_IDS.filter((id) => id !== "page-turn" && id !== "book-close");

export function isSfxId(value: unknown): value is SfxId {
  return typeof value === "string" && (SFX_IDS as readonly string[]).includes(value);
}

export function sfxEffect(id: SfxId): SfxEffect {
  const effect = SFX_EFFECTS.find((e) => e.id === id);
  if (!effect) throw new Error(`Hiệu ứng âm thanh ${id} chưa có trong thư viện.`);
  return effect;
}

/** Keep only known story effects, max two per page, no duplicates. */
export function storySfx(list: unknown): SfxId[] {
  if (!Array.isArray(list)) return [];
  const out: SfxId[] = [];
  for (const raw of list) {
    const id = typeof raw === "string" ? raw.trim().toLowerCase().replace(/[_\s]+/g, "-") : "";
    if (isSfxId(id) && (STORY_SFX_IDS as readonly string[]).includes(id) && !out.includes(id)) out.push(id);
    if (out.length === 2) break;
  }
  return out;
}
