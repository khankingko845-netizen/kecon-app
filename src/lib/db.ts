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

export async function updateStory(
  id: string,
  patch: Partial<
    Pick<
      StoryRow,
      | "title"
      | "description"
      | "category"
      | "is_published"
      | "status"
      | "moral_lesson"
      | "cover_image_url"
    >
  >
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("stories").update(patch).eq("id", id);
  if (error) throw error;
}

export async function publishStory(
  id: string,
  publish: boolean
): Promise<void> {
  await updateStory(id, {
    is_published: publish,
    status: publish ? "published" : "draft",
  });
}

export async function createBlankStory(input: {
  title: string;
  category?: string;
  source?: StoryRow["source"];
}): Promise<string> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Chưa đăng nhập");
  const { data, error } = await supabase
    .from("stories")
    .insert({
      user_id: user.id,
      title: input.title,
      category: input.category ?? "custom",
      source: input.source ?? "manual",
      status: "draft",
      page_count: 0,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function createStoryPage(
  storyId: string,
  pageNumber: number,
  content = "",
  sceneDescription = ""
): Promise<StoryPageRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("story_pages")
    .insert({
      story_id: storyId,
      page_number: pageNumber,
      content,
      scene_description: sceneDescription,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateStoryPage(
  pageId: string,
  patch: Partial<
    Pick<
      StoryPageRow,
      "content" | "scene_description" | "page_number" | "illustration_url"
    >
  >
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("story_pages")
    .update(patch)
    .eq("id", pageId);
  if (error) throw error;
}

export async function deleteStoryPage(pageId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("story_pages")
    .delete()
    .eq("id", pageId);
  if (error) throw error;
}

export async function syncPageOrder(
  pages: { id: string; page_number: number }[]
): Promise<void> {
  const supabase = createClient();
  await Promise.all(
    pages.map((p) =>
      supabase
        .from("story_pages")
        .update({ page_number: p.page_number })
        .eq("id", p.id)
    )
  );
}

export async function setStoryPageCount(
  storyId: string,
  count: number
): Promise<void> {
  const supabase = createClient();
  await supabase
    .from("stories")
    .update({ page_count: count })
    .eq("id", storyId);
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
// Admin / analytics
// ============================================================
export interface AdminStats {
  totalStories: number;
  publishedStories: number;
  draftStories: number;
  pendingReview: number;
  totalVoices: number;
  totalPlays: number;
  totalLikes: number;
  categoryBreakdown: { category: string; count: number }[];
}

export interface ContentGap {
  category: string;
  label: string;
  count: number;
  priority: "high" | "medium" | "low";
  suggestion: string;
}

const ALL_CATEGORIES: { id: string; label: string }[] = [
  { id: "fairy_tale", label: "Cổ tích" },
  { id: "adventure", label: "Phiêu lưu" },
  { id: "bedtime", label: "Ru ngủ" },
  { id: "animal", label: "Động vật" },
  { id: "educational", label: "Học chơi" },
  { id: "custom", label: "Tùy chỉnh" },
];

export async function getAdminStats(): Promise<AdminStats> {
  const supabase = createClient();
  const { data: stories } = await supabase
    .from("stories")
    .select("id, category, status, is_published, play_count, like_count");
  const { count: voiceCount } = await supabase
    .from("voice_profiles")
    .select("id", { count: "exact", head: true });

  const rows = stories ?? [];
  const categoryMap = new Map<string, number>();
  let totalPlays = 0;
  let totalLikes = 0;
  let published = 0;
  let drafts = 0;
  let pending = 0;
  for (const s of rows) {
    categoryMap.set(s.category, (categoryMap.get(s.category) ?? 0) + 1);
    totalPlays += s.play_count ?? 0;
    totalLikes += s.like_count ?? 0;
    if (s.is_published || s.status === "published") published++;
    else if (s.status === "pending_review") pending++;
    else drafts++;
  }

  return {
    totalStories: rows.length,
    publishedStories: published,
    draftStories: drafts,
    pendingReview: pending,
    totalVoices: voiceCount ?? 0,
    totalPlays,
    totalLikes,
    categoryBreakdown: Array.from(categoryMap.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export function computeContentGaps(
  breakdown: { category: string; count: number }[]
): ContentGap[] {
  const counts = new Map(breakdown.map((b) => [b.category, b.count]));
  return ALL_CATEGORIES.map((c) => {
    const count = counts.get(c.id) ?? 0;
    const priority: ContentGap["priority"] =
      count === 0 ? "high" : count < 3 ? "medium" : "low";
    return {
      category: c.id,
      label: c.label,
      count,
      priority,
      suggestion:
        count === 0
          ? `Chưa có truyện "${c.label}" — nên tạo ngay`
          : count < 3
          ? `Chỉ có ${count} truyện "${c.label}" — nên bổ sung`
          : `Đủ truyện "${c.label}"`,
    };
  }).sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });
}

export async function getModerationQueue(): Promise<StoryRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("stories")
    .select("*")
    .in("status", ["pending_review", "draft"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

// ============================================================
// GDPR / data portability
// ============================================================
export async function exportUserData(): Promise<Record<string, unknown>> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Chưa đăng nhập");

  const [profile, voices, stories, members, behavior] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("voice_profiles").select("*").eq("user_id", user.id),
    supabase.from("stories").select("*").eq("user_id", user.id),
    supabase.from("family_members").select("*").eq("user_id", user.id),
    supabase.from("user_behavior").select("*").eq("user_id", user.id).limit(500),
  ]);

  return {
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email },
    profile: profile.data,
    voice_profiles: voices.data ?? [],
    stories: stories.data ?? [],
    family_members: members.data ?? [],
    behavior: behavior.data ?? [],
  };
}

// Deletes all user-generated content (voices, stories, members, behavior).
// Auth account removal requires a privileged server action and is requested
// separately; this clears the personal data the client can reach under RLS.
export async function deleteUserData(): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Chưa đăng nhập");

  await supabase.from("user_behavior").delete().eq("user_id", user.id);
  await supabase.from("story_pages").delete().in(
    "story_id",
    (
      (await supabase.from("stories").select("id").eq("user_id", user.id)).data ??
      []
    ).map((s) => s.id)
  );
  await supabase.from("stories").delete().eq("user_id", user.id);
  await supabase.from("voice_profiles").delete().eq("user_id", user.id);
  await supabase.from("family_members").delete().eq("user_id", user.id);
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
