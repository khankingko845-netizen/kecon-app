import { withAiContext, meteredFetch } from "@/lib/ai-metering";
import { validateStoryNarrator } from "@/lib/story-narrator";
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { STORY_GENERATOR_VERSION, generateStoryWithUsage, type GeneratedStory } from "@/lib/story-ai";
import { guardUsage } from "@/lib/usage-guard";
import { rejectByoKeyUnlessAllowed } from "@/lib/byo-key";
import { resolveLlmTarget } from "@/lib/llm-config";
import { z } from "zod";
import { languageCode, llmSelectionFields, optionalText, parseJsonBody, requiredText } from "@/lib/api-validation";
import { BriefCharactersSchema, NARRATION_PACES, STORY_LENGTHS, defaultPace } from "@/lib/story-brief";
import { castVoices, castingNarrator, type CastableVoice } from "@/lib/voice-casting";
import { sceneForPage } from "@/lib/scene-library";
import { DEFAULT_ART_STYLE } from "@/lib/illustration-prompt";
import type { SupabaseClient } from "@supabase/supabase-js";

const CATEGORY_MAP: Record<string, string> = {
  cotich: "fairy_tale",
  phieuluu: "adventure",
  ngungon: "bedtime",
  dongvat: "animal",
  hocchoi: "educational",
  tuviet: "custom",
};

const GenerateBody = z.object({
  ...llmSelectionFields,
  theme: requiredText(40),
  age: z.union([requiredText(20), z.number().int().min(0).max(18).transform(String)]),
  childName: optionalText(60),
  language: languageCode,
  extraPrompt: optionalText(1000),
  voiceId: optionalText(120),
  narratorVoiceId: optionalText(120),
  narratorVoiceName: optionalText(120),
  persist: z.boolean().default(true),
  // Story Studio v2 brief (all optional: older clients get v2 writing with defaults)
  characters: BriefCharactersSchema.optional(),
  length: z.enum(STORY_LENGTHS).optional(),
  pace: z.enum(NARRATION_PACES).optional(),
  castVoices: z.boolean().optional(),
  illustrate: z.boolean().optional(),
  ambience: z.boolean().optional(),
});
type GenerateInput = z.output<typeof GenerateBody>;

