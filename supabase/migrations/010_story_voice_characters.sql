-- Migration 010: Multi-voice storytelling
-- Phase A: Story narrator voice
-- Phase B: Character voices + voice markup

-- ============================================================
-- PHASE A: Story narrator voice
-- ============================================================

-- Add narrator voice fields to stories
ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS narrator_voice_id TEXT,       -- ElevenLabs voice_id directly
  ADD COLUMN IF NOT EXISTS narrator_voice_name TEXT;     -- Display name

-- ============================================================
-- PHASE B: Story characters with individual voices
-- ============================================================

CREATE TABLE IF NOT EXISTS story_characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                    -- "Sóc Nhỏ"
  voice_id TEXT,                         -- ElevenLabs voice_id
  voice_name TEXT,                       -- "Giọng nhí nhảnh" (display)
  color TEXT DEFAULT '#6B7280',          -- Color code for UI highlighting
  emoji TEXT,                            -- "🐿️"
  description TEXT,                      -- "Bé sóc tinh nghịch"
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_story_characters_story ON story_characters(story_id);

-- Add voice_segments cache to story_pages (parsed markup segments)
ALTER TABLE story_pages
  ADD COLUMN IF NOT EXISTS voice_segments JSONB;

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE story_characters ENABLE ROW LEVEL SECURITY;

-- Anyone can read characters for stories they can access
CREATE POLICY "Anyone can read story characters"
  ON story_characters FOR SELECT
  USING (true);

-- Story owner can manage characters
CREATE POLICY "Story owner can manage characters"
  ON story_characters FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM stories WHERE stories.id = story_characters.story_id
      AND stories.user_id = auth.uid()
    )
  );

-- Admin can manage all characters
CREATE POLICY "Admin can manage all characters"
  ON story_characters FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'super_admin')
    )
  );

-- Updated_at trigger
CREATE TRIGGER story_characters_updated_at
  BEFORE UPDATE ON story_characters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
