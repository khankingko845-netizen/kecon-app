-- ============================================================
-- Migration 007: App Settings (admin-managed system config)
-- Stores API keys & config that admin sets once for all users.
-- ============================================================

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  label TEXT,           -- display label in admin UI
  category TEXT DEFAULT 'general',
  is_secret BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

-- Seed default keys (empty values — admin fills in via UI)
INSERT INTO app_settings (key, value, label, category, is_secret) VALUES
  ('elevenlabs_api_key',   '', 'ElevenLabs API Key',   'voice',   true),
  ('elevenlabs_model_id',  'eleven_multilingual_v2', 'ElevenLabs Model', 'voice', false),
  ('openai_api_key',       '', 'OpenAI API Key',       'ai',      true),
  ('gemini_api_key',       '', 'Google Gemini API Key', 'ai',      true),
  ('anthropic_api_key',    '', 'Anthropic Claude API Key', 'ai',   true),
  ('custom_provider_url',  '', 'Custom Provider URL',  'ai',      false),
  ('custom_provider_key',  '', 'Custom Provider Key',  'ai',      true),
  ('default_ai_provider',  'openai', 'Default AI Provider', 'ai',  false),
  ('default_ai_model',     'gpt-4o-mini', 'Default AI Model', 'ai', false),
  ('dalle_api_key',        '', 'DALL·E API Key',       'image',   true)
ON CONFLICT (key) DO NOTHING;

-- RLS
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Everyone can read non-secret settings
CREATE POLICY "Anyone can read non-secret settings"
  ON app_settings FOR SELECT
  USING (is_secret = false);

-- Admin can read all settings
CREATE POLICY "Admin can read all settings"
  ON app_settings FOR SELECT
  USING (is_admin());

-- Admin can update settings
CREATE POLICY "Admin can update settings"
  ON app_settings FOR UPDATE
  USING (is_admin());

-- Admin can insert new settings
CREATE POLICY "Admin can insert settings"
  ON app_settings FOR INSERT
  WITH CHECK (is_admin());