const CHARACTER_COLORS = ["#EF4444", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6", "#EC4899"];
const HEARTBEAT_MS = 10_000;
/** Whole-request budget; the writer only retries for quality when time remains. */
const GENERATION_BUDGET_MS = 210_000;

export const maxDuration = 300;

/**
 * The voice the player will actually narrate with when the parent did not pick
 * one: their first active family clone, otherwise the top-ranked default voice.
 * Casting must avoid it, or a character would sound exactly like the narrator.
 */
async function effectiveNarratorId(
  supabase: SupabaseClient,
  userId: string,
  narrator: { narratorId: string | null },
  voices: CastableVoice[],
): Promise<string | null> {
  if (narrator.narratorId) return narrator.narratorId;
  const { data: clone } = await supabase
    .from("voice_profiles")
    .select("elevenlabs_voice_id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .not("elevenlabs_voice_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return castingNarrator(null, (clone?.elevenlabs_voice_id as string | undefined) ?? null, voices);
}

async function persistStory(
  supabase: SupabaseClient,
  userId: string,
  input: GenerateInput,
  story: GeneratedStory,
  narrator: { voiceId: string | null; narratorId: string | null; name: string | null },
  meta: { provider: string; model: string; attempts: number; words: number },
): Promise<string> {
  const { theme, age, language } = input;
  const locale = language || "vi";
  const pace = input.pace ?? defaultPace(age, theme);
  const ageNums = String(age).match(/\d+/g)?.map(Number) ?? [0, 12];
  const { data: storyRow, error: storyErr } = await supabase
    .from("stories")
    .insert({
      user_id: userId,
      title: story.title,
      description: story.summary,
      category: CATEGORY_MAP[theme] || "custom",
      theme,
      target_age_min: ageNums[0] ?? 0,
      target_age_max: ageNums[1] ?? ageNums[0] ?? 12,
      voice_id: narrator.voiceId || null,
      narrator_voice_id: narrator.narratorId || null,
      narrator_voice_name: narrator.name || null,
      locale,
      page_count: story.pages.length,
      source: "ai",
      status: "draft",
      generator_version: STORY_GENERATOR_VERSION,
      story_length: input.length ?? "medium",
      narration_pace: pace,
      cast_voices: Boolean(input.castVoices),
      auto_ambience: input.ambience !== false,
      illustration_style: input.illustrate ? DEFAULT_ART_STYLE : null,
    })
    .select("id")
    .single();
  if (storyErr) throw new Error(storyErr.message);
  const storyId = storyRow.id as string;

  const pageRows = story.pages.map((p, i) => ({
    story_id: storyId,
    page_number: i + 1,
    content: p.text,
    scene_description: p.sceneDescription,
    illustration_prompt: p.illustration?.slice(0, 1000) || null,
    scene_id: sceneForPage({ sceneId: p.scene, sceneDescription: p.sceneDescription, illustration: p.illustration, text: p.text, theme }),
    mood: p.mood ?? null,
    ambient_sound: p.ambient ?? null,
    sfx_sounds: p.sfx ?? [],
  }));
  const { error: pagesErr } = await supabase.from("story_pages").insert(pageRows);
  if (pagesErr) throw new Error(pagesErr.message);

  const characters = story.characters ?? [];
  if (characters.length > 0) {
    let cast = new Map<string, { voice_id: string | null; voice_name: string | null }>();
    if (input.castVoices) {
      const { data: voices } = await supabase
        .from("default_voices")
        .select("voice_id,name,gender,description,sort_order")
        .eq("language", locale)
        .eq("is_active", true);
      cast = castVoices(characters, voices ?? [], await effectiveNarratorId(supabase, userId, narrator, voices ?? []));
    }
    const brief = new Map((input.characters ?? []).map((b) => [b.name.toLocaleLowerCase("vi"), b]));
    const charRows = characters.map((c, i) => {
      const b = brief.get(c.name.toLocaleLowerCase("vi"));
      const voice = cast.get(c.name);
      return {
        story_id: storyId,
        name: c.name,
        description: c.description || null,
        emoji: c.emoji || null,
        color: CHARACTER_COLORS[i % CHARACTER_COLORS.length],
        sort_order: i,
        role: c.role ?? "friend",
        voice_type: c.voiceType ?? null,
        appearance: c.appearance?.slice(0, 400) || null,
        preset_id: b?.presetId ?? null,
        voice_id: voice?.voice_id ?? null,
        voice_name: voice?.voice_name ?? null,
      };
    });
    const { error: charErr } = await supabase.from("story_characters").insert(charRows);
    if (charErr) console.warn("[story.generate] characters not saved:", charErr.message);
  }

  await supabase.from("user_behavior").insert({
    user_id: userId,
    action_type: "create",
    story_id: storyId,
    metadata: { theme, provider: meta.provider, model: meta.model, generator: STORY_GENERATOR_VERSION, attempts: meta.attempts, words: meta.words },
  });
  return storyId;
}

/**
 * Story generation can take 1–3 minutes (long stories, one quality retry).
 * Proxies such as Cloudflare drop requests with no response bytes for 100 s,
 * so after validation the route streams: whitespace heartbeats, then one
 * JSON document (`{...story, storyId}` or `{ error }`). JSON.parse ignores
 * the leading whitespace, so plain `res.json()` clients keep working.
 */
export async function POST(request: NextRequest) {
  return withAiContext("story.generate", async (request) => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = await parseJsonBody(request, GenerateBody);
    if (!parsed.ok) return parsed.response;
    const byoBlocked = await rejectByoKeyUnlessAllowed(supabase, user.id, parsed.data.apiKey);
    if (byoBlocked) return byoBlocked;
    const input = parsed.data;
    const { theme, childName, age, language, extraPrompt, voiceId, narratorVoiceId, persist } = input;

    const chosenVoice = await validateStoryNarrator(supabase, user.id, language || "vi", voiceId, narratorVoiceId);
    if ("error" in chosenVoice) return Response.json({ error: chosenVoice.error }, { status: 400 });

    // Provider/model/key/base URL: BYO → client choice; platform key → admin defaults
    const llm = await resolveLlmTarget(input);
    if (!llm.ok) return llm.response;
    const { target } = llm;

    const usageBlocked = await guardUsage(supabase, "story", { byo: llm.byo });
    if (usageBlocked) return usageBlocked;

    const run = async () => {
      const { story, assessment, attempts } = await generateStoryWithUsage(
        target,
        {
          theme,
          childName: childName || "",
          age,
          language: language || "vi",
          extraPrompt,
          characters: input.characters,
          length: input.length,
          pace: input.pace ?? defaultPace(age, theme),
        },
        meteredFetch({ provider: target.provider, model: target.model, kind: "llm" }),
        { qualityRetry: true, budgetMs: GENERATION_BUDGET_MS },
      );
      const storyId = persist
        ? await persistStory(supabase, user.id, input, story, chosenVoice, {
            provider: target.provider,
            model: target.model,
            attempts,
            words: assessment.totalWords,
          })
        : null;
      return { ...story, storyId, generatorVersion: STORY_GENERATOR_VERSION };
    };

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let open = true;
        const send = (text: string) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            open = false;
          }
        };
        send(" ");
        const beat = setInterval(() => send(" "), HEARTBEAT_MS);
        try {
          send(JSON.stringify(await run()));
        } catch (err) {
          send(JSON.stringify({ error: err instanceof Error ? err.message : "Story generation failed" }));
        } finally {
          clearInterval(beat);
          if (open) {
            open = false;
            try {
              controller.close();
            } catch {
              /* client went away */
            }
          }
        }
      },
    });
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // no-transform: keeps compression from buffering the heartbeats.
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  })(request);
}
