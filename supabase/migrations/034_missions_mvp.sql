-- G-03/G-04 MVP — "Bầu trời của Đóm" (docs/missions-mvp.md).
-- Server-awarded missions for finishing stories. Account-level until T10 child
-- profiles exist (child_profile_id stays NULL and is part of every uniqueness
-- key so the contract step can scope rows per child later).
-- Rules enforced here: rewards are records of what was done (never bought,
-- never random, never lost); clients cannot insert/alter rewards; completion
-- needs a server-timed listening session; feature flag `missions` (default off).

-- 1) Feature flag (additive: allowlist + catalog + setter know the new key).
ALTER TABLE public.app_settings DROP CONSTRAINT valid_feature_setting;
ALTER TABLE public.app_settings ADD CONSTRAINT valid_feature_setting CHECK
(key NOT LIKE 'feature.%' OR (key IN ('feature.gamification','feature.story_drawing','feature.book_scan','feature.expert_review','feature.branching_stories','feature.vocabulary_quiz','feature.multilingual','feature.advanced_authoring','feature.ai_illustrations','feature.child_push','feature.ai_ambience','feature.missions') AND value IS NOT NULL AND value IN ('true','false') AND category IS NOT NULL AND category='features' AND is_secret IS FALSE));
INSERT INTO public.app_settings(key,value,label,category,is_secret) VALUES ('feature.missions','false','missions','features',false) ON CONFLICT(key) DO NOTHING;
CREATE OR REPLACE FUNCTION public.public_feature_flags() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_object_agg(name,public.feature_enabled(name)) FROM unnest(ARRAY['gamification','story_drawing','book_scan','expert_review','branching_stories','vocabulary_quiz','multilingual','advanced_authoring','ai_illustrations','child_push','ai_ambience','missions']) name
$$;
CREATE OR REPLACE FUNCTION public.set_feature_flag(p_name text,p_enabled boolean,p_expected boolean,p_reason text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE oldval text; changed boolean;
BEGIN
 IF NOT public.has_permission('settings.write') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 IF p_name IS NULL OR p_name NOT IN ('gamification','story_drawing','book_scan','expert_review','branching_stories','vocabulary_quiz','multilingual','advanced_authoring','ai_illustrations','child_push','ai_ambience','missions') OR p_enabled IS NULL OR p_expected IS NULL THEN RAISE EXCEPTION 'Unknown feature' USING ERRCODE='22023'; END IF;
 PERFORM set_config('app.admin_reason',public.admin_action_reason(p_reason),true);
 SELECT value INTO oldval FROM public.app_settings WHERE key='feature.'||p_name FOR UPDATE;
 IF oldval IS NULL OR (oldval='true') IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Feature changed; reload' USING ERRCODE='40001'; END IF;
 changed:=(oldval='true') IS DISTINCT FROM p_enabled;
 IF changed THEN UPDATE public.app_settings SET value=p_enabled::text,updated_at=now(),updated_by=auth.uid() WHERE key='feature.'||p_name; END IF;
 PERFORM set_config('app.admin_reason','',true);RETURN changed;
END $$;

-- 2) Mission templates (rules only; child-facing copy lives in src/lib/missions.ts).
CREATE TABLE public.mission_templates (
 id text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{3,40}$'),
 kind text NOT NULL CHECK (kind IN ('base','themed')),
 match_categories text[] NOT NULL DEFAULT '{}',
 match_tags text[] NOT NULL DEFAULT '{}',
 match_new boolean NOT NULL DEFAULT false,
 sort_order integer NOT NULL DEFAULT 0,
 active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mission_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY missions_templates_read ON public.mission_templates FOR SELECT TO authenticated USING (public.feature_enabled('missions'));
REVOKE ALL ON public.mission_templates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mission_templates TO authenticated;
INSERT INTO public.mission_templates(id,kind,match_categories,match_tags,match_new,sort_order) VALUES
 ('nghe-het-truyen','base','{}','{}',false,0),
 ('co-tich','themed','{fairy_tale,folk}','{co-tich,co-tich-viet-nam,truyen-dan-gian,truyen-thuyet,than-thoai}',false,1),
 ('thoi-quen-tot','themed','{}','{thoi-quen-tot}',false,2),
 ('con-vat','themed','{animal}','{dong-vat}',false,3),
 ('truyen-moi','themed','{}','{}',true,4);

-- 3) Server-timed listening sessions: the server stamps start and finish, so a
--    skipped-through story (finish sooner than min_seconds) earns nothing.
CREATE TABLE public.listen_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 household_id uuid REFERENCES public.households(id) ON DELETE CASCADE,
 child_profile_id uuid,
 story_id uuid REFERENCES public.stories(id) ON DELETE SET NULL,
 min_seconds integer NOT NULL CHECK (min_seconds BETWEEN 15 AND 900),
 started_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 counted boolean NOT NULL DEFAULT false,
 local_date date,
 CHECK (NOT counted OR (completed_at IS NOT NULL AND local_date IS NOT NULL))
);
CREATE INDEX listen_sessions_user_started ON public.listen_sessions(user_id, started_at DESC);
CREATE INDEX listen_sessions_user_counted ON public.listen_sessions(user_id, local_date) WHERE counted;
CREATE INDEX listen_sessions_story ON public.listen_sessions(story_id);

