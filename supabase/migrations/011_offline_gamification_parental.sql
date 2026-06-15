-- Migration 011: Offline downloads, Gamification (badges/XP), Parental controls, Parent analytics
-- Run in order after 010_story_voice_characters.sql

-- ============================================================
-- 1. OFFLINE DOWNLOADS
-- ============================================================
CREATE TABLE IF NOT EXISTS downloaded_stories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  story_id UUID REFERENCES stories(id) ON DELETE CASCADE NOT NULL,
  downloaded_at TIMESTAMPTZ DEFAULT now(),
  size_bytes BIGINT DEFAULT 0,
  version INTEGER DEFAULT 1,
  UNIQUE(user_id, story_id)
);
ALTER TABLE downloaded_stories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own downloads" ON downloaded_stories FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- 2. GAMIFICATION — Badges & Achievements
-- ============================================================
CREATE TABLE IF NOT EXISTS badge_definitions (
  id TEXT PRIMARY KEY,              -- e.g. 'first_story', 'streak_7', 'explorer'
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '🏆',
  category TEXT NOT NULL DEFAULT 'general', -- general, streak, social, creative, explorer
  xp_reward INTEGER NOT NULL DEFAULT 10,
  sort_order INTEGER NOT NULL DEFAULT 0,
  requirement_type TEXT NOT NULL DEFAULT 'manual', -- count, streak, milestone, manual
  requirement_value INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE badge_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read badges" ON badge_definitions FOR SELECT USING (true);
CREATE POLICY "Admins manage badges" ON badge_definitions FOR ALL USING (is_admin());

CREATE TABLE IF NOT EXISTS user_badges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  badge_id TEXT REFERENCES badge_definitions(id) ON DELETE CASCADE NOT NULL,
  earned_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, badge_id)
);
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own badges" ON user_badges FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "System inserts badges" ON user_badges FOR INSERT WITH CHECK (auth.uid() = user_id);

-- XP & Levels on profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS xp INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1;

-- Daily challenges
CREATE TABLE IF NOT EXISTS daily_challenges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  challenge_date DATE NOT NULL DEFAULT CURRENT_DATE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '🎯',
  xp_reward INTEGER NOT NULL DEFAULT 20,
  challenge_type TEXT NOT NULL DEFAULT 'listen', -- listen, create, streak, explore
  target_value INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE daily_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read challenges" ON daily_challenges FOR SELECT USING (true);
CREATE POLICY "Admins manage challenges" ON daily_challenges FOR ALL USING (is_admin());

