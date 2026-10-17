-- T06: additive boolean flags; keep all feature data and core v1 flows.
INSERT INTO public.app_settings(key,value,label,category,is_secret) VALUES
('feature.gamification','false','gamification','features',false),
('feature.story_drawing','false','story_drawing','features',false),
('feature.book_scan','false','book_scan','features',false),
('feature.expert_review','false','expert_review','features',false),
('feature.branching_stories','false','branching_stories','features',false),
('feature.vocabulary_quiz','false','vocabulary_quiz','features',false),
('feature.multilingual','false','multilingual','features',false),
('feature.advanced_authoring','true','advanced_authoring','features',false),
('feature.ai_illustrations','false','ai_illustrations','features',false),
('feature.ai_ambience','false','ai_ambience','features',false),
('feature.child_push','false','child_push','features',false)
ON CONFLICT(key) DO NOTHING;
ALTER TABLE public.app_settings ADD CONSTRAINT valid_feature_setting CHECK
(key NOT LIKE 'feature.%' OR (key IN ('feature.gamification','feature.story_drawing','feature.book_scan','feature.expert_review','feature.branching_stories','feature.vocabulary_quiz','feature.multilingual','feature.advanced_authoring','feature.ai_illustrations','feature.child_push','feature.ai_ambience') AND value IS NOT NULL AND value IN ('true','false') AND category IS NOT NULL AND category='features' AND is_secret IS FALSE));
CREATE FUNCTION public.feature_enabled(p_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce((SELECT value='true' FROM public.app_settings WHERE key='feature.'||p_name AND category='features' AND is_secret IS FALSE),false)
$$;
REVOKE ALL ON FUNCTION public.feature_enabled(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.feature_enabled(text) TO anon,authenticated,service_role;
CREATE FUNCTION public.public_feature_flags() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_object_agg(name,public.feature_enabled(name)) FROM unnest(ARRAY['gamification','story_drawing','book_scan','expert_review','branching_stories','vocabulary_quiz','multilingual','advanced_authoring','ai_illustrations','child_push','ai_ambience']) name
$$;
REVOKE ALL ON FUNCTION public.public_feature_flags() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_feature_flags() TO anon,authenticated,service_role;
CREATE FUNCTION public.guard_feature_setting() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF coalesce(NEW.key,'') NOT LIKE 'feature.%' AND coalesce(OLD.key,'') NOT LIKE 'feature.%' THEN RETURN coalesce(NEW,OLD); END IF;
 IF auth.uid() IS NOT NULL THEN
  IF TG_OP<>'UPDATE' OR NOT public.has_permission('settings.write') THEN RAISE EXCEPTION 'Feature flags: permission denied' USING ERRCODE='42501'; END IF;
  PERFORM public.admin_action_reason(current_setting('app.admin_reason',true));
 END IF;
 IF TG_OP='UPDATE' AND (NEW.label IS DISTINCT FROM OLD.label OR NEW.key IS DISTINCT FROM OLD.key OR NEW.category IS DISTINCT FROM OLD.category OR NEW.is_secret IS DISTINCT FROM OLD.is_secret) THEN RAISE EXCEPTION 'Feature metadata immutable' USING ERRCODE='22023'; END IF;
 RETURN coalesce(NEW,OLD);
END $$;
REVOKE ALL ON FUNCTION public.guard_feature_setting() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_feature_setting BEFORE INSERT OR UPDATE OR DELETE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.guard_feature_setting();
CREATE FUNCTION public.audit_feature_setting() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE oldval text; newval text;
BEGIN
 IF coalesce(NEW.key,OLD.key) NOT LIKE 'feature.%' THEN RETURN NULL; END IF;
 IF TG_OP<>'INSERT' THEN oldval:=OLD.value; END IF;
 IF TG_OP<>'DELETE' THEN newval:=NEW.value; END IF;
 IF TG_OP='UPDATE' AND oldval IS NOT DISTINCT FROM newval THEN RETURN NULL; END IF;
 PERFORM public.audit_write('flag.'||lower(CASE TG_OP WHEN 'UPDATE' THEN 'update' WHEN 'INSERT' THEN 'create' ELSE 'delete' END),'feature',coalesce(NEW.key,OLD.key),
 CASE WHEN oldval IS NULL THEN NULL ELSE jsonb_build_object('enabled',oldval='true') END,
 CASE WHEN newval IS NULL THEN NULL ELSE jsonb_build_object('enabled',newval='true') END,current_setting('app.admin_reason',true),NULL,NULL,CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'db' END);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.audit_feature_setting() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER audit_feature_settings AFTER INSERT OR UPDATE OR DELETE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.audit_feature_setting();
CREATE FUNCTION public.set_feature_flag(p_name text,p_enabled boolean,p_expected boolean,p_reason text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE oldval text; changed boolean;
BEGIN
 IF NOT public.has_permission('settings.write') THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 IF p_name IS NULL OR p_name NOT IN ('gamification','story_drawing','book_scan','expert_review','branching_stories','vocabulary_quiz','multilingual','advanced_authoring','ai_illustrations','child_push','ai_ambience') OR p_enabled IS NULL OR p_expected IS NULL THEN RAISE EXCEPTION 'Unknown feature' USING ERRCODE='22023'; END IF;
 PERFORM set_config('app.admin_reason',public.admin_action_reason(p_reason),true);
 SELECT value INTO oldval FROM public.app_settings WHERE key='feature.'||p_name FOR UPDATE;
 IF oldval IS NULL OR (oldval='true') IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Feature changed; reload' USING ERRCODE='40001'; END IF;
 changed:=(oldval='true') IS DISTINCT FROM p_enabled;
 IF changed THEN UPDATE public.app_settings SET value=p_enabled::text,updated_at=now(),updated_by=auth.uid() WHERE key='feature.'||p_name; END IF;
 PERFORM set_config('app.admin_reason','',true);RETURN changed;
END $$;
REVOKE ALL ON FUNCTION public.set_feature_flag(text,boolean,boolean,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.set_feature_flag(text,boolean,boolean,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_staff_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_entity TEXT := TG_ARGV[0];
  -- Cột tự động / bộ đếm / dữ liệu lớn: không phải "thao tác" của người dùng.
  v_noise TEXT[] := ARRAY['created_at', 'updated_at', 'updated_by', 'embedding', 'play_count', 'like_count',
                          'completion_rate', 'avg_rating', 'rating_count', 'total_duration', 'page_count'];
  v_old JSONB;
  v_new JSONB;
  v_row JSONB;
  v_before JSONB;
  v_after JSONB;
  v_action TEXT;
  v_target TEXT;
  v_staff BOOLEAN;
  v_fields TEXT[];
BEGIN
  IF TG_TABLE_NAME='app_settings' THEN
   IF coalesce(NEW.key,OLD.key) LIKE 'feature.%' THEN RETURN NULL; END IF;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD) - v_noise; END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := to_jsonb(NEW) - v_noise; END IF;
  v_row := COALESCE(v_new, v_old);

  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k), array_agg(k ORDER BY k)
      INTO v_before, v_after, v_fields
      FROM jsonb_object_keys(v_new) AS k
     WHERE (v_old -> k) IS DISTINCT FROM (v_new -> k);
    IF v_fields IS NULL THEN RETURN NULL; END IF;  -- chỉ đổi cột tự động
  ELSE
    v_before := v_old;
    v_after := v_new;
  END IF;

  v_staff := v_uid IS NOT NULL AND public.is_staff();
  v_target := v_row ->> CASE WHEN v_entity = 'setting' THEN 'key' ELSE 'id' END;
  v_action := v_entity || '.' || CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END;

  IF v_entity = 'user' THEN
    -- Vai trò / gói: luôn ghi (cả SQL editor, service role). Hồ sơ người khác do nhân sự sửa:
    -- chỉ ghi TÊN cột (không chép tên bé, tuổi… vào nhật ký).
    IF 'role' = ANY (v_fields) THEN
      v_action := 'user.role_change';
      v_before := jsonb_build_object('role', v_old -> 'role');
      v_after := jsonb_build_object('role', v_new -> 'role');
    ELSIF 'current_plan' = ANY (v_fields) THEN
      v_action := 'user.plan_change';
      v_before := jsonb_build_object('current_plan', v_old -> 'current_plan');
      v_after := jsonb_build_object('current_plan', v_new -> 'current_plan');
    ELSIF v_staff AND v_target IS DISTINCT FROM v_uid::TEXT THEN
      v_action := 'user.update';
      v_before := NULL;
      v_after := jsonb_build_object('fields', to_jsonb(v_fields));
    ELSE
      RETURN NULL;
    END IF;
  ELSE
    IF NOT v_staff THEN RETURN NULL; END IF;

    IF v_entity = 'story' THEN
      -- Chỉ truyện nền tảng hoặc truyện của người khác (nhân sự sửa truyện riêng của mình: bỏ qua).
      IF NOT (nullif(current_setting('app.admin_reason',true),'') IS NOT NULL AND (TG_OP='DELETE' OR (TG_OP='UPDATE' AND ('deleted_at'=ANY(v_fields) OR ('is_published'=ANY(v_fields) AND NOT (v_new->>'is_published')::boolean))))) AND NOT (COALESCE((v_new ->> 'is_platform_content')::BOOLEAN, false)
              OR COALESCE((v_old ->> 'is_platform_content')::BOOLEAN, false)
              OR (v_row ->> 'user_id') IS DISTINCT FROM v_uid::TEXT) THEN
        RETURN NULL;
      END IF;
      IF TG_OP = 'UPDATE' AND 'deleted_at' = ANY (v_fields) THEN
        v_action := CASE WHEN v_new ->> 'deleted_at' IS NULL THEN 'story.restore' ELSE 'story.trash' END;
      ELSIF TG_OP='UPDATE' AND 'is_published'=ANY(v_fields) AND (v_old->>'is_published')::boolean AND NOT (v_new->>'is_published')::boolean THEN v_action:='story.unpublish';
      END IF;
      IF TG_OP <> 'UPDATE' THEN
        v_row := jsonb_build_object(
          'title', v_row -> 'title', 'status', v_row -> 'status', 'category', v_row -> 'category',
          'is_published', v_row -> 'is_published', 'is_platform_content', v_row -> 'is_platform_content',
          'user_id', v_row -> 'user_id');
        IF TG_OP = 'INSERT' THEN v_after := v_row; ELSE v_before := v_row; END IF;
      END IF;
    ELSIF v_entity = 'setting' THEN
      -- API key: không bao giờ chép giá trị vào nhật ký.
      -- Như RLS 019: is_secret NULL được coi là bí mật.
      IF (v_old IS NOT NULL AND (v_old ->> 'is_secret')::BOOLEAN IS NOT FALSE)
         OR (v_new IS NOT NULL AND (v_new ->> 'is_secret')::BOOLEAN IS NOT FALSE) THEN
        v_action := replace(v_action, 'setting.', 'secret.');
        IF v_before ? 'value' THEN
          v_before := jsonb_set(v_before, '{value}', to_jsonb(CASE WHEN v_before ->> 'value' = '' THEN '(trống)' ELSE '[đã ẩn]' END));
        END IF;
        IF v_after ? 'value' THEN
          v_after := jsonb_set(v_after, '{value}', to_jsonb(CASE WHEN v_after ->> 'value' = '' THEN '(trống)' ELSE '[đã ẩn]' END));
        END IF;
      END IF;
    ELSIF v_entity = 'template' THEN
      -- Nội dung trang mẫu có thể rất dài → chỉ ghi số trang.
      IF v_before ? 'pages' THEN
        v_before := jsonb_set(v_before, '{pages}', to_jsonb(COALESCE(jsonb_array_length(NULLIF(v_before -> 'pages', 'null'::JSONB)), 0)));
      END IF;
      IF v_after ? 'pages' THEN
        v_after := jsonb_set(v_after, '{pages}', to_jsonb(COALESCE(jsonb_array_length(NULLIF(v_after -> 'pages', 'null'::JSONB)), 0)));
      END IF;
    END IF;
  END IF;

  PERFORM public.audit_write(v_action, v_entity, v_target, v_before, v_after, nullif(current_setting('app.admin_reason',true),''), NULL, NULL,
                             CASE WHEN v_uid IS NULL THEN 'system' ELSE 'db' END);
  RETURN NULL;
END;
$$;
CREATE POLICY t06_feature_gate ON public.badge_definitions AS RESTRICTIVE FOR ALL TO anon,authenticated USING(public.feature_enabled('gamification')) WITH CHECK(public.feature_enabled('gamification'));
CREATE POLICY t06_feature_gate ON public.user_badges AS RESTRICTIVE FOR ALL TO anon,authenticated USING(public.feature_enabled('gamification')) WITH CHECK(public.feature_enabled('gamification'));
CREATE POLICY t06_feature_gate ON public.daily_challenges AS RESTRICTIVE FOR ALL TO anon,authenticated USING(public.feature_enabled('gamification')) WITH CHECK(public.feature_enabled('gamification'));
CREATE POLICY t06_feature_gate ON public.user_challenge_progress AS RESTRICTIVE FOR ALL TO anon,authenticated USING(public.feature_enabled('gamification')) WITH CHECK(public.feature_enabled('gamification'));
CREATE POLICY t06_push_select ON public.push_subscriptions AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(public.feature_enabled('child_push'));
CREATE POLICY t06_push_insert ON public.push_subscriptions AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK(public.feature_enabled('child_push'));
CREATE POLICY t06_push_update ON public.push_subscriptions AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING(public.feature_enabled('child_push')) WITH CHECK(public.feature_enabled('child_push'));

-- Cleanup must remain available even with SELECT/INSERT/UPDATE push gates off.
CREATE FUNCTION public.unsubscribe_push(p_endpoint text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
 IF p_endpoint IS NULL OR length(p_endpoint) NOT BETWEEN 1 AND 2048 THEN RAISE EXCEPTION 'Invalid endpoint' USING ERRCODE='22023'; END IF;
 DELETE FROM public.push_subscriptions WHERE user_id=auth.uid() AND endpoint=p_endpoint;
END $$;
REVOKE ALL ON FUNCTION public.unsubscribe_push(text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.unsubscribe_push(text) TO authenticated;
