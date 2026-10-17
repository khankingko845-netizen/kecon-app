-- G-06 / G-07 — "Bầu trời của Đóm" with the family (docs/missions-parent.md).
-- Habit missions tied to the 10 "Thói quen tốt của Bo và Su" stories, confirmed by
-- a parent with a server-verified PIN proof; good deeds for others are thanked in
-- words only (never a star or sticker); a family mission ("cả nhà đọc 3 truyện
-- cùng nhau") lights a shared constellation; a weekly parent summary; opt-in
-- parent reminders (default off, at most one a day, parent devices only).
-- Account-level like 034 until T10 child profiles. Additive (expand only).

-- 1) Parent proof: a short-lived server session minted only by a correct PIN.
--    The raw token lives in the parent's page memory; the DB keeps its SHA-256.
CREATE TABLE public.parent_gate_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz
);
CREATE INDEX parent_gate_sessions_user ON public.parent_gate_sessions(user_id, created_at DESC);
ALTER TABLE public.parent_gate_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.parent_gate_sessions FROM PUBLIC, anon, authenticated;

-- Same attempt counter / lockout as verify_parent_pin (_check_parent_pin, 017).
CREATE FUNCTION public.open_parent_gate(p_pin text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,extensions AS $$
DECLARE v_uid uuid := auth.uid(); v_res jsonb; v_token text; v_exp timestamptz;
BEGIN
 IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated'); END IF;
 v_res := public._check_parent_pin(v_uid, p_pin);
 IF NOT coalesce((v_res->>'ok')::boolean, false) THEN RETURN v_res; END IF;
 DELETE FROM public.parent_gate_sessions WHERE user_id=v_uid AND least(expires_at, coalesce(revoked_at, expires_at)) < now() - interval '30 days';
 -- At most 5 live proofs per account (a few parent devices); older ones are revoked.
 UPDATE public.parent_gate_sessions SET revoked_at=now()
  WHERE user_id=v_uid AND revoked_at IS NULL AND id NOT IN (
   SELECT id FROM public.parent_gate_sessions WHERE user_id=v_uid AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 4);
 v_token := encode(gen_random_bytes(32), 'hex');
 v_exp := now() + interval '15 minutes';
 INSERT INTO public.parent_gate_sessions(user_id, token_hash, expires_at) VALUES (v_uid, encode(digest(v_token, 'sha256'), 'hex'), v_exp);
 RETURN v_res || jsonb_build_object('gate_token', v_token, 'gate_expires_at', v_exp);
END $$;

-- Valid proof of the caller → its id (sliding 15 min, at most 60 min after the PIN).
CREATE FUNCTION public.parent_gate_check(p_token text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,extensions AS $$
DECLARE v_id uuid;
BEGIN
 IF auth.uid() IS NULL OR p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
 UPDATE public.parent_gate_sessions SET expires_at = least(created_at + interval '60 minutes', now() + interval '15 minutes')
  WHERE user_id=auth.uid() AND token_hash=encode(digest(p_token, 'sha256'), 'hex') AND revoked_at IS NULL AND expires_at > now()
  RETURNING id INTO v_id;
 RETURN v_id;
END $$;

CREATE FUNCTION public.close_parent_gate(p_token text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,extensions AS $$
BEGIN
 IF auth.uid() IS NULL OR p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN; END IF;
 UPDATE public.parent_gate_sessions SET revoked_at=now()
  WHERE user_id=auth.uid() AND token_hash=encode(digest(p_token, 'sha256'), 'hex') AND revoked_at IS NULL;
END $$;
-- A new or reset PIN ends every proof minted with the old one.
CREATE FUNCTION public.parent_gate_revoke_on_pin_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP = 'DELETE' OR NEW.pin_hash IS DISTINCT FROM OLD.pin_hash THEN
  UPDATE public.parent_gate_sessions SET revoked_at=now() WHERE user_id=OLD.user_id AND revoked_at IS NULL;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER parent_gate_revoke_on_pin_change AFTER UPDATE OF pin_hash OR DELETE ON public.parental_pins
 FOR EACH ROW EXECUTE FUNCTION public.parent_gate_revoke_on_pin_change();
REVOKE ALL ON FUNCTION public.open_parent_gate(text), public.parent_gate_check(text), public.close_parent_gate(text), public.parent_gate_revoke_on_pin_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_parent_gate(text), public.close_parent_gate(text) TO authenticated;

-- 2) Mission templates: new kinds carry their own copy (editable by admins, G-08).
--    Copy follows G-01: process praise, never "giỏi/thông minh/xuất sắc", no streak words.
ALTER TABLE public.mission_templates DROP CONSTRAINT mission_templates_kind_check;
ALTER TABLE public.mission_templates ADD CONSTRAINT mission_templates_kind_check
 CHECK (kind IN ('base','themed','habit','kindness','family'));
ALTER TABLE public.mission_templates
 ADD COLUMN title text CHECK (title IS NULL OR char_length(title) BETWEEN 2 AND 60),
 ADD COLUMN parent_label text CHECK (parent_label IS NULL OR char_length(parent_label) BETWEEN 2 AND 120),
 ADD COLUMN praise text CHECK (praise IS NULL OR char_length(praise) BETWEEN 2 AND 160),
 ADD COLUMN prompt text CHECK (prompt IS NULL OR char_length(prompt) BETWEEN 2 AND 200),
 ADD COLUMN story_tag text CHECK (story_tag IS NULL OR story_tag ~ '^kc-lib:[a-z0-9-]{2,60}$'),
 ADD COLUMN target integer CHECK (target IS NULL OR target BETWEEN 1 AND 7),
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.mission_templates ADD CONSTRAINT mission_templates_copy_present
 CHECK (kind IN ('base','themed') OR (title IS NOT NULL AND parent_label IS NOT NULL AND praise IS NOT NULL));
ALTER TABLE public.mission_templates ADD CONSTRAINT mission_templates_family_target
 CHECK ((kind = 'family') = (target IS NOT NULL));
ALTER TABLE public.mission_templates ADD CONSTRAINT mission_templates_story_kinds
 CHECK (story_tag IS NULL OR kind IN ('habit','kindness'));
ALTER TABLE public.mission_templates ADD CONSTRAINT mission_templates_process_praise
 CHECK (concat_ws(' ', title, parent_label, praise, prompt) !~* '(giỏi|thông minh|xuất sắc|thiên tài|liền|liên tục|liên tiếp|thua|phạt)');

INSERT INTO public.mission_templates(id,kind,sort_order,story_tag,title,parent_label,praise,prompt,target) VALUES
 ('tu-cat-do-choi','habit',10,'kc-lib:do-choi-muon-ve-nha','Tự cất đồ chơi','Hôm nay bé tự cất đồ chơi về chỗ','Bé đã tự đưa đồ chơi về đúng chỗ. Đóm thấy bé cố gắng lắm!','Hỏi bé: “Món đồ chơi nào thích được về nhà của nó nhất?”',NULL),
 ('lam-dung-gio','habit',11,'kc-lib:su-va-dong-ho-cat','Làm xong đúng giờ','Hôm nay bé tự làm xong một việc đúng giờ (đánh răng, đi ngủ…)','Bé đã tự làm xong việc của mình đúng giờ, giống Su với chiếc đồng hồ cát!','Hỏi bé: “Hôm nay việc gì con tự làm xong mà không cần nhắc?”',NULL),
 ('loi-noi-dep','habit',12,'kc-lib:bo-va-nhung-loi-noi-dep','Nói lời hay','Hôm nay bé chọn lời nói đẹp, kể cả khi bực mình','Bé đã chọn những lời nói đẹp. Nghe thật dễ chịu!','Hỏi bé: “Khi bực mình, mình có thể nói câu gì thay cho lời xấu?”',NULL),
 ('ba-tu-ky-dieu','habit',13,'kc-lib:ba-tu-ky-dieu','Cảm ơn, xin lỗi','Hôm nay bé tự nói “cảm ơn”, “xin lỗi” hoặc “làm ơn”','Bé đã tự nói những từ kỳ diệu. Ai nghe cũng thấy vui!','Hỏi bé: “Hôm nay con đã nói “cảm ơn” với ai?”',NULL),
 ('manh-dan','habit',14,'kc-lib:bo-manh-dan','Thử một bước nhỏ','Hôm nay bé mạnh dạn thử một việc mới, dù nhỏ','Bé đã dám thử một bước nhỏ. Bước nhỏ cũng là dũng cảm đấy!','Hỏi bé: “Việc gì làm con hơi run, nhưng con vẫn thử?”',NULL),
 ('noi-that','habit',15,'kc-lib:chiec-binh-hoa-cua-ba','Nói thật','Hôm nay bé nói thật khi lỡ làm sai','Bé đã nói thật dù hơi lo. Đóm biết điều đó không dễ chút nào!','Hỏi bé: “Nếu lỡ làm vỡ đồ, con sẽ nói với ai?”',NULL),
 ('giong-vua-du','habit',16,'kc-lib:giong-noi-ba-co','Giọng vừa đủ nghe','Hôm nay bé nhớ nói nhỏ nhẹ khi ở trong nhà','Bé đã chọn giọng vừa đủ nghe trong nhà. Cả nhà thấy thật dễ chịu!','Hỏi bé: “Giọng nào hợp khi ở trong nhà, giọng nào hợp khi ra sân chơi?”',NULL),
 ('hit-tho','habit',17,'kc-lib:ngon-nui-lua-nho','Hít thở khi giận','Hôm nay bé hít thở thật sâu khi thấy tức giận','Bé đã hít thở để ngọn núi lửa nhỏ dịu lại. Đóm thấy bé đã cố gắng!','Hỏi bé: “Khi giận, cơ thể con thấy thế nào? Mình cùng hít thở thử nhé.”',NULL),
 ('lang-nghe','habit',18,'kc-lib:su-va-chiec-ao-khoac','Lắng nghe bố mẹ','Hôm nay bé dừng lại lắng nghe khi bố mẹ dặn','Bé đã dừng lại lắng nghe, giống Su với chiếc áo khoác!','Hỏi bé: “Vì sao mẹ dặn Su mặc áo khoác nhỉ?”',NULL),
 ('chia-se','kindness',20,'kc-lib:chiec-xe-tai-do','Chia sẻ, chờ đến lượt','Hôm nay bé chia sẻ hoặc chờ đến lượt với bạn','Cảm ơn bé đã chia sẻ với bạn.','Hỏi bé: “Lúc chờ đến lượt, con thấy thế nào?”',NULL),
 ('giup-do','kindness',21,NULL,'Giúp đỡ người khác','Hôm nay bé giúp đỡ một người trong nhà','Cảm ơn bé đã giúp đỡ mọi người.','Hỏi bé: “Hôm nay con đã giúp ai? Người đó thấy sao?”',NULL),
 ('ca-nha-doc-cung','family',30,NULL,'Cả nhà đọc cùng nhau','Tuần này cả nhà đọc 3 truyện cùng nhau','Cả nhà mình đã cùng đọc đủ 3 truyện. Chòm sao của nhà mình sáng lên rồi!',NULL,3);

-- 3) Parent confirmations reuse child_missions (one per template per day) and
--    remember which parent proof confirmed them.
ALTER TABLE public.child_missions ADD COLUMN parent_session_id uuid REFERENCES public.parent_gate_sessions(id) ON DELETE SET NULL;

-- 4) Family constellation in the append-only ledger; thanks for good deeds never
--    enter the ledger (rule 9: words only, no star, no sticker).
ALTER TABLE public.reward_ledger DROP CONSTRAINT reward_ledger_kind_check;
ALTER TABLE public.reward_ledger ADD CONSTRAINT reward_ledger_kind_check CHECK (kind IN ('star','sticker','milestone','constellation'));
ALTER TABLE public.reward_ledger DROP CONSTRAINT reward_ledger_check;
ALTER TABLE public.reward_ledger ADD CONSTRAINT reward_ledger_check CHECK (
 (kind='star' AND template_id IS NOT NULL) OR (kind='sticker' AND story_id IS NOT NULL)
 OR (kind='milestone' AND milestone IS NOT NULL) OR (kind='constellation' AND template_id IS NOT NULL));
