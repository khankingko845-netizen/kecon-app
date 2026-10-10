-- Migration 016: Security hardening
--   1. Chặn leo thang đặc quyền qua bảng profiles (role, current_plan)
--   2. Người dùng không được tự sửa bộ đếm hạn mức (usage_limits)
--   3. usage_tracking chỉ do server ghi (qua consume_usage)
--   4. Hàm consume_usage(): rate limit + hạn mức theo gói, kiểm tra phía server
--
-- Chạy file này TRƯỚC hoặc NGAY KHI deploy code mới: nếu thiếu hàm
-- consume_usage(), API dùng key nền tảng sẽ trả 503 (fail-closed).

-- ============================================================
-- 1. PROFILES: bảo vệ cột role / current_plan
-- ============================================================
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
    IF COALESCE(caller_role, '') <> 'super_admin' THEN
      NEW.role := 'user';
    END IF;
    IF COALESCE(caller_role, '') NOT IN ('admin', 'super_admin') THEN
      NEW.current_plan := 'free';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
     AND COALESCE(caller_role, '') <> 'super_admin' THEN
    RAISE EXCEPTION 'Chỉ super_admin được đổi vai trò người dùng'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.current_plan IS DISTINCT FROM OLD.current_plan
     AND COALESCE(caller_role, '') NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Chỉ admin được đổi gói cước'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_columns ON public.profiles;
CREATE TRIGGER protect_profile_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_columns();

-- ============================================================
-- 2. USAGE_LIMITS: người dùng chỉ được đọc
-- ============================================================
DROP POLICY IF EXISTS "System can manage usage" ON public.usage_limits;
DROP POLICY IF EXISTS "Admins can manage usage" ON public.usage_limits;
CREATE POLICY "Admins can manage usage" ON public.usage_limits
  FOR ALL USING (public.is_admin());

-- ============================================================
-- 3. USAGE_TRACKING: chỉ server ghi (consume_usage là SECURITY DEFINER)
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can insert usage" ON public.usage_tracking;

DROP INDEX IF EXISTS public.idx_usage_tracking_user;
CREATE INDEX IF NOT EXISTS idx_usage_tracking_user_time
  ON public.usage_tracking (user_id, endpoint, created_at DESC);

