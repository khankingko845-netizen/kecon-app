"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ChevronLeft, Flame, Star, Gift, CheckCircle, Clock, Loader2, Sparkles,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import type { Screen } from "@/lib/types";

interface DailyChallengesProps {
  onNavigate: (screen: Screen, data?: Record<string, string>) => void;
  onBack: () => void;
}

interface Challenge {
  id: string;
  title: string;
  description: string;
  icon: string;
  xp_reward: number;
  type: "listen" | "create" | "voice" | "explore" | "social";
  target: number;
  progress: number;
  completed: boolean;
}

const defaultChallenges: Challenge[] = [
  {
    id: "daily_listen",
    title: "Nghe 1 câu chuyện",
    description: "Nghe trọn vẹn 1 câu chuyện bất kỳ",
    icon: "🎧",
    xp_reward: 30,
    type: "listen",
    target: 1,
    progress: 0,
    completed: false,
  },
  {
    id: "daily_create",
    title: "Tạo truyện mới",
    description: "Sáng tạo 1 câu chuyện mới bằng AI",
    icon: "✍️",
    xp_reward: 50,
    type: "create",
    target: 1,
    progress: 0,
    completed: false,
  },
  {
    id: "daily_explore",
    title: "Khám phá thể loại mới",
    description: "Nghe truyện từ thể loại bạn chưa nghe",
    icon: "🗺️",
    xp_reward: 40,
    type: "explore",
    target: 1,
    progress: 0,
    completed: false,
  },
  {
    id: "daily_listen3",
    title: "Nghe 3 câu chuyện",
    description: "Nghe trọn vẹn 3 câu chuyện trong ngày",
    icon: "📚",
    xp_reward: 80,
    type: "listen",
    target: 3,
    progress: 0,
    completed: false,
  },
  {
    id: "daily_voice",
    title: "Thu âm giọng nói",
    description: "Ghi âm mẫu giọng mới hoặc cải thiện",
    icon: "🎤",
    xp_reward: 60,
    type: "voice",
    target: 1,
    progress: 0,
    completed: false,
  },
];

const typeColors: Record<string, string> = {
  listen: "from-blue-400 to-blue-600",
  create: "from-purple-400 to-purple-600",
  voice: "from-green-400 to-green-600",
  explore: "from-amber-400 to-amber-600",
  social: "from-pink-400 to-pink-600",
};

