-- Migration 005: Ratings & Reviews, Story Sharing, Favorites, Reading Streaks
-- KểCon — Short-term Roadmap Features

-- ============================================================
-- 1. STORY RATINGS & REVIEWS
-- ============================================================
CREATE TABLE public.story_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(story_id, user_id) -- one rating per user per story
);

CREATE INDEX idx_story_ratings_story ON public.story_ratings(story_id);
CREATE INDEX idx_story_ratings_user ON public.story_ratings(user_id);

CREATE TABLE public.story_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (length(content) >= 1 AND length(content) <= 2000),
  rating INTEGER CHECK (rating >= 1 AND rating <= 5), -- optional inline rating
  is_visible BOOLEAN NOT NULL DEFAULT TRUE, -- admin moderation
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_story_reviews_story ON public.story_reviews(story_id);

-- Add average rating & rating count to stories table
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS avg_rating REAL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_count INTEGER DEFAULT 0;

-- Function to recalculate story average rating
CREATE OR REPLACE FUNCTION recalc_story_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.stories SET
    avg_rating = COALESCE((
      SELECT AVG(rating)::REAL FROM public.story_ratings
      WHERE story_id = COALESCE(NEW.story_id, OLD.story_id)
    ), 0),
    rating_count = (
      SELECT COUNT(*) FROM public.story_ratings
      WHERE story_id = COALESCE(NEW.story_id, OLD.story_id)
    )
  WHERE id = COALESCE(NEW.story_id, OLD.story_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_recalc_story_rating
AFTER INSERT OR UPDATE OR DELETE ON public.story_ratings
FOR EACH ROW EXECUTE FUNCTION recalc_story_rating();

-- ============================================================
-- 2. STORY SHARING (public links)
-- ============================================================
CREATE TABLE public.story_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  share_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  view_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ, -- null = never expires
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_story_shares_token ON public.story_shares(share_token);
CREATE INDEX idx_story_shares_story ON public.story_shares(story_id);

-- Add share_count to stories
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 0;

-- ============================================================
-- 3. USER FAVORITES (bookmarks)
-- ============================================================
CREATE TABLE public.user_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, story_id)
);

CREATE INDEX idx_user_favorites_user ON public.user_favorites(user_id);

-- ============================================================
-- 4. READING STREAKS (gamification)
-- ============================================================
CREATE TABLE public.reading_streaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_read_date DATE,
  total_stories_read INTEGER NOT NULL DEFAULT 0,
  total_listen_minutes INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. LOCALE SUPPORT (multi-language)
-- ============================================================
-- profiles table already has locale column (from migration 001)
-- Just add story locale column
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'vi';

-- ============================================================
-- 6. RLS POLICIES
-- ============================================================

-- story_ratings: users can CRUD their own ratings, read all
ALTER TABLE public.story_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read all ratings" ON public.story_ratings
  FOR SELECT USING (true);
CREATE POLICY "Users can insert own ratings" ON public.story_ratings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own ratings" ON public.story_ratings
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own ratings" ON public.story_ratings
  FOR DELETE USING (auth.uid() = user_id);

-- story_reviews: users can CRUD their own, read visible
ALTER TABLE public.story_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read visible reviews" ON public.story_reviews
  FOR SELECT USING (is_visible = true OR auth.uid() = user_id);
CREATE POLICY "Users can insert own reviews" ON public.story_reviews
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own reviews" ON public.story_reviews
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own reviews" ON public.story_reviews
  FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage all reviews" ON public.story_reviews
  FOR ALL USING (is_admin(auth.uid()));

-- story_shares: users can CRUD their own, public reads active shares
ALTER TABLE public.story_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own shares" ON public.story_shares
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Public can read active shares" ON public.story_shares
  FOR SELECT USING (is_active = true);

-- user_favorites: users can CRUD their own
ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own favorites" ON public.user_favorites
  FOR ALL USING (auth.uid() = user_id);

-- reading_streaks: users can read/update their own
ALTER TABLE public.reading_streaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own streaks" ON public.reading_streaks
  FOR ALL USING (auth.uid() = user_id);
