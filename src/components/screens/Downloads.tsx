"use client";

import { useState, useEffect, useCallback } from "react";
import {
 ChevronLeft, Download, Trash2, Loader2, Wifi, WifiOff, HardDrive,
 Play, CheckCircle,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
 getDownloadedStories, removeDownloadedStory, markStoryDownloaded,
 type DownloadedStory,
} from "@/lib/db";
import { createClient } from "@/lib/supabase/client";
import type { Screen } from "@/lib/types";

interface DownloadsProps {
 onNavigate: (screen: Screen, data?: Record<string, string>) => void;
 onBack: () => void;
}

interface StoryWithDownload {
 id: string;
 title: string;
 category: string;
 page_count: number;
 downloaded: boolean;
 downloading: boolean;
 sizeBytes: number;
}

const CACHE_PREFIX = "kecon_offline_";

export default function Downloads({ onBack, onNavigate }: DownloadsProps) {
 const { profile } = useAuth();
 const [stories, setStories] = useState<StoryWithDownload[]>([]);
 const [loading, setLoading] = useState(true);
 const [isOnline, setIsOnline] = useState(true);
 const [totalSize, setTotalSize] = useState(0);

 useEffect(() => {
 const update = () => setIsOnline(navigator.onLine);
 window.addEventListener("online", update);
 window.addEventListener("offline", update);
 update();
 return () => {
 window.removeEventListener("online", update);
 window.removeEventListener("offline", update);
 };
 }, []);

 const load = useCallback(async () => {
 if (!profile?.id) return;
 setLoading(true);
 try {
 const supabase = createClient();
 const [{ data: allStories }, downloads] = await Promise.all([
 supabase.from("stories").select("id, title, category").eq("user_id", profile.id).order("created_at", { ascending: false }),
 getDownloadedStories(profile.id),
 ]);

 const downloadMap = new Map(downloads.map((d) => [d.story_id, d]));
 const combined: StoryWithDownload[] = (allStories || []).map((s: { id: string; title: string; category: string }) => ({
 id: s.id,
 title: s.title,
 category: s.category,
 page_count: 0,
 downloaded: downloadMap.has(s.id),
 downloading: false,
 sizeBytes: downloadMap.get(s.id)?.size_bytes || 0,
 }));

 setStories(combined);
 setTotalSize(downloads.reduce((t, d) => t + d.size_bytes, 0));
 } catch {
 // ignore
 }
 setLoading(false);
 }, [profile?.id]);

 useEffect(() => { load(); }, [load]);

 const handleDownload = async (storyId: string) => {
 if (!profile?.id) return;
 setStories((prev) => prev.map((s) => s.id === storyId ? { ...s, downloading: true } : s));

 try {
 const supabase = createClient();
 // Fetch story + pages + audio
 const [{ data: story }, { data: pages }] = await Promise.all([
 supabase.from("stories").select("*").eq("id", storyId).single(),
 supabase.from("story_pages").select("*").eq("story_id", storyId).order("page_number"),
 ]);

 if (!story || !pages) throw new Error("Story not found");

 // Cache story data
 const cacheData = { story, pages, cachedAt: new Date().toISOString() };
 const json = JSON.stringify(cacheData);
 localStorage.setItem(`${CACHE_PREFIX}${storyId}`, json);

 // Cache audio files
 let audioSize = 0;
 if ("caches" in window) {
 const cache = await caches.open("kecon-audio-v1");
 for (const page of pages) {
 if (page.audio_url) {
 try {
 const resp = await fetch(page.audio_url);
 if (resp.ok) {
 await cache.put(page.audio_url, resp.clone());
 const blob = await resp.blob();
 audioSize += blob.size;
 }
 } catch {
 // skip audio that fails
 }
 }
 }
 }

 const totalBytes = json.length + audioSize;
 await markStoryDownloaded(profile.id, storyId, totalBytes);

 setStories((prev) => prev.map((s) =>
 s.id === storyId ? { ...s, downloaded: true, downloading: false, sizeBytes: totalBytes } : s
 ));
 setTotalSize((prev) => prev + totalBytes);
 } catch {
 setStories((prev) => prev.map((s) => s.id === storyId ? { ...s, downloading: false } : s));
 }
 };

 const handleRemove = async (storyId: string) => {
 if (!profile?.id) return;
 try {
 localStorage.removeItem(`${CACHE_PREFIX}${storyId}`);
 if ("caches" in window) {
 const cache = await caches.open("kecon-audio-v1");
 const keys = await cache.keys();
 for (const req of keys) {
 if (req.url.includes(storyId)) {
 await cache.delete(req);
 }
 }
 }
 const story = stories.find((s) => s.id === storyId);
 await removeDownloadedStory(profile.id, storyId);
 setStories((prev) => prev.map((s) => s.id === storyId ? { ...s, downloaded: false, sizeBytes: 0 } : s));
 setTotalSize((prev) => prev - (story?.sizeBytes || 0));
 } catch {
 // ignore
 }
 };

 const formatSize = (bytes: number) => {
 if (bytes < 1024) return `${bytes} B`;
 if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
 return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
 };

 const downloadedStories = stories.filter((s) => s.downloaded);
 const availableStories = stories.filter((s) => !s.downloaded);

 return (
 <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-24">
 <div className="px-5 pt-14">
 {/* Header */}
 <div className="flex items-center gap-3 mb-6">
 <button onClick={onBack} className="w-9 h-9 rounded-xl bg-white dark:bg-white/[0.04] flex items-center justify-center shadow-sm">
 <ChevronLeft size={18} />
 </button>
 <h2 className="text-[24px] font-black tracking-tight">Tải Về</h2>
 <Download size={22} className="text-accent ml-1" />
 </div>

 {/* Status Bar */}
 <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 mb-5 shadow-sm flex items-center justify-between">
 <div className="flex items-center gap-3">
 <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isOnline ? "bg-green-50" : "bg-red-50"}`}>
 {isOnline ? <Wifi size={20} className="text-green-500" /> : <WifiOff size={20} className="text-red-500" />}
 </div>
 <div>
 <p className="text-[13px] font-bold">{isOnline ? "Đang kết nối" : "Ngoại tuyến"}</p>
 <p className="text-[11px] text-txt-secondary dark:text-white/50">
 {downloadedStories.length} truyện đã tải
 </p>
 </div>
 </div>
 <div className="text-right">
 <div className="flex items-center gap-1 text-[11px] text-txt-secondary dark:text-white/50">
 <HardDrive size={12} />
 {formatSize(totalSize)}
 </div>
 </div>
 </div>

 {loading ? (
 <div className="flex justify-center py-12">
 <Loader2 size={24} className="animate-spin text-accent" />
 </div>
 ) : (
 <>
 {/* Downloaded Stories */}
 {downloadedStories.length > 0 && (
 <div className="mb-6">
 <h3 className="text-[14px] font-bold mb-3 flex items-center gap-2">
 <CheckCircle size={16} className="text-green-500" />
 Đã tải ({downloadedStories.length})
 </h3>
 <div className="space-y-2">
 {downloadedStories.map((story) => (
 <div key={story.id} className="bg-white dark:bg-white/[0.04] rounded-xl p-3.5 shadow-sm flex items-center gap-3">
 <button
 onClick={() => onNavigate("player", { storyId: story.id })}
 className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0"
 >
 <Play size={18} className="text-accent ml-0.5" />
 </button>
 <div className="flex-1 min-w-0">
 <p className="text-[13px] font-bold truncate">{story.title}</p>
 <p className="text-[11px] text-txt-secondary dark:text-white/50">
 {formatSize(story.sizeBytes)} • {story.category}
 </p>
 </div>
 <button
 onClick={() => handleRemove(story.id)}
 className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center"
 >
 <Trash2 size={14} className="text-red-400" />
 </button>
 </div>
 ))}
 </div>
 </div>
 )}

 {/* Available to Download */}
 {availableStories.length > 0 && (
 <div>
 <h3 className="text-[14px] font-bold mb-3 flex items-center gap-2">
 <Download size={16} className="text-txt-secondary dark:text-white/50" />
 Có thể tải ({availableStories.length})
 </h3>
 <div className="space-y-2">
 {availableStories.map((story) => (
 <div key={story.id} className="bg-white dark:bg-white/[0.04] rounded-xl p-3.5 shadow-sm flex items-center gap-3">
 <div className="w-10 h-10 rounded-xl bg-gray-50 dark:bg-white/[0.04] flex items-center justify-center flex-shrink-0 text-lg">
 📖
 </div>
 <div className="flex-1 min-w-0">
 <p className="text-[13px] font-bold truncate">{story.title}</p>
 <p className="text-[11px] text-txt-secondary dark:text-white/50">{story.category}</p>
 </div>
 <button
 onClick={() => handleDownload(story.id)}
 disabled={story.downloading || !isOnline}
 className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center disabled:opacity-40"
 >
 {story.downloading ? (
 <Loader2 size={14} className="animate-spin text-accent" />
 ) : (
 <Download size={14} className="text-accent" />
 )}
 </button>
 </div>
 ))}
 </div>
 </div>
 )}

 {stories.length === 0 && (
 <div className="text-center py-12">
 <p className="text-4xl mb-3">📖</p>
 <p className="text-[14px] font-bold text-txt-secondary dark:text-white/50">Chưa có truyện nào</p>
 <p className="text-[12px] text-txt-secondary dark:text-white/50 mt-1">Tạo truyện mới để tải về nghe offline</p>
 </div>
 )}
 </>
 )}
 </div>
 </div>
 );
}
