"use client";

import { useEffect, useState } from "react";
import {
  Search, Moon, Play, User, UserRound, Plus, Sparkles,
  Upload, LayoutDashboard, TrendingUp, Heart,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useData } from "@/lib/data-context";
import { useSettings } from "@/lib/settings-context";
import { gradientFor, iconForCategory } from "@/lib/db";
import { getRecommendations, type ScoredStory } from "@/lib/recommendations";
import type { StoryRow } from "@/lib/db";
import type { Screen } from "@/lib/types";

interface HomeProps {
  onNavigate: (screen: Screen, data?: Record<string, string>) => void;
}

function StoryIcon({ icon }: { icon: string }) {
  const iconMap: Record<string, React.ReactNode> = {
    flame: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5Z"/></svg>,
    rabbit: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7"><path d="M13 16a3 3 0 0 1 2.24 5"/><path d="M18 12h.01"/><path d="M18 21h-8a4 4 0 0 1-4-4 7 7 0 0 1 7-7h.2L9.6 6.4a1.93 1.93 0 1 1 2.8-2.8L15.8 7h.2c3.3 0 6 2.7 6 6v1a2 2 0 0 1-2 2h-1a3 3 0 0 0-3 3"/><path d="M20 8.54V4a2 2 0 1 0-4 0v3"/><path d="M7.612 12.524a3 3 0 1 0-1.6 4.3"/></svg>,
    castle: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7"><path d="M22 20v-9H2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2Z"/><path d="M18 11V4H6v7"/><path d="M15 22v-4a3 3 0 0 0-6 0v4"/><path d="M3 11V4h2v2h2V4h2v2h2V4h2v2h2V4h2v2h2V4h2v7"/></svg>,
    wand: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7"><path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8 19 13"/><path d="M15 9h0"/><path d="M17.8 6.2 19 5"/><path d="m3 21 9-9"/><path d="M12.2 6.2 11 5"/></svg>,
    rocket: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09Z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2Z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>,
    paw: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7"><circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/></svg>,
  };
  return <>{iconMap[icon] || iconMap.wand}</>;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return { text: "Chào buổi sáng", showMoon: false };
  if (h < 18) return { text: "Chào buổi chiều", showMoon: false };
  return { text: "Chào buổi tối", showMoon: true };
}

