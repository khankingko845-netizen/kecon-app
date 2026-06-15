"use client";

import { useState, useEffect, useCallback } from "react";
import TopBar from "@/components/ui/TopBar";
import {
  Crown, Check, Sparkles, Zap, Star, Loader2,
  CreditCard, ArrowRight, Shield, Heart,
} from "lucide-react";
import type { Screen } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

interface Plan {
  id: string;
  name: string;
  description: string;
  price_monthly: number;
  price_yearly: number;
  features: string[];
  story_limit: number | null;
  tts_limit: number | null;
  voice_clone_limit: number | null;
  sort_order: number;
}

interface UserSub {
  plan_id: string;
  status: string;
  billing_cycle: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
}

const PLAN_ICONS: Record<string, typeof Crown> = {
  free: Heart,
  plus: Star,
  pro: Crown,
};

const PLAN_GRADIENTS: Record<string, string> = {
  free: "from-gray-100 to-gray-200",
  plus: "from-violet-500 to-indigo-600",
  pro: "from-amber-400 to-orange-500",
};

function formatVND(amount: number): string {
  if (amount === 0) return "Miễn phí";
  return new Intl.NumberFormat("vi-VN").format(amount) + "đ";
}

export default function Subscription({
  onNavigate,
}: {
  onNavigate: (screen: Screen, params?: Record<string, string>) => void;
}) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [currentSub, setCurrentSub] = useState<UserSub | null>(null);
  const [currentPlan, setCurrentPlan] = useState("free");
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await createClient().auth.getUser();
    if (!user) return;

    // Fetch plans
    const { data: planData } = await createClient()
      .from("subscription_plans")
      .select("*")
      .eq("is_active", true)
      .order("sort_order");

    if (planData) {
      setPlans(
        planData.map((p) => ({
          ...p,
          features: Array.isArray(p.features) ? p.features : JSON.parse(p.features || "[]"),
        }))
      );
    }

    // Fetch user profile plan
    const { data: profile } = await createClient()
      .from("profiles")
      .select("current_plan")
      .eq("id", user.id)
      .single();

    if (profile?.current_plan) {
      setCurrentPlan(profile.current_plan);
    }

    // Fetch active subscription
    const { data: subData } = await createClient()
      .from("user_subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (subData) {
      setCurrentSub(subData);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubscribe = async (planId: string) => {
    if (planId === currentPlan) return;
    setSubscribing(planId);

    // For now — create a subscription record (payment integration to be added)
    const {
      data: { user },
    } = await createClient().auth.getUser();
    if (!user) return;

    const periodEnd = new Date();
    if (billing === "monthly") {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    } else {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    }

    await createClient().from("user_subscriptions").insert({
      user_id: user.id,
      plan_id: planId,
      billing_cycle: billing,
      current_period_end: periodEnd.toISOString(),
    });

    await createClient()
      .from("profiles")
      .update({ current_plan: planId })
      .eq("id", user.id);

    setCurrentPlan(planId);
    setSubscribing(null);
    load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg">
        <Loader2 size={28} className="animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg pb-8">
      <TopBar title="Gói Cước" onBack={() => onNavigate("settings")} />

      {/* Header */}
      <div className="px-5 pt-4 pb-2 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-accent/10 rounded-full mb-3">
          <Crown size={14} className="text-accent" />
          <span className="text-[12px] font-bold text-accent">
            Gói hiện tại: {plans.find((p) => p.id === currentPlan)?.name || "Miễn Phí"}
          </span>
        </div>
        <h2 className="text-xl font-black tracking-tight text-txt mb-1">
          Nâng cấp trải nghiệm
        </h2>
        <p className="text-[13px] text-txt-secondary">
          Mở khoá toàn bộ tính năng KểCon cho gia đình bạn
        </p>
      </div>

      {/* Billing toggle */}
      <div className="flex justify-center px-5 py-3">
        <div className="flex bg-white rounded-xl p-1 shadow-sm">
          <button
            onClick={() => setBilling("monthly")}
            className={`px-4 py-2 rounded-lg text-[13px] font-bold transition-all ${
              billing === "monthly"
                ? "bg-accent text-white"
                : "text-txt-secondary"
            }`}
          >
            Tháng
          </button>
          <button
            onClick={() => setBilling("yearly")}
            className={`px-4 py-2 rounded-lg text-[13px] font-bold transition-all relative ${
              billing === "yearly"
                ? "bg-accent text-white"
                : "text-txt-secondary"
            }`}
          >
            Năm
            <span className="absolute -top-2 -right-2 text-[9px] bg-emerald-500 text-white px-1.5 py-0.5 rounded-full font-bold">
              -17%
            </span>
          </button>
        </div>
      </div>

      {/* Plan cards */}
      <div className="px-5 space-y-3 mt-2">
        {plans.map((plan) => {
          const Icon = PLAN_ICONS[plan.id] || Sparkles;
          const gradient = PLAN_GRADIENTS[plan.id] || "from-gray-500 to-gray-600";
          const isCurrentPlan = plan.id === currentPlan;
          const isPaid = plan.price_monthly > 0;
          const price =
            billing === "monthly" ? plan.price_monthly : plan.price_yearly;

          return (
            <div
              key={plan.id}
              className={`relative rounded-2xl overflow-hidden transition-all ${
                isCurrentPlan
                  ? "ring-2 ring-accent shadow-lg"
                  : "shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
              }`}
            >
              {/* Most popular badge */}
              {plan.id === "plus" && (
                <div className="absolute top-0 right-0 bg-accent text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl z-10">
                  <Zap size={10} className="inline mr-0.5" />
                  PHỔ BIẾN NHẤT
                </div>
              )}

              {/* Plan header */}
              <div
                className={`bg-gradient-to-r ${gradient} p-4 ${
                  isPaid ? "text-white" : "text-txt"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon size={20} />
                  <h3 className="text-base font-black">{plan.name}</h3>
                </div>
                <p
                  className={`text-[12px] ${isPaid ? "text-white/80" : "text-txt-secondary"}`}
                >
                  {plan.description}
                </p>
                <div className="mt-2">
                  <span className="text-2xl font-black">{formatVND(price)}</span>
                  {isPaid && (
                    <span
                      className={`text-[12px] ml-1 ${isPaid ? "text-white/70" : "text-txt-secondary"}`}
                    >
                      /{billing === "monthly" ? "tháng" : "năm"}
                    </span>
                  )}
                </div>
              </div>

              {/* Features */}
              <div className="bg-white p-4">
                <ul className="space-y-2">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check
                        size={14}
                        className={`mt-0.5 shrink-0 ${
                          isPaid ? "text-accent" : "text-gray-400"
                        }`}
                      />
                      <span className="text-[13px] text-txt">{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA button */}
                <button
                  onClick={() => handleSubscribe(plan.id)}
                  disabled={isCurrentPlan || subscribing !== null}
                  className={`w-full mt-4 py-3 rounded-xl text-[14px] font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                    isCurrentPlan
                      ? "bg-gray-100 text-txt-secondary cursor-default"
                      : isPaid
                        ? "bg-accent text-white hover:bg-accent/90"
                        : "bg-gray-100 text-txt hover:bg-gray-200"
                  } disabled:opacity-60`}
                >
                  {subscribing === plan.id ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : isCurrentPlan ? (
                    <>
                      <Check size={16} /> Gói hiện tại
                    </>
                  ) : (
                    <>
                      <ArrowRight size={16} />
                      {isPaid ? "Nâng cấp" : "Chọn gói"}
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Current subscription info */}
      {currentSub && (
        <div className="mx-5 mt-4 p-4 bg-white rounded-2xl shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <CreditCard size={16} className="text-accent" />
            <span className="text-[13px] font-bold text-txt">
              Thông tin gói cước
            </span>
          </div>
          <div className="space-y-1.5 text-[12px] text-txt-secondary">
            <p>
              Chu kỳ: {currentSub.billing_cycle === "monthly" ? "Hàng tháng" : "Hàng năm"}
            </p>
            <p>
              Hết hạn:{" "}
              {new Date(currentSub.current_period_end).toLocaleDateString("vi-VN")}
            </p>
            {currentSub.cancel_at_period_end && (
              <p className="text-orange-600 font-semibold">
                Sẽ huỷ vào cuối kỳ
              </p>
            )}
          </div>
        </div>
      )}

      {/* Trust badges */}
      <div className="px-5 mt-5">
        <div className="flex items-center justify-center gap-4 text-[11px] text-txt-secondary">
          <span className="flex items-center gap-1">
            <Shield size={12} /> Thanh toán an toàn
          </span>
          <span className="flex items-center gap-1">
            <Sparkles size={12} /> Huỷ bất kỳ lúc nào
          </span>
        </div>
      </div>
    </div>
  );
}
