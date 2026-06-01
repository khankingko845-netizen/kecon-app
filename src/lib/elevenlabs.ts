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

export async function cloneVoice(
  apiKey: string,
  name: string,
  audioBlob: Blob
): Promise<CloneVoiceResult> {
  const form = new FormData();
  form.append("name", name);
  form.append("files", audioBlob, "recording.wav");
  form.append("description", `KểCon voice clone: ${name}`);

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
  modelId: string = "eleven_multilingual_v2"
): Promise<Blob> {
  const res = await fetch(
    `${ELEVENLABS_BASE}/text-to-speech/${voiceId}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.4,
          use_speaker_boost: true,
        },
      }),
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
