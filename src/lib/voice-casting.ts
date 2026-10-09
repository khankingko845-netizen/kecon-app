/**
 * Auto-casting: give each story character a distinct platform voice that
 * fits its voice type (girl, grandpa, creature…), never the narrator's voice
 * when another fits. Pure — the generate route supplies the active voices.
 */
import type { VoiceType } from "@/lib/story-brief";

export interface CastableVoice {
  voice_id: string;
  name: string;
  gender?: string | null;
  description?: string | null;
  sort_order?: number | null;
}

export interface CastCharacter {
  name: string;
  voiceType?: VoiceType | null;
  role?: "hero" | "friend";
}

export interface CastResult {
  voice_id: string | null;
  voice_name: string | null;
}

type Gender = "female" | "male" | null;

/** Whole-word match for Vietnamese words (`\b` only knows ASCII letters, so "bé"/"ông" never matched). */
function word(alternatives: string): RegExp {
  return new RegExp(`(?<!\\p{L})(?:${alternatives})(?!\\p{L})`, "u");
}

type Age = "child" | "adult" | "elder" | null;

function voiceGender(v: CastableVoice): Gender {
  const g = (v.gender ?? "").toLowerCase();
  if (/^(f|female|nữ|woman|girl)/.test(g)) return "female";
  if (/^(m|male|nam|man|boy)/.test(g)) return "male";
  const t = `${v.name} ${v.description ?? ""}`.normalize("NFC").toLowerCase();
  if (/female|woman|girl/.test(t) || word("nữ|cô|chị|bà|mẹ").test(t)) return "female";
  if (/\bmale\b|\bman\b|boy/.test(t) || word("nam|anh|chú|ông|bố").test(t)) return "male";
  return null;
}

function voiceAge(v: CastableVoice): Age {
  const t = `${v.name} ${v.description ?? ""}`.normalize("NFC").toLowerCase();
  if (/trẻ em|em bé|thiếu nhi|child|kid|young|teen/.test(t) || word("bé|trẻ").test(t)) return "child";
  if (/cao tuổi|elder|\bold\b|grand/.test(t) || word("già|ông|bà|cụ").test(t)) return "elder";
  if (/trung niên|người lớn|adult|mature|middle/.test(t)) return "adult";
  return null;
}

const WANT: Record<VoiceType, { gender: Gender; age: Age }> = {
  girl: { gender: "female", age: "child" },
  boy: { gender: "male", age: "child" },
  woman: { gender: "female", age: "adult" },
  man: { gender: "male", age: "adult" },
  grandma: { gender: "female", age: "elder" },
  grandpa: { gender: "male", age: "elder" },
  creature: { gender: null, age: null },
};

/**
 * Voice the story will be narrated with: the parent's choice, else the first
 * family clone, else the top-ranked default (same order as the player).
 */
export function castingNarrator(
  chosen: string | null | undefined,
  familyClone: string | null | undefined,
  voices: CastableVoice[],
): string | null {
  if (chosen) return chosen;
  if (familyClone) return familyClone;
  const ranked = [...voices].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.voice_id.localeCompare(b.voice_id));
  return ranked[0]?.voice_id ?? null;
}

/** Map character name → voice (or null = the narrator reads that character). */
export function castVoices(
  characters: CastCharacter[],
  voices: CastableVoice[],
  narratorVoiceId?: string | null,
): Map<string, CastResult> {
  const out = new Map<string, CastResult>();
  const pool = [...voices].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.voice_id.localeCompare(b.voice_id));
  const used = new Map<string, number>();
  const ordered = [...characters].sort((a, b) => (a.role === "hero" ? -1 : b.role === "hero" ? 1 : 0));
  for (const c of ordered) {
    const want = c.voiceType ? WANT[c.voiceType] : { gender: null, age: null };
    let best: CastableVoice | null = null;
    let bestScore = -Infinity;
    for (const v of pool) {
      const g = voiceGender(v);
      const a = voiceAge(v);
      let score = 0;
      if (v.voice_id === narratorVoiceId) score -= 6;
      score -= (used.get(v.voice_id) ?? 0) * 5;
      if (want.gender && g) score += g === want.gender ? 3 : -3;
      if (want.age && a) score += a === want.age ? 2 : want.age === "adult" ? 0 : -1;
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
    // Only the narrator's voice (or nothing) left → let the narrator read this character.
    if (!best || best.voice_id === narratorVoiceId) {
      out.set(c.name, { voice_id: null, voice_name: null });
      continue;
    }
    used.set(best.voice_id, (used.get(best.voice_id) ?? 0) + 1);
    out.set(c.name, { voice_id: best.voice_id, voice_name: best.name });
  }
  return out;
}
