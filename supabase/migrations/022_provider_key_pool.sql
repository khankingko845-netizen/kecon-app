-- ============================================================
-- Migration 022 · Admin v2 A-04b — kho nhiều API key giọng nói
--                 (ElevenLabs + Fish Audio), xoay vòng + bù key
--
--   1. provider_api_keys: mỗi nhà cung cấp giữ NHIỀU key. Giá trị mã hoá
--      trong Vault (như A-04), bảng chỉ giữ id Vault + 4 ký tự cuối + băm
--      SHA-256 (chặn thêm trùng) + trạng thái: active / exhausted (hết
--      credit, tự thử lại sau cooldown_until) / invalid (key sai, chờ admin).
--   2. Server (service role) lấy cả kho → chọn key xoay vòng; gặp lỗi hết
--      credit / key sai thì báo report_provider_key() rồi bù key kế tiếp.
--      Đổi trạng thái được ghi nhật ký (provider_key.status, nguồn hệ thống).
--   3. provider_voice_bindings: giọng nhân bản chỉ có trong tài khoản đã
--      tạo nó → nhớ key "chủ" để đọc bằng đúng key đó trước.
--   4. Key ElevenLabs đơn của A-04 được chuyển vào kho; cài đặt
--      elevenlabs_api_key bỏ đi. Thêm cài đặt fishaudio_model_id.
-- ============================================================

-- 1. Bảng kho key ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provider_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('elevenlabs', 'fishaudio')),
  label TEXT NOT NULL DEFAULT '' CHECK (char_length(label) <= 60),
  vault_secret_id UUID NOT NULL UNIQUE,
  key_hash TEXT NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  last4 TEXT CHECK (last4 IS NULL OR char_length(last4) = 4),
  enabled BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'exhausted', 'invalid')),
  cooldown_until TIMESTAMPTZ,
  last_error TEXT CHECK (last_error IS NULL OR char_length(last_error) <= 300),
  use_count BIGINT NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  char_count BIGINT NOT NULL DEFAULT 0 CHECK (char_count >= 0),
  last_used_at TIMESTAMPTZ,
  credit JSONB,
  credit_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (provider, key_hash)
);
COMMENT ON TABLE public.provider_api_keys IS
  'A-04b: kho nhiều API key giọng nói (ElevenLabs / Fish Audio) — giá trị trong vault.secrets. Dùng list/add/update/delete_provider_key; server: get_provider_key_pool.';
CREATE INDEX IF NOT EXISTS provider_api_keys_provider_idx ON public.provider_api_keys (provider, created_at);
ALTER TABLE public.provider_api_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_api_keys FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.provider_voice_bindings (
  provider TEXT NOT NULL CHECK (provider IN ('elevenlabs', 'fishaudio')),
  voice_ref TEXT NOT NULL CHECK (char_length(voice_ref) BETWEEN 1 AND 120),
  key_id UUID NOT NULL REFERENCES public.provider_api_keys(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, voice_ref)
);
COMMENT ON TABLE public.provider_voice_bindings IS
  'A-04b: giọng nhân bản → key (tài khoản) đã tạo ra nó. Chỉ server (service role) đọc / ghi qua hàm.';
ALTER TABLE public.provider_voice_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_voice_bindings FROM PUBLIC, anon, authenticated, service_role;

-- Xoá key → xoá luôn bản mã hoá trong Vault.
CREATE OR REPLACE FUNCTION public.provider_api_keys_drop_vault()
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
REVOKE ALL ON FUNCTION public.provider_api_keys_drop_vault() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS provider_api_keys_drop_vault ON public.provider_api_keys;
CREATE TRIGGER provider_api_keys_drop_vault
  AFTER DELETE ON public.provider_api_keys
  FOR EACH ROW EXECUTE FUNCTION public.provider_api_keys_drop_vault();