CREATE FUNCTION public.reward_ledger_kind_rules() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_kind text;
BEGIN
 IF NEW.template_id IS NOT NULL THEN
  SELECT kind INTO v_kind FROM public.mission_templates WHERE id=NEW.template_id;
  IF v_kind = 'kindness' THEN RAISE EXCEPTION 'Good deeds are thanked, not rewarded' USING ERRCODE='23514'; END IF;
  IF (NEW.kind = 'constellation') <> (v_kind = 'family') THEN RAISE EXCEPTION 'Constellations belong to family missions' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reward_ledger_kind_rules BEFORE INSERT ON public.reward_ledger FOR EACH ROW EXECUTE FUNCTION public.reward_ledger_kind_rules();
REVOKE ALL ON FUNCTION public.reward_ledger_kind_rules() FROM PUBLIC, anon, authenticated;

CREATE TABLE public.family_reads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 household_id uuid REFERENCES public.households(id) ON DELETE CASCADE,
 session_id uuid NOT NULL UNIQUE REFERENCES public.listen_sessions(id) ON DELETE CASCADE,
 story_id uuid REFERENCES public.stories(id) ON DELETE SET NULL,
 local_date date NOT NULL,
 week_start date NOT NULL,
 parent_session_id uuid REFERENCES public.parent_gate_sessions(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX family_reads_user_week ON public.family_reads(user_id, week_start);
ALTER TABLE public.family_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.family_reads FROM PUBLIC, anon, authenticated;

-- 5) Parent reminders: off unless a parent turns them on; only devices a parent
--    registered behind the PIN; one per Vietnam day (primary key).
CREATE TABLE public.parent_notify_prefs (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 hour smallint NOT NULL DEFAULT 19 CHECK (hour BETWEEN 6 AND 21),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.parent_devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 endpoint text NOT NULL UNIQUE CHECK (endpoint ~ '^https://[^[:space:]]+$' AND char_length(endpoint) <= 2048),
 p256dh text NOT NULL CHECK (p256dh ~ '^[A-Za-z0-9_=-]{80,100}$'),
 auth text NOT NULL CHECK (auth ~ '^[A-Za-z0-9_=-]{16,32}$'),
 parent_session_id uuid REFERENCES public.parent_gate_sessions(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX parent_devices_user ON public.parent_devices(user_id);
CREATE TABLE public.parent_notification_log (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 local_date date NOT NULL,
 status text NOT NULL CHECK (status IN ('queued','sent','failed','skipped')),
 devices_sent integer NOT NULL DEFAULT 0 CHECK (devices_sent >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 PRIMARY KEY (user_id, local_date)
);
ALTER TABLE public.parent_notify_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_notification_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.parent_notify_prefs, public.parent_devices, public.parent_notification_log FROM PUBLIC, anon, authenticated;

-- 6) Summaries.
CREATE FUNCTION public.missions_family_progress(p_user uuid, p_week date) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('id', t.id, 'title', t.title, 'target', t.target,
  'progress', least(t.target, (SELECT count(DISTINCT coalesce(f.story_id::text, f.session_id::text) || ':' || f.local_date) FROM public.family_reads f WHERE f.user_id=p_user AND f.week_start=p_week)),
  'done', EXISTS(SELECT 1 FROM public.reward_ledger l WHERE l.user_id=p_user AND l.kind='constellation' AND l.idempotency_key='constellation:'||p_user||':'||p_week))
 FROM public.mission_templates t WHERE t.kind='family' AND t.active ORDER BY t.sort_order, t.id LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.missions_family_progress(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.missions_summary_for(p_user uuid, p_now timestamptz) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_day date := public.missions_local_date(p_now); v_start date; v_missions jsonb; v_days jsonb; v_habits jsonb;
BEGIN
 v_start := public.missions_week_start(v_day);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'done',EXISTS(SELECT 1 FROM public.child_missions c WHERE c.user_id=p_user AND c.child_profile_id IS NULL AND c.template_id=a.id AND c.local_date=v_day)) ORDER BY a.ord),'[]'::jsonb)
   INTO v_missions FROM unnest(public.missions_assigned(v_day)) WITH ORDINALITY AS a(id, ord);
 SELECT jsonb_agg(jsonb_build_object('date',d.day,
   'stars',(SELECT count(*) FROM public.reward_ledger l WHERE l.user_id=p_user AND l.kind='star' AND l.local_date=d.day),
   'listened',EXISTS(SELECT 1 FROM public.listen_sessions x WHERE x.user_id=p_user AND x.counted AND x.local_date=d.day)) ORDER BY d.day)
   INTO v_days FROM (SELECT v_start + i AS day FROM generate_series(0,6) i) d;
 -- What a parent confirmed today: habits (with a star) and good deeds (thanks only).
 SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'title', t.title, 'line', t.praise) ORDER BY c.completed_at), '[]'::jsonb)
   INTO v_habits FROM public.child_missions c JOIN public.mission_templates t ON t.id=c.template_id
   WHERE c.user_id=p_user AND c.child_profile_id IS NULL AND c.local_date=v_day AND t.kind IN ('habit','kindness');
 RETURN jsonb_build_object(
  'date', v_day,
  'missions', v_missions,
  'habits', v_habits,
  'family', public.missions_family_progress(p_user, v_start),
  'week', jsonb_build_object('start', v_start, 'goal', 4,
    'nights', (SELECT count(DISTINCT x.local_date) FROM public.listen_sessions x WHERE x.user_id=p_user AND x.counted AND x.local_date BETWEEN v_start AND v_start + 6),
    'days', v_days),
  'totals', jsonb_build_object(
    'stories', (SELECT count(*) FROM public.listen_sessions x WHERE x.user_id=p_user AND x.counted),
    'stars', (SELECT count(*) FROM public.reward_ledger l WHERE l.user_id=p_user AND l.kind='star'),
    'stickers', (SELECT count(*) FROM public.reward_ledger l WHERE l.user_id=p_user AND l.kind='sticker')));
