-- ============================================================
-- Migration 019 · Admin v2 A-02 — phân quyền theo quyền hạn (RBAC)
--
--   1. Danh mục vai trò (admin_roles), quyền hạn (admin_permissions) và
--      bảng nối (admin_role_permissions). Chỉ migration / service role ghi.
--   2. profiles.role nhận thêm: ops, editor, moderator, support, analyst.
--   3. has_permission('stories.write') — dùng chung cho RLS và API;
--      my_admin_permissions() cho guard /admin.
--   4. Chuyển vai trò cũ: super_admin = mọi quyền; admin = như hiện nay
--      (mọi quyền trừ đổi vai trò). is_admin() giữ nguyên nghĩa cũ
--      (admin/super_admin) trong giai đoạn chuyển — mọi policy cũ vẫn chạy.
--   5. Policy mới cho vai trò hẹp: chỉ đúng phần việc của mình.
--      Biên tập chỉ đụng truyện nền tảng; không vai trò mới nào đọc được
--      API key; chỉ người có roles.manage (super_admin) đổi vai trò.
--
-- Đồng bộ với src/lib/admin-permissions.ts (test tests/db/admin-rbac.test.ts
-- so khớp hai bên).
-- ============================================================

-- 1. Danh mục ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_roles (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS public.admin_permissions (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.admin_role_permissions (
  role TEXT NOT NULL REFERENCES public.admin_roles(key) ON DELETE CASCADE,
  permission TEXT NOT NULL REFERENCES public.admin_permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role, permission)
);

ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_role_permissions ENABLE ROW LEVEL SECURITY;

-- Nhãn vai trò / quyền không nhạy cảm: người đã đăng nhập đọc được (màn đổi vai trò).
-- Không có policy ghi → chỉ migration / service role sửa được danh mục.
DROP POLICY IF EXISTS "Signed-in users read admin roles" ON public.admin_roles;
CREATE POLICY "Signed-in users read admin roles" ON public.admin_roles
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Signed-in users read admin permissions" ON public.admin_permissions;
CREATE POLICY "Signed-in users read admin permissions" ON public.admin_permissions
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Signed-in users read role permissions" ON public.admin_role_permissions;
CREATE POLICY "Signed-in users read role permissions" ON public.admin_role_permissions
  FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.admin_roles, public.admin_permissions, public.admin_role_permissions FROM anon, authenticated;

INSERT INTO public.admin_roles (key, label, description, sort_order) VALUES
  ('super_admin', 'Super admin', 'Tất cả, quản lý vai trò, đặt API key', 1),
  ('admin',       'Admin (đầy đủ)', 'Vai trò cũ: mọi việc trừ đổi vai trò', 2),
  ('ops',         'Vận hành', 'Cấu hình không bí mật, giọng mặc định, thông báo, số liệu', 3),
  ('editor',      'Biên tập', 'Kho truyện nền tảng, danh mục, mẫu truyện', 4),
  ('moderator',   'Kiểm duyệt', 'Hàng chờ kiểm duyệt, xem kho truyện nền tảng', 5),
  ('support',     'Hỗ trợ', 'Tra cứu tài khoản gia đình', 6),
  ('analyst',     'Phân tích', 'Chỉ xem số liệu tổng hợp', 7)
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

INSERT INTO public.admin_permissions (key, label) VALUES
  ('dashboard.view',     'Xem trang tổng quan'),
  ('stories.read',       'Xem kho truyện nền tảng'),
  ('stories.write',      'Tạo / sửa / xuất bản / xoá truyện nền tảng'),
  ('categories.manage',  'Quản lý danh mục'),
  ('templates.manage',   'Quản lý mẫu truyện'),
  ('users.read',         'Xem danh sách tài khoản'),
  ('roles.manage',       'Đổi vai trò người dùng'),
  ('analytics.view',     'Xem số liệu'),
  ('settings.read',      'Xem cài đặt hệ thống'),
  ('settings.write',     'Sửa cài đặt không bí mật'),
  ('secrets.manage',     'Xem / đặt API key hệ thống'),
  ('voices.manage',      'Quản lý giọng mặc định'),
  ('moderation.manage',  'Xử lý hàng chờ kiểm duyệt'),
  ('notifications.send', 'Gửi thông báo đẩy')
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label;

-- super_admin: mọi quyền (kể cả quyền thêm sau này — mỗi migration thêm quyền phải cấp cho super_admin).
INSERT INTO public.admin_role_permissions (role, permission)
  SELECT 'super_admin', key FROM public.admin_permissions
ON CONFLICT DO NOTHING;
-- admin (cũ): giữ nguyên những gì đang làm được — mọi quyền trừ đổi vai trò.
INSERT INTO public.admin_role_permissions (role, permission)
  SELECT 'admin', key FROM public.admin_permissions WHERE key <> 'roles.manage'
ON CONFLICT DO NOTHING;
INSERT INTO public.admin_role_permissions (role, permission) VALUES
  ('ops', 'dashboard.view'), ('ops', 'analytics.view'), ('ops', 'settings.read'), ('ops', 'settings.write'),
  ('ops', 'voices.manage'), ('ops', 'notifications.send'),
  ('editor', 'dashboard.view'), ('editor', 'stories.read'), ('editor', 'stories.write'),
  ('editor', 'categories.manage'), ('editor', 'templates.manage'),
  ('moderator', 'dashboard.view'), ('moderator', 'stories.read'), ('moderator', 'moderation.manage'),
  ('support', 'dashboard.view'), ('support', 'users.read'),
  ('analyst', 'dashboard.view'), ('analyst', 'analytics.view')
ON CONFLICT DO NOTHING;

-- 2. profiles.role -----------------------------------------------
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('user', 'super_admin', 'admin', 'ops', 'editor', 'moderator', 'support', 'analyst'));

