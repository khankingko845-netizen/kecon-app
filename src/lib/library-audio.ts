/**
 * Pre-rendered narration for platform library stories. Plans the exact
 * segments and audio identity (story_pages.audio_key) the story player
 * computes for a family that has not picked another narrator, so a saved
 * page file is reused instead of calling TTS on every listen. Pure — the
 * I/O lives in scripts/library-prerender.ts.
 */
import type { ParsedSegment } from "@/lib/elevenlabs";
import type { NarrationPace } from "@/lib/story-brief";
import { storyAudioKey, storyAudioSegments } from "@/lib/story-audio";
import { modelForLanguage } from "@/lib/tts-models";
import { rankedDefaultsForLocale, type CuratedNarrator } from "@/lib/voice-selection";

export interface PrerenderStory {
  id: string;
  locale: string | null;
  narrator_voice_id: string | null;
  narration_pace: NarrationPace | null;
  cast_voices: boolean | null;
}
export interface PrerenderPage {
  id: string;
  page_number: number;
  content: string | null;
  audio_url: string | null;
  audio_key: string | null;
}
export interface PrerenderCharacter {
  name: string;
  voice_id: string | null;
  voice_name?: string | null;
}
export interface PagePlan {
  pageId: string;
  pageNumber: number;
  key: string;
  segments: ParsedSegment[];
  /** Characters sent to TTS for this page (what the provider bills). */
  chars: number;
  /** Saved audio already matches this identity. */
  upToDate: boolean;
}
export interface StoryAudioPlan {
  narrator: string;
  model: string;
  pace: NarrationPace;
  multiVoice: boolean;
  pages: PagePlan[];
}

/** StoryPlayer's narrator for a family without a choice/clone: the story's narrator if still offered, else the top default. */
export function playerNarrator(story: PrerenderStory, defaults: CuratedNarrator[]): string | null {
  const ranked = rankedDefaultsForLocale(defaults, story.locale || "vi");
  if (story.narrator_voice_id && ranked.some((v) => v.voice_id === story.narrator_voice_id)) return story.narrator_voice_id;
  return ranked[0]?.voice_id ?? null;
}

/**
 * Same inputs as StoryPlayer.generatePageAudio: multi-voice follows the story's
 * cast_voices flag, pace defaults to "normal", the model is the platform model
 * mapped for the locale (configuredModel = /api/system/status elevenLabsModel).
 */
export async function planStoryAudio(
  story: PrerenderStory,
  pages: PrerenderPage[],
  characters: PrerenderCharacter[],
  defaults: CuratedNarrator[],
  configuredModel: string,
): Promise<StoryAudioPlan> {
  const narrator = playerNarrator(story, defaults);
  if (!narrator) throw new Error("no default voice for the story locale");
  const locale = story.locale || "vi";
  const model = modelForLanguage(configuredModel || "eleven_multilingual_v2", locale);
  const pace: NarrationPace = story.narration_pace ?? "normal";
  const multiVoice = Boolean(story.cast_voices);
  const planned: PagePlan[] = [];
  for (const p of [...pages].sort((a, b) => a.page_number - b.page_number)) {
    if (!p.content) continue;
    const segments = storyAudioSegments(p.content, narrator, characters, multiVoice);
    if (!segments.length) continue;
    const key = await storyAudioKey(segments, locale, model, pace);
    planned.push({
      pageId: p.id,
      pageNumber: p.page_number,
      key,
      segments,
      chars: segments.reduce((n, s) => n + s.text.length, 0),
      upToDate: Boolean(p.audio_url) && p.audio_key === key,
    });
  }
  return { narrator, model, pace, multiVoice, pages: planned };
}
