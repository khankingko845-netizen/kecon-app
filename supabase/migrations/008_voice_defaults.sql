-- ============================================================
-- Migration 008: Voice default settings per language
-- ============================================================

INSERT INTO app_settings (key, value, label, category, is_secret) VALUES
  ('elevenlabs_default_voice_vi', '', 'Default Voice (Vietnamese)', 'voice', false),
  ('elevenlabs_default_voice_en', '', 'Default Voice (English)', 'voice', false),
  ('elevenlabs_default_voice_ja', '', 'Default Voice (Japanese)', 'voice', false)
ON CONFLICT (key) DO NOTHING;
