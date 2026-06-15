const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  labels: Record<string, string>;
}

export interface CloneVoiceResult {
  voice_id: string;
  name: string;
}

export async function listVoices(apiKey: string): Promise<ElevenLabsVoice[]> {
  const res = await fetch(`${ELEVENLABS_BASE}/voices`, {
    headers: { "xi-api-key": apiKey },
  });
  if (!res.ok) throw new Error(`ElevenLabs error: ${res.status}`);
  const data = await res.json();
  return data.voices;
}

/**
 * Clone a voice with proper language labeling.
 * The `language` param tells ElevenLabs which language the voice speaks
 * so TTS output matches the source recording language.
 */
export async function cloneVoice(
  apiKey: string,
  name: string,
  audioBlob: Blob,
  language: string = "vi"
): Promise<CloneVoiceResult> {
  // Map short codes to ElevenLabs language labels
  const langMap: Record<string, string> = {
    vi: "Vietnamese",
    en: "English",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
    fr: "French",
    de: "German",
    es: "Spanish",
    th: "Thai",
  };

  const languageLabel = langMap[language] || language;

  const form = new FormData();
  form.append("name", name);
  form.append("files", audioBlob, "recording.wav");
  form.append("description", `KểCon voice clone: ${name} (${languageLabel})`);
  // Labels help ElevenLabs understand the voice characteristics
  form.append(
    "labels",
    JSON.stringify({
      language: languageLabel,
      accent: languageLabel,
      use_case: "storytelling",
      age: "adult",
    })
  );
  // Remove the default accent detection — force the language
  form.append("remove_background_noise", "true");

  const res = await fetch(`${ELEVENLABS_BASE}/voices/add`, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail?.message || `Clone failed: ${res.status}`);
  }
  return res.json();
}

export async function textToSpeech(
  apiKey: string,
  voiceId: string,
  text: string,
  modelId: string = "eleven_multilingual_v2",
  languageCode?: string
): Promise<Blob> {
  // Map short codes to ElevenLabs language_code format
  const langCodeMap: Record<string, string> = {
    vi: "vi",
    en: "en",
    ja: "ja",
    ko: "ko",
    zh: "zh",
    fr: "fr",
    de: "de",
    es: "es",
    th: "th",
  };
  const resolvedLang = languageCode
    ? langCodeMap[languageCode] || languageCode
    : undefined;

  const body: Record<string, unknown> = {
    text,
    model_id: modelId,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.4,
      use_speaker_boost: true,
    },
  };

  // language_code is only supported by turbo v2.5, flash v2.5, and v3+ models.
  // eleven_multilingual_v2 does NOT support language_code (will error).
  const supportsLangCode =
    modelId.includes("v3") ||
    modelId.includes("turbo_v2_5") ||
    modelId.includes("flash_v2_5") ||
    modelId.includes("flash_v2");
  if (resolvedLang && supportsLangCode) {
    body.language_code = resolvedLang;
  }

  const res = await fetch(
    `${ELEVENLABS_BASE}/text-to-speech/${voiceId}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail?.message || `TTS failed: ${res.status}`);
  }
  return res.blob();
}

export async function deleteVoice(
  apiKey: string,
  voiceId: string
): Promise<void> {
  const res = await fetch(`${ELEVENLABS_BASE}/voices/${voiceId}`, {
    method: "DELETE",
    headers: { "xi-api-key": apiKey },
  });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

// ============================================================
// Voice Markup Parser (Multi-voice storytelling)
// ============================================================

export interface ParsedSegment {
  speaker: string;       // "narrator" or character name
  text: string;
  voiceId: string;       // Resolved ElevenLabs voice_id
  voiceName?: string;
}

interface CharacterVoiceMap {
  [characterName: string]: { voiceId: string; voiceName?: string };
}

/**
 * Parse voice markup in story content.
 *
 * Supported markup:
 *   [narrator]Text here[/narrator]
 *   [character:Name]Dialogue here[/character]
 *
 * Text without markup is treated as narrator.
 */
export function parseVoiceMarkup(
  content: string,
  characters: CharacterVoiceMap,
  narratorVoiceId: string,
  narratorVoiceName?: string
): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  // Match [narrator]...[/narrator] and [character:Name]...[/character]
  const tagRegex = /\[(narrator|character:([^\]]+))\]([\s\S]*?)\[\/(?:narrator|character)\]/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(content)) !== null) {
    // Any text before this tag = narrator
    const before = content.slice(lastIndex, match.index).trim();
    if (before) {
      segments.push({
        speaker: "narrator",
        text: before,
        voiceId: narratorVoiceId,
        voiceName: narratorVoiceName,
      });
    }

    const fullTag = match[1]; // "narrator" or "character:Name"
    const characterName = match[2]; // Name (if character tag)
    const innerText = match[3].trim();

    if (!innerText) {
      lastIndex = match.index + match[0].length;
      continue;
    }

    if (fullTag === "narrator") {
      segments.push({
        speaker: "narrator",
        text: innerText,
        voiceId: narratorVoiceId,
        voiceName: narratorVoiceName,
      });
    } else if (characterName) {
      const charVoice = characters[characterName];
      segments.push({
        speaker: characterName,
        text: innerText,
        voiceId: charVoice?.voiceId || narratorVoiceId,
        voiceName: charVoice?.voiceName || characterName,
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last tag = narrator
  const remaining = content.slice(lastIndex).trim();
  if (remaining) {
    segments.push({
      speaker: "narrator",
      text: remaining,
      voiceId: narratorVoiceId,
      voiceName: narratorVoiceName,
    });
  }

  // If no markup was found at all, treat entire content as narrator
  if (segments.length === 0 && content.trim()) {
    segments.push({
      speaker: "narrator",
      text: content.trim(),
      voiceId: narratorVoiceId,
      voiceName: narratorVoiceName,
    });
  }

  return segments;
}

/**
 * Generate multi-voice audio for a page.
 * Calls TTS for each segment with the appropriate voice,
 * then concatenates the audio blobs.
 */
export async function generateMultiVoiceAudio(
  apiKey: string,
  segments: ParsedSegment[],
  modelId: string,
  languageCode?: string
): Promise<Blob> {
  if (segments.length === 0) {
    throw new Error("No segments to generate audio for");
  }

  // Optimize: merge adjacent segments with same voiceId
  const merged: ParsedSegment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && last.voiceId === seg.voiceId) {
      last.text += "\n" + seg.text;
    } else {
      merged.push({ ...seg });
    }
  }

  // Generate TTS for each segment
  const audioBlobs: Blob[] = [];
  for (const seg of merged) {
    const blob = await textToSpeech(
      apiKey,
      seg.voiceId,
      seg.text,
      modelId,
      languageCode
    );
    audioBlobs.push(blob);
  }

  // If only 1 segment, return directly
  if (audioBlobs.length === 1) return audioBlobs[0];

  // Concatenate blobs (simple binary concat for mp3 streams)
  const parts: ArrayBuffer[] = [];
  for (const blob of audioBlobs) {
    parts.push(await blob.arrayBuffer());
  }

  const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    combined.set(new Uint8Array(part), offset);
    offset += part.byteLength;
  }

  return new Blob([combined], { type: "audio/mpeg" });
}
