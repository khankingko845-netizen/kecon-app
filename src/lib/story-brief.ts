/**
 * Story Studio v2 — the structured brief a family builds in "Tạo truyện".
 *
 * Pure, shared by the wizard (client) and /api/story/generate (server):
 * characters the child picked or invented, story length, narration pace and
 * the per-age page/word plan the writer must follow.
 */
import { z } from "zod";
import { getAgeBand, type AgeBandId } from "@/lib/age-bands";

export const STORY_LENGTHS = ["short", "medium", "long"] as const;
export type StoryLength = (typeof STORY_LENGTHS)[number];

export const NARRATION_PACES = ["calm", "normal"] as const;
export type NarrationPace = (typeof NARRATION_PACES)[number];

/** Voice archetypes the writer assigns so the cast can be voiced. */
export const VOICE_TYPES = ["girl", "boy", "woman", "man", "grandma", "grandpa", "creature"] as const;
export type VoiceType = (typeof VOICE_TYPES)[number];

export const MAX_BRIEF_CHARACTERS = 3;

/** Characters become `[character:Name]` markup: no brackets, slashes or control characters. */
export function cleanCharacterName(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[[\]{}<>/\\|`*_#"]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

function cleanDescription(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[[\]{}<>`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export const BriefCharacterSchema = z.object({
  name: z.string().max(80).transform(cleanCharacterName).pipe(z.string().min(1, "Nhân vật cần có tên")),
  description: z.string().max(400).default("").transform(cleanDescription),
  role: z.enum(["hero", "friend"]).default("friend"),
  /** Preset card id (art only); custom characters omit it. */
  presetId: z.string().max(40).regex(/^[a-z0-9-]+$/).optional(),
  /** The child themself is the hero. */
  isChild: z.boolean().optional(),
  /** Family's voice choice for this character (else the writer/heuristics decide). */
  voiceType: z.enum(VOICE_TYPES).optional(),
  /** English look for presets so pictures match the card art. */
  appearance: z.string().max(300).optional().transform((v) => (v ? v.replace(/\s+/g, " ").trim() : undefined)),
});
export type BriefCharacter = z.output<typeof BriefCharacterSchema>;

export const BriefCharactersSchema = z
  .array(BriefCharacterSchema)
  .max(MAX_BRIEF_CHARACTERS, `Tối đa ${MAX_BRIEF_CHARACTERS} nhân vật`)
  .default([])
  .transform((list) => {
    const seen = new Set<string>();
    const unique = list.filter((c) => {
      const key = c.name.toLocaleLowerCase("vi");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // Exactly one hero, first in the list.
    const heroIndex = Math.max(0, unique.findIndex((c) => c.role === "hero"));
    return unique
      .map((c, i) => ({ ...c, role: (i === heroIndex ? "hero" : "friend") as BriefCharacter["role"] }))
      .sort((a, b) => (a.role === "hero" ? -1 : b.role === "hero" ? 1 : 0));
  });

export interface PagePlan {
  pages: number;
  /** Vietnamese words (syllables) of story text per page, excluding markup. */
  words: readonly [number, number];
}

const LENGTH_PLAN: Record<AgeBandId, Record<StoryLength, PagePlan>> = {
  "3-5": {
    short: { pages: 6, words: [40, 55] },
    medium: { pages: 8, words: [55, 75] },
    long: { pages: 10, words: [65, 85] },
  },
  "6-8": {
    short: { pages: 8, words: [60, 80] },
    medium: { pages: 10, words: [80, 100] },
    long: { pages: 12, words: [95, 120] },
  },
  "9-12": {
    short: { pages: 10, words: [80, 100] },
    medium: { pages: 12, words: [100, 125] },
    long: { pages: 14, words: [120, 145] },
  },
};

/** Calm bedtime narration ≈110 words/min, normal ≈130 (incl. pauses). */
const WORDS_PER_MINUTE: Record<NarrationPace, number> = { calm: 110, normal: 130 };

export function pagePlan(age: string | number | null | undefined, length: StoryLength = "medium"): PagePlan {
  return LENGTH_PLAN[getAgeBand(age).id][length];
}

export function estimatedMinutes(plan: PagePlan, pace: NarrationPace = "normal"): number {
  const words = plan.pages * ((plan.words[0] + plan.words[1]) / 2);
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE[pace]));
}

export function defaultPace(age: string | number | null | undefined, theme?: string | null): NarrationPace {
  return theme === "ngungon" || getAgeBand(age).id === "3-5" ? "calm" : "normal";
}

export const LENGTH_LABEL: Record<StoryLength, string> = { short: "Ngắn", medium: "Vừa", long: "Dài" };
export const PACE_LABEL: Record<NarrationPace, string> = { calm: "Chậm rãi", normal: "Vừa phải" };

/** Count spoken words of a page: markup and paralinguistic tags removed. */
export function spokenWordCount(text: string): number {
  const plain = text
    .replace(/\[\/?(narrator|character)(:[^\]]*)?\]/g, " ")
    .replace(/\[[^\]]{1,40}\]/g, " ")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .trim();
  return plain ? plain.split(/\s+/).length : 0;
}