END $$;

CREATE OR REPLACE FUNCTION public.missions_album() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
 IF v_uid IS NULL OR NOT public.feature_enabled('missions') THEN RAISE EXCEPTION 'Action unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object(
  'stickers', (SELECT coalesce(jsonb_agg(jsonb_build_object('story_id', l.story_id, 'title', s.title, 'cover_image_url', s.cover_image_url, 'earned_on', l.local_date) ORDER BY l.id DESC), '[]'::jsonb)
    FROM public.reward_ledger l LEFT JOIN public.stories s ON s.id=l.story_id AND s.is_platform_content AND s.is_published AND s.status='published' AND s.deleted_at IS NULL
    WHERE l.user_id=v_uid AND l.kind='sticker'),
  'milestones', (SELECT coalesce(jsonb_agg(l.milestone ORDER BY l.milestone), '[]'::jsonb) FROM public.reward_ledger l WHERE l.user_id=v_uid AND l.kind='milestone'),
  'constellations', (SELECT coalesce(jsonb_agg(jsonb_build_object('week_start', public.missions_week_start(l.local_date), 'earned_on', l.local_date) ORDER BY l.id DESC), '[]'::jsonb)
    FROM public.reward_ledger l WHERE l.user_id=v_uid AND l.kind='constellation'));
