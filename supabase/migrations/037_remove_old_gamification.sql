-- G-09 — gỡ gamification cũ (XP/level, huy hiệu, thử thách hằng ngày).
-- docs/missions-mvp.md §G-09. "Bầu trời của Đóm" (034/036) replaces it: rewards
-- are records the server writes for what was done; there is no longer any
-- client-callable path that grants points/badges.
-- Staging before this migration: 0 user_badges, 0 daily_challenges, 0
-- user_challenge_progress, 0 profiles with non-default xp/level; the 18
-- badge_definitions rows were seed data only. Rollback = restore the
-- pre-fix54 pg_dump (contract step; nothing reads these objects any more).

-- 1) Retire the flag: delete the row under an audit reason (the
--    audit_feature_setting trigger writes flag.delete with this reason), then
--    tighten the allow-list so the key can never come back.
DO $$
BEGIN
 PERFORM set_config('app.admin_reason','G-09: gỡ gamification cũ (XP, huy hiệu, thử thách) — thay bằng Bầu trời của Đóm',true);
 DELETE FROM public.app_settings WHERE key='feature.gamification';
 PERFORM set_config('app.admin_reason','',true);
END $$;
ALTER TABLE public.app_settings DROP CONSTRAINT valid_feature_setting;
ALTER TABLE public.app_settings ADD CONSTRAINT valid_feature_setting CHECK
(key NOT LIKE 'feature.%' OR (key IN ('feature.story_drawing','feature.book_scan','feature.expert_review','feature.branching_stories','feature.vocabulary_quiz','feature.multilingual','feature.advanced_authoring','feature.ai_illustrations','feature.child_push','feature.ai_ambience','feature.missions') AND value IS NOT NULL AND value IN ('true','false') AND category IS NOT NULL AND category='features' AND is_secret IS FALSE));
CREATE OR REPLACE FUNCTION public.public_feature_flags() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_object_agg(name,public.feature_enabled(name)) FROM unnest(ARRAY['story_drawing','book_scan','expert_review','branching_stories','vocabulary_quiz','multilingual','advanced_authoring','ai_illustrations','child_push','ai_ambience','missions']) name
$$;
CREATE OR REPLACE FUNCTION public.set_feature_flag(p_name text,p_enabled boolean,p_expected boolean,p_reason text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE oldval text; changed boolean;
BEGIN
 IF NOT public.has_permission('settings.write') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 IF p_name IS NULL OR p_name NOT IN ('story_drawing','book_scan','expert_review','branching_stories','vocabulary_quiz','multilingual','advanced_authoring','ai_illustrations','child_push','ai_ambience','missions') OR p_enabled IS NULL OR p_expected IS NULL THEN RAISE EXCEPTION 'Unknown feature' USING ERRCODE='22023'; END IF;
 PERFORM set_config('app.admin_reason',public.admin_action_reason(p_reason),true);
 SELECT value INTO oldval FROM public.app_settings WHERE key='feature.'||p_name FOR UPDATE;
 IF oldval IS NULL OR (oldval='true') IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Feature changed; reload' USING ERRCODE='40001'; END IF;
 changed:=(oldval='true') IS DISTINCT FROM p_enabled;
 IF changed THEN UPDATE public.app_settings SET value=p_enabled::text,updated_at=now(),updated_by=auth.uid() WHERE key='feature.'||p_name; END IF;
 PERFORM set_config('app.admin_reason','',true);RETURN changed;
END $$;

-- 2) No more client-callable reward path: award_xp() was the only RPC that
--    let a signed-in client add points.
DROP FUNCTION IF EXISTS public.award_xp(uuid,integer);

-- 3) Old reward data (policies, grants and indexes go with the tables).
DROP TABLE IF EXISTS public.user_challenge_progress;
DROP TABLE IF EXISTS public.daily_challenges;
DROP TABLE IF EXISTS public.user_badges;
DROP TABLE IF EXISTS public.badge_definitions;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS xp, DROP COLUMN IF EXISTS level;
