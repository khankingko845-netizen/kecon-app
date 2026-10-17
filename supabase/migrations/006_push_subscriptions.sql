-- Migration 006: Push notification subscriptions + Subscription plans
-- KểCon — Push Notifications & Subscription Model

-- ============================================================
-- 1. PUSH SUBSCRIPTIONS
-- ============================================================
CREATE TABLE public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  keys JSONB NOT NULL DEFAULT '{}',
  subscription_json JSONB NOT NULL DEFAULT '{}',
  user_agent TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_subs_user ON public.push_subscriptions(user_id);
CREATE INDEX idx_push_subs_endpoint ON public.push_subscriptions(endpoint);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own push subs" ON public.push_subscriptions
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Admins can read all push subs" ON public.push_subscriptions
  FOR SELECT USING (is_admin());

-- ============================================================
-- 2. SUBSCRIPTION PLANS
-- ============================================================
CREATE TABLE public.subscription_plans (
  id TEXT PRIMARY KEY, -- 'free', 'plus', 'pro'
  name TEXT NOT NULL,
  description TEXT,
  price_monthly INTEGER NOT NULL DEFAULT 0, -- VND cents
  price_yearly INTEGER NOT NULL DEFAULT 0,
  features JSONB NOT NULL DEFAULT '[]',
  story_limit INTEGER DEFAULT NULL, -- null = unlimited
  tts_limit INTEGER DEFAULT NULL,
  voice_clone_limit INTEGER DEFAULT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default plans
INSERT INTO public.subscription_plans (id, name, description, price_monthly, price_yearly, features, story_limit, tts_limit, voice_clone_limit, sort_order)
VALUES
  ('free', 'Miễn Phí', 'Trải nghiệm cơ bản cho gia đình', 0, 0,
   '["5 truyện AI/tháng", "1 giọng clone", "Nghe không giới hạn", "Thư viện cộng đồng"]'::jsonb,
   5, 20, 1, 0),
  ('plus', 'KểCon Plus', 'Cho gia đình yêu truyện', 79000, 790000,
   '["30 truyện AI/tháng", "3 giọng clone", "Batch TTS", "Chia sẻ truyện", "Không quảng cáo", "Hỗ trợ ưu tiên"]'::jsonb,
   30, 100, 3, 1),
  ('pro', 'KểCon Pro', 'Trải nghiệm không giới hạn', 149000, 1490000,
   '["Truyện AI không giới hạn", "10 giọng clone", "Minh hoạ AI DALL·E", "Xuất bản lên cộng đồng", "API access", "Hỗ trợ VIP"]'::jsonb,
   NULL, NULL, 10, 2);

-- ============================================================
-- 3. USER SUBSCRIPTIONS
-- ============================================================
CREATE TABLE public.user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES public.subscription_plans(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired', 'past_due')),
  billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'yearly')),
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  payment_provider TEXT, -- 'stripe', 'momo', 'vnpay', etc.
  payment_id TEXT, -- external payment reference
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_subs_user ON public.user_subscriptions(user_id);
CREATE INDEX idx_user_subs_status ON public.user_subscriptions(status);

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own subscription" ON public.user_subscriptions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage all subscriptions" ON public.user_subscriptions
  FOR ALL USING (is_admin());

-- Plans are publicly readable
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active plans" ON public.subscription_plans
  FOR SELECT USING (is_active = true);
CREATE POLICY "Admins can manage plans" ON public.subscription_plans
  FOR ALL USING (is_admin());

-- ============================================================
-- 4. USAGE LIMITS TRACKING
-- ============================================================
CREATE TABLE public.usage_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period_start DATE NOT NULL DEFAULT date_trunc('month', now())::date,
  stories_created INTEGER NOT NULL DEFAULT 0,
  tts_generated INTEGER NOT NULL DEFAULT 0,
  voices_cloned INTEGER NOT NULL DEFAULT 0,
  illustrations_generated INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, period_start)
);

CREATE INDEX idx_usage_limits_user_period ON public.usage_limits(user_id, period_start);

ALTER TABLE public.usage_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own usage" ON public.usage_limits
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "System can manage usage" ON public.usage_limits
  FOR ALL USING (auth.uid() = user_id);

-- Add subscription plan reference to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS current_plan TEXT DEFAULT 'free' REFERENCES public.subscription_plans(id);