END $$;

-- Weekly parent summary (shown behind the parent gate). Read-only, own data only.
CREATE FUNCTION public.missions_parent_week() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_uid uuid := auth.uid(); v_day date; v_start date;
BEGIN
 IF v_uid IS NULL OR NOT public.feature_enabled('missions') THEN RAISE EXCEPTION 'Action unavailable' USING ERRCODE='42501'; END IF;
 v_day := public.missions_local_date(now()); v_start := public.missions_week_start(v_day);
 RETURN jsonb_build_object(
  'summary', public.missions_summary_for(v_uid, now()),
  'stories', (SELECT coalesce(jsonb_agg(jsonb_build_object('session_id', x.id, 'story_id', x.story_id, 'title', s.title, 'category', s.category, 'date', x.local_date,
     'together', EXISTS(SELECT 1 FROM public.family_reads f WHERE f.session_id=x.id),
     'prompt', (SELECT t.prompt FROM public.mission_templates t WHERE t.active AND t.story_tag IS NOT NULL AND t.story_tag = ANY(coalesce(s.tags,'{}'::text[])) ORDER BY t.sort_order LIMIT 1))
     ORDER BY x.completed_at DESC), '[]'::jsonb)
    FROM (SELECT * FROM public.listen_sessions WHERE user_id=v_uid AND counted AND local_date BETWEEN v_start AND v_start + 6 ORDER BY completed_at DESC LIMIT 30) x
    LEFT JOIN public.stories s ON s.id=x.story_id AND (s.is_platform_content OR s.user_id=v_uid)),
  'habits', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'title', t.title, 'label', t.parent_label, 'prompt', t.prompt,
     'today', EXISTS(SELECT 1 FROM public.child_missions c WHERE c.user_id=v_uid AND c.template_id=t.id AND c.local_date=v_day),
     'week', (SELECT count(*) FROM public.child_missions c WHERE c.user_id=v_uid AND c.template_id=t.id AND c.local_date BETWEEN v_start AND v_start + 6))
     ORDER BY t.sort_order, t.id), '[]'::jsonb)
    FROM public.mission_templates t WHERE t.active AND t.kind IN ('habit','kindness')
     AND (t.story_tag IS NULL OR EXISTS(SELECT 1 FROM public.listen_sessions x JOIN public.stories s ON s.id=x.story_id
       WHERE x.user_id=v_uid AND x.counted AND t.story_tag = ANY(coalesce(s.tags,'{}'::text[]))))),
  'family', (SELECT public.missions_family_progress(v_uid, v_start) || jsonb_build_object('label', t.parent_label)
    FROM public.mission_templates t WHERE t.kind='family' AND t.active ORDER BY t.sort_order, t.id LIMIT 1),
  'notify', jsonb_build_object(
    'enabled', coalesce((SELECT p.enabled FROM public.parent_notify_prefs p WHERE p.user_id=v_uid), false),
    'hour', coalesce((SELECT p.hour FROM public.parent_notify_prefs p WHERE p.user_id=v_uid), 19),
    'devices', (SELECT count(*) FROM public.parent_devices d WHERE d.user_id=v_uid)));
