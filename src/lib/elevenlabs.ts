import { modelForLanguage, supportsLanguageCode } from "@/lib/tts-models";
import { ProviderHttpError, providerHttpError } from "@/lib/provider-keys";

/** `ELEVENLABS_API_BASE` overrides the host (tests point it at a local mock). */
export function elevenLabsBase(): string {
  return `${(process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io").replace(/\/+$/, "")}/v1`;
}

/**
 * fetch() to ElevenLabs; any failure becomes a {@link ProviderHttpError}
 * (status + `detail.status` code such as `quota_exceeded`) so the key pool
 * (src/lib/key-pool.ts) can tell "hết credit" from "key sai" from "giọng không có".
 */
export async function elevenFetch(path: string, apiKey: string, init: RequestInit = {}, what = "lỗi"): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${elevenLabsBase()}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(120_000),
      headers: { "xi-api-key": apiKey, ...(init.headers ?? {}) },
    });
  } catch (err) {
    throw new ProviderHttpError("elevenlabs", 0, "network", `ElevenLabs không phản hồi (${err instanceof Error ? err.name : "lỗi mạng"})`);
  }
  if (!res.ok) throw await providerHttpError("elevenlabs", res, what);
  return res;
}

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
  const res = await elevenFetch("/voices", apiKey, {}, "lỗi");
  const data = await res.json();
  return data.voices;
}

export interface ElevenLabsSubscription {
  tier: string | null;
  character_count: number;
  character_limit: number;
  next_character_count_reset_unix: number | null;
}

/** Character quota of the key's account (needs the `user_read` permission on restricted keys). */
export async function getSubscription(apiKey: string): Promise<ElevenLabsSubscription> {
  const res = await elevenFetch("/user/subscription", apiKey, {}, "kiểm tra credit lỗi");
  const d = (await res.json()) as Partial<ElevenLabsSubscription>;
  return {
    tier: d.tier ?? null,
    character_count: Number(d.character_count ?? 0),
    character_limit: Number(d.character_limit ?? 0),
    next_character_count_reset_unix: d.next_character_count_reset_unix ?? null,
  };
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

  const res = await elevenFetch("/voices/add", apiKey, { method: "POST", body: form }, "clone giọng lỗi");
  return res.json();
}

// ============================================================
// Emotion Detection & Voice Settings
// ============================================================

export type EmotionType = "neutral" | "whisper" | "excited" | "sad" | "scared" | "angry" | "happy" | "gentle" | "dramatic";

interface EmotionSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
}

