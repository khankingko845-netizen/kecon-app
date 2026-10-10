-- ============================================================
-- Migration 009: Default voices per language
-- Admin curates a list of system-wide default voices per language.
-- Users pick from this list when they don't have their own clone.
-- ============================================================

CREATE TABLE IF NOT EXISTS default_voices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  voice_id TEXT NOT NULL,
  name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'vi',
  description TEXT,
  preview_url TEXT,
  gender TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(voice_id, language)
);

-- Anyone can read active default voices, admin writes
ALTER TABLE default_voices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active default voices"
  ON default_voices FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admin can manage default voices"
  ON default_voices FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Remove old single-voice settings (replaced by this table)
DELETE FROM app_settings WHERE key IN (
  'elevenlabs_default_voice_vi',
  'elevenlabs_default_voice_en',
  'elevenlabs_default_voice_ja'
);
