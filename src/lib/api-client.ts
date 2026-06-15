"use client";

// Client-side helpers that call our server-side proxy routes (/api/*).
// API keys are passed from the user's saved settings (BYO-key) and never
// hard-coded; the routes fall back to server env vars when present.

import type { ElevenLabsVoice } from "@/lib/elevenlabs";

export interface CloneVoiceResult {
  voice_id: string;
  name: string;
}

export async function cloneVoiceApi(
  name: string,
  audio: Blob,
  apiKey?: string,
  language: string = "vi"
): Promise<CloneVoiceResult> {
  const form = new FormData();
  form.append("name", name);
  form.append("audio", audio, "recording.webm");
  form.append("language", language);
  if (apiKey) form.append("apiKey", apiKey);

  const res = await fetch("/api/voice/clone", { method: "POST", body: form });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Clone giọng thất bại");
  return json;
}

export async function ttsApi(
  voiceId: string,
  text: string,
  apiKey?: string,
  modelId?: string,
  language?: string
): Promise<Blob> {
  const res = await fetch("/api/voice/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ voiceId, text, modelId, apiKey, language }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || "Tạo giọng đọc thất bại");
  }
  return res.blob();
}

export async function listVoicesApi(
  apiKey?: string
): Promise<ElevenLabsVoice[]> {
  const res = await fetch("/api/voice/list", {
    headers: apiKey ? { "x-elevenlabs-key": apiKey } : {},
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Không tải được danh sách giọng");
  return json.voices ?? [];
}

export interface GeneratedStory {
  title: string;
  summary: string;
  pages: { text: string; sceneDescription: string }[];
  storyId: string | null;
}

export async function illustrateApi(
  prompt: string,
  apiKey?: string
): Promise<string> {
  const res = await fetch("/api/story/illustrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, apiKey }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Tạo minh hoạ thất bại");
  return json.url as string;
}

export async function generateStoryApi(input: {
  provider: string;
  model: string;
  theme: string;
  childName?: string;
  age?: string;
  language?: string;
  extraPrompt?: string;
  voiceId?: string | null;
  apiKey?: string;
  baseUrl?: string;
  persist?: boolean;
}): Promise<GeneratedStory> {
  const res = await fetch("/api/story/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Tạo truyện thất bại");
  return json;
}