const EMOTION_PRESETS: Record<EmotionType, EmotionSettings> = {
  neutral:   { stability: 0.5, similarity_boost: 0.75, style: 0.4, use_speaker_boost: true },
  whisper:   { stability: 0.8, similarity_boost: 0.9,  style: 0.1, use_speaker_boost: false },
  excited:   { stability: 0.3, similarity_boost: 0.6,  style: 0.8, use_speaker_boost: true },
  happy:     { stability: 0.4, similarity_boost: 0.7,  style: 0.7, use_speaker_boost: true },
  sad:       { stability: 0.7, similarity_boost: 0.85, style: 0.3, use_speaker_boost: false },
  scared:    { stability: 0.6, similarity_boost: 0.7,  style: 0.5, use_speaker_boost: true },
  angry:     { stability: 0.3, similarity_boost: 0.6,  style: 0.9, use_speaker_boost: true },
  gentle:    { stability: 0.75, similarity_boost: 0.85, style: 0.2, use_speaker_boost: false },
  dramatic:  { stability: 0.35, similarity_boost: 0.65, style: 0.85, use_speaker_boost: true },
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `text` contains any of `words` as a whole word (Unicode-aware). */
function hasWord(text: string, words: string[]): boolean {
  const pattern = words.map(escapeRegExp).join("|");
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${pattern})(?![\\p{L}\\p{M}\\p{N}])`, "u").test(text.normalize("NFC"));
}

/**
 * Auto-detect emotion from text content.
 * Returns the most likely emotion based on keywords and context.
 */
export function detectEmotion(text: string): EmotionType {
  const t = text.toLowerCase();

  // Check for explicit emotion tags first
  if (/\[thì thầm\]|\[whisper\]/i.test(text)) return "whisper";
  if (/\[hét\]|\[shout\]|\[la\]/i.test(text)) return "excited";
  if (/\[cười\]|\[laugh\]|\[vui\]/i.test(text)) return "happy";
  if (/\[buồn\]|\[sad\]|\[khóc\]/i.test(text)) return "sad";
  if (/\[sợ\]|\[scared\]|\[run\]/i.test(text)) return "scared";
  if (/\[giận\]|\[angry\]/i.test(text)) return "angry";
  if (/\[nhẹ nhàng\]|\[gentle\]|\[dịu\]/i.test(text)) return "gentle";
  if (/\[kịch tính\]|\[dramatic\]/i.test(text)) return "dramatic";

  // Auto-detect from context
  // Whole-word matching so short keywords don't hit inside other words
  // (e.g. "ôm" in "hôm", "run" in "trung").
  if (hasWord(t, ["thì thầm", "nhỏ giọng", "rì rầm", "whisper", "thầm thì", "lẩm bẩm"])) return "whisper";
  if (hasWord(t, ["hét", "la lớn", "kêu lên", "wow", "hoan hô", "tuyệt vời", "haha", "oà"])) return "excited";
  if (hasWord(t, ["buồn", "khóc", "nước mắt", "nhớ", "thương", "đau", "mất", "chia ly"])) return "sad";
  if (hasWord(t, ["sợ", "run", "rùng mình", "kinh", "hãi", "đáng sợ", "bóng tối"])) return "scared";
  if (hasWord(t, ["giận", "tức", "nổi điên", "bực", "la mắng"])) return "angry";
  if (hasWord(t, ["cười", "vui", "hạnh phúc", "sung sướng", "mừng", "yêu", "xinh", "đẹp"])) return "happy";
  if (hasWord(t, ["ru ngủ", "dịu dàng", "nhẹ nhàng", "ấm áp", "âu yếm", "ôm"])) return "gentle";
  if (hasWord(t, ["bất ngờ", "bí ẩn", "kịch tính", "nguy hiểm", "phiêu lưu", "mạo hiểm"])) return "dramatic";

  return "neutral";
}

/**
 * Strip emotion tags from text before sending to TTS.
 */
export function stripEmotionTags(text: string): string {
  return text.replace(/\[(thì thầm|whisper|hét|shout|la|cười|laugh|vui|buồn|sad|khóc|sợ|scared|run|giận|angry|nhẹ nhàng|gentle|dịu|kịch tính|dramatic)\]/gi, "").trim();
}

export async function textToSpeech(
  apiKey: string,
  voiceId: string,
  text: string,
  modelId: string = "eleven_multilingual_v2",
  languageCode?: string,
  emotion?: EmotionType
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

  // Auto-detect emotion if not provided
  const detectedEmotion = emotion || detectEmotion(text);
  const emotionSettings = EMOTION_PRESETS[detectedEmotion] || EMOTION_PRESETS.neutral;

  // Strip emotion tags from text before sending to TTS
  const cleanText = stripEmotionTags(text);

  const body: Record<string, unknown> = {
    text: cleanText,
    model_id: modelForLanguage(modelId, resolvedLang),
    voice_settings: emotionSettings,
  };

  // language_code is only supported by turbo v2.5, flash v2.5, and v3+ models.
  // eleven_multilingual_v2 does NOT support language_code (will error).
  if (resolvedLang && supportsLanguageCode(modelForLanguage(modelId, resolvedLang))) {
    body.language_code = resolvedLang;
  }

  const res = await elevenFetch(
    `/text-to-speech/${encodeURIComponent(voiceId)}/stream`,
    apiKey,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    "TTS lỗi"
  );
  return res.blob();
}

export async function deleteVoice(
  apiKey: string,
  voiceId: string
): Promise<void> {
  await elevenFetch(`/voices/${encodeURIComponent(voiceId)}`, apiKey, { method: "DELETE" }, "xoá giọng lỗi");
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

  // Generate TTS for each segment (with emotion detection)
  const audioBlobs: Blob[] = [];
  for (const seg of merged) {
    const emotion = detectEmotion(seg.text);
    const blob = await textToSpeech(
      apiKey,
      seg.voiceId,
      seg.text,
      modelId,
      languageCode,
      emotion
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
