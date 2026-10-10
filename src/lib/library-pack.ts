/**
 * Platform library pack (content/library/<version>/*.json): edited retellings
 * of Vietnamese folk tales shipped as reviewed files, not generated per family.
 * Pure: unit tests validate every file; scripts/library-import.ts turns a pack
 * into one idempotent SQL transaction (platform content, audit-logged).
 */
import { z } from "zod";
import { SCENE_IDS } from "@/lib/scene-library";
import { STORY_SFX_IDS, type SfxId } from "@/lib/sfx-library";
import { STORY_AMBIENTS, STORY_MOODS } from "@/lib/story-ai";
import { VOICE_TYPES, pagePlan, spokenWordCount } from "@/lib/story-brief";
import { castVoices, castingNarrator, type CastableVoice } from "@/lib/voice-casting";

/** Kid Library filter ids (Library.tsx). */
export const LIBRARY_CATEGORIES = ["fairy_tale", "folk", "bedtime", "animal", "adventure", "educational"] as const;
/** Tag that marks a row as imported from the pack (idempotency + rollback key). */
export const LIBRARY_TAG_PREFIX = "kc-lib:";
/** Extra words allowed above the plan's upper bound (dialogue-heavy pages). */
export const PAGE_WORD_SLACK = 10;
/**
 * Words a 3–8 year-old library story must not use (violence/death/vices).
 * Whole-word match on Vietnamese syllables; editors soften the plot instead.
 */
export const BLOCKED_PHRASES = [
  "giết", "chết", "máu", "chém", "tự tử", "ăn thịt", "làm thịt", "mổ bụng", "đầu lâu",
  "xác chết", "rượu", "thuốc lá", "đánh đòn", "ma quỷ", "ngu", "đồ ngốc",
] as const;
/** The bundled castle art is European: Vietnamese tales use village/home instead. */
const DISALLOWED_SCENES = new Set(["castle"]);

const CHARACTER_COLORS = ["#EF4444", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6", "#EC4899"];
const SFX = STORY_SFX_IDS as unknown as [SfxId, ...SfxId[]];

const Character = z.object({
  name: z.string().min(1).max(40),
  role: z.enum(["hero", "friend"]),
  voiceType: z.enum(VOICE_TYPES),
  description: z.string().min(3).max(200),
  appearance: z.string().min(3).max(400),
});

const Page = z.object({
  text: z.string().min(1),
  sceneDescription: z.string().min(3).max(300),
  scene: z.enum(SCENE_IDS),
  mood: z.enum(STORY_MOODS),
  ambient: z.enum(STORY_AMBIENTS).nullable(),
  sfx: z.array(z.enum(SFX)).max(3),
});

export const LibraryStorySchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60),
  title: z.string().min(2).max(80),
  category: z.enum(LIBRARY_CATEGORIES),
  ageMin: z.number().int().min(2).max(12),
  ageMax: z.number().int().min(2).max(12),
  band: z.enum(["3-5", "6-8", "9-12"]),
  length: z.enum(["short", "medium", "long"]),
  pace: z.enum(["calm", "normal"]),
  summary: z.string().min(20).max(300),
  moral: z.string().min(5).max(200),
  tags: z.array(z.string().regex(/^[a-z0-9-]{2,40}$/)).max(6),
  origin: z.string().min(10).max(300),
  adaptation: z.array(z.string().min(5).max(300)).min(1),
  characters: z.array(Character).min(1).max(6),
  pages: z.array(Page).min(4).max(14),
});
export type LibraryStory = z.infer<typeof LibraryStorySchema>;

const LINE = /^\[narrator\]([^[\]]+)\[\/narrator\]$|^\[character:([^\]]+)\]([^[\]]+)\[\/character\]$/;

