/**
 * Narration for one story page — shared by the full player and the
 * MiniPlayer, so a page sounds the same (voice, pace, cast) wherever it is
 * played and saved narration is reused instead of paying for it twice.
 */
import { ttsApi } from "@/lib/api-client";
import { mergeAudioBlobs } from "@/lib/audio-merger";
import { savePageAudio, uploadTtsAudio, type StoryPageRow } from "@/lib/db";
import type { ParsedSegment } from "@/lib/elevenlabs";
import { segmentGap } from "@/lib/narration-pacing";
import { storyAudioKey, storyAudioSegments } from "@/lib/story-audio";
import type { NarrationPace } from "@/lib/story-brief";

export interface NarrationSetup {
  voiceId: string;
  characters: { name: string; voice_id: string | null; voice_name?: string | null }[];
  multiVoice: boolean;
  locale: string;
  model: string;
  pace: NarrationPace;
  /** Parent's own ElevenLabs key (then the chosen model is sent too). */
  apiKey?: string;
}

/** TTS every segment of a page (one voice per segment) into one clip. */
export async function synthesizeSegments(segments: ParsedSegment[], setup: NarrationSetup, alive: () => boolean = () => true): Promise<Blob> {
  const blobs: Blob[] = [];
  for (const seg of segments) {
    if (!alive()) throw new Error("Đã dừng giọng đọc.");
    blobs.push(await ttsApi(seg.voiceId, seg.text, setup.apiKey || undefined, setup.apiKey ? setup.model : undefined, setup.locale, setup.pace));
  }
  if (blobs.length === 1) return blobs[0];
  const merged = await mergeAudioBlobs(blobs, undefined, { gap: segmentGap(setup.pace) });
  try {
    return await (await fetch(merged.blobUrl)).blob();
  } finally {
    URL.revokeObjectURL(merged.blobUrl);
  }
}

/**
 * MiniPlayer: audio for page N (1-based) of a story whose player is closed —
 * the saved narration when it matches this voice setup, else fresh narration
 * (saved for next time, like the full player does).
 */
export function makePageResolver(pages: Pick<StoryPageRow, "id" | "content" | "audio_url" | "audio_key">[], setup: NarrationSetup) {
  const known = new Map<number, string>();
  return async (pageNumber: number): Promise<string | null> => {
    const row = pages[pageNumber - 1];
    if (!row?.content || !setup.voiceId) return null;
    const segments = storyAudioSegments(row.content, setup.voiceId, setup.characters, setup.multiVoice);
    if (!segments.length) return null;
    const key = await storyAudioKey(segments, setup.locale, setup.model, setup.pace);
    if (row.audio_url && row.audio_key === key) return row.audio_url;
    const saved = known.get(pageNumber);
    if (saved) return saved;
    const blob = await synthesizeSegments(segments, setup);
    void uploadTtsAudio(row.id, blob)
      .then(async (remote) => {
        await savePageAudio(row.id, remote, 0, key);
        known.set(pageNumber, remote);
      })
      .catch(() => {});
    return URL.createObjectURL(blob);
  };
}
