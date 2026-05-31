-- KểCon Database Schema v2
-- Run this in Supabase SQL Editor to set up the database

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================
-- 1. PROFILES (extends Supabase auth.users)
-- ============================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  family_name TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  child_age INTEGER CHECK (child_age >= 0 AND child_age <= 18),
  child_name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin')),
  locale TEXT NOT NULL DEFAULT 'vi',
  onboarding_done BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. VOICE PROFILES
-- ============================================================
CREATE TABLE public.voice_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'parent',
  gender TEXT NOT NULL DEFAULT 'female' CHECK (gender IN ('male', 'female')),
  elevenlabs_voice_id TEXT,
  sample_audio_url TEXT,
  quality_score REAL DEFAULT 0 CHECK (quality_score >= 0 AND quality_score <= 100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_voice_profiles_user ON public.voice_profiles(user_id);

-- ============================================================
-- 3. STORIES
-- ============================================================
CREATE TABLE public.stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'fairy_tale',
  theme TEXT,
  target_age_min INTEGER DEFAULT 0,
  target_age_max INTEGER DEFAULT 12,
  voice_id UUID REFERENCES public.voice_profiles(id) ON DELETE SET NULL,
  cover_image_url TEXT,
  total_duration INTEGER DEFAULT 0, -- seconds
  page_count INTEGER DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  is_template BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT DEFAULT 'ai' CHECK (source IN ('ai', 'manual', 'upload', 'template')),
  tags TEXT[] DEFAULT '{}',
  moral_lesson TEXT,
  embedding VECTOR(1536),
  play_count INTEGER NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0,
  completion_rate REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived', 'pending_review', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stories_user ON public.stories(user_id);
CREATE INDEX idx_stories_category ON public.stories(category);
CREATE INDEX idx_stories_status ON public.stories(status);
CREATE INDEX idx_stories_tags ON public.stories USING GIN(tags);

-- ============================================================
-- 4. STORY PAGES
-- ============================================================
CREATE TABLE public.story_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  scene_description TEXT,
  illustration_url TEXT,
  audio_url TEXT,
  audio_duration INTEGER DEFAULT 0, -- seconds
  transition_effect TEXT DEFAULT 'fade',
  particle_effect TEXT,
  ambient_sound TEXT,
  sfx_sounds TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(story_id, page_number)
);

CREATE INDEX idx_story_pages_story ON public.story_pages(story_id);

-- ============================================================
-- 5. FAMILY MEMBERS
-- ============================================================
CREATE TABLE public.family_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relation TEXT NOT NULL,
  avatar_url TEXT,
  voice_profile_id UUID REFERENCES public.voice_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_family_members_user ON public.family_members(user_id);

-- ============================================================
-- 6. AUDIO CACHE
-- ============================================================
CREATE TABLE public.audio_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_page_id UUID REFERENCES public.story_pages(id) ON DELETE CASCADE,
  voice_id UUID REFERENCES public.voice_profiles(id) ON DELETE CASCADE,
  audio_url TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'elevenlabs',
  model TEXT,
  content_hash TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(content_hash, voice_id)
);

-- ============================================================
-- 7. PLAY SESSIONS (analytics)
-- ============================================================
CREATE TABLE public.play_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  voice_id UUID REFERENCES public.voice_profiles(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration INTEGER DEFAULT 0, -- seconds listened
  pages_listened INTEGER DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  device_info JSONB DEFAULT '{}'
);

CREATE INDEX idx_play_sessions_user ON public.play_sessions(user_id);
CREATE INDEX idx_play_sessions_story ON public.play_sessions(story_id);

-- ============================================================
-- 8. USER BEHAVIOR (for recommendations)
-- ============================================================
CREATE TABLE public.user_behavior (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('play', 'like', 'share', 'search', 'create', 'complete')),
  story_id UUID REFERENCES public.stories(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_behavior_user ON public.user_behavior(user_id);
CREATE INDEX idx_user_behavior_action ON public.user_behavior(action_type);

-- ============================================================
-- 9. API USAGE TRACKING
-- ============================================================
CREATE TABLE public.usage_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  tokens_used INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_tracking_user ON public.usage_tracking(user_id);
CREATE INDEX idx_usage_tracking_provider ON public.usage_tracking(provider);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audio_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.play_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_behavior ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_tracking ENABLE ROW LEVEL SECURITY;

-- PROFILES policies
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- VOICE PROFILES policies
CREATE POLICY "Users can view own voices"
  ON public.voice_profiles FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can manage own voices"
  ON public.voice_profiles FOR ALL
  USING (user_id = auth.uid());

-- STORIES policies
CREATE POLICY "Users can view own stories"
  ON public.stories FOR SELECT
  USING (user_id = auth.uid() OR is_published = TRUE);

CREATE POLICY "Users can manage own stories"
  ON public.stories FOR ALL
  USING (user_id = auth.uid());

-- STORY PAGES policies
CREATE POLICY "Users can view pages of accessible stories"
  ON public.story_pages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stories s
      WHERE s.id = story_id AND (s.user_id = auth.uid() OR s.is_published = TRUE)
    )
  );

CREATE POLICY "Users can manage pages of own stories"
  ON public.story_pages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.stories s
      WHERE s.id = story_id AND s.user_id = auth.uid()
    )
  );

-- FAMILY MEMBERS policies
CREATE POLICY "Users can manage own family"
  ON public.family_members FOR ALL
  USING (user_id = auth.uid());

-- AUDIO CACHE policies
CREATE POLICY "Users can view cached audio"
  ON public.audio_cache FOR SELECT
  USING (TRUE);

CREATE POLICY "Authenticated users can insert cache"
  ON public.audio_cache FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- PLAY SESSIONS policies
CREATE POLICY "Users can manage own sessions"
  ON public.play_sessions FOR ALL
  USING (user_id = auth.uid());

-- USER BEHAVIOR policies
CREATE POLICY "Users can manage own behavior"
  ON public.user_behavior FOR ALL
  USING (user_id = auth.uid());

-- USAGE TRACKING policies
CREATE POLICY "Users can view own usage"
  ON public.usage_tracking FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Authenticated users can insert usage"
  ON public.usage_tracking FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
-- ADMIN POLICIES (for admin/super_admin roles)
-- ============================================================
-- SECURITY DEFINER helper bypasses RLS to avoid infinite recursion
-- when admin policies on `profiles` need to read the caller's role.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
  );
$$;

CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can view all stories"
  ON public.stories FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can update any story status"
  ON public.stories FOR UPDATE
  USING (public.is_admin());

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, family_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'family_name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER voice_profiles_updated_at
  BEFORE UPDATE ON public.voice_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER stories_updated_at
  BEFORE UPDATE ON public.stories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER story_pages_updated_at
  BEFORE UPDATE ON public.story_pages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