CREATE TABLE public.child_missions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 household_id uuid REFERENCES public.households(id) ON DELETE CASCADE,
 child_profile_id uuid,
 template_id text NOT NULL REFERENCES public.mission_templates(id),
 local_date date NOT NULL,
 session_id uuid REFERENCES public.listen_sessions(id) ON DELETE SET NULL,
 story_id uuid REFERENCES public.stories(id) ON DELETE SET NULL,
 completed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX child_missions_once_per_day ON public.child_missions(user_id, coalesce(child_profile_id,'00000000-0000-0000-0000-000000000000'::uuid), template_id, local_date);
CREATE INDEX child_missions_session ON public.child_missions(session_id);
CREATE INDEX child_missions_story ON public.child_missions(story_id);

-- 4) Append-only reward ledger. story_id has no FK on purpose: a cascading
--    SET NULL would be an UPDATE, and ledger rows never change. Rows leave only
--    together with the account / household (ON DELETE CASCADE).
CREATE TABLE public.reward_ledger (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 household_id uuid REFERENCES public.households(id) ON DELETE CASCADE,
 child_profile_id uuid,
 kind text NOT NULL CHECK (kind IN ('star','sticker','milestone')),
 template_id text REFERENCES public.mission_templates(id),
 story_id uuid,
 milestone integer CHECK (milestone > 0),
 local_date date NOT NULL,
 idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind='star' AND template_id IS NOT NULL) OR (kind='sticker' AND story_id IS NOT NULL) OR (kind='milestone' AND milestone IS NOT NULL))
);
CREATE INDEX reward_ledger_user_kind ON public.reward_ledger(user_id, kind, local_date);
CREATE FUNCTION public.reward_ledger_append_only() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' AND (NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=OLD.user_id)
   OR (OLD.household_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.households h WHERE h.id=OLD.household_id))) THEN
  RETURN OLD;
 END IF;
 RAISE EXCEPTION 'reward_ledger is append-only' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION public.reward_ledger_append_only() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER reward_ledger_append_only BEFORE UPDATE OR DELETE ON public.reward_ledger FOR EACH ROW EXECUTE FUNCTION public.reward_ledger_append_only();
CREATE FUNCTION public.reward_ledger_no_truncate() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'reward_ledger is append-only' USING ERRCODE='42501'; END $$;
REVOKE ALL ON FUNCTION public.reward_ledger_no_truncate() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER reward_ledger_no_truncate BEFORE TRUNCATE ON public.reward_ledger FOR EACH STATEMENT EXECUTE FUNCTION public.reward_ledger_no_truncate();