export default function DailyChallenges({ onBack, onNavigate }: DailyChallengesProps) {
  const { profile } = useAuth();
  const [challenges, setChallenges] = useState<Challenge[]>(defaultChallenges);
  const [streak, setStreak] = useState(0);
  const [totalXP, setTotalXP] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const supabase = createClient();

      // Get today's progress from play_sessions and stories
      const today = new Date().toISOString().split("T")[0];
      const [{ count: listenCount }, { count: storyCount }, { count: voiceCount }] = await Promise.all([
        supabase.from("play_sessions").select("*", { count: "exact", head: true }).eq("user_id", profile.id).gte("started_at", today),
        supabase.from("stories").select("*", { count: "exact", head: true }).eq("user_id", profile.id).gte("created_at", today),
        supabase.from("voice_profiles").select("*", { count: "exact", head: true }).eq("user_id", profile.id).gte("created_at", today),
      ]);

      const lc = listenCount || 0;
      const sc = storyCount || 0;
      const vc = voiceCount || 0;

      setChallenges((prev) =>
        prev.map((c) => {
          let progress = 0;
          if (c.type === "listen") progress = Math.min(lc, c.target);
          else if (c.type === "create") progress = Math.min(sc, c.target);
          else if (c.type === "voice") progress = Math.min(vc, c.target);
          return { ...c, progress, completed: progress >= c.target };
        })
      );

      // Get streak
      const { data: streakData } = await supabase
        .from("reading_streaks")
        .select("current_streak")
        .eq("user_id", profile.id)
        .single();
      setStreak(streakData?.current_streak || 0);

      // Get total XP
      const { data: xpData } = await supabase
        .from("user_badges")
        .select("badge:badge_definitions(xp_reward)")
        .eq("user_id", profile.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const xp = (xpData || []).reduce((sum: number, b: any) => sum + (b.badge?.[0]?.xp_reward || b.badge?.xp_reward || 0), 0);
      setTotalXP(xp);
    } catch {
      // use defaults
    }
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => { load(); }, [load]);

  const completedCount = challenges.filter((c) => c.completed).length;
  const totalReward = challenges.filter((c) => c.completed).reduce((s, c) => s + c.xp_reward, 0);

  return (
    <div className="min-h-screen bg-surface pb-24">
      <div className="px-5 pt-14">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-white flex items-center justify-center shadow-sm">
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-[22px] font-black tracking-tight">Thử Thách Hàng Ngày</h2>
          <Flame size={20} className="text-orange-500" />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2.5 mb-5">
          <div className="bg-white rounded-2xl p-3 text-center shadow-sm">
            <Flame size={20} className="text-orange-500 mx-auto mb-1" />
            <p className="text-[18px] font-black">{streak}</p>
            <p className="text-[10px] text-txt-secondary font-semibold">Streak</p>
          </div>
          <div className="bg-white rounded-2xl p-3 text-center shadow-sm">
            <Star size={20} className="text-amber-500 mx-auto mb-1" />
            <p className="text-[18px] font-black">{totalXP}</p>
            <p className="text-[10px] text-txt-secondary font-semibold">Tổng XP</p>
          </div>
          <div className="bg-white rounded-2xl p-3 text-center shadow-sm">
            <Gift size={20} className="text-purple-500 mx-auto mb-1" />
            <p className="text-[18px] font-black">{completedCount}/{challenges.length}</p>
            <p className="text-[10px] text-txt-secondary font-semibold">Hoàn thành</p>
          </div>
        </div>

        {/* Daily reward banner */}
        {completedCount > 0 && (
          <div className="bg-gradient-to-r from-accent to-pink-500 rounded-2xl p-4 mb-5 text-white">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={16} />
              <p className="text-[14px] font-bold">+{totalReward} XP hôm nay!</p>
            </div>
            <p className="text-[12px] opacity-80">
              Hoàn thành {completedCount}/{challenges.length} thử thách
            </p>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-accent" />
          </div>
        ) : (
          <div className="space-y-3">
            {challenges.map((challenge) => (
              <div
                key={challenge.id}
                className={`bg-white rounded-2xl p-4 shadow-sm transition-all ${
                  challenge.completed ? "opacity-70" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${typeColors[challenge.type]} flex items-center justify-center text-xl flex-shrink-0`}>
                    {challenge.completed ? (
                      <CheckCircle size={22} className="text-white" />
                    ) : (
                      challenge.icon
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className={`text-[14px] font-bold ${challenge.completed ? "line-through text-txt-secondary" : "text-txt"}`}>
                        {challenge.title}
                      </p>
                      <span className="text-[11px] font-bold text-accent flex items-center gap-1">
                        <Star size={10} /> +{challenge.xp_reward} XP
                      </span>
                    </div>
                    <p className="text-[12px] text-txt-secondary mt-0.5">{challenge.description}</p>

                    {/* Progress bar */}
                    <div className="mt-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-semibold text-txt-secondary">
                          {challenge.progress}/{challenge.target}
                        </span>
                        {!challenge.completed && (
                          <span className="text-[10px] text-txt-secondary flex items-center gap-1">
                            <Clock size={9} /> Hôm nay
                          </span>
                        )}
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            challenge.completed ? "bg-green-400" : "bg-accent"
                          }`}
                          style={{ width: `${Math.min((challenge.progress / challenge.target) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* CTA */}
        {!loading && completedCount < challenges.length && (
          <div className="mt-6 text-center">
            <button
              onClick={() => onNavigate("create")}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-accent to-pink-500 text-white text-[14px] font-bold active:scale-95 transition-transform"
            >
              <Sparkles size={16} /> Hoàn thành thử thách
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
