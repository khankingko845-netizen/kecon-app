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
type Age = "child" | "adult" | "elder" | null;

function voiceGender(v: CastableVoice): Gender {
  const g = (v.gender ?? "").toLowerCase();
  if (/^(f|female|nữ|woman|girl)/.test(g)) return "female";
  if (/^(m|male|nam|man|boy)/.test(g)) return "male";
  const t = `${v.name} ${v.description ?? ""}`.toLowerCase();
  if (/\bnữ\b|female|woman|girl|\bcô\b|\bchị\b|\bbà\b|\bmẹ\b/.test(t)) return "female";
  if (/\bnam\b|male|\bman\b|boy|\banh\b|\bchú\b|\bông\b|\bbố\b/.test(t)) return "male";
  return null;
}

function voiceAge(v: CastableVoice): Age {
  const t = `${v.name} ${v.description ?? ""}`.toLowerCase();
  if (/trẻ em|em bé|\bbé\b|thiếu nhi|child|kid|young|teen|\btrẻ\b/.test(t)) return "child";
  if (/\bgià\b|\bông\b|\bbà\b|cao tuổi|elder|old|grand/.test(t)) return "elder";
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
