-- KểCon Migration 002 — Storage buckets, semantic search, analytics helpers
-- Safe to run multiple times (idempotent where possible).

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('recordings', 'recordings', false),
  ('tts-cache', 'tts-cache', true),
  ('illustrations', 'illustrations', true)
ON CONFLICT (id) DO NOTHING;

-- Recordings: private — only the owner (path prefixed with their uid) can access.
DROP POLICY IF EXISTS "Users manage own recordings" ON storage.objects;
CREATE POLICY "Users manage own recordings"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'recordings'
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'recordings'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Public buckets: anyone can read, authenticated users can write to their folder.
DROP POLICY IF EXISTS "Public read tts" ON storage.objects;
CREATE POLICY "Public read tts"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'tts-cache');

DROP POLICY IF EXISTS "Auth write tts" ON storage.objects;
CREATE POLICY "Auth write tts"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'tts-cache' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Public read illustrations" ON storage.objects;
CREATE POLICY "Public read illustrations"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'illustrations');

DROP POLICY IF EXISTS "Auth write illustrations" ON storage.objects;
CREATE POLICY "Auth write illustrations"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'illustrations' AND auth.uid() IS NOT NULL);

-- ============================================================
-- COUNTER HELPERS (atomic increments, bypass RLS via SECURITY DEFINER)
-- ============================================================
CREATE OR REPLACE FUNCTION public.increment_play_count(p_story_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.stories SET play_count = play_count + 1 WHERE id = p_story_id;
$$;

CREATE OR REPLACE FUNCTION public.toggle_like(p_story_id UUID, p_delta INTEGER)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.stories
  SET like_count = GREATEST(0, like_count + p_delta)
  WHERE id = p_story_id;
$$;

-- ============================================================
-- SEMANTIC SEARCH (pgvector) — used by recommendations (Phase 4)
-- ============================================================
CREATE OR REPLACE FUNCTION public.match_stories(
  query_embedding VECTOR(1536),
  match_count INTEGER DEFAULT 10,
  exclude_user UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  description TEXT,
  category TEXT,
  cover_image_url TEXT,
  similarity REAL
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    s.id,
    s.title,
    s.description,
    s.category,
    s.cover_image_url,
    (1 - (s.embedding <=> query_embedding))::REAL AS similarity
  FROM public.stories s
  WHERE s.embedding IS NOT NULL
    AND s.is_published = TRUE
    AND (exclude_user IS NULL OR s.user_id <> exclude_user)
  ORDER BY s.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ============================================================
-- ADMIN ANALYTICS (aggregate views, SECURITY DEFINER for admins)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_overview()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT json_build_object(
    'total_users', (SELECT count(*) FROM public.profiles),
    'total_stories', (SELECT count(*) FROM public.stories),
    'published_stories', (SELECT count(*) FROM public.stories WHERE is_published),
    'pending_review', (SELECT count(*) FROM public.stories WHERE status = 'pending_review'),
    'total_plays', (SELECT COALESCE(sum(play_count), 0) FROM public.stories),
    'total_voices', (SELECT count(*) FROM public.voice_profiles)
  ) INTO result;

  RETURN result;
END;
$$;

-- Indexes to support recommendations/admin queries
CREATE INDEX IF NOT EXISTS idx_stories_play_count ON public.stories(play_count DESC);
CREATE INDEX IF NOT EXISTS idx_stories_published ON public.stories(is_published, created_at DESC);
