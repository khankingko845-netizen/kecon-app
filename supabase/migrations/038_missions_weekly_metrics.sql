-- G-10 · Weekly metrics + guardrails for "Bầu trời của Đóm" (docs/g10-missions-metrics.md).
-- The team sees aggregates only: no family, child, story or device appears in the
-- result. Weeks are Vietnam calendar weeks starting on Monday. Families are
-- accounts with role 'user'; staff and internal test accounts (@kecon.test) are
-- left out.

-- 1) Listening funnel counters. Unfinished listen sessions are pruned after
--    7 days (034), so the funnel is counted as it happens into a table that holds
--    only per-day totals. Days before this migration are back-filled from what is
--    left and flagged; "too fast" was never stored before, so it is unknown there.
CREATE TABLE public.missions_listen_daily (
 local_date date PRIMARY KEY,
 started integer NOT NULL DEFAULT 0 CHECK (started >= 0),
 counted integer NOT NULL DEFAULT 0 CHECK (counted >= 0),
 expired integer NOT NULL DEFAULT 0 CHECK (expired >= 0),
 too_fast integer CHECK (too_fast >= 0),
 backfilled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.missions_listen_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.missions_listen_daily FROM PUBLIC, anon, authenticated;

ALTER TABLE public.listen_sessions ADD COLUMN too_fast_at timestamptz;

CREATE FUNCTION public.missions_metrics_family(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id=p.id
  WHERE p.id=p_user AND p.role='user' AND coalesce(u.email,'') NOT ILIKE '%@kecon.test')
$$;
REVOKE ALL ON FUNCTION public.missions_metrics_family(uuid) FROM PUBLIC, anon, authenticated;

INSERT INTO public.missions_listen_daily(local_date, started, counted, expired, too_fast, backfilled)
SELECT d, sum(st)::int, sum(co)::int, sum(ex)::int, NULL, true FROM (
 SELECT public.missions_local_date(s.started_at) d, 1 st, 0 co, 0 ex FROM public.listen_sessions s WHERE public.missions_metrics_family(s.user_id)
 UNION ALL
 SELECT s.local_date, 0, 1, 0 FROM public.listen_sessions s WHERE s.counted AND public.missions_metrics_family(s.user_id)
 UNION ALL
 SELECT public.missions_local_date(s.completed_at), 0, 0, 1 FROM public.listen_sessions s
  WHERE s.completed_at IS NOT NULL AND NOT s.counted AND public.missions_metrics_family(s.user_id)
) x GROUP BY d;

CREATE FUNCTION public.missions_listen_daily_bump(p_day date, p_started int, p_counted int, p_expired int, p_too_fast int) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 INSERT INTO public.missions_listen_daily AS d(local_date, started, counted, expired, too_fast)
 VALUES (p_day, p_started, p_counted, p_expired, p_too_fast)
 ON CONFLICT (local_date) DO UPDATE SET started=d.started+p_started, counted=d.counted+p_counted, expired=d.expired+p_expired,
  too_fast=CASE WHEN p_too_fast=0 THEN d.too_fast ELSE coalesce(d.too_fast, 0)+p_too_fast END, updated_at=now()
$$;
REVOKE ALL ON FUNCTION public.missions_listen_daily_bump(date,int,int,int,int) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.missions_listen_count() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.missions_metrics_family(NEW.user_id) THEN RETURN NULL; END IF;
 IF TG_OP = 'INSERT' THEN
  PERFORM public.missions_listen_daily_bump(public.missions_local_date(NEW.started_at), 1, 0, 0, 0);
  RETURN NULL;
 END IF;
 IF NEW.counted AND NOT OLD.counted THEN
  PERFORM public.missions_listen_daily_bump(NEW.local_date, 0, 1, 0, 0);
 ELSIF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL AND NOT NEW.counted THEN
  PERFORM public.missions_listen_daily_bump(public.missions_local_date(NEW.completed_at), 0, 0, 1, 0);
 END IF;
 IF NEW.too_fast_at IS NOT NULL AND OLD.too_fast_at IS NULL THEN
  PERFORM public.missions_listen_daily_bump(public.missions_local_date(NEW.too_fast_at), 0, 0, 0, 1);
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.missions_listen_count() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER listen_sessions_count AFTER INSERT OR UPDATE OF counted, completed_at, too_fast_at ON public.listen_sessions
 FOR EACH ROW EXECUTE FUNCTION public.missions_listen_count();

-- 2) The only change to 034's missions_complete_listen: a too-fast finish is remembered once.
CREATE OR REPLACE FUNCTION public.missions_complete_listen(p_session uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
 IF v_now - s.started_at < make_interval(secs => s.min_seconds) THEN
  -- G-10: remember (once) that this session ended too fast, for the weekly guardrail.
  UPDATE public.listen_sessions SET too_fast_at=v_now WHERE id=s.id AND too_fast_at IS NULL;
  RETURN jsonb_build_object('counted', false, 'reason', 'too_fast');
 END IF;
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

-- 3) The weekly summary for the team (analytics.view). Aggregates only.
CREATE FUNCTION public.missions_weekly_summary(p_weeks integer DEFAULT 8) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_cur date; v_from date; v_weeks jsonb;
BEGIN
 IF NOT public.has_permission('analytics.view') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 IF p_weeks IS NULL OR p_weeks NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'Invalid period' USING ERRCODE='22023'; END IF;
 v_cur := public.missions_week_start(public.missions_local_date(now()));
 v_from := v_cur - 7 * (p_weeks - 1);
 WITH fam AS MATERIALIZED (
  SELECT p.id AS user_id FROM public.profiles p JOIN auth.users u ON u.id=p.id
  WHERE p.role='user' AND coalesce(u.email,'') NOT ILIKE '%@kecon.test'
 ), wk AS (
  SELECT (v_cur - 7 * g)::date AS ws FROM generate_series(0, p_weeks - 1) g
 ), heard AS MATERIALIZED (
  SELECT s.user_id, s.local_date, s.started_at, s.completed_at, public.missions_week_start(s.local_date) AS ws
  FROM public.listen_sessions s JOIN fam f ON f.user_id=s.user_id
  WHERE s.counted AND s.local_date >= v_from
 ), nights AS (
  SELECT ws, user_id, count(DISTINCT local_date)::int AS n FROM heard GROUP BY ws, user_id
 ), per_night AS (
  -- Minutes from Play to the end of the story, capped at 60 per story (a paused tab is not listening).
  SELECT ws, user_id, local_date, count(*)::int AS stories,
   sum(least(extract(epoch FROM completed_at - started_at) / 60.0, 60)) AS minutes
  FROM heard GROUP BY ws, user_id, local_date
 ), deeds AS MATERIALIZED (
  SELECT public.missions_week_start(c.local_date) AS ws, t.kind, c.user_id
  FROM public.child_missions c JOIN fam f ON f.user_id=c.user_id JOIN public.mission_templates t ON t.id=c.template_id
  WHERE c.local_date >= v_from
 ), bedtime AS (
  SELECT h.ws, count(*)::int AS n FROM heard h JOIN public.parental_controls pc ON pc.user_id=h.user_id
  WHERE pc.is_enabled AND pc.bedtime_start IS NOT NULL AND pc.bedtime_end IS NOT NULL AND pc.bedtime_start <> pc.bedtime_end
   AND CASE WHEN pc.bedtime_start < pc.bedtime_end
    THEN (h.started_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time >= pc.bedtime_start AND (h.started_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time < pc.bedtime_end
    ELSE (h.started_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time >= pc.bedtime_start OR (h.started_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time < pc.bedtime_end END
  GROUP BY h.ws
 )
 SELECT coalesce(jsonb_agg(x.row ORDER BY x.ws DESC), '[]'::jsonb) INTO v_weeks FROM (
  SELECT w.ws, jsonb_build_object(
   'week_start', w.ws, 'week_end', w.ws + 6, 'partial', w.ws = v_cur,
   'families_listening', n.families,
   'small_sample', n.families < 5,
   'avg_nights', n.avg_nights,
   'nights_histogram', CASE WHEN n.families >= 5 THEN n.histogram END,
   'listening', jsonb_build_object(
     'started', coalesce(d.started, 0), 'finished', coalesce(d.counted, 0), 'expired', coalesce(d.expired, 0),
     'too_fast', CASE WHEN d.backfilled THEN NULL ELSE coalesce(d.too_fast, 0) END,
     'finish_rate', CASE WHEN coalesce(d.started, 0) > 0 THEN round(100.0 * d.counted / d.started) END,
     'exact', NOT coalesce(d.backfilled, false)),
   'missions_done', (SELECT count(*) FROM deeds e WHERE e.ws=w.ws AND e.kind IN ('base','themed'))::int,
   'habits', jsonb_build_object('confirmed', (SELECT count(*) FROM deeds e WHERE e.ws=w.ws AND e.kind='habit')::int,
     'families', (SELECT count(DISTINCT e.user_id) FROM deeds e WHERE e.ws=w.ws AND e.kind='habit')::int),
   'kindness', jsonb_build_object('thanked', (SELECT count(*) FROM deeds e WHERE e.ws=w.ws AND e.kind='kindness')::int,
     'families', (SELECT count(DISTINCT e.user_id) FROM deeds e WHERE e.ws=w.ws AND e.kind='kindness')::int),
   'family_reads', jsonb_build_object(
     'reads', (SELECT count(*) FROM public.family_reads r JOIN fam f ON f.user_id=r.user_id WHERE r.week_start=w.ws)::int,
     'families', (SELECT count(DISTINCT r.user_id) FROM public.family_reads r JOIN fam f ON f.user_id=r.user_id WHERE r.week_start=w.ws)::int,
     'reached_target', (SELECT count(*) FROM public.reward_ledger l JOIN fam f ON f.user_id=l.user_id
       WHERE l.kind='constellation' AND l.idempotency_key='constellation:'||l.user_id||':'||w.ws)::int),
   'guardrails', jsonb_build_object(
     'bedtime_sessions', coalesce((SELECT b.n FROM bedtime b WHERE b.ws=w.ws), 0),
     'nights_3plus', (SELECT count(*) FROM per_night p WHERE p.ws=w.ws AND p.stories >= 3)::int,
     'family_nights', (SELECT count(*) FROM per_night p WHERE p.ws=w.ws)::int,
     'avg_minutes_per_night', (SELECT round(avg(p.minutes)::numeric, 1) FROM per_night p WHERE p.ws=w.ws)),
   'reminders', jsonb_build_object(
     'sent', (SELECT count(*) FROM public.parent_notification_log g JOIN fam f ON f.user_id=g.user_id WHERE g.status='sent' AND g.local_date BETWEEN w.ws AND w.ws + 6)::int,
     'failed', (SELECT count(*) FROM public.parent_notification_log g JOIN fam f ON f.user_id=g.user_id WHERE g.status='failed' AND g.local_date BETWEEN w.ws AND w.ws + 6)::int,
     'skipped', (SELECT count(*) FROM public.parent_notification_log g JOIN fam f ON f.user_id=g.user_id WHERE g.status='skipped' AND g.local_date BETWEEN w.ws AND w.ws + 6)::int,
     'turned_off', (SELECT count(*) FROM public.parent_notify_prefs q JOIN fam f ON f.user_id=q.user_id
       WHERE NOT q.enabled AND public.missions_local_date(q.updated_at) BETWEEN w.ws AND w.ws + 6)::int)
  ) AS row
  FROM wk w
  CROSS JOIN LATERAL (
   SELECT count(*)::int AS families, round(avg(nn.n)::numeric, 1) AS avg_nights,
    (SELECT jsonb_object_agg(k::text, (SELECT count(*) FROM nights z WHERE z.ws=w.ws AND z.n=k)) FROM generate_series(1, 7) k) AS histogram
   FROM nights nn WHERE nn.ws=w.ws) n
  LEFT JOIN LATERAL (
   SELECT sum(m.started)::int AS started, sum(m.counted)::int AS counted, sum(m.expired)::int AS expired,
    sum(m.too_fast)::int AS too_fast, bool_or(m.backfilled) AS backfilled
   FROM public.missions_listen_daily m WHERE m.local_date BETWEEN w.ws AND w.ws + 6) d ON true
 ) x;
 RETURN jsonb_build_object(
  'weeks', v_weeks, 'week_count', p_weeks, 'timezone', 'Asia/Ho_Chi_Minh', 'week_starts', 'monday',
  'generated_at', now(), 'min_families', 5,
  'families_total', (SELECT count(*) FROM public.profiles p JOIN auth.users u ON u.id=p.id WHERE p.role='user' AND coalesce(u.email,'') NOT ILIKE '%@kecon.test')::int,
  'reminders_on', (SELECT count(*) FROM public.parent_notify_prefs q WHERE q.enabled AND public.missions_metrics_family(q.user_id))::int,
  'funnel_since', (SELECT min(m.local_date) FROM public.missions_listen_daily m WHERE NOT m.backfilled));
END $$;
REVOKE ALL ON FUNCTION public.missions_weekly_summary(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.missions_weekly_summary(integer) TO authenticated;
