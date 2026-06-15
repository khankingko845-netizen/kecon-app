"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ChevronLeft, BarChart3, Clock, BookOpen, Headphones, TrendingUp,
  Calendar, Loader2, Flame,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getUsageHistory, getReadingStreak, type DailyUsage } from "@/lib/db";
import type { Screen } from "@/lib/types";

interface ParentAnalyticsProps {
  onNavigate: (screen: Screen, data?: Record<string, string>) => void;
  onBack: () => void;
}

export default function ParentAnalytics({ onBack }: ParentAnalyticsProps) {
  const { profile } = useAuth();
  const [usage, setUsage] = useState<DailyUsage[]>([]);
  const [streak, setStreak] = useState({ current: 0, longest: 0 });
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<7 | 14 | 30>(7);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const [usageData, streakData] = await Promise.all([
        getUsageHistory(profile.id, period),
        getReadingStreak(),
      ]);
      setUsage(usageData);
      setStreak({
        current: streakData?.current_streak || 0,
        longest: streakData?.longest_streak || 0,
      });
    } catch {
      // ignore
    }
    setLoading(false);
  }, [profile?.id, period]);

  useEffect(() => { load(); }, [load]);

  // Aggregate stats
  const totalMinutes = usage.reduce((s, u) => s + (u.listening_minutes || 0), 0);
  const totalStories = usage.reduce((s, u) => s + (u.stories_played || 0), 0);
  const totalCreated = usage.reduce((s, u) => s + (u.stories_created || 0), 0);
  const avgMinutes = usage.length > 0 ? Math.round(totalMinutes / usage.length) : 0;
  const activeDays = usage.filter((u) => (u.listening_minutes || 0) > 0).length;

  // Build chart data (last N days, fill gaps)
  const chartDays: { date: string; minutes: number; stories: number }[] = [];
  for (let i = period - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    const dayUsage = usage.find((u) => u.usage_date === dateStr);
    chartDays.push({
      date: dateStr,
      minutes: dayUsage?.listening_minutes || 0,
      stories: dayUsage?.stories_played || 0,
    });
  }
  const maxMinutes = Math.max(1, ...chartDays.map((d) => d.minutes));

  return (
    <div className="min-h-screen bg-surface pb-24">
      <div className="px-5 pt-14">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-white flex items-center justify-center shadow-sm">
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-[24px] font-black tracking-tight">Thống Kê Bé</h2>
          <BarChart3 size={22} className="text-accent ml-1" />
        </div>

        {/* Period Selector */}
        <div className="flex gap-2 mb-5">
          {([7, 14, 30] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`flex-1 py-2 rounded-xl text-[12px] font-bold transition-all ${
                period === p ? "bg-accent text-white" : "bg-white text-txt-secondary shadow-sm"
              }`}
            >
              {p} ngày
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-accent" />
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <Clock size={16} className="text-blue-500" />
                  <span className="text-[11px] font-bold text-txt-secondary">Tổng thời gian</span>
                </div>
                <p className="text-[22px] font-black">{totalMinutes}</p>
                <p className="text-[11px] text-txt-secondary">phút nghe</p>
              </div>
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <Headphones size={16} className="text-purple-500" />
                  <span className="text-[11px] font-bold text-txt-secondary">Truyện đã nghe</span>
                </div>
                <p className="text-[22px] font-black">{totalStories}</p>
                <p className="text-[11px] text-txt-secondary">lượt nghe</p>
              </div>
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp size={16} className="text-green-500" />
                  <span className="text-[11px] font-bold text-txt-secondary">Trung bình / ngày</span>
                </div>
                <p className="text-[22px] font-black">{avgMinutes}</p>
                <p className="text-[11px] text-txt-secondary">phút / ngày</p>
              </div>
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <Flame size={16} className="text-orange-500" />
                  <span className="text-[11px] font-bold text-txt-secondary">Streak hiện tại</span>
                </div>
                <p className="text-[22px] font-black">{streak.current}</p>
                <p className="text-[11px] text-txt-secondary">ngày liên tục (kỷ lục: {streak.longest})</p>
              </div>
            </div>

            {/* Activity Chart */}
            <div className="bg-white rounded-2xl p-4 mb-5 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <Calendar size={16} className="text-txt-secondary" />
                <p className="text-[13px] font-bold">Thời gian nghe ({period} ngày)</p>
              </div>
              <div className="flex items-end gap-1 h-32">
                {chartDays.map((day, i) => {
                  const height = Math.max(4, (day.minutes / maxMinutes) * 100);
                  const dayLabel = new Date(day.date).toLocaleDateString("vi", { weekday: "narrow" });
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full flex flex-col items-center justify-end" style={{ height: 100 }}>
                        {day.minutes > 0 && (
                          <span className="text-[8px] font-bold text-accent mb-0.5">{day.minutes}p</span>
                        )}
                        <div
                          className={`w-full rounded-t-md transition-all ${
                            day.minutes > 0 ? "bg-accent" : "bg-gray-100"
                          }`}
                          style={{ height: `${height}%`, minHeight: 4 }}
                        />
                      </div>
                      <span className="text-[8px] text-txt-secondary">{dayLabel}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Summary */}
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <BookOpen size={16} className="text-txt-secondary" />
                <p className="text-[13px] font-bold">Tổng quan</p>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-[12px]">
                  <span className="text-txt-secondary">Ngày hoạt động</span>
                  <span className="font-bold">{activeDays}/{period} ngày</span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-txt-secondary">Truyện đã tạo</span>
                  <span className="font-bold">{totalCreated} truyện</span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-txt-secondary">Streak dài nhất</span>
                  <span className="font-bold">{streak.longest} ngày</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
