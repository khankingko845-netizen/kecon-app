-- Story Studio v2: the brief a family builds in "Tạo truyện" (cast, length,
-- narration pace, voiced characters, illustrations, ambience) and the per-page
-- art/sound direction the writer returns. Additive and nullable: NULL means a
-- legacy story and every reader keeps its old behaviour.
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS generator_version smallint CHECK (generator_version BETWEEN 1 AND 99),
  ADD COLUMN IF NOT EXISTS story_length text CHECK (story_length IN ('short','medium','long')),
  ADD COLUMN IF NOT EXISTS narration_pace text CHECK (narration_pace IN ('calm','normal')),
  ADD COLUMN IF NOT EXISTS cast_voices boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_ambience boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS illustration_style text CHECK (illustration_style ~ '^[a-z0-9-]{1,40}$');
COMMENT ON COLUMN public.stories.narration_pace IS 'calm|normal; NULL = legacy story narrated without pacing markup.';
COMMENT ON COLUMN public.stories.cast_voices IS 'Characters were auto-cast to distinct voices; the player starts in multi-voice mode.';
COMMENT ON COLUMN public.stories.illustration_style IS 'House art style requested for AI page illustrations; NULL = none requested.';

ALTER TABLE public.story_characters
  ADD COLUMN IF NOT EXISTS role text CHECK (role IN ('hero','friend')),
  ADD COLUMN IF NOT EXISTS voice_type text CHECK (voice_type IN ('girl','boy','woman','man','grandma','grandpa','creature')),
  ADD COLUMN IF NOT EXISTS appearance text CHECK (char_length(appearance) <= 400),
  ADD COLUMN IF NOT EXISTS preset_id text CHECK (preset_id ~ '^[a-z0-9-]{1,40}$');
COMMENT ON COLUMN public.story_characters.appearance IS 'English visual bible reused in every illustration prompt for consistency.';

ALTER TABLE public.story_pages
  ADD COLUMN IF NOT EXISTS illustration_prompt text CHECK (char_length(illustration_prompt) <= 1000),
  ADD COLUMN IF NOT EXISTS scene_id text CHECK (scene_id ~ '^[a-z0-9-]{1,40}$'),
  ADD COLUMN IF NOT EXISTS mood text CHECK (mood IN ('calm','happy','curious','tense','sad','sleepy','triumphant'));
COMMENT ON COLUMN public.story_pages.scene_id IS 'Bundled scene art (public/scenes/v1) shown until/unless an AI illustration exists.';

-- Illustration provider (DALL·E 3 was retired from the OpenAI API): admin-tunable, non-secret.
INSERT INTO public.app_settings (key, value, label, category, is_secret) VALUES
  ('illustration_provider', 'auto', 'Nhà cung cấp minh hoạ (auto|openai|gemini|off)', 'image', false),
  ('illustration_model', '', 'Model minh hoạ (trống = mặc định)', 'image', false),
  ('illustration_quality', 'low', 'Chất lượng minh hoạ OpenAI (low|medium|high)', 'image', false)
ON CONFLICT (key) DO NOTHING;