ALTER TABLE public.listen_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.child_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY missions_own_read ON public.listen_sessions FOR SELECT TO authenticated USING (user_id=auth.uid() AND public.feature_enabled('missions'));
CREATE POLICY missions_own_read ON public.child_missions FOR SELECT TO authenticated USING (user_id=auth.uid() AND public.feature_enabled('missions'));
CREATE POLICY missions_own_read ON public.reward_ledger FOR SELECT TO authenticated USING (user_id=auth.uid() AND public.feature_enabled('missions'));
-- Read-own only (RLS); every write goes through the RPCs below.
REVOKE ALL ON public.listen_sessions, public.child_missions, public.reward_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.listen_sessions, public.child_missions, public.reward_ledger TO authenticated;
REVOKE ALL ON SEQUENCE public.reward_ledger_id_seq FROM PUBLIC, anon, authenticated;

-- 5) Helpers. Days are Vietnam calendar days; weeks start on Monday.
CREATE FUNCTION public.missions_local_date(p_ts timestamptz) RETURNS date LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT (p_ts AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
$$;
CREATE FUNCTION public.missions_week_start(p_day date) RETURNS date LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT p_day - (extract(isodow FROM p_day)::int - 1)
$$;
-- Two missions a day: the base one plus one themed mission rotating by date.
CREATE FUNCTION public.missions_assigned(p_day date) RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH base AS (SELECT id FROM public.mission_templates WHERE kind='base' AND active ORDER BY sort_order, id LIMIT 1),
 themed AS (SELECT id, (row_number() OVER (ORDER BY sort_order, id) - 1)::int AS i, count(*) OVER ()::int AS n FROM public.mission_templates WHERE kind='themed' AND active)
 SELECT array_remove(ARRAY[(SELECT id FROM base),(SELECT id FROM themed WHERE i = (((p_day - DATE '2026-01-05') % n) + n) % n)], NULL)
$$;
CREATE FUNCTION public.missions_summary_for(p_user uuid, p_now timestamptz) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_day date := public.missions_local_date(p_now); v_start date; v_missions jsonb; v_days jsonb;
BEGIN
 v_start := public.missions_week_start(v_day);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'done',EXISTS(SELECT 1 FROM public.child_missions c WHERE c.user_id=p_user AND c.child_profile_id IS NULL AND c.template_id=a.id AND c.local_date=v_day)) ORDER BY a.ord),'[]'::jsonb)
   INTO v_missions FROM unnest(public.missions_assigned(v_day)) WITH ORDINALITY AS a(id, ord);
 SELECT jsonb_agg(jsonb_build_object('date',d.day,
   'stars',(SELECT count(*) FROM public.reward_ledger l WHERE l.user_id=p_user AND l.kind='star' AND l.local_date=d.day),
   'listened',EXISTS(SELECT 1 FROM public.listen_sessions x WHERE x.user_id=p_user AND x.counted AND x.local_date=d.day)) ORDER BY d.day)
   INTO v_days FROM (SELECT v_start + i AS day FROM generate_series(0,6) i) d;
 RETURN jsonb_build_object(
  'date', v_day,
  'missions', v_missions,
  'week', jsonb_build_object('start', v_start, 'goal', 4,
    'nights', (SELECT count(DISTINCT x.local_date) FROM public.listen_sessions x WHERE x.user_id=p_user AND x.counted AND x.local_date BETWEEN v_start AND v_start + 6),
    'days', v_days),
  'totals', jsonb_build_object(
    'stories', (SELECT count(*) FROM public.listen_sessions x WHERE x.user_id=p_user AND x.counted),
    'stars', (SELECT count(*) FROM public.reward_ledger l WHERE l.user_id=p_user AND l.kind='star'),
    'stickers', (SELECT count(*) FROM public.reward_ledger l WHERE l.user_id=p_user AND l.kind='sticker')));
