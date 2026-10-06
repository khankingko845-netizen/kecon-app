-- ============================================================
-- 018 · Quên PIN phụ huynh: đặt lại sau khi xác minh lại tài khoản (T19)
--
-- Cổng phụ huynh (tab "Bố mẹ") cần đường thoát khi bố mẹ quên PIN, nhưng bé
-- không được tự xoá PIN. reset_parent_pin() chỉ chạy khi phiên hiện tại vừa
-- đăng nhập lại (mật khẩu / OTP / OAuth) trong 10 phút gần nhất — đọc từ claim
-- `amr` của JWT Supabase: [{ "method": "password", "timestamp": 1700000000 }].
-- Làm mới token (refresh) giữ nguyên timestamp cũ nên không lách được.
--
-- Kết quả: xoá hash, gỡ khoá, bật reset_required → app mở màn Kiểm soát phụ
-- huynh để đặt PIN mới (set_parent_pin không cần PIN cũ vì hash đã NULL).
-- ============================================================

CREATE OR REPLACE FUNCTION public._recent_reauth(p_window INTERVAL DEFAULT INTERVAL '10 minutes')
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_amr JSONB := auth.jwt() -> 'amr';
  v_last BIGINT;
BEGIN
  IF v_amr IS NULL OR jsonb_typeof(v_amr) <> 'array' THEN
    RETURN FALSE;
  END IF;
  SELECT max((e ->> 'timestamp')::BIGINT) INTO v_last
    FROM jsonb_array_elements(v_amr) AS e
   WHERE jsonb_typeof(e) = 'object'
     AND (e ->> 'timestamp') ~ '^[0-9]{1,12}$'
     AND COALESCE(e ->> 'method', '') NOT IN ('', 'anonymous', 'token_refresh');
  RETURN v_last IS NOT NULL
     AND to_timestamp(v_last) >= now() - p_window
     AND to_timestamp(v_last) <= now() + INTERVAL '1 minute';
END;
$$;

REVOKE ALL ON FUNCTION public._recent_reauth(INTERVAL) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reset_parent_pin()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'unauthenticated');
  END IF;

  IF NOT public._recent_reauth() THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'reauth_required');
  END IF;

  INSERT INTO public.parental_pins (user_id, pin_hash, failed_attempts, locked_until, reset_required, updated_at)
  VALUES (uid, NULL, 0, NULL, TRUE, now())
  ON CONFLICT (user_id) DO UPDATE
    SET pin_hash = NULL,
        failed_attempts = 0,
        locked_until = NULL,
        reset_required = TRUE,
        updated_at = now();

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.reset_parent_pin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_parent_pin() TO authenticated;