-- ============================================================
-- 4. consume_usage(): gọi từ API route trước mỗi lần dùng AI/TTS
--    p_kind  : 'story' | 'ai' | 'tts' | 'voice_clone' | 'illustration'
--    p_amount: số đơn vị chi phí (vd: số trang minh hoạ, số chuyên gia, 1/1000 ký tự TTS)
--    p_byo   : true khi người dùng dùng API key riêng (bỏ qua hạn mức gói)
-- ============================================================
CREATE OR REPLACE FUNCTION public.consume_usage(
  p_kind TEXT,
  p_amount INTEGER DEFAULT 1,
  p_byo BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID := auth.uid();
  v_period DATE := date_trunc('month', now())::date;
  v_plan TEXT;
  v_limit INTEGER;
  v_used INTEGER;
  v_recent INTEGER;
  v_rate INTEGER;
  v_admin BOOLEAN;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'unauthenticated');
  END IF;

  IF p_kind NOT IN ('story', 'ai', 'tts', 'voice_clone', 'illustration') THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_kind');
  END IF;

  -- Tuần tự hoá theo (user, loại) để request song song không cùng lọt rate limit/hạn mức
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text || ':' || p_kind, 0));

  p_amount := LEAST(GREATEST(COALESCE(p_amount, 1), 1), 50);
  v_admin := public.is_admin();

  -- Rate limit theo đơn vị chi phí / phút (áp dụng cả BYO key)
  v_rate := CASE p_kind
    WHEN 'tts' THEN 60
    WHEN 'story' THEN 5
    WHEN 'voice_clone' THEN 3
    WHEN 'illustration' THEN 20
    ELSE 20
  END;
  IF v_admin THEN
    v_rate := v_rate * 5;
  END IF;

  SELECT COALESCE(SUM(ut.tokens_used), 0) INTO v_recent
  FROM public.usage_tracking ut
  WHERE ut.user_id = uid
    AND ut.endpoint = p_kind
    AND ut.created_at > now() - interval '1 minute';

  IF v_recent + p_amount > v_rate THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'rate_limited', 'retry_after', 60);
  END IF;

  -- Hạn mức theo gói (chỉ khi dùng key của nền tảng)
  IF NOT p_byo AND NOT v_admin THEN
    SELECT us.plan_id INTO v_plan
    FROM public.user_subscriptions us
    WHERE us.user_id = uid
      AND us.status = 'active'
      AND us.current_period_end > now()
    ORDER BY us.created_at DESC
    LIMIT 1;

    IF v_plan IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.user_subscriptions us WHERE us.user_id = uid) THEN
        v_plan := 'free'; -- từng có gói trả phí nhưng đã hết hạn/huỷ
      ELSE
        SELECT p.current_plan INTO v_plan FROM public.profiles p WHERE p.id = uid;
      END IF;
    END IF;
    v_plan := COALESCE(v_plan, 'free');

    SELECT CASE p_kind
             WHEN 'story' THEN sp.story_limit
             WHEN 'voice_clone' THEN sp.voice_clone_limit
             ELSE NULL
           END
    INTO v_limit
    FROM public.subscription_plans sp
    WHERE sp.id = v_plan;

    INSERT INTO public.usage_limits (user_id, period_start)
    VALUES (uid, v_period)
    ON CONFLICT (user_id, period_start) DO NOTHING;

    IF p_kind = 'story' THEN
      SELECT ul.stories_created INTO v_used
      FROM public.usage_limits ul
      WHERE ul.user_id = uid AND ul.period_start = v_period;
    ELSIF p_kind = 'voice_clone' THEN
      -- Lấy số lớn hơn giữa số giọng hiện có và số lần clone trong tháng
      -- (user có thể tự xoá voice_profiles, nhưng không sửa được usage_limits)
      SELECT GREATEST(
        (SELECT count(*) FROM public.voice_profiles vp WHERE vp.user_id = uid),
        (SELECT ul.voices_cloned FROM public.usage_limits ul
          WHERE ul.user_id = uid AND ul.period_start = v_period)
      ) INTO v_used;
    END IF;

    IF v_limit IS NOT NULL AND COALESCE(v_used, 0) + p_amount > v_limit THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'quota_exceeded',
        'plan', v_plan,
        'used', COALESCE(v_used, 0),
        'limit', v_limit
      );
    END IF;

    UPDATE public.usage_limits SET
      stories_created = stories_created + CASE WHEN p_kind = 'story' THEN p_amount ELSE 0 END,
      tts_generated = tts_generated + CASE WHEN p_kind = 'tts' THEN p_amount ELSE 0 END,
      voices_cloned = voices_cloned + CASE WHEN p_kind = 'voice_clone' THEN p_amount ELSE 0 END,
      illustrations_generated = illustrations_generated + CASE WHEN p_kind = 'illustration' THEN p_amount ELSE 0 END
    WHERE user_id = uid AND period_start = v_period;
  END IF;

  INSERT INTO public.usage_tracking (user_id, provider, endpoint, tokens_used)
  VALUES (uid, CASE WHEN p_byo THEN 'byo' ELSE 'platform' END, p_kind, p_amount);

  RETURN jsonb_build_object(
    'allowed', true,
    'plan', v_plan,
    'used', CASE WHEN v_limit IS NULL THEN NULL ELSE COALESCE(v_used, 0) + p_amount END,
    'limit', v_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_usage(TEXT, INTEGER, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_usage(TEXT, INTEGER, BOOLEAN) TO authenticated;

-- ============================================================
-- 5. (TUỲ CHỌN — chạy thủ công sau khi kiểm tra) Dọn dữ liệu bị tự nâng quyền trước 016
-- ============================================================
-- Rà soát tài khoản có quyền cao:
--   SELECT p.id, u.email, p.role, p.created_at
--   FROM public.profiles p JOIN auth.users u ON u.id = p.id
--   WHERE p.role <> 'user' ORDER BY p.created_at;
--
-- Đưa user tự nâng gói (không có subscription active) về gói free:
--   UPDATE public.profiles p SET current_plan = 'free'
--   WHERE p.current_plan <> 'free' AND p.role = 'user'
--     AND NOT EXISTS (
--       SELECT 1 FROM public.user_subscriptions us
--       WHERE us.user_id = p.id AND us.status = 'active' AND us.current_period_end > now()
--     );
