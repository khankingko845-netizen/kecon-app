-- ============================================================
-- 003_branching.sql
-- Choose-Your-Own-Adventure branching support.
-- Adds a `choices` column to story_pages. Each choice is:
--   { "label": string, "description": string, "target": number }
-- where `target` is the page_number to jump to when selected.
-- A page with an empty choices array is a normal (linear) page; the last
-- such page (or a page explicitly marked) is an ending.
-- Additive + defaulted, so it is safe to run on a live database.
-- ============================================================

ALTER TABLE public.story_pages
  ADD COLUMN IF NOT EXISTS choices JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Flag a story as branching so the UI can offer the adventure player.
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS is_branching BOOLEAN NOT NULL DEFAULT false;