END $$;

-- 7) Parent actions: each needs a live parent proof from open_parent_gate.
CREATE FUNCTION public.missions_confirm(p_proof text, p_template text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_uid uuid := auth.uid(); v_gate uuid; t public.mission_templates; v_day date; v_hh uuid;
BEGIN
 IF v_uid IS NULL OR NOT public.feature_enabled('missions') THEN RAISE EXCEPTION 'Action unavailable' USING ERRCODE='42501'; END IF;
 v_gate := public.parent_gate_check(p_proof);
 IF v_gate IS NULL THEN RAISE EXCEPTION 'Parent proof required' USING ERRCODE='28000'; END IF;
 SELECT * INTO t FROM public.mission_templates WHERE id=p_template AND active AND kind IN ('habit','kindness');
 IF NOT FOUND THEN RAISE EXCEPTION 'Mission unavailable' USING ERRCODE='22023'; END IF;
 IF t.story_tag IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.listen_sessions x JOIN public.stories s ON s.id=x.story_id
   WHERE x.user_id=v_uid AND x.counted AND t.story_tag = ANY(coalesce(s.tags,'{}'::text[]))) THEN
  RAISE EXCEPTION 'Mission not unlocked' USING ERRCODE='22023';
 END IF;
 v_day := public.missions_local_date(now()); v_hh := public.current_household_id();
 INSERT INTO public.child_missions(user_id, household_id, template_id, local_date, parent_session_id)
 VALUES (v_uid, v_hh, t.id, v_day, v_gate) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN jsonb_build_object('confirmed', false, 'reason', 'already_confirmed', 'kind', t.kind); END IF;
 IF t.kind = 'habit' THEN
  INSERT INTO public.reward_ledger(user_id, household_id, kind, template_id, local_date, idempotency_key)
  VALUES (v_uid, v_hh, 'star', t.id, v_day, 'star:'||v_uid||':'||t.id||':'||v_day) ON CONFLICT (idempotency_key) DO NOTHING;
 END IF;
 RETURN jsonb_build_object('confirmed', true, 'kind', t.kind, 'star', t.kind = 'habit', 'line', t.praise);
