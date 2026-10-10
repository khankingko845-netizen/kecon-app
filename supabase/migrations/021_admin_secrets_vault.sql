-- ============================================================
-- Migration 021 · Admin v2 A-04 — API key hệ thống vào Supabase Vault
--
--   1. API key không còn nằm dạng chữ thường trong app_settings.value:
--      giá trị mã hoá trong vault.secrets, app_secrets chỉ giữ id + 4 ký tự
--      cuối. CHECK chặn ghi key thật vào app_settings (kể cả SQL editor).
--   2. API CHỈ-GHI: set_system_secret() đặt / đổi / xoá key (quyền
--      secrets.manage, ghi nhật ký secret.create / update / delete — không
--      bao giờ chép key). list_system_secrets() chỉ trả "đã đặt" + …abcd.
--   3. get_system_secret(): CHỈ service role (server) đọc được key để gọi
--      nhà cung cấp AI; anon / authenticated không execute được.
--   4. Key đã lưu dạng chữ thường trước đây được chuyển vào Vault.
--   5. Sửa FK app_settings.updated_by → ON DELETE SET NULL (trước đây xoá
--      tài khoản từng lưu cài đặt bị lỗi).
-- ============================================================

-- 0. Vault ---------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('vault.create_secret(text, text, text, uuid)') IS NULL THEN
    CREATE EXTENSION IF NOT EXISTS supabase_vault;
  END IF;
  IF to_regprocedure('vault.create_secret(text, text, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Migration 021 cần Supabase Vault (extension supabase_vault)';
  END IF;
END $$;

-- 1. app_settings: FK + cờ bí mật bắt buộc --------------------------
ALTER TABLE public.app_settings DROP CONSTRAINT IF EXISTS app_settings_updated_by_fkey;
ALTER TABLE public.app_settings
  ADD CONSTRAINT app_settings_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Như RLS 019: is_secret NULL được coi là bí mật.
UPDATE public.app_settings SET is_secret = true WHERE is_secret IS NULL;
ALTER TABLE public.app_settings
  ALTER COLUMN is_secret SET DEFAULT false,
  ALTER COLUMN is_secret SET NOT NULL;

-- 2. app_secrets: tham chiếu Vault, không chứa key ---------------------
CREATE TABLE IF NOT EXISTS public.app_secrets (
  key TEXT PRIMARY KEY REFERENCES public.app_settings(key) ON DELETE CASCADE ON UPDATE CASCADE,
  vault_secret_id UUID NOT NULL UNIQUE,
  last4 TEXT CHECK (last4 IS NULL OR char_length(last4) = 4),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
COMMENT ON TABLE public.app_secrets IS
  'A-04: API key hệ thống — giá trị mã hoá trong vault.secrets. Không ai đọc trực tiếp; dùng set_system_secret / list_system_secrets / get_system_secret.';
ALTER TABLE public.app_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_secrets FROM PUBLIC, anon, authenticated, service_role;

-- Xoá tham chiếu (hoặc xoá cài đặt) → xoá luôn bản mã hoá trong Vault.
CREATE OR REPLACE FUNCTION public.app_secrets_drop_vault()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE id = OLD.vault_secret_id;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.app_secrets_drop_vault() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS app_secrets_drop_vault ON public.app_secrets;
CREATE TRIGGER app_secrets_drop_vault
  AFTER DELETE ON public.app_secrets
  FOR EACH ROW EXECUTE FUNCTION public.app_secrets_drop_vault();

-- 3. Hàm nội bộ ------------------------------------------------------
-- 4 ký tự cuối chỉ khi key đủ dài (key ngắn: lộ 4 ký tự là lộ quá nhiều).
CREATE OR REPLACE FUNCTION public.secret_last4(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN char_length(p_value) >= 12 THEN right(p_value, 4) END
$$;
REVOKE ALL ON FUNCTION public.secret_last4(TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- Ghi giá trị vào Vault: cập nhật bản đang trỏ tới / bản cùng tên, hoặc tạo mới.
CREATE OR REPLACE FUNCTION public.secret_vault_put(p_key TEXT, p_value TEXT, p_current UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name TEXT := 'kecon/app_settings/' || p_key;
  v_id UUID;
BEGIN
  SELECT s.id INTO v_id
    FROM vault.secrets s
   WHERE s.id = p_current OR s.name = v_name
   ORDER BY (s.id IS NOT DISTINCT FROM p_current) DESC
   LIMIT 1;
  IF v_id IS NULL THEN
    RETURN vault.create_secret(p_value, v_name, 'KểCon · API key hệ thống (' || p_key || ')');
  END IF;
  PERFORM vault.update_secret(v_id, p_value);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.secret_vault_put(TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated, service_role;

-- 4. Chuyển key cũ (chữ thường) vào Vault -----------------------------
DO $$
DECLARE
  r RECORD;
  v_value TEXT;
  v_id UUID;
BEGIN
  FOR r IN
    SELECT s.key, s.value, s.updated_at, s.updated_by
      FROM public.app_settings s
     WHERE s.is_secret AND s.value <> ''
     ORDER BY s.key
  LOOP
    v_value := regexp_replace(r.value, '^[[:space:]]+|[[:space:]]+$', '', 'g');
    IF v_value <> '' THEN
      v_id := public.secret_vault_put(r.key, v_value, (SELECT k.vault_secret_id FROM public.app_secrets k WHERE k.key = r.key));
      INSERT INTO public.app_secrets (key, vault_secret_id, last4, updated_at, updated_by)
      VALUES (r.key, v_id, public.secret_last4(v_value), COALESCE(r.updated_at, now()), r.updated_by)
      ON CONFLICT (key) DO UPDATE
        SET vault_secret_id = EXCLUDED.vault_secret_id, last4 = EXCLUDED.last4,
            updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by;
      PERFORM public.audit_write('secret.update', 'setting', r.key,
        jsonb_build_object('storage', 'app_settings'),
        jsonb_build_object('storage', 'vault', 'last4', '…' || public.secret_last4(v_value)),
        'Migration 021: chuyển API key vào Vault', NULL, NULL, 'system');
    END IF;
  END LOOP;
  UPDATE public.app_settings SET value = '' WHERE is_secret AND value <> '';
END $$;

-- Từ nay app_settings không bao giờ chứa key thật.
ALTER TABLE public.app_settings DROP CONSTRAINT IF EXISTS app_settings_secret_not_plaintext;
ALTER TABLE public.app_settings
  ADD CONSTRAINT app_settings_secret_not_plaintext CHECK (NOT is_secret OR value = '');

-- Người dùng API không lật được cờ bí mật (lật → dòng thành công khai, ai cũng đọc).
CREATE OR REPLACE FUNCTION public.guard_app_settings_secret_flag()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.is_secret IS DISTINCT FROM OLD.is_secret THEN
    RAISE EXCEPTION 'Không đổi được cờ bí mật của cài đặt "%"', OLD.key USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_app_settings_secret_flag ON public.app_settings;
CREATE TRIGGER guard_app_settings_secret_flag
  BEFORE UPDATE OF is_secret ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_app_settings_secret_flag();

-- 5. API chỉ-ghi cho màn Cài đặt -------------------------------------
-- p_value rỗng = xoá key. Trả về trạng thái (không bao giờ trả key).
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
REVOKE ALL ON FUNCTION public.set_system_secret(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_system_secret(TEXT, TEXT, TEXT) TO authenticated, service_role;

-- Trạng thái từng key: đã đặt chưa, 4 ký tự cuối, ai đặt, lúc nào.
CREATE OR REPLACE FUNCTION public.list_system_secrets()
RETURNS TABLE (key TEXT, label TEXT, category TEXT, is_set BOOLEAN, last4 TEXT, updated_at TIMESTAMPTZ, updated_by_email TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.has_permission('secrets.manage') THEN
    RAISE EXCEPTION 'Chỉ Super admin / Admin xem được trạng thái API key' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT s.key, s.label, s.category, k.key IS NOT NULL, k.last4, k.updated_at, u.email::TEXT
      FROM public.app_settings s
      LEFT JOIN public.app_secrets k ON k.key = s.key
      LEFT JOIN auth.users u ON u.id = k.updated_by
     WHERE s.is_secret
     ORDER BY s.category, s.key;
END;
$$;
REVOKE ALL ON FUNCTION public.list_system_secrets() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_system_secrets() TO authenticated;

-- 6. Đọc key: CHỈ server (service role) --------------------------------
CREATE OR REPLACE FUNCTION public.get_system_secret(p_key TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT d.decrypted_secret
    FROM public.app_secrets k
    JOIN vault.decrypted_secrets d ON d.id = k.vault_secret_id
   WHERE k.key = p_key
$$;
REVOKE ALL ON FUNCTION public.get_system_secret(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_system_secret(TEXT) TO service_role;
