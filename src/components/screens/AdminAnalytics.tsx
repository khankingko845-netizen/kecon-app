"use client";

import { useState, useEffect } from "react";
import {
  Loader2, TrendingUp, Play, Heart, CheckCircle2, Users, Headphones,
} from "lucide-react";
import TopBar from "@/components/ui/TopBar";
import { getAdminAnalytics, type AdminAnalytics } from "@/lib/db";

interface AdminAnalyticsProps {
  onBack: () => void;
}

const categoryLabels: Record<string, string> = {
  fairy_tale: "Cổ tích",
  adventure: "Phiêu lưu",
  bedtime: "Ru ngủ",
  animal: "Động vật",
  educational: "Học chơi",
  custom: "Tùy chỉnh",
};

export default function AdminAnalytics({ onBack }: AdminAnalyticsProps) {
  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminAnalytics()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const maxPlays = data
    ? Math.max(...data.topStories.map((s) => s.play_count), 1)
    : 1;
  const maxCatPlays = data
    ? Math.max(...data.categoryPlays.map((c) => c.plays), 1)
    : 1;

  return (
    <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-10">
      <TopBar title="Thống kê" onBack={onBack} />

      {loading ? (
        <div className="flex justify-center pt-20">
          <Loader2 size={26} className="animate-spin text-accent" />
        </div>
      ) : !data ? (
        <div className="px-5 pt-4 text-center text-[13px] text-txt-secondary dark:text-white/50">
          Chưa có dữ liệu
        </div>
      ) : (
        <div className="px-5 pt-2">
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-2.5 mb-6">
            <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-2">
                <CheckCircle2 size={17} />
              </div>
              <div className="text-[22px] font-black tracking-tight">
                {Math.round(data.avgCompletion)}%
              </div>
              <div className="text-[11px] text-txt-secondary dark:text-white/50 font-medium">
                Tỷ lệ hoàn thành TB
              </div>
            </div>
            <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
              <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-2">
                <Headphones size={17} />
              </div>
              <div className="text-[22px] font-black tracking-tight">
                {data.totalSessions}
              </div>
              <div className="text-[11px] text-txt-secondary dark:text-white/50 font-medium">
                Phiên nghe
              </div>
            </div>
            <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
              <div className="w-9 h-9 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center mb-2">
                <Users size={17} />
              </div>
              <div className="text-[22px] font-black tracking-tight">
                {data.recentSignups}
              </div>
              <div className="text-[11px] text-txt-secondary dark:text-white/50 font-medium">
                Đăng ký 7 ngày
              </div>
            </div>
            <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
              <div className="w-9 h-9 rounded-xl bg-orange-50 text-accent flex items-center justify-center mb-2">
                <Play size={17} />
              </div>
              <div className="text-[22px] font-black tracking-tight">
                {data.topStories.reduce((s, t) => s + t.play_count, 0)}
              </div>
              <div className="text-[11px] text-txt-secondary dark:text-white/50 font-medium">
                Tổng lượt nghe (top)
              </div>
            </div>
          </div>

          {/* Top stories */}
          <h3 className="text-[15px] font-black tracking-tight mb-2.5 flex items-center gap-1.5">
            <TrendingUp size={16} className="text-accent" /> Truyện phổ biến
          </h3>
          <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 mb-6 shadow-[0_1px_3px_rgba(0,0,0,0.03)] space-y-3">
            {data.topStories.length === 0 ? (
              <p className="text-[13px] text-txt-secondary dark:text-white/50 text-center py-2">
                Chưa có lượt nghe
              </p>
            ) : (
              data.topStories.map((s, i) => (
                <div key={s.id}>
                  <div className="flex justify-between items-center text-[12px] mb-1">
                    <span className="font-semibold truncate flex-1 min-w-0">
                      <span className="text-txt-secondary dark:text-white/50 mr-1.5">{i + 1}.</span>
                      {s.title}
                    </span>
                    <span className="text-txt-secondary dark:text-white/50 flex items-center gap-2 ml-2 shrink-0">
                      <span className="flex items-center gap-0.5">
                        <Play size={10} /> {s.play_count}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <Heart size={10} /> {s.like_count}
                      </span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 dark:bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-accent to-pink-500"
                      style={{ width: `${(s.play_count / maxPlays) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Plays by category */}
          <h3 className="text-[15px] font-black tracking-tight mb-2.5">
            Lượt nghe theo thể loại
          </h3>
          <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.03)] space-y-2.5">
            {data.categoryPlays.length === 0 ? (
              <p className="text-[13px] text-txt-secondary dark:text-white/50 text-center py-2">
                Chưa có dữ liệu
              </p>
            ) : (
              data.categoryPlays.map((c) => (
                <div key={c.category}>
                  <div className="flex justify-between text-[12px] font-semibold mb-1">
                    <span>{categoryLabels[c.category] || c.category}</span>
                    <span className="text-txt-secondary dark:text-white/50">{c.plays}</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 dark:bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-400 to-violet-500"
                      style={{ width: `${(c.plays / maxCatPlays) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
