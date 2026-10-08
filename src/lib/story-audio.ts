import { parseVoiceMarkup, type ParsedSegment } from "@/lib/elevenlabs";
/** One selected narrator for the whole story unless multi-character mode is explicitly enabled. */
export function storyAudioSegments(
  text: string,
  narrator: string,
  characters: {
    name: string;
    voice_id: string | null;
    voice_name?: string | null;
  }[],
  multiVoice = false,
): ParsedSegment[] {
  const map: Record<string, { voiceId: string; voiceName?: string }> = {};
  if (multiVoice)
    for (const c of characters)
      if (c.voice_id)
        map[c.name] = {
          voiceId: c.voice_id,
          voiceName: c.voice_name || c.name,
        };
  const segments = parseVoiceMarkup(text, map, narrator);
  const merged: ParsedSegment[] = [];
  for (const seg of segments) {
    const last = merged.at(-1);
    if (last?.voiceId === seg.voiceId) last.text += "\n" + seg.text;
    else merged.push({ ...seg });
  }
  return merged;
}
/** Full audio identity; old URLs without a fingerprint are never assumed to match. */
export async function storyAudioKey(
  segments: ParsedSegment[],
  locale: string,
  model: string,
  pace?: "calm" | "normal" | null,
): Promise<string> {
  // Legacy (unpaced) stories keep the exact v2 payload so saved audio still matches.
  const payload = pace
    ? JSON.stringify({ version: 3, locale, model, pace, segments: segments.map((s) => [s.voiceId, s.text]) })
    : JSON.stringify({
        version: 2,
        locale,
        model,
        segments: segments.map((s) => [s.voiceId, s.text]),
      });
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
