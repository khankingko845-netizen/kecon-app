-- ============================================================
-- 017 · PIN phụ huynh: hash bcrypt + xác minh phía server + khoá sau 5 lần sai (T03)
--
-- Trước đây PIN được lưu ở parental_controls.pin_hash dưới dạng btoa(pin)
-- (base64 — giải ngược được) và client đọc được cột này.
--
-- Bây giờ:
--   • PIN nằm trong bảng riêng parental_pins, bật RLS nhưng KHÔNG có policy và
--     bị REVOKE khỏi anon/authenticated → client không đọc/ghi trực tiếp được.
--   • Chỉ truy cập qua các hàm SECURITY DEFINER:
--       parent_pin_status()                 → { has_pin, reset_required, locked_until }
--       set_parent_pin(new, current?)       → đặt/đổi PIN (đổi phải nhập đúng PIN cũ)
--       verify_parent_pin(pin)              → { ok, reason?, attempts_left?, locked_until? }
--   • Sai 5 lần liên tiếp → khoá 15 phút (đếm cả khi đổi PIN với PIN cũ sai).
--   • Dữ liệu btoa cũ bị xoá (không chuyển đổi), đánh dấu reset_required để
--     app nhắc phụ huynh đặt PIN mới; cột parental_controls.pin_hash bị bỏ.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.parental_pins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  pin_hash TEXT,                               -- bcrypt (pgcrypto crypt/gen_salt('bf'))
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  reset_required BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.parental_pins ENABLE ROW LEVEL SECURITY;
-- Không tạo policy nào: chỉ các hàm SECURITY DEFINER bên dưới được chạm vào bảng.
REVOKE ALL ON public.parental_pins FROM PUBLIC, anon, authenticated;

-- Chuyển dữ liệu cũ: không giữ PIN dạng giải ngược được, buộc đặt lại.
INSERT INTO public.parental_pins (user_id, reset_required)
SELECT user_id, TRUE
FROM public.parental_controls
WHERE pin_hash IS NOT NULL AND pin_hash <> ''
ON CONFLICT (user_id) DO UPDATE SET reset_required = TRUE, pin_hash = NULL;

ALTER TABLE public.parental_controls DROP COLUMN IF EXISTS pin_hash;

-- ── Trạng thái PIN (không bao giờ trả hash) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.parent_pin_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  uid UUID := auth.uid();
  r public.parental_pins%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'unauthenticated');
  END IF;
  SELECT * INTO r FROM public.parental_pins WHERE user_id = uid;
  RETURN jsonb_build_object(
    'ok', TRUE,
    'has_pin', COALESCE(r.pin_hash IS NOT NULL, FALSE),
    'reset_required', COALESCE(r.reset_required, FALSE),
    'locked_until', CASE WHEN r.locked_until > now() THEN r.locked_until END
  );
END;
$$;

-- ── Xác minh nội bộ: đếm sai + khoá; dùng chung cho verify và đổi PIN ─────
CREATE OR REPLACE FUNCTION public._check_parent_pin(p_uid UUID, p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  max_attempts CONSTANT INTEGER := 5;
  lock_window CONSTANT INTERVAL := INTERVAL '15 minutes';
  r public.parental_pins%ROWTYPE;
  v_failed INTEGER;
BEGIN
  -- Khoá dòng để các lần thử song song không vượt giới hạn.
  SELECT * INTO r FROM public.parental_pins WHERE user_id = p_uid FOR UPDATE;

  IF NOT FOUND OR r.pin_hash IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'no_pin');
  END IF;

  IF r.locked_until IS NOT NULL AND r.locked_until > now() THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'locked', 'locked_until', r.locked_until);
  END IF;

  IF p_pin IS NOT NULL AND crypt(p_pin, r.pin_hash) = r.pin_hash THEN
    UPDATE public.parental_pins
       SET failed_attempts = 0, locked_until = NULL
     WHERE user_id = p_uid;
    RETURN jsonb_build_object('ok', TRUE);
  END IF;

  -- Hết thời gian khoá thì đếm lại từ đầu.
  v_failed := CASE WHEN r.locked_until IS NOT NULL THEN 1 ELSE r.failed_attempts + 1 END;

  IF v_failed >= max_attempts THEN
    UPDATE public.parental_pins
       SET failed_attempts = 0, locked_until = now() + lock_window
     WHERE user_id = p_uid;
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'locked', 'locked_until', now() + lock_window);
  END IF;

  UPDATE public.parental_pins
     SET failed_attempts = v_failed, locked_until = NULL
   WHERE user_id = p_uid;
  RETURN jsonb_build_object('ok', FALSE, 'reason', 'invalid', 'attempts_left', max_attempts - v_failed);
END;
$$;

REVOKE ALL ON FUNCTION public._check_parent_pin(UUID, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.verify_parent_pin(p_pin TEXT)
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
  RETURN public._check_parent_pin(uid, p_pin);
END;
$$;

-- ── Đặt / đổi PIN ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_parent_pin(p_new_pin TEXT, p_current_pin TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  uid UUID := auth.uid();
  v_has_pin BOOLEAN;
  v_check JSONB;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'unauthenticated');
  END IF;

  IF p_new_pin IS NULL OR p_new_pin !~ '^[0-9]{4,6}$' THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'invalid_format');
  END IF;

  SELECT pin_hash IS NOT NULL INTO v_has_pin FROM public.parental_pins WHERE user_id = uid;

  -- Đã có PIN → phải nhập đúng PIN hiện tại (có đếm sai + khoá).
  IF COALESCE(v_has_pin, FALSE) THEN
    v_check := public._check_parent_pin(uid, p_current_pin);
    IF NOT (v_check ->> 'ok')::BOOLEAN THEN
      RETURN v_check;
    END IF;
  END IF;

  INSERT INTO public.parental_pins (user_id, pin_hash, failed_attempts, locked_until, reset_required, updated_at)
  VALUES (uid, crypt(p_new_pin, gen_salt('bf', 10)), 0, NULL, FALSE, now())
  ON CONFLICT (user_id) DO UPDATE
    SET pin_hash = EXCLUDED.pin_hash,
        failed_attempts = 0,
        locked_until = NULL,
        reset_required = FALSE,
        updated_at = now();

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.parent_pin_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_parent_pin(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_parent_pin(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parent_pin_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_parent_pin(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_parent_pin(TEXT, TEXT) TO authenticated;
