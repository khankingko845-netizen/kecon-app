-- G-08 · Admin for "Bầu trời của Đóm": mission templates and character cards
-- (docs/g08-missions-admin.md). Staff with templates.manage (and a valid A-05
-- admin session) change copy / on-off through two RPCs; each real change needs
-- a 10–500 character reason and writes exactly one audit row (trigger).
-- Additive: one small table, three RPCs, three triggers. Nothing is dropped.

-- 1) Character cards can be paused per library story. No row = card is on.
--    Pausing only stops new cards; cards already in an album stay (rule 3).
CREATE TABLE public.mission_sticker_settings (
 story_id uuid PRIMARY KEY REFERENCES public.stories(id) ON DELETE CASCADE,
 enabled boolean NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.mission_sticker_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mission_sticker_settings FROM PUBLIC, anon, authenticated;

-- The award path (missions_complete_listen) is unchanged: a paused card's
-- ledger insert is skipped, so FOUND is false and no card is announced.
CREATE FUNCTION public.mission_sticker_paused() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.kind = 'sticker' AND EXISTS (SELECT 1 FROM public.mission_sticker_settings m WHERE m.story_id = NEW.story_id AND NOT m.enabled) THEN
  RETURN NULL;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.mission_sticker_paused() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER reward_ledger_sticker_paused BEFORE INSERT ON public.reward_ledger
 FOR EACH ROW EXECUTE FUNCTION public.mission_sticker_paused();

-- 2) One audit row per real change, with the reason set by the RPC.
CREATE FUNCTION public.audit_mission_template_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF to_jsonb(OLD) - 'updated_at' - 'version' = to_jsonb(NEW) - 'updated_at' - 'version' THEN RETURN NULL; END IF;
 PERFORM public.audit_write('mission_template.update', 'mission_template', NEW.id,
  jsonb_build_object('title', OLD.title, 'parent_label', OLD.parent_label, 'praise', OLD.praise, 'prompt', OLD.prompt, 'target', OLD.target, 'active', OLD.active, 'version', OLD.version),
  jsonb_build_object('title', NEW.title, 'parent_label', NEW.parent_label, 'praise', NEW.praise, 'prompt', NEW.prompt, 'target', NEW.target, 'active', NEW.active, 'version', NEW.version),
  nullif(current_setting('app.admin_reason', true), ''), NULL, NULL, CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'db' END);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.audit_mission_template_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER audit_mission_templates AFTER UPDATE ON public.mission_templates
 FOR EACH ROW EXECUTE FUNCTION public.audit_mission_template_change();

CREATE FUNCTION public.audit_mission_sticker_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_before boolean := true; v_title text;
BEGIN
 IF TG_OP = 'UPDATE' THEN v_before := OLD.enabled; END IF;
 IF v_before = NEW.enabled THEN RETURN NULL; END IF;
 SELECT title INTO v_title FROM public.stories WHERE id = NEW.story_id;
 PERFORM public.audit_write('mission_sticker.update', 'story', NEW.story_id::text,
  jsonb_build_object('sticker_enabled', v_before, 'title', v_title), jsonb_build_object('sticker_enabled', NEW.enabled, 'title', v_title),
  nullif(current_setting('app.admin_reason', true), ''), NULL, NULL, CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'db' END);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.audit_mission_sticker_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER audit_mission_sticker_settings AFTER INSERT OR UPDATE ON public.mission_sticker_settings
 FOR EACH ROW EXECUTE FUNCTION public.audit_mission_sticker_change();

