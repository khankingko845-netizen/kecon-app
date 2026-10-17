-- ============================================================
-- Migration 020 · Admin v2 A-03 — nhật ký thao tác quản trị (audit log)
--
--   1. Quyền audit.read (super_admin, admin) để xem màn "Nhật ký".
--   2. admin_audit_log: CHỈ THÊM. Không ai sửa / xoá được — kể cả
--      service role (bị thu quyền) và chủ bảng (trigger chặn UPDATE /
--      DELETE / TRUNCATE). Không FK tới auth.users: nhật ký còn nguyên khi
--      tài khoản bị xoá (lưu sẵn email + vai trò lúc thao tác).
--   3. Ghi tự động bằng trigger audit_<bảng> trên các bảng nhạy cảm khi
--      nhân sự thao tác (kể cả gọi PostgREST trực tiếp, không qua UI):
--      profiles (đổi vai trò / gói — ghi cả khi đổi bằng SQL editor),
--      app_settings (API key được che giá trị), stories (truyện nền tảng
--      hoặc truyện của người khác), story_categories, story_templates,
--      default_voices.
--   4. log_admin_action(): API route /api/admin/* (và route cần quyền) ghi
--      thao tác không đi qua bảng (thử kết nối, gửi thông báo…). Người ghi
--      luôn là auth.uid() — không giả danh người khác được.
-- ============================================================

-- 1. Quyền ---------------------------------------------------------
INSERT INTO public.admin_permissions (key, label) VALUES
  ('audit.read', 'Xem nhật ký thao tác')
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label;
INSERT INTO public.admin_role_permissions (role, permission) VALUES
  ('super_admin', 'audit.read'), ('admin', 'audit.read')
ON CONFLICT DO NOTHING;

-- 2. Bảng nhật ký -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id UUID,
  actor_email TEXT,
  actor_role TEXT,
  action TEXT NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),
  target_type TEXT,
  target_id TEXT,
  before JSONB,
  after JSONB,
  reason TEXT CHECK (char_length(reason) <= 500),
  ip TEXT,
  user_agent TEXT,
  -- db = trigger trên bảng; api = log_admin_action(); system = SQL editor / service role
  source TEXT NOT NULL DEFAULT 'db' CHECK (source IN ('db', 'api', 'system'))
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON public.admin_audit_log (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON public.admin_audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON public.admin_audit_log (action, created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read audit log" ON public.admin_audit_log;
CREATE POLICY "Staff read audit log" ON public.admin_audit_log
  FOR SELECT TO authenticated USING (public.has_permission('audit.read'));
-- Không có policy ghi; thu luôn quyền ghi ở mức bảng (service role bỏ qua RLS nhưng không bỏ qua GRANT).
REVOKE ALL ON public.admin_audit_log FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.admin_audit_log FROM authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_audit_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Nhật ký thao tác chỉ được thêm — không sửa / xoá được'
    USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS admin_audit_log_no_update_delete ON public.admin_audit_log;
CREATE TRIGGER admin_audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.admin_audit_log_append_only();
DROP TRIGGER IF EXISTS admin_audit_log_no_truncate ON public.admin_audit_log;
CREATE TRIGGER admin_audit_log_no_truncate
  BEFORE TRUNCATE ON public.admin_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.admin_audit_log_append_only();

-- 3. Hàm ghi -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
      JOIN public.admin_role_permissions rp ON rp.role = p.role
     WHERE p.id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated, service_role;

-- Header của request PostgREST (IP, trình duyệt) — NULL khi không có.
CREATE OR REPLACE FUNCTION public.audit_request_header(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  h JSONB;
BEGIN
  BEGIN
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  RETURN nullif(btrim(h ->> p_name), '');
END;
$$;
REVOKE ALL ON FUNCTION public.audit_request_header(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.audit_write(
  p_action TEXT, p_target_type TEXT, p_target_id TEXT, p_before JSONB, p_after JSONB,
  p_reason TEXT, p_ip TEXT, p_user_agent TEXT, p_source TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id BIGINT;
BEGIN
  INSERT INTO public.admin_audit_log
    (actor_id, actor_email, actor_role, action, target_type, target_id, before, after, reason, ip, user_agent, source)
  VALUES (
    v_uid,
    (SELECT u.email FROM auth.users u WHERE u.id = v_uid),
    (SELECT p.role FROM public.profiles p WHERE p.id = v_uid),
    p_action, p_target_type, p_target_id, p_before, p_after,
    left(nullif(btrim(p_reason), ''), 500),
    left(COALESCE(
      nullif(btrim(p_ip), ''),
      public.audit_request_header('cf-connecting-ip'),
      public.audit_request_header('x-real-ip'),
      nullif(btrim(split_part(public.audit_request_header('x-forwarded-for'), ',', 1)), '')
    ), 64),
    left(COALESCE(nullif(btrim(p_user_agent), ''), public.audit_request_header('user-agent')), 300),
    p_source
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_write(TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- Cho API route: chỉ nhân sự, người ghi = auth.uid().
CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_action TEXT,
  p_target_type TEXT DEFAULT NULL,
  p_target_id TEXT DEFAULT NULL,
  p_before JSONB DEFAULT NULL,
  p_after JSONB DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_ip TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff() THEN
    RAISE EXCEPTION 'Chỉ nhân sự quản trị được ghi nhật ký' USING ERRCODE = '42501';
  END IF;
  RETURN public.audit_write(p_action, p_target_type, p_target_id, p_before, p_after, p_reason, p_ip, p_user_agent, 'api');
END;
$$;
REVOKE ALL ON FUNCTION public.log_admin_action(TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_admin_action(TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT) TO authenticated;

-- 4. Trigger ghi tự động -------------------------------------------
-- TG_ARGV[0] = loại đối tượng: user | setting | story | category | template | default_voice
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
      IF NOT (COALESCE((v_new ->> 'is_platform_content')::BOOLEAN, false)
              OR COALESCE((v_old ->> 'is_platform_content')::BOOLEAN, false)
              OR (v_row ->> 'user_id') IS DISTINCT FROM v_uid::TEXT) THEN
        RETURN NULL;
      END IF;
      IF TG_OP = 'UPDATE' AND 'deleted_at' = ANY (v_fields) THEN
        v_action := CASE WHEN v_new ->> 'deleted_at' IS NULL THEN 'story.restore' ELSE 'story.trash' END;
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

  PERFORM public.audit_write(v_action, v_entity, v_target, v_before, v_after, NULL, NULL, NULL,
                             CASE WHEN v_uid IS NULL THEN 'system' ELSE 'db' END);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_staff_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_profiles ON public.profiles;
CREATE TRIGGER audit_profiles
  AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_staff_change('user');
DROP TRIGGER IF EXISTS audit_app_settings ON public.app_settings;
CREATE TRIGGER audit_app_settings
  AFTER INSERT OR UPDATE OR DELETE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_staff_change('setting');
DROP TRIGGER IF EXISTS audit_stories ON public.stories;
CREATE TRIGGER audit_stories
  AFTER INSERT OR UPDATE OR DELETE ON public.stories
  FOR EACH ROW EXECUTE FUNCTION public.audit_staff_change('story');
DROP TRIGGER IF EXISTS audit_story_categories ON public.story_categories;
CREATE TRIGGER audit_story_categories
  AFTER INSERT OR UPDATE OR DELETE ON public.story_categories
  FOR EACH ROW EXECUTE FUNCTION public.audit_staff_change('category');
DROP TRIGGER IF EXISTS audit_story_templates ON public.story_templates;
CREATE TRIGGER audit_story_templates
  AFTER INSERT OR UPDATE OR DELETE ON public.story_templates
  FOR EACH ROW EXECUTE FUNCTION public.audit_staff_change('template');
DROP TRIGGER IF EXISTS audit_default_voices ON public.default_voices;
CREATE TRIGGER audit_default_voices
  AFTER INSERT OR UPDATE OR DELETE ON public.default_voices
  FOR EACH ROW EXECUTE FUNCTION public.audit_staff_change('default_voice');
