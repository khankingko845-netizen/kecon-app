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