-- 3. Hàm quyền ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_permission(p_permission TEXT)
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
     WHERE p.id = auth.uid() AND rp.permission = p_permission
  );
$$;

CREATE OR REPLACE FUNCTION public.my_admin_permissions()
RETURNS TEXT[]
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(rp.permission ORDER BY rp.permission), '{}'::TEXT[])
    FROM public.profiles p
    JOIN public.admin_role_permissions rp ON rp.role = p.role
   WHERE p.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.has_permission(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_admin_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_admin_permissions() TO authenticated, service_role;

-- Số liệu tổng hợp cho người có analytics.view — không trả về dòng dữ liệu của gia đình.
CREATE OR REPLACE FUNCTION public.admin_usage_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  IF NOT public.has_permission('analytics.view') THEN
    RAISE EXCEPTION 'Không có quyền xem số liệu' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'total_sessions', (SELECT count(*) FROM public.play_sessions),
    'recent_signups', (SELECT count(*) FROM public.profiles WHERE created_at >= now() - interval '7 days')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_usage_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_usage_summary() TO authenticated, service_role;

-- 4. Đổi vai trò: chỉ roles.manage, không tự đổi vai trò của chính mình ----
CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  caller_role TEXT;
BEGIN
  -- auth.uid() NULL = service role, SQL editor hoặc trigger hệ thống
  -- (vd: tạo profile khi đăng ký). Anon không ghi được profiles nhờ RLS.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.role INTO caller_role FROM public.profiles p WHERE p.id = auth.uid();

  IF TG_OP = 'INSERT' THEN
    IF NOT public.has_permission('roles.manage') THEN
      NEW.role := 'user';
    END IF;
    IF COALESCE(caller_role, '') NOT IN ('admin', 'super_admin') THEN
      NEW.current_plan := 'free';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT public.has_permission('roles.manage') THEN
      RAISE EXCEPTION 'Chỉ super_admin được đổi vai trò người dùng'
        USING ERRCODE = '42501';
    END IF;
    IF OLD.id = auth.uid() THEN
      RAISE EXCEPTION 'Không tự đổi vai trò của chính mình'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.current_plan IS DISTINCT FROM OLD.current_plan
     AND COALESCE(caller_role, '') NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Chỉ admin được đổi gói cước'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- 5. Policy cho vai trò hẹp (vai trò cũ vẫn đi qua các policy is_admin()) ----

-- Kho truyện nền tảng: biên tập đọc / ghi, kiểm duyệt + phân tích chỉ đọc.
-- Truyện riêng của gia đình (is_platform_content = false) không nằm trong phạm vi.
DROP POLICY IF EXISTS "Staff read platform stories" ON public.stories;
CREATE POLICY "Staff read platform stories" ON public.stories
  FOR SELECT USING (
    is_platform_content = true
    AND (public.has_permission('stories.read') OR public.has_permission('analytics.view'))
  );
DROP POLICY IF EXISTS "Editors insert platform stories" ON public.stories;
CREATE POLICY "Editors insert platform stories" ON public.stories
  FOR INSERT WITH CHECK (is_platform_content = true AND public.has_permission('stories.write'));
DROP POLICY IF EXISTS "Editors update platform stories" ON public.stories;
CREATE POLICY "Editors update platform stories" ON public.stories
  FOR UPDATE
  USING (is_platform_content = true AND public.has_permission('stories.write'))
  WITH CHECK (is_platform_content = true AND public.has_permission('stories.write'));
DROP POLICY IF EXISTS "Editors delete platform stories" ON public.stories;
CREATE POLICY "Editors delete platform stories" ON public.stories
  FOR DELETE USING (is_platform_content = true AND public.has_permission('stories.write'));

DROP POLICY IF EXISTS "Staff read platform story pages" ON public.story_pages;
CREATE POLICY "Staff read platform story pages" ON public.story_pages
  FOR SELECT USING (
    public.has_permission('stories.read')
    AND EXISTS (SELECT 1 FROM public.stories s WHERE s.id = story_id AND s.is_platform_content = true)
  );
DROP POLICY IF EXISTS "Editors write platform story pages" ON public.story_pages;
CREATE POLICY "Editors write platform story pages" ON public.story_pages
  FOR ALL
  USING (
    public.has_permission('stories.write')
    AND EXISTS (SELECT 1 FROM public.stories s WHERE s.id = story_id AND s.is_platform_content = true)
  )
  WITH CHECK (
    public.has_permission('stories.write')
    AND EXISTS (SELECT 1 FROM public.stories s WHERE s.id = story_id AND s.is_platform_content = true)
  );

DROP POLICY IF EXISTS "Staff manage categories" ON public.story_categories;
CREATE POLICY "Staff manage categories" ON public.story_categories
  FOR ALL USING (public.has_permission('categories.manage'))
  WITH CHECK (public.has_permission('categories.manage'));

DROP POLICY IF EXISTS "Staff manage templates" ON public.story_templates;
CREATE POLICY "Staff manage templates" ON public.story_templates
  FOR ALL USING (public.has_permission('templates.manage'))
  WITH CHECK (public.has_permission('templates.manage'));

DROP POLICY IF EXISTS "Staff manage default voices" ON public.default_voices;
CREATE POLICY "Staff manage default voices" ON public.default_voices
  FOR ALL USING (public.has_permission('voices.manage'))
  WITH CHECK (public.has_permission('voices.manage'));

-- Hỗ trợ: xem danh sách tài khoản (không có quyền sửa).
DROP POLICY IF EXISTS "Staff read profiles" ON public.profiles;
CREATE POLICY "Staff read profiles" ON public.profiles
  FOR SELECT USING (public.has_permission('users.read'));

-- Cài đặt hệ thống: dòng bí mật chỉ cho secrets.manage; dòng thường cho settings.write.
-- (Dòng không bí mật vẫn đọc công khai như trước.)
DROP POLICY IF EXISTS "Admin can read all settings" ON public.app_settings;
DROP POLICY IF EXISTS "Admin can update settings" ON public.app_settings;
DROP POLICY IF EXISTS "Admin can insert settings" ON public.app_settings;
DROP POLICY IF EXISTS "Staff read secret settings" ON public.app_settings;
CREATE POLICY "Staff read secret settings" ON public.app_settings
  FOR SELECT USING (is_secret IS NOT FALSE AND public.has_permission('secrets.manage'));
DROP POLICY IF EXISTS "Staff update settings" ON public.app_settings;
CREATE POLICY "Staff update settings" ON public.app_settings
  FOR UPDATE
  USING (public.has_permission(CASE WHEN is_secret IS NOT FALSE THEN 'secrets.manage' ELSE 'settings.write' END))
  WITH CHECK (public.has_permission(CASE WHEN is_secret IS NOT FALSE THEN 'secrets.manage' ELSE 'settings.write' END));
DROP POLICY IF EXISTS "Staff insert settings" ON public.app_settings;
CREATE POLICY "Staff insert settings" ON public.app_settings
  FOR INSERT
  WITH CHECK (public.has_permission(CASE WHEN is_secret IS NOT FALSE THEN 'secrets.manage' ELSE 'settings.write' END));

-- 6. Cờ "truyện nền tảng" chỉ người có stories.write bật / tắt ------------
-- Trước đây policy "Users can manage own stories" cho phép gia đình tự gắn
-- is_platform_content = true lên truyện của mình (→ biên tập sửa được truyện
-- riêng, truyện lọt vào kho nền tảng). Service role / SQL editor không bị chặn.
CREATE OR REPLACE FUNCTION public.guard_platform_content_flag()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.is_platform_content)
     OR (TG_OP = 'UPDATE' AND NEW.is_platform_content IS DISTINCT FROM OLD.is_platform_content) THEN
    IF NOT public.has_permission('stories.write') THEN
      RAISE EXCEPTION 'Chỉ biên tập / admin được đánh dấu truyện nền tảng'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stories_guard_platform_content ON public.stories;
CREATE TRIGGER stories_guard_platform_content
  BEFORE INSERT OR UPDATE OF is_platform_content ON public.stories
  FOR EACH ROW EXECUTE FUNCTION public.guard_platform_content_flag();