END $$;
REVOKE ALL ON FUNCTION public.missions_local_date(timestamptz), public.missions_week_start(date), public.missions_assigned(date), public.missions_summary_for(uuid,timestamptz) FROM PUBLIC, anon, authenticated;

-- 6) Client-callable RPCs (each re-checks auth + flag; no direct table writes).
CREATE FUNCTION public.missions_start_listen(p_story uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_uid uuid := auth.uid(); v_chars integer; v_min integer; v_id uuid; v_recent integer;
BEGIN
 IF v_uid IS NULL OR NOT public.feature_enabled('missions') THEN RAISE EXCEPTION 'Action unavailable' USING ERRCODE='42501'; END IF;
 IF p_story IS NULL OR NOT public.can_read_story(p_story) OR NOT EXISTS(SELECT 1 FROM public.stories s WHERE s.id=p_story AND s.deleted_at IS NULL
   AND ((s.is_platform_content AND s.is_published AND s.status='published') OR (NOT s.is_platform_content AND s.user_id=v_uid))) THEN
  RAISE EXCEPTION 'Story unavailable' USING ERRCODE='22023';
 END IF;
 DELETE FROM public.listen_sessions WHERE user_id=v_uid AND NOT counted AND started_at < now() - interval '7 days';
 SELECT count(*) INTO v_recent FROM public.listen_sessions WHERE user_id=v_uid AND started_at > now() - interval '1 day';
 IF v_recent >= 60 THEN RAISE EXCEPTION 'Too many listening sessions' USING ERRCODE='54000'; END IF;
 SELECT coalesce(sum(char_length(p.content)),0) INTO v_chars FROM public.story_pages p WHERE p.story_id=p_story;
 -- Narration runs ~15 chars/s; 35 chars/s still allows 2× playback but not skipping.
 v_min := greatest(15, least(900, ceil(v_chars / 35.0)::int));
 INSERT INTO public.listen_sessions(user_id, household_id, story_id, min_seconds)
 VALUES (v_uid, public.current_household_id(), p_story, v_min) RETURNING id INTO v_id;
 RETURN jsonb_build_object('session_id', v_id, 'min_seconds', v_min);
END $$;

CREATE FUNCTION public.missions_complete_listen(p_session uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_uid uuid := auth.uid(); v_now timestamptz := now(); s public.listen_sessions; st public.stories; t public.mission_templates;
 v_day date; v_prior boolean; v_done text[] := '{}'; v_sticker jsonb; v_total integer; v_milestone integer; m integer;
BEGIN
 IF v_uid IS NULL OR NOT public.feature_enabled('missions') THEN RAISE EXCEPTION 'Action unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.listen_sessions WHERE id=p_session AND user_id=v_uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Session unavailable' USING ERRCODE='22023'; END IF;
 IF s.completed_at IS NOT NULL THEN RETURN jsonb_build_object('counted', false, 'reason', 'already_completed'); END IF;
 IF v_now - s.started_at > interval '6 hours' THEN
  UPDATE public.listen_sessions SET completed_at=v_now WHERE id=s.id;
  RETURN jsonb_build_object('counted', false, 'reason', 'expired');
 END IF;
 IF v_now - s.started_at < make_interval(secs => s.min_seconds) THEN RETURN jsonb_build_object('counted', false, 'reason', 'too_fast'); END IF;
 v_day := public.missions_local_date(v_now);
 SELECT * INTO st FROM public.stories WHERE id=s.story_id;
 v_prior := EXISTS(SELECT 1 FROM public.listen_sessions x WHERE x.user_id=v_uid AND x.story_id=s.story_id AND x.counted AND x.id<>s.id);
 UPDATE public.listen_sessions SET completed_at=v_now, counted=true, local_date=v_day WHERE id=s.id;
 FOR t IN SELECT * FROM public.mission_templates WHERE id = ANY(public.missions_assigned(v_day)) ORDER BY sort_order, id LOOP
  IF (t.match_new AND NOT v_prior AND s.story_id IS NOT NULL)
   OR (NOT t.match_new AND ((cardinality(t.match_categories)=0 AND cardinality(t.match_tags)=0)
     OR st.category = ANY(t.match_categories) OR coalesce(st.tags,'{}'::text[]) && t.match_tags)) THEN
   INSERT INTO public.child_missions(user_id, household_id, template_id, local_date, session_id, story_id)
   VALUES (v_uid, s.household_id, t.id, v_day, s.id, s.story_id) ON CONFLICT DO NOTHING;
   IF FOUND THEN
    INSERT INTO public.reward_ledger(user_id, household_id, kind, template_id, story_id, local_date, idempotency_key)
    VALUES (v_uid, s.household_id, 'star', t.id, s.story_id, v_day, 'star:'||v_uid||':'||t.id||':'||v_day) ON CONFLICT (idempotency_key) DO NOTHING;
    v_done := v_done || t.id;
   END IF;
  END IF;
 END LOOP;
 -- Album: meeting a library story's characters is recorded once per story.
 IF st.id IS NOT NULL AND st.is_platform_content AND EXISTS(SELECT 1 FROM unnest(coalesce(st.tags,'{}'::text[])) tg WHERE tg LIKE 'kc-lib:%') THEN
  INSERT INTO public.reward_ledger(user_id, household_id, kind, story_id, local_date, idempotency_key)
  VALUES (v_uid, s.household_id, 'sticker', st.id, v_day, 'sticker:'||v_uid||':'||st.id) ON CONFLICT (idempotency_key) DO NOTHING;
  IF FOUND THEN v_sticker := jsonb_build_object('story_id', st.id, 'title', st.title, 'cover_image_url', st.cover_image_url); END IF;
 END IF;
 SELECT count(*) INTO v_total FROM public.listen_sessions WHERE user_id=v_uid AND counted;
 FOREACH m IN ARRAY ARRAY[1,5,10,25,50,100] LOOP
  IF v_total >= m THEN
   INSERT INTO public.reward_ledger(user_id, household_id, kind, milestone, local_date, idempotency_key)
   VALUES (v_uid, s.household_id, 'milestone', m, v_day, 'milestone:'||v_uid||':'||m) ON CONFLICT (idempotency_key) DO NOTHING;
   IF FOUND THEN v_milestone := m; END IF;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('counted', true, 'completed', to_jsonb(v_done), 'sticker', v_sticker, 'milestone', v_milestone,
  'today', public.missions_summary_for(v_uid, v_now));
END $$;

CREATE FUNCTION public.missions_today() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.feature_enabled('missions') THEN RAISE EXCEPTION 'Action unavailable' USING ERRCODE='42501'; END IF;
 RETURN public.missions_summary_for(auth.uid(), now());
END $$;

CREATE FUNCTION public.missions_album() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
 IF v_uid IS NULL OR NOT public.feature_enabled('missions') THEN RAISE EXCEPTION 'Action unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object(
  'stickers', (SELECT coalesce(jsonb_agg(jsonb_build_object('story_id', l.story_id, 'title', s.title, 'cover_image_url', s.cover_image_url, 'earned_on', l.local_date) ORDER BY l.id DESC), '[]'::jsonb)
    FROM public.reward_ledger l LEFT JOIN public.stories s ON s.id=l.story_id AND s.is_platform_content AND s.is_published AND s.status='published' AND s.deleted_at IS NULL
    WHERE l.user_id=v_uid AND l.kind='sticker'),
  'milestones', (SELECT coalesce(jsonb_agg(l.milestone ORDER BY l.milestone), '[]'::jsonb) FROM public.reward_ledger l WHERE l.user_id=v_uid AND l.kind='milestone'));
END $$;
REVOKE ALL ON FUNCTION public.missions_start_listen(uuid), public.missions_complete_listen(uuid), public.missions_today(), public.missions_album() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.missions_start_listen(uuid), public.missions_complete_listen(uuid), public.missions_today(), public.missions_album() TO authenticated;