CREATE TABLE IF NOT EXISTS user_challenge_progress (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  challenge_id UUID REFERENCES daily_challenges(id) ON DELETE CASCADE NOT NULL,
  progress INTEGER DEFAULT 0,
  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  UNIQUE(user_id, challenge_id)
);
ALTER TABLE user_challenge_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own challenge progress" ON user_challenge_progress FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- 3. PARENTAL CONTROLS
-- ============================================================
CREATE TABLE IF NOT EXISTS parental_controls (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  pin_hash TEXT,                           -- 4-digit PIN hash
  daily_limit_minutes INTEGER DEFAULT 0,   -- 0 = unlimited
  bedtime_start TIME,                      -- e.g. 21:00
  bedtime_end TIME,                        -- e.g. 06:00
  allowed_categories TEXT[] DEFAULT '{}',  -- empty = all allowed
  blocked_categories TEXT[] DEFAULT '{}',
  max_age_rating INTEGER DEFAULT 99,       -- max age content allowed
  is_enabled BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE parental_controls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own controls" ON parental_controls FOR ALL USING (auth.uid() = user_id);

-- Daily usage tracking for parental limits
CREATE TABLE IF NOT EXISTS daily_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  listening_minutes INTEGER DEFAULT 0,
  stories_played INTEGER DEFAULT 0,
  stories_created INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, usage_date)
);
ALTER TABLE daily_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own usage" ON daily_usage FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- 4. SEED BADGE DEFINITIONS
-- ============================================================
INSERT INTO badge_definitions (id, name, description, icon, category, xp_reward, sort_order, requirement_type, requirement_value) VALUES
  ('first_story',      'Câu Chuyện Đầu Tiên',   'Tạo truyện đầu tiên',                    '📖', 'creative',  10, 1,  'count', 1),
  ('storyteller_10',   'Nhà Kể Chuyện',          'Tạo 10 truyện',                          '✍️', 'creative',  50, 2,  'count', 10),
  ('storyteller_50',   'Bậc Thầy Truyện',        'Tạo 50 truyện',                          '🎭', 'creative', 200, 3,  'count', 50),
  ('first_voice',      'Giọng Nói Đầu Tiên',     'Clone giọng nói đầu tiên',               '🎙️', 'creative',  15, 4,  'count', 1),
  ('voice_collector',  'Sưu Tập Giọng',          'Clone 5 giọng nói',                      '🎤', 'creative',  75, 5,  'count', 5),
  ('first_listen',     'Lần Nghe Đầu Tiên',      'Nghe truyện đầu tiên đến hết',           '🎧', 'general',   10, 6,  'count', 1),
  ('bookworm',         'Mọt Sách',               'Nghe 25 truyện đến hết',                 '📚', 'general',  100, 7,  'count', 25),
  ('streak_3',         'Kiên Trì 3 Ngày',        'Nghe truyện 3 ngày liên tục',            '🔥', 'streak',    30, 8,  'streak', 3),
  ('streak_7',         'Tuần Lễ Tuyệt Vời',      'Nghe truyện 7 ngày liên tục',            '⭐', 'streak',    70, 9,  'streak', 7),
  ('streak_30',        'Siêu Bền Bỉ',            'Nghe truyện 30 ngày liên tục',           '👑', 'streak',   300, 10, 'streak', 30),
  ('explorer',         'Nhà Thám Hiểm',          'Nghe truyện từ 5 thể loại khác nhau',    '🗺️', 'explorer',  50, 11, 'count', 5),
  ('night_owl',        'Cú Đêm',                 'Nghe truyện sau 21:00',                   '🦉', 'general',   20, 12, 'milestone', 1),
  ('early_bird',       'Chim Sớm',               'Nghe truyện trước 7:00 sáng',            '🐦', 'general',   20, 13, 'milestone', 1),
  ('family_bond',      'Gắn Kết Gia Đình',       'Thêm 3 thành viên vào cây gia đình',    '👨‍👩‍👧‍👦', 'social',  40, 14, 'count', 3),
  ('lullaby_master',   'Bậc Thầy Ru Ngủ',        'Sử dụng chế độ ru ngủ 10 lần',          '🌙', 'general',   50, 15, 'count', 10),
  ('adventure_king',   'Vua Phiêu Lưu',          'Hoàn thành 5 truyện phân nhánh',         '⚔️', 'explorer',  60, 16, 'count', 5),
  ('sharing_star',     'Ngôi Sao Chia Sẻ',       'Chia sẻ truyện 5 lần',                   '💫', 'social',    40, 17, 'count', 5),
  ('ai_expert',        'Chuyên Gia AI',           'Sử dụng AI Expert Panel 10 lần',        '🤖', 'creative',  60, 18, 'count', 10)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 5. HELPER: Award XP function
-- ============================================================
CREATE OR REPLACE FUNCTION award_xp(p_user_id UUID, p_amount INTEGER)
RETURNS void AS $$
DECLARE
  new_xp INTEGER;
  new_level INTEGER;
BEGIN
  UPDATE profiles
  SET xp = COALESCE(xp, 0) + p_amount
  WHERE id = p_user_id
  RETURNING xp INTO new_xp;

  -- Level formula: level = floor(sqrt(xp / 100)) + 1
  new_level := GREATEST(1, FLOOR(SQRT(COALESCE(new_xp, 0)::numeric / 100.0))::integer + 1);

  UPDATE profiles SET level = new_level WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
