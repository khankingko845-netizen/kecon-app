-- A cached URL alone cannot identify narrator/text/locale/model. Keep legacy audio,
-- but only new matching fingerprints may be reused by the story player.
ALTER TABLE public.story_pages ADD COLUMN IF NOT EXISTS audio_key text;
COMMENT ON COLUMN public.story_pages.audio_key IS 'SHA-256 of rendered segments, locale and effective model; NULL denotes legacy/unknown identity.';
