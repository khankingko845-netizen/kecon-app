-- ============================================================
-- 004_admin_upgrade.sql
-- Admin module upgrade: additional RLS, platform content,
-- soft delete, story templates.
-- ============================================================

-- 1. Platform content flag (admin-created stories visible to all)
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS is_platform_content BOOLEAN NOT NULL DEFAULT false;

-- 2. Soft delete
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- 3. Story templates table
CREATE TABLE IF NOT EXISTS public.story_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'custom',
  pages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.story_templates ENABLE ROW LEVEL SECURITY;

-- 4. Additional admin RLS policies
-- Stories: INSERT + DELETE for admins
DROP POLICY IF EXISTS "Admins can insert stories" ON public.stories;
CREATE POLICY "Admins can insert stories"
  ON public.stories FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete stories" ON public.stories;
CREATE POLICY "Admins can delete stories"
  ON public.stories FOR DELETE
  USING (public.is_admin());

-- Story pages: full access for admins
DROP POLICY IF EXISTS "Admins can select all story_pages" ON public.story_pages;
CREATE POLICY "Admins can select all story_pages"
  ON public.story_pages FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert story_pages" ON public.story_pages;
CREATE POLICY "Admins can insert story_pages"
  ON public.story_pages FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update story_pages" ON public.story_pages;
CREATE POLICY "Admins can update story_pages"
  ON public.story_pages FOR UPDATE
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete story_pages" ON public.story_pages;
CREATE POLICY "Admins can delete story_pages"
  ON public.story_pages FOR DELETE
  USING (public.is_admin());

-- Voice profiles: admin full access
DROP POLICY IF EXISTS "Admins can manage all voice_profiles" ON public.voice_profiles;
CREATE POLICY "Admins can manage all voice_profiles"
  ON public.voice_profiles FOR ALL
  USING (public.is_admin());

-- Profiles: admin can update (change roles, etc.)
DROP POLICY IF EXISTS "Admins can update profiles" ON public.profiles;
CREATE POLICY "Admins can update profiles"
  ON public.profiles FOR UPDATE
  USING (public.is_admin());

-- Story templates: only admins
DROP POLICY IF EXISTS "Admins can manage templates" ON public.story_templates;
CREATE POLICY "Admins can manage templates"
  ON public.story_templates FOR ALL
  USING (public.is_admin());

-- 5. Platform content visibility: all authenticated users see published platform stories
DROP POLICY IF EXISTS "Published platform stories visible to all" ON public.stories;
CREATE POLICY "Published platform stories visible to all"
  ON public.stories FOR SELECT
  USING (
    is_platform_content = true
    AND is_published = true
    AND deleted_at IS NULL
  );

-- 6. Exclude soft-deleted from normal user queries (update existing owner policy)
-- We rely on the app filtering deleted_at IS NULL; the owner SELECT policy
-- already exists ("Users can view own stories") so no change needed there.
-- Admin SELECT policy already exists ("Admins can view all stories").

-- 7. User behavior: admin can view all
DROP POLICY IF EXISTS "Admins can view all behavior" ON public.user_behavior;
CREATE POLICY "Admins can view all behavior"
  ON public.user_behavior FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can view all play_sessions" ON public.play_sessions;
CREATE POLICY "Admins can view all play_sessions"
  ON public.play_sessions FOR SELECT
  USING (public.is_admin());
