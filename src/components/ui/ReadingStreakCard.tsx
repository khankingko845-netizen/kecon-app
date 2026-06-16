"use client";

import { useState, useEffect } from "react";
import { Flame, BookOpen, Headphones, Trophy, Star, Zap } from "lucide-react";
import { getReadingStreak, type ReadingStreakRow } from "@/lib/db";

/* ── XP & Level calculations ── */
function calcLevel(totalStories: number, totalMinutes: number, streak: number) {
 const xp = totalStories * 50 + totalMinutes * 2 + streak * 30;
 // Each level requires progressively more XP
 let level = 1;
 let xpForNext = 100;
 let xpAccum = 0;
 while (xp >= xpAccum + xpForNext) {
 xpAccum += xpForNext;
 level++;
 xpForNext = Math.floor(100 * Math.pow(1.3, level - 1));
 }
 const xpInLevel = xp - xpAccum;
 return { level, xp, xpInLevel, xpForNext, progress: xpInLevel / xpForNext };
}

const LEVEL_TITLES = [
 "Bé Mới Đọc", "Bé Ham Đọc", "Nhà Thám Hiểm", "Người Kể Chuyện",
 "Pháp Sư Truyện", "Bậc Thầy Kể", "Huyền Thoại", "Siêu Sao Đọc",
];

/* ── Weekly goal ring (SVG) ── */
function WeeklyRing({ current, goal }: { current: number; goal: number }) {
 const pct = Math.min(current / goal, 1);
 const r = 28;
 const circ = 2 * Math.PI * r;
 const dash = circ * pct;

 return (
 <div className="relative w-[72px] h-[72px] flex items-center justify-center">
 <svg width={72} height={72} className="-rotate-90">
 <circle cx={36} cy={36} r={r} fill="none" stroke="currentColor" strokeWidth={5}
 className="text-gray-100 dark:text-white/10" />
 <circle cx={36} cy={36} r={r} fill="none" strokeWidth={5}
 strokeDasharray={`${dash} ${circ}`}
 strokeLinecap="round"
 className="text-accent transition-all duration-1000 ease-out"
 style={{ filter: pct >= 1 ? "drop-shadow(0 0 6px rgba(255,107,61,0.6))" : "none" }}
 />
 </svg>
 <div className="absolute inset-0 flex flex-col items-center justify-center">
 <span className="text-[15px] font-black dark:text-white">{current}</span>
 <span className="text-[8px] font-bold text-txt-secondary dark:text-white/40">/{goal}</span>
 </div>
 </div>
 );
}

export default function ReadingStreakCard() {
 const [streak, setStreak] = useState<ReadingStreakRow | null>(null);
 const [animate, setAnimate] = useState(false);

 useEffect(() => {
 getReadingStreak().then((s) => {
 setStreak(s);
 // Trigger entrance animation
 setTimeout(() => setAnimate(true), 100);
 }).catch(() => {});
 }, []);

 if (!streak) return null;

 const { level, xp, xpInLevel, xpForNext, progress } = calcLevel(
 streak.total_stories_read, streak.total_listen_minutes, streak.current_streak
 );
 const title = LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)];
 const weeklyGoal = 7; // stories per week
 const weeklyDone = Math.min(streak.current_streak, weeklyGoal);

 const stats = [
 { icon: Flame, value: streak.current_streak, unit: "ngày", color: "text-orange-500", bg: "bg-orange-50 dark:bg-orange-500/10" },
 { icon: Trophy, value: streak.longest_streak, unit: "kỷ lục", color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-500/10" },
 { icon: BookOpen, value: streak.total_stories_read, unit: "truyện", color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-500/10" },
 { icon: Headphones, value: streak.total_listen_minutes, unit: "phút", color: "text-violet-500", bg: "bg-violet-50 dark:bg-violet-500/10" },
 ];

 return (
 <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/5 p-4 shadow-[0_1px_3px_rgba(0,0,0,0.03)] dark:shadow-none">
 {/* Level + XP Bar */}
 <div className="flex items-center gap-3 mb-3">
 <div className="flex items-center gap-2 flex-1">
 <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent to-pink-500 flex items-center justify-center text-white shadow-sm">
 <Zap size={18} />
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-1.5">
 <span className="text-[13px] font-black dark:text-white">Lv.{level}</span>
 <span className="text-[11px] font-bold text-accent">{title}</span>
 </div>
 {/* XP Bar */}
 <div className="mt-1 h-2 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden">
 <div
 className="h-full rounded-full bg-gradient-to-r from-accent to-pink-500 transition-all duration-1000 ease-out"
 style={{ width: animate ? `${Math.max(progress * 100, 3)}%` : "3%" }}
 />
 </div>
 <p className="text-[9px] font-semibold text-txt-secondary dark:text-white/40 mt-0.5">
 {xpInLevel} / {xpForNext} XP
 </p>
 </div>
 </div>

 {/* Weekly Ring */}
 <WeeklyRing current={weeklyDone} goal={weeklyGoal} />
 </div>

 {/* Stats grid */}
 <div className="grid grid-cols-4 gap-2">
 {stats.map((s) => (
 <div key={s.unit} className={`${s.bg} rounded-xl p-2 text-center`}>
 <s.icon size={14} className={`${s.color} mx-auto mb-0.5`} />
 <p className="text-[15px] font-black text-txt dark:text-white">{s.value}</p>
 <p className="text-[9px] font-bold text-txt-secondary dark:text-white/40">{s.unit}</p>
 </div>
 ))}
 </div>

 {/* Streak fire */}
 {streak.current_streak >= 3 && (
 <div className="mt-2.5 flex items-center justify-center gap-1 py-1.5 rounded-xl bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-500/10 dark:to-amber-500/10">
 <Flame size={14} className="text-orange-500" />
 <span className="text-[11px] font-bold text-orange-600 dark:text-orange-400">
 🔥 {streak.current_streak} ngày liên tiếp! Cố lên!
 </span>
 </div>
 )}
 </div>
 );
}
