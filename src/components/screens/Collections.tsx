"use client";

import { useState, useEffect, useCallback } from "react";
import {
 ChevronLeft, BookOpen, Loader2, Play, Star, Heart, Sparkles,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import { gradientFor, iconForCategory } from "@/lib/db";
import type { Screen } from "@/lib/types";

interface CollectionsProps {
 onNavigate: (screen: Screen, data?: Record<string, string>) => void;
 onBack: () => void;
}

interface Collection {
 id: string;
 name: string;
 description: string;
 emoji: string;
 color: string;
 stories: CollectionStory[];
}

interface CollectionStory {
 id: string;
 title: string;
 category: string;
 play_count: number;
 like_count: number;
}

function StoryIcon({ icon }: { icon: string }) {
 const iconMap: Record<string, React.ReactNode> = {
 flame: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5Z"/></svg>,
 wand: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8 19 13"/><path d="M15 9h0"/><path d="M17.8 6.2 19 5"/><path d="m3 21 9-9"/><path d="M12.2 6.2 11 5"/></svg>,
 };
 return <>{iconMap[icon] || iconMap.wand}</>;
}

export default function Collections({ onBack, onNavigate }: CollectionsProps) {
 const { profile } = useAuth();
 const [collections, setCollections] = useState<Collection[]>([]);
 const [loading, setLoading] = useState(true);
 const [selectedCollection, setSelectedCollection] = useState<string | null>(null);

 const load = useCallback(async () => {
 if (!profile?.id) return;
 setLoading(true);
 try {
 const supabase = createClient();

 // Build collections from existing stories by category
 const { data: stories } = await supabase
 .from("stories")
 .select("id, title, category, play_count, like_count")
 .eq("user_id", profile.id)
 .order("created_at", { ascending: false });

 if (!stories || stories.length === 0) {
 setCollections([]);
 setLoading(false);
 return;
 }

 // Group by category
 const categoryMap = new Map<string, CollectionStory[]>();
 for (const s of stories) {
 const cat = s.category || "custom";
 if (!categoryMap.has(cat)) categoryMap.set(cat, []);
 categoryMap.get(cat)!.push(s);
 }

 const categoryMeta: Record<string, { name: string; emoji: string; color: string }> = {
 fairy_tale: { name: "Cổ Tích Việt Nam", emoji: "🏰", color: "from-purple-400 to-purple-600" },
 adventure: { name: "Phiêu Lưu Kỳ Thú", emoji: "🚀", color: "from-blue-400 to-blue-600" },
 bedtime: { name: "Ru Ngủ Bé Yêu", emoji: "🌙", color: "from-indigo-400 to-indigo-600" },
 animal: { name: "Thế Giới Động Vật", emoji: "🐰", color: "from-green-400 to-green-600" },
 educational: { name: "Học Mà Chơi", emoji: "📖", color: "from-amber-400 to-amber-600" },
 custom: { name: "Truyện Tùy Chỉnh", emoji: "🎨", color: "from-pink-400 to-pink-600" },
 };

 // Add special collections
 const favoriteStories = stories.filter((s) => (s.like_count || 0) > 0);
 const popularStories = [...stories].sort((a, b) => (b.play_count || 0) - (a.play_count || 0)).slice(0, 10);

 const cols: Collection[] = [];

 if (popularStories.length > 0) {
 cols.push({
 id: "popular",
 name: "Nghe Nhiều Nhất",
 description: `${popularStories.length} truyện phổ biến`,
 emoji: "🔥",
 color: "from-orange-400 to-red-500",
 stories: popularStories,
 });
 }

 if (favoriteStories.length > 0) {
 cols.push({
 id: "favorites",
 name: "Yêu Thích",
 description: `${favoriteStories.length} truyện được yêu thích`,
 emoji: "❤️",
 color: "from-pink-400 to-rose-500",
 stories: favoriteStories,
 });
 }

 for (const [cat, catStories] of categoryMap) {
 const meta = categoryMeta[cat] || { name: cat, emoji: "📚", color: "from-gray-400 to-gray-600" };
 cols.push({
 id: cat,
 name: meta.name,
 description: `${catStories.length} truyện`,
 emoji: meta.emoji,
 color: meta.color,
 stories: catStories,
 });
 }

 setCollections(cols);
 } catch {
 // ignore
 }
 setLoading(false);
 }, [profile?.id]);

 useEffect(() => { load(); }, [load]);

 const selected = selectedCollection ? collections.find((c) => c.id === selectedCollection) : null;

 return (
 <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-24">
 <div className="px-5 pt-14">
 {/* Header */}
 <div className="flex items-center gap-3 mb-5">
 <button
 onClick={() => selectedCollection ? setSelectedCollection(null) : onBack()}
 className="w-9 h-9 rounded-xl bg-white dark:bg-white/[0.04] flex items-center justify-center shadow-sm"
 >
 <ChevronLeft size={18} />
 </button>
 <h2 className="text-[22px] font-black tracking-tight">
 {selected ? selected.name : "Bộ Sưu Tập"}
 </h2>
 </div>

 {loading ? (
 <div className="flex justify-center py-12">
 <Loader2 size={24} className="animate-spin text-accent" />
 </div>
 ) : selected ? (
 /* Collection detail */
 <div className="space-y-2.5">
 <p className="text-[13px] text-txt-secondary dark:text-white/50 mb-3">
 {selected.emoji} {selected.description}
 </p>
 {selected.stories.map((story) => (
 <button
 key={story.id}
 onClick={() => onNavigate("player", { storyId: story.id })}
 className="w-full bg-white dark:bg-white/[0.04] rounded-xl p-3.5 flex items-center gap-3 shadow-sm active:scale-[0.98] transition-transform"
 >
 <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradientFor(story.id)} flex items-center justify-center text-white flex-shrink-0`}>
 <StoryIcon icon={iconForCategory(story.category, story.id)} />
 </div>
 <div className="flex-1 min-w-0 text-left">
 <p className="text-[14px] font-bold truncate">{story.title}</p>
 <p className="text-[11px] text-txt-secondary dark:text-white/50 flex items-center gap-2">
 <span className="flex items-center gap-0.5"><Play size={10} /> {story.play_count || 0}</span>
 <span className="flex items-center gap-0.5"><Heart size={10} /> {story.like_count || 0}</span>
 </p>
 </div>
 <Play size={16} className="text-accent flex-shrink-0" />
 </button>
 ))}
 </div>
 ) : collections.length === 0 ? (
 <div className="text-center py-16">
 <BookOpen size={40} className="text-gray-300 mx-auto mb-3" />
 <p className="text-[14px] font-bold text-txt-secondary dark:text-white/50">Chưa có bộ sưu tập</p>
 <p className="text-[12px] text-txt-secondary dark:text-white/50 mt-1">Tạo truyện để bắt đầu sưu tập</p>
 <button
 onClick={() => onNavigate("create")}
 className="mt-4 inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-accent to-pink-500 text-white text-[14px] font-bold"
 >
 <Sparkles size={16} /> Tạo Truyện
 </button>
 </div>
 ) : (
 /* Collection grid */
 <div className="grid grid-cols-2 gap-3">
 {collections.map((col) => (
 <button
 key={col.id}
 onClick={() => setSelectedCollection(col.id)}
 className="bg-white dark:bg-white/[0.04] rounded-2xl overflow-hidden shadow-sm text-left active:scale-[0.97] transition-transform"
 >
 <div className={`h-20 bg-gradient-to-br ${col.color} flex items-center justify-center`}>
 <span className="text-4xl">{col.emoji}</span>
 </div>
 <div className="p-3">
 <p className="text-[13px] font-bold truncate">{col.name}</p>
 <p className="text-[11px] text-txt-secondary dark:text-white/50 flex items-center gap-1">
 <Star size={10} /> {col.description}
 </p>
 </div>
 </button>
 ))}
 </div>
 )}
 </div>
 </div>
 );
}