-- 2. Hàm nội bộ --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provider_key_label(p_provider TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_provider WHEN 'elevenlabs' THEN 'ElevenLabs' WHEN 'fishaudio' THEN 'Fish Audio' ELSE p_provider END
$$;
REVOKE ALL ON FUNCTION public.provider_key_label(TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- Ảnh chụp cho nhật ký: không bao giờ có key, chỉ …abcd.
CREATE OR REPLACE FUNCTION public.provider_key_snapshot(k public.provider_api_keys)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'provider', k.provider, 'label', k.label, 'last4', '…' || k.last4,
    'enabled', k.enabled, 'status', k.status)
$$;
REVOKE ALL ON FUNCTION public.provider_key_snapshot(public.provider_api_keys) FROM PUBLIC, anon, authenticated, service_role;

-- Ai được quản lý kho: nhân sự có secrets.manage; hoặc server / SQL editor.
CREATE OR REPLACE FUNCTION public.provider_key_require_manage(p_message TEXT)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    IF COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
      RAISE EXCEPTION '%', p_message USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.has_permission('secrets.manage') THEN
    RAISE EXCEPTION '%', p_message USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.provider_key_require_manage(TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- Thêm key (dùng chung cho API và migration). Trả về dòng mới.
CREATE OR REPLACE FUNCTION public.provider_key_insert(p_provider TEXT, p_value TEXT, p_label TEXT, p_actor UUID)
RETURNS public.provider_api_keys
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_value TEXT := regexp_replace(COALESCE(p_value, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_label TEXT := left(regexp_replace(COALESCE(p_label, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), 60);
  v_hash TEXT;
  v_id UUID := gen_random_uuid();
  v_vault UUID;
  v_row public.provider_api_keys;
BEGIN
  IF p_provider IS NULL OR p_provider NOT IN ('elevenlabs', 'fishaudio') THEN
    RAISE EXCEPTION 'Nhà cung cấp không hợp lệ: %', COALESCE(p_provider, '(trống)') USING ERRCODE = '22023';
  END IF;
  IF v_value = '' THEN
    RAISE EXCEPTION 'Chưa nhập API key' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_value) < 12 THEN
    RAISE EXCEPTION 'API key quá ngắn' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_value) > 4096 THEN
    RAISE EXCEPTION 'API key quá dài (tối đa 4096 ký tự)' USING ERRCODE = '22001';
  END IF;
  IF v_value ~ '[[:space:][:cntrl:]]' THEN
    RAISE EXCEPTION 'API key không được chứa khoảng trắng / xuống dòng' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.provider_api_keys k WHERE k.provider = p_provider) >= 50 THEN
    RAISE EXCEPTION 'Kho % đã đủ 50 key', public.provider_key_label(p_provider) USING ERRCODE = '54000';
  END IF;
  v_hash := encode(sha256(convert_to(v_value, 'UTF8')), 'hex');
  IF EXISTS (SELECT 1 FROM public.provider_api_keys k WHERE k.provider = p_provider AND k.key_hash = v_hash) THEN
    RAISE EXCEPTION 'Key này đã có trong kho % (…%)', public.provider_key_label(p_provider), right(v_value, 4)
      USING ERRCODE = '23505';
  END IF;

  v_vault := vault.create_secret(v_value, 'kecon/provider_keys/' || v_id::TEXT,
    'KểCon · kho key ' || public.provider_key_label(p_provider));
  INSERT INTO public.provider_api_keys (id, provider, label, vault_secret_id, key_hash, last4, created_by, updated_by)
  VALUES (v_id, p_provider, v_label, v_vault, v_hash, public.secret_last4(v_value), p_actor, p_actor)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.provider_key_insert(TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated, service_role;

-- 3. API cho màn Cài đặt (chỉ-ghi: không hàm nào trả key) ----------------
CREATE OR REPLACE FUNCTION public.list_provider_keys()
RETURNS TABLE (
  id UUID, provider TEXT, label TEXT, last4 TEXT, enabled BOOLEAN, status TEXT,
  cooldown_until TIMESTAMPTZ, last_error TEXT, use_count BIGINT, char_count BIGINT,
  last_used_at TIMESTAMPTZ, credit JSONB, credit_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ, created_by_email TEXT, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.has_permission('secrets.manage') THEN
    RAISE EXCEPTION 'Chỉ Super admin / Admin xem được kho API key' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT k.id, k.provider, k.label, k.last4, k.enabled, k.status,
           k.cooldown_until, k.last_error, k.use_count, k.char_count,
           k.last_used_at, k.credit, k.credit_checked_at,
           k.created_at, u.email::TEXT, k.updated_at
      FROM public.provider_api_keys k
      LEFT JOIN auth.users u ON u.id = k.created_by
     ORDER BY k.provider, k.created_at, k.id;
END;
$$;
REVOKE ALL ON FUNCTION public.list_provider_keys() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_provider_keys() TO authenticated;

CREATE OR REPLACE FUNCTION public.add_provider_key(p_provider TEXT, p_value TEXT, p_label TEXT DEFAULT NULL, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.provider_api_keys;
BEGIN
  PERFORM public.provider_key_require_manage('Chỉ Super admin / Admin thêm được API key');
  v_row := public.provider_key_insert(p_provider, p_value, p_label, v_uid);
  PERFORM public.audit_write('provider_key.add', 'provider_key', v_row.id::TEXT,
    NULL, public.provider_key_snapshot(v_row),
    p_reason, NULL, NULL, CASE WHEN v_uid IS NULL THEN 'system' ELSE 'db' END);
  RETURN jsonb_build_object('id', v_row.id, 'provider', v_row.provider, 'label', v_row.label,
    'last4', v_row.last4, 'enabled', v_row.enabled, 'status', v_row.status, 'created_at', v_row.created_at);
END;
$$;
REVOKE ALL ON FUNCTION public.add_provider_key(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_provider_key(TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- Đổi tên / tắt / bật. Bật (p_enabled = true) cũng đưa key về "active" để thử lại ngay.
CREATE OR REPLACE FUNCTION public.update_provider_key(p_id UUID, p_label TEXT DEFAULT NULL, p_enabled BOOLEAN DEFAULT NULL, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_old public.provider_api_keys;
  v_new public.provider_api_keys;
BEGIN
  PERFORM public.provider_key_require_manage('Chỉ Super admin / Admin sửa được API key');
  SELECT * INTO v_old FROM public.provider_api_keys k WHERE k.id = p_id FOR UPDATE;
  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy key' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.provider_api_keys k
     SET label = COALESCE(left(regexp_replace(p_label, '^[[:space:]]+|[[:space:]]+$', '', 'g'), 60), k.label),
         enabled = COALESCE(p_enabled, k.enabled),
         status = CASE WHEN p_enabled THEN 'active' ELSE k.status END,
         cooldown_until = CASE WHEN p_enabled THEN NULL ELSE k.cooldown_until END,
         last_error = CASE WHEN p_enabled THEN NULL ELSE k.last_error END,
         updated_at = now(), updated_by = v_uid
   WHERE k.id = p_id
  RETURNING * INTO v_new;
  PERFORM public.audit_write('provider_key.update', 'provider_key', p_id::TEXT,
    public.provider_key_snapshot(v_old), public.provider_key_snapshot(v_new),
    p_reason, NULL, NULL, CASE WHEN v_uid IS NULL THEN 'system' ELSE 'db' END);
  RETURN jsonb_build_object('id', v_new.id, 'label', v_new.label, 'enabled', v_new.enabled, 'status', v_new.status);
END;
$$;
REVOKE ALL ON FUNCTION public.update_provider_key(UUID, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_provider_key(UUID, TEXT, BOOLEAN, TEXT) TO authenticated, service_role;

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
REVOKE ALL ON FUNCTION public.delete_provider_key(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_provider_key(UUID, TEXT) TO authenticated, service_role;

-- 4. CHỈ server (service role) -----------------------------------------
-- Cả kho của một nhà cung cấp (key đang bật, chưa bị đánh dấu sai), kèm key giải mã.
CREATE OR REPLACE FUNCTION public.get_provider_key_pool(p_provider TEXT)
RETURNS TABLE (id UUID, label TEXT, last4 TEXT, secret TEXT, status TEXT, cooldown_until TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT k.id, k.label, k.last4, d.decrypted_secret, k.status, k.cooldown_until
    FROM public.provider_api_keys k
    JOIN vault.decrypted_secrets d ON d.id = k.vault_secret_id
   WHERE k.provider = p_provider AND k.enabled AND k.status <> 'invalid'
   ORDER BY k.created_at, k.id
$$;
REVOKE ALL ON FUNCTION public.get_provider_key_pool(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_provider_key_pool(TEXT) TO service_role;

-- Một key (kể cả đang tắt / sai) — cho nút "Kiểm tra" của admin (route server).
CREATE OR REPLACE FUNCTION public.get_provider_key_secret(p_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT d.decrypted_secret
    FROM public.provider_api_keys k
    JOIN vault.decrypted_secrets d ON d.id = k.vault_secret_id
   WHERE k.id = p_id
$$;
REVOKE ALL ON FUNCTION public.get_provider_key_secret(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_provider_key_secret(UUID) TO service_role;

-- Server báo kết quả: đổi trạng thái (hết credit / sai / hoạt động lại), lỗi gần nhất,
-- credit đọc được. Chỉ ghi nhật ký khi trạng thái thật sự đổi.
CREATE OR REPLACE FUNCTION public.report_provider_key(
  p_id UUID, p_status TEXT DEFAULT NULL, p_error TEXT DEFAULT NULL,
  p_cooldown_until TIMESTAMPTZ DEFAULT NULL, p_credit JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old public.provider_api_keys;
  v_new public.provider_api_keys;
BEGIN
  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'exhausted', 'invalid') THEN
    RAISE EXCEPTION 'Trạng thái key không hợp lệ: %', p_status USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_old FROM public.provider_api_keys k WHERE k.id = p_id FOR UPDATE;
  IF v_old.id IS NULL THEN
    RETURN NULL;  -- key vừa bị xoá: bỏ qua
  END IF;
  UPDATE public.provider_api_keys k
     SET status = COALESCE(p_status, k.status),
         cooldown_until = CASE
           WHEN p_status = 'active' THEN NULL
           WHEN p_status IS NOT NULL THEN p_cooldown_until
           ELSE k.cooldown_until END,
         last_error = CASE
           WHEN p_status = 'active' AND p_error IS NULL THEN NULL
           WHEN p_error IS NOT NULL THEN left(p_error, 300)
           ELSE k.last_error END,
         credit = COALESCE(p_credit, k.credit),
         credit_checked_at = CASE WHEN p_credit IS NOT NULL THEN now() ELSE k.credit_checked_at END
   WHERE k.id = p_id
  RETURNING * INTO v_new;
  IF v_new.status IS DISTINCT FROM v_old.status THEN
    PERFORM public.audit_write('provider_key.status', 'provider_key', p_id::TEXT,
      jsonb_build_object('status', v_old.status),
      jsonb_build_object('status', v_new.status, 'error', v_new.last_error, 'cooldown_until', v_new.cooldown_until),
      'Tự động: ' || public.provider_key_label(v_new.provider) || ' …' || COALESCE(v_new.last4, '????'),
      NULL, NULL, 'system');
  END IF;
  RETURN jsonb_build_object('id', v_new.id, 'status', v_new.status, 'cooldown_until', v_new.cooldown_until);
END;
$$;
REVOKE ALL ON FUNCTION public.report_provider_key(UUID, TEXT, TEXT, TIMESTAMPTZ, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_provider_key(UUID, TEXT, TEXT, TIMESTAMPTZ, JSONB) TO service_role;

-- Cộng dồn lượt dùng (server gom theo lô). Key "hết credit" vừa chạy được → hoạt động lại.
CREATE OR REPLACE FUNCTION public.record_provider_key_usage(p_id UUID, p_uses INT, p_chars BIGINT DEFAULT 0)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.provider_api_keys k
     SET use_count = k.use_count + GREATEST(COALESCE(p_uses, 0), 0),
         char_count = k.char_count + GREATEST(COALESCE(p_chars, 0), 0),
         last_used_at = now()
   WHERE k.id = p_id;
  IF EXISTS (SELECT 1 FROM public.provider_api_keys k WHERE k.id = p_id AND k.status = 'exhausted') THEN
    PERFORM public.report_provider_key(p_id, 'active');
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.record_provider_key_usage(UUID, INT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_provider_key_usage(UUID, INT, BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.bind_provider_voice(p_provider TEXT, p_voice_ref TEXT, p_key_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.provider_voice_bindings (provider, voice_ref, key_id)
  SELECT p_provider, p_voice_ref, k.id FROM public.provider_api_keys k WHERE k.id = p_key_id AND k.provider = p_provider
  ON CONFLICT (provider, voice_ref) DO UPDATE SET key_id = EXCLUDED.key_id, created_at = now()
$$;
REVOKE ALL ON FUNCTION public.bind_provider_voice(TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bind_provider_voice(TEXT, TEXT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.get_provider_voice_key(p_provider TEXT, p_voice_ref TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT b.key_id FROM public.provider_voice_bindings b WHERE b.provider = p_provider AND b.voice_ref = p_voice_ref
$$;
REVOKE ALL ON FUNCTION public.get_provider_voice_key(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_provider_voice_key(TEXT, TEXT) TO service_role;

-- 5. Chuyển key ElevenLabs đơn (A-04) vào kho --------------------------
DO $$
DECLARE
  v_value TEXT;
  v_by UUID;
  v_row public.provider_api_keys;
BEGIN
  SELECT d.decrypted_secret, k.updated_by INTO v_value, v_by
    FROM public.app_secrets k
    JOIN vault.decrypted_secrets d ON d.id = k.vault_secret_id
   WHERE k.key = 'elevenlabs_api_key';
  v_value := regexp_replace(COALESCE(v_value, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  IF char_length(v_value) >= 12 THEN
    v_row := public.provider_key_insert('elevenlabs', v_value, 'Key chính (chuyển từ A-04)', v_by);
    PERFORM public.audit_write('provider_key.add', 'provider_key', v_row.id::TEXT,
      NULL, public.provider_key_snapshot(v_row),
      'Migration 022: chuyển key ElevenLabs vào kho nhiều key', NULL, NULL, 'system');
    -- Giọng nhân bản trước đây đều nằm trong tài khoản của key này.
    INSERT INTO public.provider_voice_bindings (provider, voice_ref, key_id)
    SELECT DISTINCT 'elevenlabs', v.elevenlabs_voice_id, v_row.id
      FROM public.voice_profiles v
     WHERE v.elevenlabs_voice_id IS NOT NULL AND v.elevenlabs_voice_id <> ''
       AND char_length(v.elevenlabs_voice_id) <= 120
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
-- Ô key đơn bỏ đi (app_secrets + bản Vault cũ xoá theo cascade / trigger).
DELETE FROM public.app_settings WHERE key = 'elevenlabs_api_key';

-- 6. Cài đặt Fish Audio --------------------------------------------------
INSERT INTO public.app_settings (key, value, label, category, is_secret)
VALUES ('fishaudio_model_id', 's2.1-pro', 'Fish Audio Model', 'voice', false)
ON CONFLICT (key) DO NOTHING;