END $$;

CREATE FUNCTION public.missions_mark_together(p_proof text, p_session uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_uid uuid := auth.uid(); v_gate uuid; s public.listen_sessions; t public.mission_templates; v_day date; v_week date; v_new boolean := false; v_p jsonb;
BEGIN
 IF v_uid IS NULL OR NOT public.feature_enabled('missions') THEN RAISE EXCEPTION 'Action unavailable' USING ERRCODE='42501'; END IF;
 v_gate := public.parent_gate_check(p_proof);
 IF v_gate IS NULL THEN RAISE EXCEPTION 'Parent proof required' USING ERRCODE='28000'; END IF;
 SELECT * INTO t FROM public.mission_templates WHERE kind='family' AND active ORDER BY sort_order, id LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Mission unavailable' USING ERRCODE='22023'; END IF;
 v_day := public.missions_local_date(now()); v_week := public.missions_week_start(v_day);
 SELECT * INTO s FROM public.listen_sessions WHERE id=p_session AND user_id=v_uid AND counted FOR UPDATE;
 -- Only this week's finished stories: a past week stays as it was.
 IF NOT FOUND OR s.local_date < v_week OR s.local_date > v_day THEN RAISE EXCEPTION 'Session unavailable' USING ERRCODE='22023'; END IF;
 INSERT INTO public.family_reads(user_id, household_id, session_id, story_id, local_date, week_start, parent_session_id)
 VALUES (v_uid, s.household_id, s.id, s.story_id, s.local_date, v_week, v_gate) ON CONFLICT (session_id) DO NOTHING;
 v_p := public.missions_family_progress(v_uid, v_week);
 IF (v_p->>'progress')::int >= t.target THEN
  INSERT INTO public.reward_ledger(user_id, household_id, kind, template_id, local_date, idempotency_key)
  VALUES (v_uid, s.household_id, 'constellation', t.id, v_day, 'constellation:'||v_uid||':'||v_week) ON CONFLICT (idempotency_key) DO NOTHING;
  v_new := FOUND;
 END IF;
 RETURN jsonb_build_object('marked', true, 'progress', (v_p->>'progress')::int, 'target', t.target,
  'done', (v_p->>'progress')::int >= t.target, 'constellation', v_new, 'line', CASE WHEN v_new THEN t.praise END);
END $$;

CREATE FUNCTION public.parent_notify_set(p_proof text, p_enabled boolean, p_hour integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
 IF v_uid IS NULL OR NOT public.feature_enabled('missions') THEN RAISE EXCEPTION 'Action unavailable' USING ERRCODE='42501'; END IF;
 IF public.parent_gate_check(p_proof) IS NULL THEN RAISE EXCEPTION 'Parent proof required' USING ERRCODE='28000'; END IF;
 IF p_enabled IS NULL OR p_hour IS NULL OR p_hour NOT BETWEEN 6 AND 21 THEN RAISE EXCEPTION 'Invalid reminder' USING ERRCODE='22023'; END IF;
 INSERT INTO public.parent_notify_prefs(user_id, enabled, hour, updated_at) VALUES (v_uid, p_enabled, p_hour, now())
 ON CONFLICT (user_id) DO UPDATE SET enabled=EXCLUDED.enabled, hour=EXCLUDED.hour, updated_at=now();
 RETURN jsonb_build_object('enabled', p_enabled, 'hour', p_hour, 'devices', (SELECT count(*) FROM public.parent_devices WHERE user_id=v_uid));
END $$;

CREATE FUNCTION public.parent_device_register(p_proof text, p_endpoint text, p_p256dh text, p_auth text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_uid uuid := auth.uid(); v_gate uuid;
BEGIN
 IF v_uid IS NULL OR NOT public.feature_enabled('missions') THEN RAISE EXCEPTION 'Action unavailable' USING ERRCODE='42501'; END IF;
 v_gate := public.parent_gate_check(p_proof);
 IF v_gate IS NULL THEN RAISE EXCEPTION 'Parent proof required' USING ERRCODE='28000'; END IF;
 -- A browser that receives the child's notifications is a child-mode device.
 IF EXISTS(SELECT 1 FROM public.push_subscriptions WHERE endpoint=p_endpoint) THEN RAISE EXCEPTION 'Child device' USING ERRCODE='22023'; END IF;
 INSERT INTO public.parent_devices(user_id, endpoint, p256dh, auth, parent_session_id) VALUES (v_uid, p_endpoint, p_p256dh, p_auth, v_gate)
 ON CONFLICT (endpoint) DO UPDATE SET user_id=EXCLUDED.user_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth, parent_session_id=EXCLUDED.parent_session_id, created_at=now();
 DELETE FROM public.parent_devices WHERE user_id=v_uid AND id NOT IN (SELECT id FROM public.parent_devices WHERE user_id=v_uid ORDER BY created_at DESC LIMIT 5);
 RETURN jsonb_build_object('devices', (SELECT count(*) FROM public.parent_devices WHERE user_id=v_uid));
END $$;

-- Removing a device never needs the PIN.
CREATE FUNCTION public.parent_device_remove(p_endpoint text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
 DELETE FROM public.parent_devices WHERE user_id=auth.uid() AND endpoint=p_endpoint;
 RETURN jsonb_build_object('devices', (SELECT count(*) FROM public.parent_devices WHERE user_id=auth.uid()));
END $$;
REVOKE ALL ON FUNCTION public.missions_parent_week(), public.missions_confirm(text,text), public.missions_mark_together(text,uuid),
 public.parent_notify_set(text,boolean,integer), public.parent_device_register(text,text,text,text), public.parent_device_remove(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.missions_parent_week(), public.missions_confirm(text,text), public.missions_mark_together(text,uuid),
 public.parent_notify_set(text,boolean,integer), public.parent_device_register(text,text,text,text), public.parent_device_remove(text) TO authenticated;

-- 8) Reminder job (service role only, scripts/parent-notify.mjs every 15 min):
--    claim → send to parent devices → finish. The log's primary key makes it ≤ 1/day.
CREATE FUNCTION public.parent_notify_claim(p_now timestamptz DEFAULT now(), p_limit integer DEFAULT 200) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_day date := public.missions_local_date(p_now); v_hour int := extract(hour FROM p_now AT TIME ZONE 'Asia/Ho_Chi_Minh')::int;
 v_out jsonb := '[]'::jsonb; r record; v_nights int;
BEGIN
 IF NOT public.feature_enabled('missions') THEN RETURN v_out; END IF;
 FOR r IN SELECT p.user_id FROM public.parent_notify_prefs p
   WHERE p.enabled AND p.hour = v_hour
    AND EXISTS(SELECT 1 FROM public.parent_devices d WHERE d.user_id=p.user_id AND NOT EXISTS(SELECT 1 FROM public.push_subscriptions ps WHERE ps.endpoint=d.endpoint))
    AND NOT EXISTS(SELECT 1 FROM public.parent_notification_log l WHERE l.user_id=p.user_id AND l.local_date=v_day)
   ORDER BY p.user_id LIMIT greatest(1, least(coalesce(p_limit, 200), 1000)) LOOP
  INSERT INTO public.parent_notification_log(user_id, local_date, status) VALUES (r.user_id, v_day, 'queued') ON CONFLICT DO NOTHING;
  CONTINUE WHEN NOT FOUND;
  SELECT count(DISTINCT x.local_date) INTO v_nights FROM public.listen_sessions x
   WHERE x.user_id=r.user_id AND x.counted AND x.local_date BETWEEN public.missions_week_start(v_day) AND v_day;
  v_out := v_out || jsonb_build_array(jsonb_build_object('user_id', r.user_id, 'date', v_day, 'title', 'Tuần của bé',
   'body', CASE WHEN v_nights = 0 THEN 'Tối nay cả nhà mình cùng đọc một truyện ngắn nhé?'
     ELSE 'Tuần này bé đã nghe truyện ' || v_nights || ' tối. Mở “Tuần của bé” để xem gợi ý trò chuyện.' END,
   'devices', (SELECT coalesce(jsonb_agg(jsonb_build_object('endpoint', d.endpoint, 'p256dh', d.p256dh, 'auth', d.auth)), '[]'::jsonb)
     FROM public.parent_devices d WHERE d.user_id=r.user_id AND NOT EXISTS(SELECT 1 FROM public.push_subscriptions ps WHERE ps.endpoint=d.endpoint))));
 END LOOP;
 RETURN v_out;
END $$;

CREATE FUNCTION public.parent_notify_finish(p_user uuid, p_date date, p_status text, p_sent integer, p_gone text[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_status NOT IN ('sent','failed','skipped') THEN RAISE EXCEPTION 'Invalid status' USING ERRCODE='22023'; END IF;
 UPDATE public.parent_notification_log SET status=p_status, devices_sent=greatest(0, coalesce(p_sent, 0)), finished_at=now()
  WHERE user_id=p_user AND local_date=p_date AND status='queued';
 DELETE FROM public.parent_devices WHERE user_id=p_user AND endpoint = ANY(coalesce(p_gone, '{}'::text[]));
END $$;
REVOKE ALL ON FUNCTION public.parent_notify_claim(timestamptz, integer), public.parent_notify_finish(uuid, date, text, integer, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parent_notify_claim(timestamptz, integer), public.parent_notify_finish(uuid, date, text, integer, text[]) TO service_role;
