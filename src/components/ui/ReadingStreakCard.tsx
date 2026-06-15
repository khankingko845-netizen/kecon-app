"use client";

import { useState, useEffect } from "react";
import { Flame, BookOpen, Headphones, Trophy } from "lucide-react";
import { getReadingStreak, type ReadingStreakRow } from "@/lib/db";

export default function ReadingStreakCard() {
  const [streak, setStreak] = useState<ReadingStreakRow | null>(null);

  useEffect(() => {
    getReadingStreak().then(setStreak).catch(() => {});
  }, []);

  if (!streak) return null;

  const stats = [
    {
      icon: Flame,
      label: "Chuỗi",
      value: `${streak.current_streak}`,
      unit: "ngày",
      color: "text-orange-500",
      bg: "bg-orange-50",
    },
    {
      icon: Trophy,
      label: "Kỷ lục",
      value: `${streak.longest_streak}`,
      unit: "ngày",
      color: "text-amber-500",
      bg: "bg-amber-50",
    },
    {
      icon: BookOpen,
      label: "Đã đọc",
      value: `${streak.total_stories_read}`,
      unit: "truyện",
      color: "text-blue-500",
      bg: "bg-blue-50",
    },
    {
      icon: Headphones,
      label: "Đã nghe",
      value: `${streak.total_listen_minutes}`,
      unit: "phút",
      color: "text-violet-500",
      bg: "bg-violet-50",
    },
  ];

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
      <div className="flex items-center gap-2 mb-3">
        <Flame size={18} className="text-orange-500" />
        <h3 className="text-[14px] font-extrabold tracking-tight">
          Chuỗi Đọc Truyện
        </h3>
        {streak.current_streak >= 3 && (
          <span className="ml-auto px-2 py-0.5 rounded-md bg-orange-100 text-[10px] font-bold text-orange-600">
            🔥 {streak.current_streak} ngày liên tiếp!
          </span>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`${s.bg} rounded-xl p-2.5 text-center`}
          >
            <s.icon size={16} className={`${s.color} mx-auto mb-1`} />
            <p className="text-[16px] font-black text-txt">{s.value}</p>
            <p className="text-[9px] font-bold text-txt-secondary mt-0.5">
              {s.unit}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