export default function Home({ onNavigate }: HomeProps) {
  const { profile, isAdmin } = useAuth();
  const { voiceProfiles, stories, loading } = useData();
  const { settings } = useSettings();
  const [forYou, setForYou] = useState<ScoredStory[]>([]);
  const [trending, setTrending] = useState<StoryRow[]>([]);

  const familyName = profile?.family_name?.trim() || profile?.display_name || "bạn";
  const initial = (familyName[0] || "K").toUpperCase();
  const g = greeting();
  const recent = stories.slice(0, 3);

  useEffect(() => {
    getRecommendations({ childAge: settings.childAge })
      .then((rec) => {
        setForYou(rec.forYou);
        setTrending(rec.trending);
      })
      .catch(() => {});
  }, [settings.childAge, stories.length]);

  return (
    <div className="min-h-screen bg-surface pb-24">
      {/* Header */}
      <div className="px-5 pt-14 pb-4">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-sm text-txt-secondary font-medium flex items-center gap-1">
              {g.text} {g.showMoon && <Moon size={14} />}
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight mt-0.5">
              Gia đình {familyName}
            </h1>
          </div>
          <div className="w-11 h-11 rounded-[14px] bg-gradient-to-br from-accent to-amber-400 flex items-center justify-center text-white text-xl font-bold">
            {initial}
          </div>
        </div>
      </div>

      {/* Search */}
      <button
        onClick={() => onNavigate("library")}
        className="mx-5 w-[calc(100%-2.5rem)] bg-white rounded-[14px] px-4 py-3.5 flex items-center gap-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
      >
        <Search size={18} className="text-gray-400" />
        <span className="text-sm text-gray-400">Tìm truyện, chủ đề...</span>
      </button>

      {/* Voice Profiles */}
      <div className="px-5 pt-5">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-base font-extrabold tracking-tight">Giọng Đọc</h3>
          <button
            onClick={() => onNavigate("profiles")}
            className="text-sm text-accent font-semibold"
          >
            Quản lý ›
          </button>
        </div>
        <div className="flex gap-3.5 overflow-x-auto no-scrollbar pb-1">
          {voiceProfiles.map((v) => (
            <button
              key={v.id}
              onClick={() => onNavigate("profiles")}
              className="text-center shrink-0"
            >
              <div
                className={`w-14 h-14 rounded-[18px] bg-gradient-to-br ${gradientFor(v.id)} flex items-center justify-center text-white mb-1.5`}
              >
                {v.gender === "female" ? <UserRound size={24} /> : <User size={24} />}
              </div>
              <span className="text-[11px] font-bold text-txt block max-w-[56px] truncate">
                {v.name}
              </span>
            </button>
          ))}
          <button
            onClick={() => onNavigate("recording")}
            className="text-center shrink-0"
          >
            <div className="w-14 h-14 rounded-[18px] border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 mb-1.5">
              <Plus size={20} />
            </div>
            <span className="text-[11px] font-bold text-txt">Thêm</span>
          </button>
        </div>
      </div>

      {/* Quick actions */}
      <div className="px-5 pt-5 grid grid-cols-2 gap-2.5">
        <button
          onClick={() => onNavigate("upload")}
          className="bg-white rounded-2xl p-3.5 flex items-center gap-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] active:scale-[0.98] transition-transform"
        >
          <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
            <Upload size={17} />
          </div>
          <span className="text-[13px] font-bold text-txt">Tải truyện</span>
        </button>
        {isAdmin && (
          <button
            onClick={() => onNavigate("admin")}
            className="bg-white rounded-2xl p-3.5 flex items-center gap-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] active:scale-[0.98] transition-transform"
          >
            <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center text-violet-600">
              <LayoutDashboard size={17} />
            </div>
            <span className="text-[13px] font-bold text-txt">Quản trị</span>
          </button>
        )}
      </div>

      {/* For You (AI recommendations) */}
      {forYou.length > 0 && (
        <div className="px-5 pt-5">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-base font-extrabold tracking-tight flex items-center gap-1.5">
              <Sparkles size={16} className="text-accent" /> Dành cho bé
            </h3>
          </div>
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
            {forYou.map(({ story, reason }) => (
              <button
                key={story.id}
                onClick={() => onNavigate("player", { storyId: story.id })}
                className="shrink-0 w-36 text-left active:scale-[0.98] transition-transform"
              >
                <div
                  className={`w-36 h-24 rounded-2xl bg-gradient-to-br ${gradientFor(story.id)} flex items-center justify-center text-white mb-1.5`}
                >
                  <StoryIcon icon={iconForCategory(story.category, story.id)} />
                </div>
                <p className="text-[13px] font-bold truncate">{story.title}</p>
                <p className="text-[11px] text-accent font-semibold truncate">{reason}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Trending */}
      {trending.length > 0 && (
        <div className="px-5 pt-5">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-base font-extrabold tracking-tight flex items-center gap-1.5">
              <TrendingUp size={16} className="text-pink-500" /> Đang thịnh hành
            </h3>
          </div>
          <div className="space-y-2.5">
            {trending.slice(0, 3).map((story) => (
              <button
                key={story.id}
                onClick={() => onNavigate("player", { storyId: story.id })}
                className="w-full bg-white rounded-2xl p-3 flex items-center gap-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)] active:scale-[0.98] transition-transform"
              >
                <div
                  className={`w-12 h-12 rounded-[12px] bg-gradient-to-br ${gradientFor(story.id)} flex items-center justify-center text-white shrink-0`}
                >
                  <StoryIcon icon={iconForCategory(story.category, story.id)} />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-[14px] font-bold truncate">{story.title}</p>
                  <p className="text-[11px] text-txt-secondary flex items-center gap-1">
                    <Heart size={11} /> {story.like_count} · <Play size={11} /> {story.play_count}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recent Stories */}
      <div className="px-5 pt-5">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-base font-extrabold tracking-tight">Nghe Gần Đây</h3>
          <button
            onClick={() => onNavigate("library")}
            className="text-sm text-accent font-semibold"
          >
            Xem tất cả ›
          </button>
        </div>

        {recent.length === 0 ? (
          <button
            onClick={() => onNavigate("create")}
            className="w-full bg-white rounded-2xl p-5 flex flex-col items-center gap-2 shadow-[0_1px_3px_rgba(0,0,0,0.04)] active:scale-[0.98] transition-transform"
          >
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-accent to-pink-500 flex items-center justify-center text-white">
              <Sparkles size={22} />
            </div>
            <p className="text-[14px] font-bold text-txt">
              {loading ? "Đang tải..." : "Chưa có truyện nào"}
            </p>
            <p className="text-[12px] text-txt-secondary">Tạo truyện AI đầu tiên cho bé</p>
          </button>
        ) : (
          <div className="space-y-2.5">
            {recent.map((story) => (
              <button
                key={story.id}
                onClick={() => onNavigate("player", { storyId: story.id })}
                className="w-full bg-white rounded-2xl p-3.5 flex items-center gap-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] active:scale-[0.98] transition-transform"
              >
                <div
                  className={`w-14 h-14 rounded-[14px] bg-gradient-to-br ${gradientFor(story.id)} flex items-center justify-center text-white shrink-0`}
                >
                  <StoryIcon icon={iconForCategory(story.category, story.id)} />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-[15px] font-bold tracking-tight truncate">
                    {story.title}
                  </div>
                  <div className="text-xs text-txt-secondary font-medium mt-0.5">
                    {story.page_count} trang
                    {story.description ? ` · ${story.description.slice(0, 30)}` : ""}
                  </div>
                </div>
                <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center text-white shrink-0">
                  <Play size={14} fill="white" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
