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
  is_branching: boolean;
  source: "ai" | "manual" | "upload" | "template";
  tags: string[];
  moral_lesson: string | null;
  play_count: number;
  like_count: number;
  completion_rate: number;
  status: "draft" | "published" | "archived" | "pending_review" | "rejected";
  is_platform_content: boolean;
  deleted_at: string | null;
  avg_rating: number;
  rating_count: number;
  share_count: number;
  locale: string;
  created_at: string;
  updated_at: string;
}

export interface StoryTemplateRow {
  id: string;
  title: string;
  description: string | null;
  category: string;
  pages: {
    content: string;
    scene_description?: string | null;
    particle_effect?: string | null;
    ambient_sound?: string | null;
  }[];
  created_by: string | null;
  created_at: string;
}

export interface AdminUserRow {
  id: string;
  display_name: string | null;
  family_name: string | null;
  role: string;
  child_name: string | null;
  child_age: number | null;
  created_at: string;
  storyCount: number;
  voiceCount: number;
}

export interface PageChoice {
  label: string;
  description?: string;
  target: number; // page_number to jump to
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
  choices: PageChoice[];
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
  // Normalize choices (column may be absent on rows created before migration).
  return (data ?? []).map((p) => ({ ...p, choices: p.choices ?? [] }));
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
      | "is_branching"
      | "is_platform_content"
      | "target_age_min"
      | "target_age_max"
      | "tags"
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
  isPlatformContent?: boolean;
  description?: string;
  targetAgeMin?: number;
  targetAgeMax?: number;
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
      description: input.description ?? null,
      target_age_min: input.targetAgeMin ?? 3,
      target_age_max: input.targetAgeMax ?? 8,
      is_platform_content: input.isPlatformContent ?? false,
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
      | "content"
      | "scene_description"
      | "page_number"
      | "illustration_url"
      | "particle_effect"
      | "transition_effect"
      | "choices"
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

export async function createFamilyMember(input: {
  name: string;
  relation: string;
  voiceProfileId?: string | null;
}): Promise<FamilyMemberRow> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Chưa đăng nhập");
  const { data, error } = await supabase
    .from("family_members")
    .insert({
      user_id: user.id,
      name: input.name,
      relation: input.relation,
      voice_profile_id: input.voiceProfileId ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as FamilyMemberRow;
}

export async function deleteFamilyMember(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("family_members")
    .delete()
    .eq("id", id);
  if (error) throw error;
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
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

// ============================================================
// Admin: story management (Phase C)
// ============================================================
export interface AdminStoriesFilter {
  status?: StoryRow["status"] | "all";
  category?: string | "all";
  search?: string;
  includeDeleted?: boolean;
}

export async function getAdminStories(
  filter: AdminStoriesFilter = {}
): Promise<StoryRow[]> {
  const supabase = createClient();
  let query = supabase
    .from("stories")
    .select("*")
    .order("created_at", { ascending: false });
  if (!filter.includeDeleted) query = query.is("deleted_at", null);
  if (filter.status && filter.status !== "all")
    query = query.eq("status", filter.status);
  if (filter.category && filter.category !== "all")
    query = query.eq("category", filter.category);
  if (filter.search && filter.search.trim())
    query = query.ilike("title", `%${filter.search.trim()}%`);
  const { data, error } = await query.limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function softDeleteStory(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("stories")
    .update({ deleted_at: new Date().toISOString(), is_published: false })
    .eq("id", id);
  if (error) throw error;
}

export async function restoreStory(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("stories")
    .update({ deleted_at: null })
    .eq("id", id);
  if (error) throw error;
}

export async function bulkPublishStories(
  ids: string[],
  publish: boolean
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("stories")
    .update({
      is_published: publish,
      status: publish ? "published" : "draft",
    })
    .in("id", ids);
  if (error) throw error;
}

export async function bulkSoftDeleteStories(ids: string[]): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("stories")
    .update({ deleted_at: new Date().toISOString(), is_published: false })
    .in("id", ids);
  if (error) throw error;
}

// ============================================================
// Admin: story templates (Phase C)
// ============================================================
export async function getStoryTemplates(): Promise<StoryTemplateRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("story_templates")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((t) => ({ ...t, pages: t.pages ?? [] }));
}

export async function createTemplateFromStory(
  storyId: string
): Promise<string> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Chưa đăng nhập");
  const story = await getStory(storyId);
  if (!story) throw new Error("Không tìm thấy truyện");
  const pages = await getStoryPages(storyId);
  const { data, error } = await supabase
    .from("story_templates")
    .insert({
      title: story.title,
      description: story.description,
      category: story.category,
      created_by: user.id,
      pages: pages.map((p) => ({
        content: p.content,
        scene_description: p.scene_description,
        particle_effect: p.particle_effect,
        ambient_sound: p.ambient_sound,
      })),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function deleteTemplate(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("story_templates")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function createStoryFromTemplate(
  templateId: string
): Promise<string> {
  const supabase = createClient();
  const { data: tpl, error: tErr } = await supabase
    .from("story_templates")
    .select("*")
    .eq("id", templateId)
    .single();
  if (tErr) throw tErr;
  const storyId = await createBlankStory({
    title: tpl.title,
    category: tpl.category,
    source: "template",
    description: tpl.description ?? undefined,
    isPlatformContent: true,
  });
  const pages = (tpl.pages ?? []) as StoryTemplateRow["pages"];
  for (let i = 0; i < pages.length; i++) {
    const page = await createStoryPage(
      storyId,
      i + 1,
      pages[i].content,
      pages[i].scene_description ?? ""
    );
    if (pages[i].particle_effect) {
      await updateStoryPage(page.id, {
        particle_effect: pages[i].particle_effect ?? null,
      });
    }
  }
  await setStoryPageCount(storyId, pages.length);
  return storyId;
}

// ============================================================
// Admin: user management (Phase D)
// ============================================================
export async function getAdminUsers(): Promise<AdminUserRow[]> {
  const supabase = createClient();
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, display_name, family_name, role, child_name, child_age, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const { data: stories } = await supabase
    .from("stories")
    .select("user_id")
    .is("deleted_at", null);
  const { data: voices } = await supabase
    .from("voice_profiles")
    .select("user_id");
  const storyCounts = new Map<string, number>();
  for (const s of stories ?? [])
    storyCounts.set(s.user_id, (storyCounts.get(s.user_id) ?? 0) + 1);
  const voiceCounts = new Map<string, number>();
  for (const v of voices ?? [])
    voiceCounts.set(v.user_id, (voiceCounts.get(v.user_id) ?? 0) + 1);
  return (profiles ?? []).map((p) => ({
    ...p,
    storyCount: storyCounts.get(p.id) ?? 0,
    voiceCount: voiceCounts.get(p.id) ?? 0,
  }));
}

export async function updateUserRole(
  userId: string,
  role: "user" | "admin" | "super_admin"
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", userId);
  if (error) throw error;
}

// ============================================================
// Admin: advanced analytics (Phase D)
// ============================================================
export interface AdminAnalytics {
  topStories: {
    id: string;
    title: string;
    play_count: number;
    like_count: number;
    completion_rate: number;
  }[];
  avgCompletion: number;
  totalSessions: number;
  recentSignups: number;
  categoryPlays: { category: string; plays: number }[];
}

export async function getAdminAnalytics(): Promise<AdminAnalytics> {
  const supabase = createClient();
  const { data: stories } = await supabase
    .from("stories")
    .select("id, title, category, play_count, like_count, completion_rate")
    .is("deleted_at", null);
  const rows = stories ?? [];
  const topStories = [...rows]
    .sort((a, b) => (b.play_count ?? 0) - (a.play_count ?? 0))
    .slice(0, 10)
    .map((s) => ({
      id: s.id,
      title: s.title,
      play_count: s.play_count ?? 0,
      like_count: s.like_count ?? 0,
      completion_rate: s.completion_rate ?? 0,
    }));
  const withCompletion = rows.filter((s) => (s.completion_rate ?? 0) > 0);
  const avgCompletion =
    withCompletion.length > 0
      ? withCompletion.reduce((sum, s) => sum + (s.completion_rate ?? 0), 0) /
        withCompletion.length
      : 0;
  const catMap = new Map<string, number>();
  for (const s of rows)
    catMap.set(s.category, (catMap.get(s.category) ?? 0) + (s.play_count ?? 0));
  const categoryPlays = Array.from(catMap.entries())
    .map(([category, plays]) => ({ category, plays }))
    .sort((a, b) => b.plays - a.plays);

  const { count: totalSessions } = await supabase
    .from("play_sessions")
    .select("id", { count: "exact", head: true });

  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { count: recentSignups } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .gte("created_at", weekAgo);

  return {
    topStories,
    avgCompletion,
    totalSessions: totalSessions ?? 0,
    recentSignups: recentSignups ?? 0,
    categoryPlays,
  };
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

// ============================================================
// Ratings & Reviews (Migration 005)
// ============================================================
export interface StoryRatingRow {
  id: string;
  story_id: string;
  user_id: string;
  rating: number;
  created_at: string;
  updated_at: string;
}

export interface StoryReviewRow {
  id: string;
  story_id: string;
  user_id: string;
  content: string;
  rating: number | null;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
  // joined
  display_name?: string | null;
}

export async function getStoryRating(storyId: string): Promise<{
  avgRating: number;
  ratingCount: number;
  userRating: number | null;
}> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: story } = await supabase
    .from("stories")
    .select("avg_rating, rating_count")
    .eq("id", storyId)
    .maybeSingle();

  let userRating: number | null = null;
  if (user) {
    const { data: rating } = await supabase
      .from("story_ratings")
      .select("rating")
      .eq("story_id", storyId)
      .eq("user_id", user.id)
      .maybeSingle();
    userRating = rating?.rating ?? null;
  }

  return {
    avgRating: story?.avg_rating ?? 0,
    ratingCount: story?.rating_count ?? 0,
    userRating,
  };
}

export async function rateStory(storyId: string, rating: number): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Chưa đăng nhập");

  const { data: existing } = await supabase
    .from("story_ratings")
    .select("id")
    .eq("story_id", storyId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("story_ratings")
      .update({ rating, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await supabase.from("story_ratings").insert({
      story_id: storyId,
      user_id: user.id,
      rating,
    });
  }
}

export async function getStoryReviews(storyId: string): Promise<StoryReviewRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("story_reviews")
    .select("*, profiles!inner(display_name)")
    .eq("story_id", storyId)
    .eq("is_visible", true)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    // Fallback without join if profiles join fails
    const { data: fallback } = await supabase
      .from("story_reviews")
      .select("*")
      .eq("story_id", storyId)
      .eq("is_visible", true)
      .order("created_at", { ascending: false })
      .limit(50);
    return fallback ?? [];
  }
  return (data ?? []).map((r) => ({
    ...r,
    display_name: (r as Record<string, unknown>).profiles
      ? ((r as Record<string, unknown>).profiles as { display_name: string | null }).display_name
      : null,
  }));
}

export async function createReview(storyId: string, content: string, rating?: number): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Chưa đăng nhập");

  await supabase.from("story_reviews").insert({
    story_id: storyId,
    user_id: user.id,
    content,
    rating: rating ?? null,
  });
}

export async function deleteReview(reviewId: string): Promise<void> {
  const supabase = createClient();
  await supabase.from("story_reviews").delete().eq("id", reviewId);
}

// ============================================================
// Story Sharing (Migration 005)
// ============================================================
export interface StoryShareRow {
  id: string;
  story_id: string;
  user_id: string;
  share_token: string;
  is_active: boolean;
  view_count: number;
  expires_at: string | null;
  created_at: string;
}

export async function createShareLink(storyId: string): Promise<StoryShareRow> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Chưa đăng nhập");

  // Check for existing active share
  const { data: existing } = await supabase
    .from("story_shares")
    .select("*")
    .eq("story_id", storyId)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (existing) return existing;

  const { data, error } = await supabase
    .from("story_shares")
    .insert({ story_id: storyId, user_id: user.id })
    .select("*")
    .single();
  if (error) throw error;

  // Increment share count (best-effort)
  try { await supabase.rpc("increment_play_count", { p_story_id: storyId }); } catch {}
  await logBehavior("share", storyId);

  return data;
}

export async function getShareByToken(token: string): Promise<{
  share: StoryShareRow;
  story: StoryRow;
  pages: StoryPageRow[];
} | null> {
  const supabase = createClient();
  const { data: share } = await supabase
    .from("story_shares")
    .select("*")
    .eq("share_token", token)
    .eq("is_active", true)
    .maybeSingle();
  if (!share) return null;

  // Check expiry
  if (share.expires_at && new Date(share.expires_at) < new Date()) return null;

  const [story, pages] = await Promise.all([
    getStory(share.story_id),
    getStoryPages(share.story_id),
  ]);
  if (!story) return null;

  // Increment view count
  await supabase
    .from("story_shares")
    .update({ view_count: (share.view_count || 0) + 1 })
    .eq("id", share.id);

  return { share, story, pages };
}

export async function deactivateShare(shareId: string): Promise<void> {
  const supabase = createClient();
  await supabase.from("story_shares").update({ is_active: false }).eq("id", shareId);
}

// ============================================================
// User Favorites / Bookmarks (Migration 005)
// ============================================================
export async function getUserFavorites(): Promise<StoryRow[]> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: favs } = await supabase
    .from("user_favorites")
    .select("story_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (!favs || favs.length === 0) return [];

  const storyIds = favs.map((f) => f.story_id);
  const { data: stories } = await supabase
    .from("stories")
    .select("*")
    .in("id", storyIds);

  // Preserve favorites order
  const storyMap = new Map((stories ?? []).map((s) => [s.id, s]));
  return storyIds.map((id) => storyMap.get(id)).filter(Boolean) as StoryRow[];
}

