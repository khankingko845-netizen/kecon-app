"use client";

import { useState, useEffect, useCallback } from "react";
import {
 Clock, Headphones, TrendingUp,
 Calendar, Loader2, Moon,
} from "@/components/ui/icons";
import ParentHeader from "@/components/parent/ParentHeader";
import { useAuth } from "@/lib/auth-context";
import { getUsageHistory, type DailyUsage } from "@/lib/db";
import type { Screen } from "@/lib/types";

interface ParentAnalyticsProps {
 onNavigate: (screen: Screen, data?: Record<string, string>) => void;
 onBack: () => void;
}

export default function ParentAnalytics({ onBack }: ParentAnalyticsProps) {
 const { profile } = useAuth();
 const [usage, setUsage] = useState<DailyUsage[]>([]);
 const [loading, setLoading] = useState(true);
 const [period, setPeriod] = useState<7 | 14 | 30>(7);

 const profileId = profile?.id;
 const load = useCallback(async () => {
 if (!profileId) return;
 setLoading(true);
 try {
 // Days with listening, never a "streak": nothing here can be lost or reset (G-02/G-09).
 setUsage(await getUsageHistory(profileId, period));
 } catch {
 // ignore
 }
 setLoading(false);
 }, [profileId, period]);

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
 const peakMinutes = Math.max(0, ...chartDays.map((d) => d.minutes));

 return (
 <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-24">
 <ParentHeader title="Thống kê của bé" onBack={onBack} />
 <div className="px-5 pt-3">

 {/* Period Selector */}
 <div className="flex gap-2 mb-5" role="group" aria-label="Khoảng thời gian">
 {([7, 14, 30] as const).map((p) => (
 <button
 key={p}
 type="button"
 aria-pressed={period === p}
 onClick={() => setPeriod(p)}
 className={`flex-1 min-h-11 rounded-xl text-[14px] font-bold transition-all ${
 period === p ? "bg-accent text-white" : "bg-white dark:bg-white/[0.04] text-txt-secondary dark:text-white/50 shadow-sm"
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
 <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 shadow-sm">
 <div className="flex items-center gap-2 mb-2">
 <Clock size={16} className="text-blue-500" />
 <span className="text-[12px] font-bold text-txt-secondary dark:text-white/50">Tổng thời gian</span>
 </div>
 <p className="text-[22px] font-black">{totalMinutes}</p>
 <p className="text-[12px] text-txt-secondary dark:text-white/50">phút nghe</p>
 </div>
 <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 shadow-sm">
 <div className="flex items-center gap-2 mb-2">
 <Headphones size={16} className="text-purple-500" />
 <span className="text-[12px] font-bold text-txt-secondary dark:text-white/50">Truyện đã nghe</span>
 </div>
 <p className="text-[22px] font-black">{totalStories}</p>
 <p className="text-[12px] text-txt-secondary dark:text-white/50">lượt nghe</p>
 </div>
 <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 shadow-sm">
 <div className="flex items-center gap-2 mb-2">
 <TrendingUp size={16} className="text-green-500" />
 <span className="text-[12px] font-bold text-txt-secondary dark:text-white/50">Trung bình / ngày</span>
 </div>
 <p className="text-[22px] font-black">{avgMinutes}</p>
 <p className="text-[12px] text-txt-secondary dark:text-white/50">phút / ngày</p>
 </div>
 <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 shadow-sm">
 <div className="flex items-center gap-2 mb-2">
 <Moon size={16} className="text-indigo-500" />
 <span className="text-[12px] font-bold text-txt-secondary dark:text-white/50">Ngày có nghe</span>
 </div>
 <p className="text-[22px] font-black">{activeDays}</p>
 <p className="text-[12px] text-txt-secondary dark:text-white/50">trên {period} ngày</p>
 </div>
 </div>

 {/* Activity Chart */}
 <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 mb-5 shadow-sm">
 <div className="flex items-center gap-2 mb-4">
 <Calendar size={16} className="text-txt-secondary dark:text-white/50" />
 <p className="text-[13px] font-bold">Thời gian nghe ({period} ngày)</p>
 </div>
 <div
 className="flex items-end gap-1 h-32"
 role="img"
 aria-label={`Thời gian nghe ${period} ngày: tổng ${totalMinutes} phút, nhiều nhất ${peakMinutes} phút một ngày`}
 >
 {chartDays.map((day, i) => {
 const height = Math.max(4, (day.minutes / maxMinutes) * 100);
 const dayLabel = new Date(day.date).toLocaleDateString("vi", { weekday: "narrow" });
 return (
 <div key={i} className="flex-1 flex flex-col items-center gap-1" aria-hidden>
 <div className="w-full flex flex-col items-center justify-end" style={{ height: 100 }}>
 {period === 7 && day.minutes > 0 && (
 <span className="text-[12px] font-bold text-accent mb-0.5">{day.minutes}p</span>
 )}
 <div
 className={`w-full rounded-t-md transition-all ${
 day.minutes > 0 ? "bg-accent" : "bg-gray-100 dark:bg-white/[0.06]"
 }`}
 style={{ height: `${height}%`, minHeight: 4 }}
 />
 </div>
 {period === 7 && <span className="text-[12px] text-txt-secondary dark:text-white/50">{dayLabel}</span>}
 </div>
 );
 })}
 </div>
 {period !== 7 && (
 <p className="mt-2 text-[12px] text-txt-secondary dark:text-white/50">Mỗi cột là một ngày, cũ nhất bên trái.</p>
 )}
 </div>

 {/* Summary */}
 <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 shadow-sm">
 <div className="flex justify-between text-[14px]">
 <span className="text-txt-secondary dark:text-white/50">Truyện đã tạo</span>
 <span className="font-bold">{totalCreated} truyện</span>
 </div>
 </div>
 </>
 )}
 </div>
 </div>
 );
}
