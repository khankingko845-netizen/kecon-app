"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { BookOpen, Loader2, Volume2, Square, Pencil, Search, X, SortAsc, SortDesc, Play, Heart, Share2, Trash2 } from "lucide-react";
import { useData } from "@/lib/data-context";
import { gradientFor, iconForCategory, getStoryPages } from "@/lib/db";
import { LibrarySkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import EmptyState from "@/components/ui/EmptyState";
import LongPressMenu from "@/components/ui/LongPressMenu";
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
  { id: "all", label: "Tất Cả", emoji: "📚" },
  { id: "fairy_tale", label: "Cổ Tích", emoji: "🏰" },
  { id: "adventure", label: "Phiêu Lưu", emoji: "🚀" },
  { id: "bedtime", label: "Ru Ngủ", emoji: "🌙" },
  { id: "animal", label: "Động Vật", emoji: "🐰" },
  { id: "educational", label: "Học Chơi", emoji: "📖" },
  { id: "ai", label: "AI Tạo", emoji: "✨" },
  { id: "custom", label: "Tùy Chỉnh", emoji: "🎨" },
];

const categoryLabels: Record<string, string> = {
  fairy_tale: "Cổ tích",
  adventure: "Phiêu lưu",
  bedtime: "Ru ngủ",
  animal: "Động vật",
  educational: "Học chơi",
  custom: "Tùy chỉnh",
};

type SortBy = "newest" | "oldest" | "name" | "popular";