-- 3) Catalog for the admin screen: templates + library cards, counts only.
CREATE FUNCTION public.admin_missions_catalog() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_since date := public.missions_local_date(now()) - 27;
BEGIN
 IF NOT public.has_permission('templates.manage') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501'; END IF;
 RETURN jsonb_build_object(
  'templates', (SELECT coalesce(jsonb_agg(jsonb_build_object(
     'id', t.id, 'kind', t.kind, 'title', t.title, 'parent_label', t.parent_label, 'praise', t.praise, 'prompt', t.prompt,
     'story_tag', t.story_tag,
     'story_title', (SELECT s.title FROM public.stories s WHERE t.story_tag IS NOT NULL AND s.is_platform_content AND s.deleted_at IS NULL
                      AND t.story_tag = ANY (coalesce(s.tags, '{}'::text[])) ORDER BY s.created_at LIMIT 1),
     'target', t.target, 'active', t.active, 'version', t.version, 'updated_at', t.updated_at,
     'done_28d', (SELECT count(*) FROM public.child_missions c WHERE c.template_id = t.id AND c.local_date >= v_since))
   ORDER BY t.sort_order, t.id), '[]'::jsonb) FROM public.mission_templates t),
  'stickers', (SELECT coalesce(jsonb_agg(jsonb_build_object(
     'story_id', s.id, 'title', s.title, 'cover_image_url', s.cover_image_url, 'thumbnail_path', s.thumbnail_path,
     'thumbnail_scene', s.thumbnail_scene, 'thumbnail_source', s.thumbnail_source, 'published', s.is_published,
     'enabled', coalesce(m.enabled, true), 'updated_at', m.updated_at,
     'awarded', (SELECT count(*) FROM public.reward_ledger l WHERE l.kind = 'sticker' AND l.story_id = s.id))
   ORDER BY s.title, s.id), '[]'::jsonb)
   FROM public.stories s LEFT JOIN public.mission_sticker_settings m ON m.story_id = s.id
   WHERE s.is_platform_content AND s.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM unnest(coalesce(s.tags, '{}'::text[])) tg WHERE tg LIKE 'kc-lib:%')),
  'since', v_since);
END $$;
REVOKE ALL ON FUNCTION public.admin_missions_catalog() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_missions_catalog() TO authenticated;

