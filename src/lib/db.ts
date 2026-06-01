"use client";

import { createClient } from "@/lib/supabase/client";

// ============================================================
// Row types (mirror supabase/migrations/001_initial_schema.sql)
// ============================================================
export interface VoiceProfileRow {
  id: string;
  user_id: string;
  name: string;
  relation: string;
  gender: "male" | "female";
  elevenlabs_voice_id: string | null;
  sample_audio_url: string | null;
  quality_score: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StoryRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category: string;
  theme: string | null;
  target_age_min: number;
  target_age_max: number;
  voice_id: string | null;
  cover_image_url: string | null;
  total_duration: number;
  page_count: number;
  is_published: boolean;
  is_template: boolean;
  source: "ai" | "manual" | "upload" | "template";
  tags: string[];
  moral_lesson: string | null;
  play_count: number;
  like_count: number;
  completion_rate: number;
  status: "draft" | "published" | "archived" | "pending_review" | "rejected";
  created_at: string;
  updated_at: string;
}

export interface StoryPageRow {
  id: string;
  story_id: string;
  page_number: number;
  content: string;
  scene_description: string | null;
  illustration_url: string | null;
  audio_url: string | null;
  audio_duration: number;
  transition_effect: string;
  particle_effect: string | null;
  ambient_sound: string | null;
  sfx_sounds: string[];
}

export interface FamilyMemberRow {
  id: string;
  user_id: string;
  name: string;
  relation: string;
  avatar_url: string | null;
  voice_profile_id: string | null;
}

// ============================================================
// Visual identity helpers (deterministic gradient/icon from id)
// ============================================================
const GRADIENTS = [
  "from-pink-400 to-pink-600",
  "from-blue-500 to-blue-700",
  "from-amber-400 to-amber-500",
  "from-emerald-400 to-emerald-600",
  "from-violet-400 to-violet-600",
  "from-rose-400 to-rose-500",
];

const STORY_ICONS = ["flame", "rabbit", "castle", "wand", "rocket", "paw"];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function gradientFor(id: string): string {
  return GRADIENTS[hashString(id) % GRADIENTS.length];
}

export function iconForCategory(category: string, id: string): string {
  const map: Record<string, string> = {
    cotich: "castle",
    fairy_tale: "castle",
    phieuluu: "rocket",
    adventure: "rocket",
    dongvat: "paw",
    animal: "paw",
    ngungon: "wand",
    bedtime: "wand",
  };
  return map[category] || STORY_ICONS[hashString(id) % STORY_ICONS.length];
}

// ============================================================
// Voice profiles
// ============================================================
export async function getVoiceProfiles(): Promise<VoiceProfileRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("voice_profiles")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createVoiceProfile(input: {
  name: string;
  relation: string;
  gender: "male" | "female";
  elevenlabs_voice_id?: string | null;
  sample_audio_url?: string | null;
  quality_score?: number;
}): Promise<VoiceProfileRow> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Chưa đăng nhập");

  const { data, error } = await supabase
    .from("voice_profiles")
    .insert({
      user_id: user.id,
      name: input.name,
      relation: input.relation,
      gender: input.gender,
      elevenlabs_voice_id: input.elevenlabs_voice_id ?? null,
      sample_audio_url: input.sample_audio_url ?? null,
      quality_score: input.quality_score ?? 0,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteVoiceProfile(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("voice_profiles").delete().eq("id", id);
  if (error) throw error;
}

// ============================================================
// Stories
// ============================================================
export async function getStories(opts?: {
  ownOnly?: boolean;
}): Promise<StoryRow[]> {
  const supabase = createClient();
  let query = supabase.from("stories").select("*").order("created_at", {
    ascending: false,
  });
  if (opts?.ownOnly) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) query = query.eq("user_id", user.id);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getRecentStories(limit = 3): Promise<StoryRow[]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("stories")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getStory(id: string): Promise<StoryRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("stories")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getStoryPages(storyId: string): Promise<StoryPageRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("story_pages")
    .select("*")
    .eq("story_id", storyId)
    .order("page_number", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function deleteStory(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("stories").delete().eq("id", id);
  if (error) throw error;
}

// ============================================================
// Family members
// ============================================================
export async function getFamilyMembers(): Promise<FamilyMemberRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("family_members")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ============================================================
// Analytics / behavior
// ============================================================
export async function logBehavior(
  actionType: "play" | "like" | "share" | "search" | "create" | "complete",
  storyId?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("user_behavior").insert({
    user_id: user.id,
    action_type: actionType,
    story_id: storyId ?? null,
    metadata: metadata ?? {},
  });
}

export async function logPlaySession(input: {
  storyId: string;
  voiceId?: string | null;
  duration: number;
  pagesListened: number;
  completed: boolean;
}): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("play_sessions").insert({
    user_id: user.id,
    story_id: input.storyId,
    voice_id: input.voiceId ?? null,
    ended_at: new Date().toISOString(),
    duration: input.duration,
    pages_listened: input.pagesListened,
    completed: input.completed,
  });
  await supabase.rpc("increment_play_count", { p_story_id: input.storyId });
}

export async function likeStory(storyId: string, like: boolean): Promise<void> {
  const supabase = createClient();
  await supabase.rpc("toggle_like", {
    p_story_id: storyId,
    p_delta: like ? 1 : -1,
  });
  if (like) await logBehavior("like", storyId);
}

// ============================================================
// Storage
// ============================================================
export async function uploadRecording(blob: Blob): Promise<string> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Chưa đăng nhập");

  const ext = blob.type.includes("mp4") ? "mp4" : "webm";
  const path = `${user.id}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("recordings")
    .upload(path, blob, { contentType: blob.type, upsert: false });
  if (error) throw error;
  return path;
}

export async function getRecordingUrl(path: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from("recordings")
    .createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}

export async function uploadTtsAudio(
  storyPageId: string,
  blob: Blob
): Promise<string> {
  const supabase = createClient();
  const path = `${storyPageId}-${Date.now()}.mp3`;
  const { error } = await supabase.storage
    .from("tts-cache")
    .upload(path, blob, { contentType: "audio/mpeg", upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("tts-cache").getPublicUrl(path);
  return data.publicUrl;
}

export async function savePageAudio(
  storyPageId: string,
  audioUrl: string,
  durationSec: number
): Promise<void> {
  const supabase = createClient();
  await supabase
    .from("story_pages")
    .update({ audio_url: audioUrl, audio_duration: Math.round(durationSec) })
    .eq("id", storyPageId);
}
