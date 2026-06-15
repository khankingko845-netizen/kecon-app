"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, Trophy, Star, Zap, Target, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  getAllBadges, getUserBadges, getProfileXP, checkAndAwardBadges,
  type BadgeDefinition, type UserBadge,
} from "@/lib/db";
import type { Screen } from "@/lib/types";

interface AchievementsProps {
  onNavigate: (screen: Screen, data?: Record<string, string>) => void;
  onBack: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  general: "Tổng hợp",
  creative: "Sáng tạo",
  streak: "Kiên trì",
  explorer: "Khám phá",
  social: "Cộng đồng",
};

const CATEGORY_COLORS: Record<string, string> = {
  general: "from-blue-500 to-cyan-400",
  creative: "from-purple-500 to-pink-400",
  streak: "from-orange-500 to-amber-400",
  explorer: "from-emerald-500 to-teal-400",
  social: "from-rose-500 to-red-400",
};

export default function Achievements({ onBack }: AchievementsProps) {
  const { profile } = useAuth();
  const [allBadges, setAllBadges] = useState<BadgeDefinition[]>([]);
  const [userBadges, setUserBadges] = useState<UserBadge[]>([]);
  const [xp, setXp] = useState(0);
  const [level, setLevel] = useState(1);
  const [loading, setLoading] = useState(true);
  const [newBadges, setNewBadges] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const [badges, earned, xpData, freshBadges] = await Promise.all([
        getAllBadges(),
        getUserBadges(profile.id),
        getProfileXP(profile.id),
        checkAndAwardBadges(profile.id),
      ]);
      setAllBadges(badges);
      setUserBadges(earned);
      setXp(xpData.xp);
      setLevel(xpData.level);
      if (freshBadges.length > 0) {
        setNewBadges(freshBadges);
        // Reload badges to include newly awarded
        const updated = await getUserBadges(profile.id);
        setUserBadges(updated);
        const updatedXp = await getProfileXP(profile.id);
        setXp(updatedXp.xp);
        setLevel(updatedXp.level);
      }
    } catch {
      // silently fail
    }
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => { load(); }, [load]);

  const earnedSet = new Set(userBadges.map((b) => b.badge_id));
  const earnedCount = userBadges.length;
  const totalCount = allBadges.length;

  // Group by category
  const categories = [...new Set(allBadges.map((b) => b.category))];

  // XP to next level
  const nextLevelXp = level * level * 100;
  const prevLevelXp = (level - 1) * (level - 1) * 100;
  const progress = Math.min(100, ((xp - prevLevelXp) / (nextLevelXp - prevLevelXp)) * 100);

  return (
    <div className="min-h-screen bg-surface pb-24">
      <div className="px-5 pt-14">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-white flex items-center justify-center shadow-sm">
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-[24px] font-black tracking-tight">Thành Tích</h2>
        </div>

        {/* XP & Level Card */}
        <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl p-5 text-white mb-5 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl font-black">
                {level}
              </div>
              <div>
                <p className="text-[11px] font-bold text-white/70 uppercase">Level</p>
                <p className="text-[18px] font-black">
                  {xp.toLocaleString()} XP
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-bold text-white/70">Huy hiệu</p>
              <p className="text-[20px] font-black">{earnedCount}/{totalCount}</p>
            </div>
          </div>
          <div className="h-2 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[10px] text-white/60 mt-1 text-right">
            {nextLevelXp - xp} XP đến Level {level + 1}
          </p>
        </div>

        {/* New badge notification */}
        {newBadges.length > 0 && (
          <div className="bg-gradient-to-r from-yellow-50 to-amber-50 border border-amber-200 rounded-xl p-4 mb-5 flex items-center gap-3">
            <div className="text-3xl">🎉</div>
            <div>
              <p className="text-[13px] font-bold text-amber-800">Chúc mừng! Huy hiệu mới!</p>
              <p className="text-[11px] text-amber-600">
                Bạn vừa nhận {newBadges.length} huy hiệu mới
              </p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-accent" />
          </div>
        ) : (
          /* Badge Categories */
          categories.map((cat) => {
            const catBadges = allBadges.filter((b) => b.category === cat);
            return (
              <div key={cat} className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${CATEGORY_COLORS[cat] || "from-gray-400 to-gray-500"} flex items-center justify-center`}>
                    {cat === "streak" ? <Zap size={14} className="text-white" /> :
                     cat === "creative" ? <Star size={14} className="text-white" /> :
                     cat === "explorer" ? <Target size={14} className="text-white" /> :
                     <Trophy size={14} className="text-white" />}
                  </div>
                  <h3 className="text-[15px] font-bold">{CATEGORY_LABELS[cat] || cat}</h3>
                  <span className="text-[11px] text-txt-secondary ml-auto">
                    {catBadges.filter((b) => earnedSet.has(b.id)).length}/{catBadges.length}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {catBadges.map((badge) => {
                    const earned = earnedSet.has(badge.id);
                    const isNew = newBadges.includes(badge.id);
                    return (
                      <div
                        key={badge.id}
                        className={`bg-white rounded-xl p-3 text-center transition-all ${
                          earned
                            ? isNew ? "ring-2 ring-amber-400 shadow-lg" : "shadow-sm"
                            : "opacity-40 grayscale"
                        }`}
                      >
                        <div className="text-2xl mb-1">{badge.icon}</div>
                        <p className="text-[11px] font-bold leading-tight mb-0.5">{badge.name}</p>
                        <p className="text-[9px] text-txt-secondary leading-tight">{badge.description}</p>
                        <p className="text-[9px] font-bold text-accent mt-1">+{badge.xp_reward} XP</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