export async function toggleFavorite(storyId: string): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Chưa đăng nhập");

  const { data: existing } = await supabase
    .from("user_favorites")
    .select("id")
    .eq("user_id", user.id)
    .eq("story_id", storyId)
    .maybeSingle();

  if (existing) {
    await supabase.from("user_favorites").delete().eq("id", existing.id);
    return false;
  } else {
    await supabase.from("user_favorites").insert({
      user_id: user.id,
      story_id: storyId,
    });
    return true;
  }
}

export async function isFavorited(storyId: string): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data } = await supabase
    .from("user_favorites")
    .select("id")
    .eq("user_id", user.id)
    .eq("story_id", storyId)
    .maybeSingle();

  return !!data;
}

// ============================================================
// Reading Streaks (Migration 005)
// ============================================================
export interface ReadingStreakRow {
  id: string;
  user_id: string;
  current_streak: number;
  longest_streak: number;
  last_read_date: string | null;
  total_stories_read: number;
  total_listen_minutes: number;
  updated_at: string;
}

export async function getReadingStreak(): Promise<ReadingStreakRow | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("reading_streaks")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  return data;
}

export async function updateReadingStreak(listenMinutes: number): Promise<ReadingStreakRow> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Chưa đăng nhập");

  const today = new Date().toISOString().split("T")[0];
  const { data: existing } = await supabase
    .from("reading_streaks")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existing) {
    // Create new streak record
    const { data, error } = await supabase
      .from("reading_streaks")
      .insert({
        user_id: user.id,
        current_streak: 1,
        longest_streak: 1,
        last_read_date: today,
        total_stories_read: 1,
        total_listen_minutes: Math.round(listenMinutes),
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  // Calculate streak
  const lastDate = existing.last_read_date;
  let newStreak = existing.current_streak;

  if (lastDate === today) {
    // Already read today — just update minutes
    const { data, error } = await supabase
      .from("reading_streaks")
      .update({
        total_listen_minutes: existing.total_listen_minutes + Math.round(listenMinutes),
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  if (lastDate === yesterdayStr) {
    newStreak = existing.current_streak + 1;
  } else {
    newStreak = 1; // streak broken
  }

  const longestStreak = Math.max(existing.longest_streak, newStreak);

  const { data, error } = await supabase
    .from("reading_streaks")
    .update({
      current_streak: newStreak,
      longest_streak: longestStreak,
      last_read_date: today,
      total_stories_read: existing.total_stories_read + 1,
      total_listen_minutes: existing.total_listen_minutes + Math.round(listenMinutes),
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// ============================================================
// App Settings (admin-managed system config)
// ============================================================
export interface AppSettingRow {
  key: string;
  value: string;
  label: string | null;
  category: string;
  is_secret: boolean;
  updated_at: string;
}

/** Fetch all app settings (admin sees secrets, regular users see non-secret only via RLS). */
export async function getAppSettings(): Promise<AppSettingRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("*")
    .order("category", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Fetch a single setting by key. */
export async function getAppSetting(key: string): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .single();
  if (error) return "";
  return data?.value ?? "";
}

/** Update a setting (admin only). */
export async function updateAppSetting(key: string, value: string): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("app_settings")
    .update({ value, updated_at: new Date().toISOString(), updated_by: user?.id ?? null })
    .eq("key", key);
  if (error) throw error;
}

/** Bulk update settings (admin only). */
export async function updateAppSettings(settings: Record<string, string>): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const promises = Object.entries(settings).map(([key, value]) =>
    supabase
      .from("app_settings")
      .update({ value, updated_at: new Date().toISOString(), updated_by: user?.id ?? null })
      .eq("key", key)
  );
  const results = await Promise.all(promises);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

// ============================================================
// Batch TTS Generation
// ============================================================
export async function getPagesMissingAudio(storyId: string): Promise<StoryPageRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("story_pages")
    .select("*")
    .eq("story_id", storyId)
    .is("audio_url", null)
    .order("page_number", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