function hasPhrase(text: string, phrase: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${phrase}(?![\\p{L}\\p{N}])`, "u").test(text);
}

/** Editorial checks beyond the schema. Empty list = the story may ship. */
export function libraryStoryProblems(raw: unknown): string[] {
  const parsed = LibraryStorySchema.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  const s = parsed.data;
  const out: string[] = [];
  if (JSON.stringify(raw) !== JSON.stringify(raw).normalize("NFC")) out.push("text is not NFC-normalised");
  if (s.ageMin > s.ageMax) out.push("ageMin > ageMax");
  if (!s.characters.some((c) => c.role === "hero")) out.push("no hero character");
  const names = new Set(s.characters.map((c) => c.name));
  if (names.size !== s.characters.length) out.push("duplicate character names");
  if (s.tags.some((t) => t.startsWith(LIBRARY_TAG_PREFIX))) out.push("tags must not use the import prefix");

  const plan = pagePlan(s.band, s.length);
  if (s.pages.length !== plan.pages) out.push(`needs ${plan.pages} pages for ${s.band}/${s.length}, has ${s.pages.length}`);
  const speaking = new Set<string>();
  let dialoguePages = 0;
  s.pages.forEach((p, i) => {
    const n = i + 1;
    const words = spokenWordCount(p.text);
    if (words < plan.words[0] || words > plan.words[1] + PAGE_WORD_SLACK)
      out.push(`page ${n}: ${words} words, plan ${plan.words[0]}–${plan.words[1]}`);
    if (DISALLOWED_SCENES.has(p.scene)) out.push(`page ${n}: scene "${p.scene}" is not allowed in the library`);
    let speaks = false;
    for (const line of p.text.split("\n")) {
      const m = LINE.exec(line);
      if (!m) {
        out.push(`page ${n}: malformed line "${line.slice(0, 40)}"`);
        continue;
      }
      if (m[2] !== undefined) {
        if (!names.has(m[2])) out.push(`page ${n}: unknown speaker "${m[2]}"`);
        speaking.add(m[2]);
        speaks = true;
      }
    }
    if (speaks) dialoguePages++;
    const lower = p.text.toLocaleLowerCase("vi");
    for (const phrase of BLOCKED_PHRASES) if (hasPhrase(lower, phrase)) out.push(`page ${n}: blocked phrase "${phrase}"`);
  });
  if (dialoguePages < Math.ceil(s.pages.length / 2)) out.push(`dialogue on ${dialoguePages} pages, needs ${Math.ceil(s.pages.length / 2)}`);
  for (const c of s.characters) if (!speaking.has(c.name)) out.push(`character "${c.name}" never speaks`);
  return out;
}

/** Validate a whole pack (all files), including cross-story uniqueness. */
export function packProblems(stories: unknown[]): string[] {
  const out: string[] = [];
  const slugs = new Set<string>();
  const titles = new Set<string>();
  for (const raw of stories) {
    const slug = (raw as { slug?: string })?.slug ?? "?";
    for (const p of libraryStoryProblems(raw)) out.push(`${slug}: ${p}`);
    const title = String((raw as { title?: string })?.title ?? "").toLocaleLowerCase("vi");
    if (slugs.has(slug)) out.push(`${slug}: duplicate slug`);
    if (titles.has(title)) out.push(`${slug}: duplicate title`);
    slugs.add(slug);
    titles.add(title);
  }
  return out;
}

// ── SQL import ───────────────────────────────────────────────────────────

function lit(value: string | null | undefined): string {
  return value === null || value === undefined ? "NULL" : `'${value.replace(/'/g, "''")}'`;
}
function arr(values: readonly string[]): string {
  return `ARRAY[${values.map(lit).join(", ")}]::text[]`;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ImportOptions {
  /** Staff profile that owns platform rows (stories.user_id is NOT NULL). */
  ownerId: string;
  /** Active default voices for the pack locale (voice_id, name, gender, description, sort_order). */
  voices: CastableVoice[];
  /** Pack version, written into the audit entry. */
  version: string;
  reason: string;
}

/** Narrator + character casting the import will store (exported for review/tests). */
export function libraryCasting(story: LibraryStory, voices: CastableVoice[]) {
  const narratorId = castingNarrator(null, null, voices);
  const narrator = voices.find((v) => v.voice_id === narratorId) ?? null;
  const cast = castVoices(story.characters, voices, narratorId);
  return { narrator, cast };
}

/**
 * One transaction; each story is skipped when a live row with its
 * `kc-lib:<slug>` tag exists, so re-running the import is a no-op.
 */
export function buildLibraryImportSql(stories: LibraryStory[], opts: ImportOptions): string {
  if (!UUID.test(opts.ownerId)) throw new Error("ownerId must be a uuid");
  const problems = packProblems(stories);
  if (problems.length) throw new Error(`pack has problems:\n${problems.join("\n")}`);
  const parts: string[] = ["BEGIN;"];
  for (const s of stories) {
    const tag = `${LIBRARY_TAG_PREFIX}${s.slug}`;
    const { narrator, cast } = libraryCasting(s, opts.voices);
    const pages = s.pages
      .map((p, i) => `(${i + 1}, ${lit(p.text)}, ${lit(p.sceneDescription)}, ${lit(p.scene)}, ${lit(p.mood)}, ${p.ambient ? lit(p.ambient) : "NULL::text"}, ${arr(p.sfx)})`)
      .join(",\n    ");
    const chars = s.characters
      .map((c, i) => {
        const v = cast.get(c.name);
        return `(${lit(c.name)}, ${lit(c.description)}, ${lit(CHARACTER_COLORS[i % CHARACTER_COLORS.length])}, ${i}, ${lit(c.role)}, ${lit(c.voiceType)}, ${lit(c.appearance)}, ${lit(v?.voice_id ?? null)}::text, ${lit(v?.voice_name ?? null)}::text)`;
      })
      .join(",\n    ");
    const after = `jsonb_build_object('title', ${lit(s.title)}, 'slug', ${lit(s.slug)}, 'pack', ${lit(opts.version)}, 'category', ${lit(s.category)}, 'status', 'published', 'is_platform_content', true, 'pages', ${s.pages.length})`;
    parts.push(`-- ${s.slug}
WITH s AS (
  INSERT INTO public.stories (user_id, title, description, category, target_age_min, target_age_max, tags, moral_lesson,
    locale, narrator_voice_id, narrator_voice_name, page_count, source, status, is_published, is_platform_content,
    story_length, narration_pace, cast_voices, auto_ambience)
  SELECT ${lit(opts.ownerId)}::uuid, ${lit(s.title)}, ${lit(s.summary)}, ${lit(s.category)}, ${s.ageMin}, ${s.ageMax},
    ${arr([...s.tags, tag])}, ${lit(s.moral)}, 'vi', ${lit(narrator?.voice_id)}, ${lit(narrator?.name)}, ${s.pages.length},
    'manual', 'published', true, true, ${lit(s.length)}, ${lit(s.pace)}, true, true
  WHERE NOT EXISTS (SELECT 1 FROM public.stories WHERE ${lit(tag)} = ANY (tags) AND deleted_at IS NULL)
  RETURNING id
), p AS (
  INSERT INTO public.story_pages (story_id, page_number, content, scene_description, scene_id, mood, ambient_sound, sfx_sounds)
  SELECT s.id, v.n, v.content, v.scene_description, v.scene_id, v.mood, v.ambient_sound, v.sfx_sounds FROM s, (VALUES
    ${pages}
  ) AS v(n, content, scene_description, scene_id, mood, ambient_sound, sfx_sounds)
  RETURNING story_id
), c AS (
  INSERT INTO public.story_characters (story_id, name, description, color, sort_order, role, voice_type, appearance, voice_id, voice_name)
  SELECT s.id, v.name, v.description, v.color, v.sort_order, v.role, v.voice_type, v.appearance, v.voice_id, v.voice_name FROM s, (VALUES
    ${chars}
  ) AS v(name, description, color, sort_order, role, voice_type, appearance, voice_id, voice_name)
  RETURNING story_id
)
SELECT ${lit(s.slug)} AS slug, public.audit_write('story.create', 'story', s.id::text, NULL, ${after}, ${lit(opts.reason)}, NULL, NULL, 'system') AS audit_id FROM s;`);
  }
  parts.push("COMMIT;");
  return parts.join("\n\n") + "\n";
}

/** Rollback for a pack: soft-deletes (trash) the imported rows; audited like the import. */
export function buildLibraryRollbackSql(slugs: string[], reason: string): string {
  const tags = slugs.map((s) => `${LIBRARY_TAG_PREFIX}${s}`);
  return `BEGIN;
WITH t AS (
  UPDATE public.stories SET deleted_at = now(), is_published = false, status = 'archived'
  WHERE tags && ${arr(tags)} AND is_platform_content AND deleted_at IS NULL
  RETURNING id, title
)
SELECT public.audit_write('story.trash', 'story', t.id::text, NULL, jsonb_build_object('title', t.title), ${lit(reason)}, NULL, NULL, 'system') FROM t;
COMMIT;
`;
}
