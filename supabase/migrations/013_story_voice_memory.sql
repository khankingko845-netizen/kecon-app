-- Remember which voice was last used for each story
ALTER TABLE stories ADD COLUMN IF NOT EXISTS last_voice_id TEXT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS last_voice_name TEXT;

-- Index for quick lookup
CREATE INDEX IF NOT EXISTS idx_stories_last_voice ON stories(user_id, last_voice_id) WHERE last_voice_id IS NOT NULL;