export default function Library({ onNavigate }: LibraryProps) {
  const { stories, loading, refreshStories } = useData();
  const { toast } = useToast();
  const [activeFilter, setActiveFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const [playingStoryId, setPlayingStoryId] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const togglePreview = useCallback(async (storyId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (playingStoryId === storyId && previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
      setPlayingStoryId(null);
      return;
    }
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
      setPlayingStoryId(null);
    }
    setLoadingAudio(storyId);
    try {
      const pages = await getStoryPages(storyId);
      const firstPageWithAudio = pages.find((p) => p.audio_url);
      if (!firstPageWithAudio?.audio_url) { setLoadingAudio(null); return; }
      const audio = new Audio(firstPageWithAudio.audio_url);
      previewAudioRef.current = audio;
      audio.onended = () => { setPlayingStoryId(null); previewAudioRef.current = null; };
      await audio.play();
      setPlayingStoryId(storyId);
    } catch { /* no audio */ }
    setLoadingAudio(null);
  }, [playingStoryId]);

  const filtered = useMemo(() => {
    let result = stories.filter((s) => {
      if (activeFilter === "all") return true;
      if (activeFilter === "ai") return s.source === "ai";
      return s.category === activeFilter;
    });

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          (s.description || "").toLowerCase().includes(q) ||
          (s.category || "").toLowerCase().includes(q)
      );
    }

    // Sort
    switch (sortBy) {
      case "oldest":
        result = [...result].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        break;
      case "name":
        result = [...result].sort((a, b) => a.title.localeCompare(b.title, "vi"));
        break;
      case "popular":
        result = [...result].sort((a, b) => (b.play_count || 0) - (a.play_count || 0));
        break;
      default: // newest — already default from DB
        break;
    }

    return result;
  }, [stories, activeFilter, searchQuery, sortBy]);

  return (
    <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-24">
      <div className="px-5 pt-14">
        {/* Header */}
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="text-[28px] font-black tracking-tight dark:text-white">Thư Viện</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowSearch(!showSearch); if (!showSearch) setTimeout(() => searchRef.current?.focus(), 100); }}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${showSearch ? "bg-accent text-white" : "bg-white dark:bg-white/10 shadow-sm text-txt dark:text-white"}`}
            >
              <Search size={16} />
            </button>
            <button
              onClick={() => setSortBy((s) => s === "newest" ? "oldest" : s === "oldest" ? "name" : s === "name" ? "popular" : "newest")}
              className="w-9 h-9 rounded-xl bg-white dark:bg-white/10 flex items-center justify-center shadow-sm dark:text-white"
              title={`Sắp xếp: ${sortBy}`}
            >
              {sortBy === "oldest" ? <SortAsc size={16} /> : <SortDesc size={16} />}
            </button>
          </div>
        </div>

        {/* Search Bar */}
        {showSearch && (
          <div className="relative mb-3">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-white/30" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo tên, mô tả, thể loại..."
              className="w-full pl-10 pr-10 py-3 rounded-xl bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[14px] font-medium outline-none focus:border-accent transition-colors dark:text-white"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-white/30">
                <X size={16} />
              </button>
            )}
          </div>
        )}

        {/* Sort label */}
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar flex-1">
            {filters.map((f) => (
              <button
                key={f.id}
                onClick={() => setActiveFilter(f.id)}
                className={`px-3 py-2 rounded-[10px] text-[12px] font-semibold whitespace-nowrap border transition-all flex items-center gap-1 ${
                  activeFilter === f.id
                    ? "bg-txt text-white border-txt dark:bg-accent dark:border-accent"
                    : "bg-white dark:bg-white/5 text-txt-secondary dark:text-white/50 border-gray-200 dark:border-white/10"
                }`}
              >
                <span>{f.emoji}</span> {f.label}
              </button>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-txt-secondary dark:text-white/50 mb-2">
          {filtered.length} truyện
          {sortBy !== "newest" && ` · ${sortBy === "oldest" ? "Cũ nhất" : sortBy === "name" ? "A→Z" : "Phổ biến"}`}
        </p>
      </div>

      {loading && stories.length === 0 && (
        <LibrarySkeleton />
      )}

      {!loading && filtered.length === 0 && (
        <EmptyState
          type={searchQuery ? "search" : "library"}
          query={searchQuery || undefined}
          onAction={searchQuery ? undefined : () => onNavigate("create")}
        />
      )}

      <div className="grid grid-cols-2 gap-2.5 px-5 pt-2">
        {filtered.map((story) => (
          <LongPressMenu
            key={story.id}
            items={[
              { id: "play", icon: Play, label: "Nghe truyện", color: "text-accent" },
              { id: "edit", icon: Pencil, label: "Chỉnh sửa", color: "text-blue-500" },
              { id: "favorite", icon: Heart, label: "Yêu thích", color: "text-pink-500" },
              { id: "share", icon: Share2, label: "Chia sẻ", color: "text-emerald-500" },
              { id: "delete", icon: Trash2, label: "Xoá", destructive: true },
            ]}
            onSelect={(action) => {
              if (action === "play") onNavigate("player", { storyId: story.id });
              else if (action === "edit") onNavigate("editor", { storyId: story.id });
              else if (action === "share") { navigator.share?.({ title: story.title, url: window.location.href }).catch(() => {}); }
              else if (action === "delete") { toast("info", "Tính năng xoá đang phát triển"); }
              else if (action === "favorite") { toast("success", "Đã thêm vào yêu thích ❤️"); }
            }}
          >
          <button
            onClick={() => onNavigate("player", { storyId: story.id })}
            className="bg-white dark:bg-white/5 rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-none text-left active:scale-[0.97] transition-transform w-full"
          >
            <div className={`h-[90px] bg-gradient-to-br ${gradientFor(story.id)} flex items-center justify-center text-white relative`}>
              <StoryIcon icon={iconForCategory(story.category, story.id)} />
              <button
                onClick={(e) => { e.stopPropagation(); onNavigate("editor", { storyId: story.id }); }}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/60 active:scale-90 transition-all"
                title="Chỉnh sửa"
              >
                <Pencil size={13} />
              </button>
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
              <h5 className="text-[13px] font-bold tracking-tight mb-0.5 truncate dark:text-white">{story.title}</h5>
              <p className="text-[11px] text-txt-secondary dark:text-white/50 mb-1.5">
                {story.page_count} trang · {categoryLabels[story.category] || story.category}
              </p>
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-orange-100 text-orange-700">
                  {story.source === "ai" ? "AI" : "Truyện"}
                </span>
                {(story.play_count || 0) > 0 && (
                  <span className="text-[10px] text-txt-secondary dark:text-white/50">▶ {story.play_count}</span>
                )}
              </div>
            </div>
          </button>
          </LongPressMenu>
        ))}
      </div>
    </div>
  );
}
