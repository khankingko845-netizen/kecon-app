"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { Volume2, Square, Pencil, Search, X, SortAsc, SortDesc, Play, Heart, Share2, Trash2 } from "@/components/ui/icons";
import { GlowDots } from "@/components/ui/states";
import { useKidStories } from "@/lib/parental-controls-context";
import { isCategoryAllowed } from "@/lib/content-filter";
import { getStoryPages } from "@/lib/db";
import { LibrarySkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import EmptyState from "@/components/ui/EmptyState";
import { CategoryIcon } from "@/components/ui/Icon3D";
import { CARD_SHADOW } from "@/components/ui/kit";
import LongPressMenu from "@/components/ui/LongPressMenu";
import type { Screen } from "@/lib/types";

interface LibraryProps {
 onNavigate: (screen: Screen, data?: Record<string, string>) => void;
 /** Pre-selected topic (Home "Chủ đề" tiles). */
 initialCategory?: string;
}


const filters = [
 { id: "all", label: "Tất cả" },
 { id: "fairy_tale", label: "Cổ tích" },
 { id: "adventure", label: "Phiêu lưu" },
 { id: "bedtime", label: "Ru ngủ" },
 { id: "animal", label: "Động vật" },
 { id: "educational", label: "Học chơi" },
 { id: "folk", label: "Dân gian" },
 { id: "ai", label: "Đóm sáng tác" },
 { id: "custom", label: "Của nhà mình" },
];

const SORT_LABEL: Record<SortBy, string> = { newest: "Mới nhất", oldest: "Cũ nhất", name: "A→Z", popular: "Nghe nhiều" };

/** Soft cover tints per topic — pastel, never saturated gradients (concept board). */
const COVER_TINT: Record<string, string> = {
 fairy_tale: "bg-[#FDEBDD]",
 adventure: "bg-[#E4EEFF]",
 bedtime: "bg-[#ECE9FF]",
 animal: "bg-[#FFE9E2]",
 educational: "bg-[#E3F8F1]",
 folk: "bg-[#FFF0C7]",
};

const categoryLabels: Record<string, string> = {
 fairy_tale: "Cổ tích",
 adventure: "Phiêu lưu",
 bedtime: "Ru ngủ",
 animal: "Động vật",
 educational: "Học chơi",
 folk: "Dân gian",
 custom: "Của nhà mình",
};

type SortBy = "newest" | "oldest" | "name" | "popular";

export default function Library({ onNavigate, initialCategory }: LibraryProps) {
 // T19: stories hidden by Parental controls never reach the kid library.
 const { stories, loading, contentRules } = useKidStories();
 const { toast } = useToast();
 const [activeFilter, setActiveFilter] = useState(initialCategory || "all");
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
 <div className="min-h-screen bg-cream pb-32">
 <div className="px-5 pt-12">
 {/* Header (board: Baloo title + round white icon buttons) */}
 <div className="mb-3 flex items-center justify-between">
 <h1 className="font-display text-[28px] font-bold leading-tight text-ink">Thư viện</h1>
 <div className="flex items-center gap-2">
 <button
 type="button"
 aria-label="Tìm truyện"
 aria-pressed={showSearch}
 onClick={() => { setShowSearch(!showSearch); if (!showSearch) setTimeout(() => searchRef.current?.focus(), 100); }}
 className={`flex h-11 w-11 items-center justify-center rounded-2xl transition-colors ${showSearch ? "bg-brand text-white" : `bg-white text-ink ${CARD_SHADOW}`}`}
 >
 <Search size={20} />
 </button>
 <button
 type="button"
 onClick={() => setSortBy((s) => s === "newest" ? "oldest" : s === "oldest" ? "name" : s === "name" ? "popular" : "newest")}
 className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-ink ${CARD_SHADOW}`}
 aria-label={`Sắp xếp: ${SORT_LABEL[sortBy]}`}
 >
 {sortBy === "oldest" ? <SortAsc size={20} /> : <SortDesc size={20} />}
 </button>
 </div>
 </div>

 {showSearch && (
 <div className="relative mb-3">
 <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-2" />
 <input
 ref={searchRef}
 type="text"
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 placeholder="Tìm truyện, chủ đề…"
 aria-label="Tìm truyện"
 className={`h-12 w-full rounded-2xl bg-white pl-11 pr-11 text-[15px] font-bold text-ink outline-none placeholder:text-ink-2/70 focus:ring-2 focus:ring-brand ${CARD_SHADOW}`}
 />
 {searchQuery && (
 <button type="button" aria-label="Xoá tìm kiếm" onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center text-ink-2">
 <X size={18} />
 </button>
 )}
 </div>
 )}

 {/* Topic chips with 3D icons */}
 <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 no-scrollbar" role="tablist" aria-label="Chủ đề">
 {filters.filter((f) => isCategoryAllowed(f.id, contentRules)).map((f) => (
 <button
 key={f.id}
 type="button"
 role="tab"
 aria-selected={activeFilter === f.id}
 data-say={f.label}
 onClick={() => setActiveFilter(f.id)}
 className={`flex min-h-[48px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-2xl pl-1.5 pr-3.5 text-[14px] font-black transition-colors ${
 activeFilter === f.id ? "bg-brand text-white shadow-[0_4px_0_var(--color-brand-press)]" : `bg-white text-ink ${CARD_SHADOW}`
 }`}
 >
 <CategoryIcon category={f.id} size={36} className="rounded-xl" /> {f.label}
 </button>
 ))}
 </div>

 <p data-kid-detail className="mb-1 mt-2.5 text-[13px] font-bold text-ink-2">
 {filtered.length} truyện
 {sortBy !== "newest" && ` · ${SORT_LABEL[sortBy]}`}
 </p>
 </div>

 {loading && stories.length === 0 && <LibrarySkeleton />}

 {!loading && filtered.length === 0 && (
 <EmptyState
 type={searchQuery ? "search" : "library"}
 query={searchQuery || undefined}
 onAction={searchQuery ? undefined : () => onNavigate("create")}
 />
 )}

 <div className="grid grid-cols-2 gap-3 px-5 pt-2">
 {filtered.map((story) => (
 <LongPressMenu
 key={story.id}
 items={[
 { id: "play", icon: Play, label: "Nghe truyện", color: "text-cta-ink" },
 { id: "edit", icon: Pencil, label: "Chỉnh sửa", color: "text-brand-ink" },
 { id: "favorite", icon: Heart, label: "Yêu thích", color: "text-cta-ink" },
 { id: "share", icon: Share2, label: "Chia sẻ", color: "text-success" },
 { id: "delete", icon: Trash2, label: "Xoá", destructive: true },
 ]}
 onSelect={(action) => {
 if (action === "play") onNavigate("player", { storyId: story.id });
 else if (action === "edit") onNavigate("editor", { storyId: story.id });
 else if (action === "share") { navigator.share?.({ title: story.title, url: window.location.href }).catch(() => {}); }
 else if (action === "delete") { toast("info", "Tính năng xoá đang phát triển"); }
 else if (action === "favorite") { toast("success", "Đã thêm vào yêu thích"); }
 }}
 >
 <div className={`relative w-full overflow-hidden rounded-[24px] bg-white p-2 text-left ${CARD_SHADOW}`}>
 <button
 type="button"
 onClick={() => onNavigate("player", { storyId: story.id })}
 className="block w-full text-left active:scale-[0.98] transition-transform"
 >
 <span className={`flex h-[104px] items-center justify-center rounded-[18px] ${COVER_TINT[story.category] ?? "bg-brand-soft"}`}>
 <CategoryIcon category={story.category} size={80} />
 </span>
 <b className="mt-2 block truncate px-1 text-[15px] font-black leading-tight text-ink">{story.title}</b>
 <small data-kid-detail className="block truncate px-1 pb-1 text-[12.5px] font-bold text-ink-2">
 {story.page_count} trang · {categoryLabels[story.category] || (story.source === "ai" ? "Đóm sáng tác" : "Truyện")}
 </small>
 {story.description && (
 <small data-kid-extra className="line-clamp-2 px-1 pb-1 text-[12px] font-semibold leading-snug text-ink-2">{story.description}</small>
 )}
 </button>
 <button
 type="button"
 onClick={(e) => togglePreview(story.id, e)}
 aria-label={playingStoryId === story.id ? "Dừng nghe thử" : `Nghe thử ${story.title}`}
 className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-brand-ink shadow-sm active:scale-90"
 >
 {loadingAudio === story.id ? <GlowDots size={3} /> : playingStoryId === story.id ? <Square size={14} weight="fill" /> : <Volume2 size={18} />}
 </button>
 </div>
 </LongPressMenu>
 ))}
 </div>
 </div>
 );
}
