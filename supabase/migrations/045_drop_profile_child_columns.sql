-- T10 (contract): drop profiles.child_name / profiles.child_age (docs/child-profiles.md).
-- Migration 044 copied their data into child_profiles (1–5 per household, member-only RLS) and
-- stopped the signup trigger from filling them; since then no app code reads or writes them.
-- No CASCADE: if anything still depended on these columns the migration would fail instead of
-- silently dropping it. Restoring needs the pre-045 backup (the data also lives in child_profiles).
ALTER TABLE public.profiles
 DROP COLUMN IF EXISTS child_name,
 DROP COLUMN IF EXISTS child_age;
