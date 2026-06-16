"use client";

import { useState, useEffect } from "react";
import { Heart, Loader2, Play, Star, Trash2 } from "lucide-react";
import TopBar from "@/components/ui/TopBar";
import { getUserFavorites, toggleFavorite, gradientFor, type StoryRow } from "@/lib/db";
import type { Screen } from "@/lib/types";

interface FavoritesProps {
 onBack: () => void;
 onNavigate: (screen: Screen, data?: Record<string, string>) => void;
}

export default function Favorites({ onBack, onNavigate }: FavoritesProps) {
 const [favorites, setFavorites] = useState<StoryRow[]>([]);
 const [loading, setLoading] = useState(true);
 const [removing, setRemoving] = useState<string | null>(null);

 useEffect(() => {
 getUserFavorites()
 .then(setFavorites)
 .catch(() => {})
 .finally(() => setLoading(false));
 }, []);

 const handleRemove = async (storyId: string) => {
 setRemoving(storyId);
 try {
 await toggleFavorite(storyId);
 setFavorites((prev) => prev.filter((s) => s.id !== storyId));
 } catch {}
 setRemoving(null);
 };

 return (
 <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-24">
 <TopBar
 title="Yêu Thích"
 onBack={onBack}
 rightElement={
 <span className="text-[13px] font-bold text-txt-secondary dark:text-white/50">
 {favorites.length} truyện
 </span>
 }
 />

 <div className="px-5 pt-2">
 {loading ? (
 <div className="flex justify-center pt-20">
 <Loader2 size={26} className="animate-spin text-accent" />
 </div>
 ) : favorites.length === 0 ? (
 <div className="text-center pt-20">
 <Heart size={48} className="mx-auto text-gray-300 mb-4" />
 <p className="text-[15px] font-bold text-txt-secondary dark:text-white/50 mb-2">
 Chưa có truyện yêu thích
 </p>
 <p className="text-[13px] text-txt-secondary dark:text-white/50/60">
 Nhấn ❤️ khi nghe truyện để lưu vào đây
 </p>
 </div>
 ) : (
 <div className="space-y-3">
 {favorites.map((story) => (
 <div
 key={story.id}
 className="bg-white dark:bg-white/[0.04] rounded-2xl border border-gray-100 dark:border-white/[0.06] p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex items-center gap-3"
 >
 {/* Cover / gradient */}
 {story.cover_image_url ? (
 // eslint-disable-next-line @next/next/no-img-element
 <img
 src={story.cover_image_url}
 alt={story.title}
 className="w-16 h-16 rounded-xl object-cover shrink-0"
 />
 ) : (
 <div
 className={`w-16 h-16 rounded-xl bg-gradient-to-br ${gradientFor(
 story.id
 )} flex items-center justify-center shrink-0`}
 >
 <span className="text-white text-2xl font-bold">
 {(story.title || "T")[0].toUpperCase()}
 </span>
 </div>
 )}

 {/* Info */}
 <div className="flex-1 min-w-0">
 <p className="text-[14px] font-bold text-txt dark:text-white truncate">
 {story.title}
 </p>
 <div className="flex items-center gap-2 mt-1">
 <span className="text-[11px] text-txt-secondary dark:text-white/50">
 {story.page_count} trang
 </span>
 {(story.avg_rating ?? 0) > 0 && (
 <span className="text-[11px] text-amber-500 flex items-center gap-0.5">
 <Star size={10} fill="currentColor" />
 {(story.avg_rating ?? 0).toFixed(1)}
 </span>
 )}
 </div>
 </div>

 {/* Actions */}
 <div className="flex items-center gap-2 shrink-0">
 <button
 onClick={() => onNavigate("player", { storyId: story.id })}
 className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center"
 >
 <Play size={18} className="text-accent" fill="currentColor" />
 </button>
 <button
 onClick={() => handleRemove(story.id)}
 disabled={removing === story.id}
 className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center disabled:opacity-50"
 >
 {removing === story.id ? (
 <Loader2 size={16} className="animate-spin text-red-400" />
 ) : (
 <Trash2 size={16} className="text-red-400" />
 )}
 </button>
 </div>
 </div>
 ))}
 </div>
 )}
 </div>
 </div>
 );
}