-- 4) Edit one template. Optimistic lock on version; only the fields that make
--    sense for its kind; base and family stay on (turning them off would break
--    the daily mission / the family read).
CREATE FUNCTION public.admin_update_mission_template(p_id text, p_expected_version integer, p_patch jsonb, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.mission_templates; n public.mission_templates; k text; v_allowed text[]; v_reason text;
BEGIN
 IF NOT public.has_permission('templates.manage') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501'; END IF;
 v_reason := public.admin_action_reason(p_reason);
 IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN RAISE EXCEPTION 'Nothing to change' USING ERRCODE = '22023'; END IF;
 SELECT * INTO t FROM public.mission_templates WHERE id = p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown template' USING ERRCODE = 'P0002'; END IF;
 IF p_expected_version IS NULL OR t.version <> p_expected_version THEN RAISE EXCEPTION 'Template changed; reload' USING ERRCODE = '40001'; END IF;
 v_allowed := CASE t.kind
  WHEN 'base' THEN '{}'::text[]
  WHEN 'themed' THEN ARRAY['active']
  WHEN 'family' THEN ARRAY['title', 'parent_label', 'praise', 'target']
  ELSE ARRAY['title', 'parent_label', 'praise', 'prompt', 'active'] END;
 FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
  IF NOT k = ANY (v_allowed) THEN RAISE EXCEPTION 'Field not editable' USING ERRCODE = '22023'; END IF;
  IF k = 'active' AND jsonb_typeof(p_patch -> k) <> 'boolean' THEN RAISE EXCEPTION 'Invalid value' USING ERRCODE = '22023'; END IF;
  IF k = 'target' THEN
   IF jsonb_typeof(p_patch -> k) <> 'number' THEN RAISE EXCEPTION 'Invalid value' USING ERRCODE = '22023'; END IF;
   IF (p_patch ->> k)::numeric % 1 <> 0 THEN RAISE EXCEPTION 'Invalid value' USING ERRCODE = '22023'; END IF;
  END IF;
  IF k IN ('title', 'parent_label', 'praise') AND jsonb_typeof(p_patch -> k) <> 'string' THEN RAISE EXCEPTION 'Invalid value' USING ERRCODE = '22023'; END IF;
  IF k = 'prompt' AND jsonb_typeof(p_patch -> k) NOT IN ('string', 'null') THEN RAISE EXCEPTION 'Invalid value' USING ERRCODE = '22023'; END IF;
 END LOOP;
 n := t;
 IF p_patch ? 'title' THEN n.title := btrim(p_patch ->> 'title'); END IF;
 IF p_patch ? 'parent_label' THEN n.parent_label := btrim(p_patch ->> 'parent_label'); END IF;
 IF p_patch ? 'praise' THEN n.praise := btrim(p_patch ->> 'praise'); END IF;
 IF p_patch ? 'prompt' THEN n.prompt := nullif(btrim(coalesce(p_patch ->> 'prompt', '')), ''); END IF;
 IF p_patch ? 'target' THEN n.target := (p_patch ->> 'target')::numeric::integer; END IF;
 IF p_patch ? 'active' THEN n.active := (p_patch ->> 'active')::boolean; END IF;
 -- Rule 9: a good deed for others is thanked with words only.
 IF n.kind = 'kindness' AND n.praise NOT LIKE 'Cảm ơn%' THEN RAISE EXCEPTION 'Kindness praise must thank' USING ERRCODE = '22023'; END IF;
 IF (n.title, n.parent_label, n.praise, n.prompt, n.target, n.active) IS NOT DISTINCT FROM (t.title, t.parent_label, t.praise, t.prompt, t.target, t.active) THEN
  RETURN jsonb_build_object('changed', false, 'version', t.version);
 END IF;
 PERFORM set_config('app.admin_reason', v_reason, true);
 -- Length and "no giỏi / thông minh / liên tục…" are CHECK constraints (036) → 23514.
 UPDATE public.mission_templates SET title = n.title, parent_label = n.parent_label, praise = n.praise, prompt = n.prompt,
  target = n.target, active = n.active, version = t.version + 1, updated_at = now() WHERE id = t.id RETURNING * INTO n;
 PERFORM set_config('app.admin_reason', '', true);
 RETURN jsonb_build_object('changed', true, 'version', n.version);
END $$;
REVOKE ALL ON FUNCTION public.admin_update_mission_template(text, integer, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_mission_template(text, integer, jsonb, text) TO authenticated;

-- 5) Pause / resume one library story's character card (compare-and-set).
CREATE FUNCTION public.admin_set_mission_sticker(p_story uuid, p_enabled boolean, p_expected boolean, p_reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_reason text; v_cur boolean;
BEGIN
 IF NOT public.has_permission('templates.manage') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501'; END IF;
 v_reason := public.admin_action_reason(p_reason);
 IF p_enabled IS NULL OR p_expected IS NULL THEN RAISE EXCEPTION 'Invalid value' USING ERRCODE = '22023'; END IF;
 PERFORM 1 FROM public.stories s WHERE s.id = p_story AND s.is_platform_content AND s.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM unnest(coalesce(s.tags, '{}'::text[])) tg WHERE tg LIKE 'kc-lib:%') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown story' USING ERRCODE = 'P0002'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('mission_sticker:' || p_story::text));
 v_cur := coalesce((SELECT enabled FROM public.mission_sticker_settings WHERE story_id = p_story), true);
 IF v_cur <> p_expected THEN RAISE EXCEPTION 'Card changed; reload' USING ERRCODE = '40001'; END IF;
 IF v_cur = p_enabled THEN RETURN false; END IF;
 PERFORM set_config('app.admin_reason', v_reason, true);
 INSERT INTO public.mission_sticker_settings(story_id, enabled, updated_at, updated_by) VALUES (p_story, p_enabled, now(), auth.uid())
 ON CONFLICT (story_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by;
 PERFORM set_config('app.admin_reason', '', true);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_mission_sticker(uuid, boolean, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_mission_sticker(uuid, boolean, boolean, text) TO authenticated;
