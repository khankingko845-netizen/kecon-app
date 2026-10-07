-- A-15: confirmations with mandatory audit reason; invoker RPC retains RLS/MFA.
CREATE FUNCTION public.admin_action_reason(p_reason text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 10 AND 500 THEN
  RAISE EXCEPTION 'Lý do cần 10–500 ký tự' USING ERRCODE='22023';
 END IF;
 RETURN btrim(p_reason);
END; $$;
REVOKE ALL ON FUNCTION public.admin_action_reason(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_action_reason(text) TO authenticated,service_role;

CREATE FUNCTION public.require_admin_action_reason() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_old jsonb:=to_jsonb(OLD); v_new jsonb; v_require boolean:=false;
BEGIN
 IF auth.uid() IS NULL THEN RETURN COALESCE(NEW,OLD); END IF;
 IF TG_OP='UPDATE' THEN v_new:=to_jsonb(NEW); END IF;
 IF TG_TABLE_NAME='profiles' THEN
  v_require:=public.has_permission('roles.manage') AND auth.uid()::text<>v_new->>'id' AND v_new->>'role' IN ('user','super_admin','admin','ops','editor','moderator','support','analyst') AND v_old->>'role' IS DISTINCT FROM v_new->>'role';
 ELSIF TG_TABLE_NAME='stories' THEN
  v_require:=public.is_staff() AND ((v_old->>'is_platform_content')::boolean OR (v_old->>'user_id') IS DISTINCT FROM auth.uid()::text)
   AND (TG_OP='DELETE' OR (v_old->>'deleted_at' IS NULL AND v_new->>'deleted_at' IS NOT NULL)
    OR ((v_old->>'is_published')::boolean AND NOT (v_new->>'is_published')::boolean));
 ELSE v_require:=TG_OP='DELETE'; END IF;
 IF v_require THEN PERFORM public.admin_action_reason(current_setting('app.admin_reason',true)); END IF;
 RETURN COALESCE(NEW,OLD);
END; $$;
REVOKE ALL ON FUNCTION public.require_admin_action_reason() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER confirmed_role BEFORE UPDATE OF role ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.require_admin_action_reason();
CREATE TRIGGER confirmed_story BEFORE UPDATE OR DELETE ON public.stories FOR EACH ROW EXECUTE FUNCTION public.require_admin_action_reason();
CREATE TRIGGER confirmed_category BEFORE DELETE ON public.story_categories FOR EACH ROW EXECUTE FUNCTION public.require_admin_action_reason();
CREATE TRIGGER confirmed_template BEFORE DELETE ON public.story_templates FOR EACH ROW EXECUTE FUNCTION public.require_admin_action_reason();
CREATE TRIGGER confirmed_default_voice BEFORE DELETE ON public.default_voices FOR EACH ROW EXECUTE FUNCTION public.require_admin_action_reason();

CREATE FUNCTION public.admin_confirmed_action(p_action text,p_ids text[],p_reason text,p_role text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_permission text; v_reason text; v_count integer; v_expected integer;
BEGIN
 v_permission:=CASE p_action WHEN 'role.change' THEN 'roles.manage' WHEN 'story.trash' THEN 'stories.write'
  WHEN 'story.unpublish' THEN 'stories.write' WHEN 'category.delete' THEN 'categories.manage'
  WHEN 'template.delete' THEN 'templates.manage' WHEN 'default_voice.delete' THEN 'voices.manage' END;
 IF v_permission IS NULL THEN RAISE EXCEPTION 'Thao tác không hợp lệ' USING ERRCODE='22023'; END IF;
 IF NOT public.has_permission(v_permission) THEN RAISE EXCEPTION 'Không có quyền hoặc phiên quản trị đã khoá' USING ERRCODE='42501'; END IF;
 v_reason:=public.admin_action_reason(p_reason);
 v_expected:=cardinality(p_ids);
 IF v_expected IS NULL OR v_expected NOT BETWEEN 1 AND 100 OR EXISTS(SELECT 1 FROM unnest(p_ids) x WHERE x IS NULL)
  OR (SELECT count(DISTINCT x) FROM unnest(p_ids) x)<>v_expected THEN
  RAISE EXCEPTION 'Chọn 1–100 đối tượng khác nhau' USING ERRCODE='22023'; END IF;
 PERFORM set_config('app.admin_reason',v_reason,true);
 CASE p_action
 WHEN 'role.change' THEN
  IF v_expected<>1 OR p_role IS NULL OR p_role NOT IN ('user','super_admin','admin','ops','editor','moderator','support','analyst') OR auth.uid()::text=ANY(p_ids) THEN
   RAISE EXCEPTION 'Vai trò hoặc đối tượng không hợp lệ' USING ERRCODE='22023'; END IF;
  UPDATE public.profiles SET role=p_role WHERE id=ANY(p_ids::uuid[]) AND role IS DISTINCT FROM p_role;
 WHEN 'story.trash' THEN UPDATE public.stories SET deleted_at=now(),is_published=false WHERE id=ANY(p_ids::uuid[]) AND deleted_at IS NULL;
 WHEN 'story.unpublish' THEN UPDATE public.stories SET is_published=false,status='draft' WHERE id=ANY(p_ids::uuid[]) AND is_published;
 WHEN 'category.delete' THEN DELETE FROM public.story_categories WHERE id=ANY(p_ids);
 WHEN 'template.delete' THEN DELETE FROM public.story_templates WHERE id=ANY(p_ids::uuid[]);
 WHEN 'default_voice.delete' THEN DELETE FROM public.default_voices WHERE id=ANY(p_ids::uuid[]);
 END CASE;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>v_expected THEN RAISE EXCEPTION 'Đối tượng đã thay đổi hoặc không có quyền; tải lại để thử lại' USING ERRCODE='40001'; END IF;
 PERFORM set_config('app.admin_reason','',true);
 RETURN v_count;
END; $$;
REVOKE ALL ON FUNCTION public.admin_confirmed_action(text,text[],text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_confirmed_action(text,text[],text,text) TO authenticated;

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

CREATE OR REPLACE FUNCTION public.set_system_secret(p_key TEXT, p_value TEXT, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  -- Cắt khoảng trắng / tab / xuống dòng hai đầu (hay dính khi dán key).
  v_value TEXT := regexp_replace(COALESCE(p_value, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_old public.app_secrets%ROWTYPE;
  v_id UUID;
  v_last4 TEXT;
  v_action TEXT;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- Nhân sự có secrets.manage; hoặc server / SQL editor (không có người dùng).
  IF v_uid IS NULL THEN
    IF COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
      RAISE EXCEPTION 'Chỉ Super admin / Admin đặt được API key' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.has_permission('secrets.manage') THEN
    RAISE EXCEPTION 'Chỉ Super admin / Admin đặt được API key' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.app_settings s WHERE s.key = p_key AND s.is_secret) THEN
    RAISE EXCEPTION 'Không có API key "%"', p_key USING ERRCODE = '22023';
  END IF;
  IF char_length(v_value) > 4096 THEN
    RAISE EXCEPTION 'API key quá dài (tối đa 4096 ký tự)' USING ERRCODE = '22001';
  END IF;
  IF v_value ~ '[[:space:][:cntrl:]]' THEN
    RAISE EXCEPTION 'API key không được chứa khoảng trắng / xuống dòng' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old FROM public.app_secrets k WHERE k.key = p_key FOR UPDATE;

  IF v_value = '' THEN
    IF v_uid IS NOT NULL THEN p_reason:=public.admin_action_reason(p_reason); END IF;
    IF v_old.key IS NULL THEN
      RETURN jsonb_build_object('key', p_key, 'is_set', false, 'last4', NULL, 'updated_at', NULL);
    END IF;
    DELETE FROM public.app_secrets k WHERE k.key = p_key;  -- trigger xoá bản trong Vault
    v_action := 'secret.delete';
  ELSE
    v_last4 := public.secret_last4(v_value);
    v_id := public.secret_vault_put(p_key, v_value, v_old.vault_secret_id);
    INSERT INTO public.app_secrets (key, vault_secret_id, last4, updated_at, updated_by)
    VALUES (p_key, v_id, v_last4, v_now, v_uid)
    ON CONFLICT (key) DO UPDATE
      SET vault_secret_id = EXCLUDED.vault_secret_id, last4 = EXCLUDED.last4,
          updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by;
    v_action := CASE WHEN v_old.key IS NULL THEN 'secret.create' ELSE 'secret.update' END;
  END IF;

  PERFORM public.audit_write(v_action, 'setting', p_key,
    jsonb_build_object('is_set', v_old.key IS NOT NULL, 'last4', '…' || v_old.last4),
    jsonb_build_object('is_set', v_value <> '', 'last4', '…' || v_last4),
    p_reason, NULL, NULL, CASE WHEN v_uid IS NULL THEN 'system' ELSE 'db' END);

  RETURN jsonb_build_object(
    'key', p_key,
    'is_set', v_value <> '',
    'last4', v_last4,
    'updated_at', CASE WHEN v_value <> '' THEN v_now END);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_provider_key(p_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_old public.provider_api_keys;
BEGIN
  PERFORM public.provider_key_require_manage('Chỉ Super admin / Admin xoá được API key');
  p_reason:=public.admin_action_reason(p_reason);
  DELETE FROM public.provider_api_keys k WHERE k.id = p_id RETURNING * INTO v_old;  -- trigger xoá bản trong Vault
  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy key' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.audit_write('provider_key.delete', 'provider_key', p_id::TEXT,
    public.provider_key_snapshot(v_old), NULL,
    p_reason, NULL, NULL, CASE WHEN v_uid IS NULL THEN 'system' ELSE 'db' END);
  RETURN jsonb_build_object('id', p_id, 'deleted', true);
END;
$$;
