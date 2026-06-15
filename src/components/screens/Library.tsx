"use client";

import { useState, useRef, useCallback } from "react";
import { Sparkles, BookOpen, Loader2, Volume2, Square, Pencil } from "lucide-react";
import { useData } from "@/lib/data-context";
import { gradientFor, iconForCategory, getStoryPages } from "@/lib/db";
import type { Screen } from "@/lib/types";

interface LibraryProps {
  onNavigate: (screen: Screen, data?: Record<string, string>) => void;
}

function StoryIcon({ icon, size = 36 }: { icon: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    flame: <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5Z"/>,
    rabbit: <><path d="M13 16a3 3 0 0 1 2.24 5"/><path d="M18 12h.01"/><path d="M18 21h-8a4 4 0 0 1-4-4 7 7 0 0 1 7-7h.2L9.6 6.4a1.93 1.93 0 1 1 2.8-2.8L15.8 7h.2c3.3 0 6 2.7 6 6v1a2 2 0 0 1-2 2h-1a3 3 0 0 0-3 3"/><path d="M20 8.54V4a2 2 0 1 0-4 0v3"/><path d="M7.612 12.524a3 3 0 1 0-1.6 4.3"/></>,
    castle: <><path d="M22 20v-9H2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2Z"/><path d="M18 11V4H6v7"/><path d="M15 22v-4a3 3 0 0 0-6 0v4"/><path d="M3 11V4h2v2h2V4h2v2h2V4h2v2h2V4h2v2h2V4h2v7"/></>,
    wand: <><path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8 19 13"/><path d="M15 9h0"/><path d="M17.8 6.2 19 5"/><path d="m3 21 9-9"/><path d="M12.2 6.2 11 5"/></>,
    rocket: <><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09Z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2Z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></>,
    paw: <><circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/></>,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: size, height: size }}>
      {paths[icon] || paths.wand}
    </svg>
  );
}

const filters = [
  { id: "all", label: "Tất Cả" },
  { id: "fairy_tale", label: "Cổ Tích" },
  { id: "ai", label: "AI Sáng Tạo" },
  { id: "bedtime", label: "Ru Ngủ" },
];

const categoryLabels: Record<string, string> = {
  fairy_tale: "Cổ tích",
  adventure: "Phiêu lưu",
  bedtime: "Ru ngủ",
  animal: "Động vật",
  educational: "Học chơi",
  custom: "Tùy chỉnh",
};

export default function Library({ onNavigate }: LibraryProps) {
  const { stories, loading } = useData();
  const [activeFilter, setActiveFilter] = useState("all");
  const [playingStoryId, setPlayingStoryId] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const togglePreview = useCallback(async (storyId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Don't navigate to player

    // If already playing this story, stop
    if (playingStoryId === storyId && previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
      setPlayingStoryId(null);
      return;
    }

    // Stop any current playback
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
      setPlayingStoryId(null);
    }

    setLoadingAudio(storyId);
    try {
      const pages = await getStoryPages(storyId);
      const firstPageWithAudio = pages.find((p) => p.audio_url);
      if (!firstPageWithAudio?.audio_url) {
        setLoadingAudio(null);
        return;
      }
      const audio = new Audio(firstPageWithAudio.audio_url);
      previewAudioRef.current = audio;
      audio.onended = () => {
        setPlayingStoryId(null);
        previewAudioRef.current = null;
      };
      await audio.play();
      setPlayingStoryId(storyId);
    } catch {
      // No audio available
    }
    setLoadingAudio(null);
  }, [playingStoryId]);

  const filtered = stories.filter((s) => {
    if (activeFilter === "all") return true;
    if (activeFilter === "ai") return s.source === "ai";
    return s.category === activeFilter;
  });

  return (
    <div className="min-h-screen bg-surface pb-24">
      <div className="px-5 pt-14">
        <h2 className="text-[28px] font-black tracking-tight mb-3.5">
          Thư Viện
        </h2>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold whitespace-nowrap border transition-all ${
                activeFilter === f.id
                  ? "bg-txt text-white border-txt"
                  : "bg-white text-txt-secondary border-gray-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading && stories.length === 0 && (
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-accent" />
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="px-5 pt-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center text-accent mx-auto mb-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <BookOpen size={26} />
          </div>
          <p className="text-[15px] font-bold text-txt mb-1">
            {stories.length === 0 ? "Thư viện trống" : "Không có truyện phù hợp"}
          </p>
          <p className="text-[13px] text-txt-secondary mb-4">
            Tạo truyện AI đầu tiên cho gia đình bạn
          </p>
          <button
            onClick={() => onNavigate("create")}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-accent to-pink-500 text-white text-[14px] font-bold active:scale-95 transition-transform"
          >
            <Sparkles size={16} /> Tạo Truyện
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5 px-5 pt-4">
        {filtered.map((story) => (
          <button
            key={story.id}
            onClick={() => onNavigate("player", { storyId: story.id })}
            className="bg-white rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04)] text-left active:scale-[0.97] transition-transform"
          >
            <div
              className={`h-[90px] bg-gradient-to-br ${gradientFor(story.id)} flex items-center justify-center text-white relative`}
            >
              <StoryIcon icon={iconForCategory(story.category, story.id)} />
              {/* Edit Button */}
              <button
                onClick={(e) => { e.stopPropagation(); onNavigate("editor", { storyId: story.id }); }}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/60 active:scale-90 transition-all"
                title="Chỉnh sửa"
              >
                <Pencil size={13} />
              </button>
              {/* Audio Preview Button */}
              <button
                onClick={(e) => togglePreview(story.id, e)}
                className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/60 active:scale-90 transition-all"
              >
                {loadingAudio === story.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : playingStoryId === story.id ? (
                  <Square size={12} />
                ) : (
                  <Volume2 size={14} />
                )}
              </button>
            </div>
            <div className="p-3 pb-3.5">
              <h5 className="text-[13px] font-bold tracking-tight mb-0.5 truncate">
                {story.title}
              </h5>
              <p className="text-[11px] text-txt-secondary mb-1.5">
                {story.page_count} trang ·{" "}
                {categoryLabels[story.category] || story.category}
              </p>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-orange-100 text-orange-700">
                {story.source === "ai" ? "AI" : "Truyện"}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
