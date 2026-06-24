"use client";

import { useState, useEffect, useCallback } from "react";
import { Leaf, Loader2, RotateCcw, BookOpen } from "lucide-react";
import TopBar from "@/components/ui/TopBar";
import SceneEffects from "@/components/ui/SceneEffects";
import { asEffectType } from "@/lib/scene-effects";
import { useData } from "@/lib/data-context";
import {
 getStory,
 getStoryPages,
 logBehavior,
 type StoryRow,
 type StoryPageRow,
} from "@/lib/db";
import type { Screen } from "@/lib/types";

interface AdventureProps {
 storyId?: string;
 onBack: () => void;
 onNavigate?: (screen: Screen, data?: Record<string, string>) => void;
}

export default function Adventure({ storyId, onBack, onNavigate }: AdventureProps) {
 const { stories } = useData();
 const [story, setStory] = useState<StoryRow | null>(null);
 const [pages, setPages] = useState<StoryPageRow[]>([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 // Path is the sequence of page_numbers the child has walked.
 const [path, setPath] = useState<number[]>([1]);

 const branchingStories = stories.filter((s) => s.is_branching);

 useEffect(() => {
 if (!storyId) {
 setLoading(false);
 return;
 }
 let active = true;
 (async () => {
 setLoading(true);
 setError(null);
 try {
 const [s, ps] = await Promise.all([
 getStory(storyId),
 getStoryPages(storyId),
 ]);
 if (!active) return;
 setStory(s);
 setPages(ps);
 setPath([ps[0]?.page_number ?? 1]);
 logBehavior("play", storyId).catch(() => {});
 } catch (e) {
 if (active) setError(e instanceof Error ? e.message : "Không tải được truyện");
 } finally {
 if (active) setLoading(false);
 }
 })();
 return () => {
 active = false;
 };
 }, [storyId]);

 const pageByNumber = useCallback(
 (n: number) => pages.find((p) => p.page_number === n) ?? null,
 [pages]
 );

 const currentNumber = path[path.length - 1];
 const currentPage = pageByNumber(currentNumber);

 const goTo = (target: number) => setPath((prev) => [...prev, target]);
 const goPrev = () => setPath((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
 const restart = () => setPath([pages[0]?.page_number ?? 1]);

 // ----- Story picker (no storyId provided) -----
 if (!storyId) {
 return (
 <div className="min-h-screen bg-white dark:bg-white/[0.04] flex flex-col">
 <TopBar
 title=""
 onBack={onBack}
 rightElement={
 <span className="text-[15px] font-bold text-emerald-700 flex items-center gap-1.5">
 <Leaf size={18} /> Truyện Phiêu Lưu
 </span>
 }
 />
 <div className="flex-1 px-6 pt-5 pb-10">
 {branchingStories.length === 0 ? (
 <div className="text-center pt-20 text-txt-secondary dark:text-white/50">
 <BookOpen size={40} className="mx-auto mb-3 opacity-40" />
 <p className="text-sm">
 Chưa có truyện phân nhánh nào. Hãy tạo lựa chọn rẽ nhánh trong
 Story Editor để bắt đầu.
 </p>
 </div>
 ) : (
 <div className="space-y-2.5">
 <h3 className="text-base font-extrabold text-txt dark:text-white mb-1">
 Chọn một cuộc phiêu lưu
 </h3>
 {branchingStories.map((s) => (
 <button
 key={s.id}
 onClick={() =>
 onNavigate?.("adventure", { storyId: s.id })
 }
 className="w-full p-4 rounded-[14px] flex items-center gap-3.5 border-2 border-transparent bg-surface dark:bg-white/[0.04] hover:border-emerald-300 hover:bg-emerald-50 transition-all active:scale-[0.98] text-left"
 >
 <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
 <Leaf size={20} />
 </div>
 <div>
 <strong className="text-[15px] font-bold block mb-0.5">
 {s.title}
 </strong>
 <span className="text-xs text-txt-secondary dark:text-white/50">
 {s.page_count} trang · phân nhánh
 </span>
 </div>
 </button>
 ))}
 </div>
 )}
 </div>
 </div>
 );
 }

 if (loading) {
 return (
 <div className="min-h-screen bg-white dark:bg-white/[0.04] flex items-center justify-center">
 <Loader2 className="animate-spin text-emerald-600" size={28} />
 </div>
 );
 }

 if (error || !currentPage) {
 return (
 <div className="min-h-screen bg-white dark:bg-white/[0.04] flex flex-col">
 <TopBar title="" onBack={onBack} />
 <div className="flex-1 flex items-center justify-center px-6 text-center text-txt-secondary dark:text-white/50">
 <p className="text-sm">{error || "Truyện không có nội dung."}</p>
 </div>
 </div>
 );
 }

 const choices = currentPage.choices ?? [];
 const hasChoices = choices.length > 0;
 // A page with no choices and no following page is an ending.
 const nextNumber = currentNumber + 1;
 const hasNext = !hasChoices && pageByNumber(nextNumber) != null;
 const isEnding = !hasChoices && !hasNext;
 const effect = asEffectType(currentPage.particle_effect);

 return (
 <div className="relative min-h-screen overflow-hidden bg-white dark:bg-white/[0.04] flex flex-col">
 <SceneEffects effect={effect} active />
 <div className="relative z-10 flex flex-col min-h-screen">
 <TopBar
 title=""
 onBack={onBack}
 rightElement={
 <span className="text-[15px] font-bold text-emerald-700 flex items-center gap-1.5">
 <Leaf size={18} /> {story?.title || "Phiêu Lưu"}
 </span>
 }
 />

 {/* Scene */}
 <div className="h-44 bg-gradient-to-b from-emerald-100 to-emerald-200 flex items-center justify-center px-6 text-center text-emerald-800">
 <span className="text-sm font-medium opacity-80">
 {currentPage.scene_description || `Trang ${currentNumber}`}
 </span>
 </div>

 {/* Story */}
 <div className="flex-1 px-6 pt-5 pb-10">
 <p className="text-[15px] leading-[1.8] text-txt dark:text-white mb-5 whitespace-pre-wrap">
 {currentPage.content}
 </p>

 {hasChoices && (
 <>
 <h3 className="text-lg font-extrabold text-center text-emerald-700 mb-3.5 tracking-tight">
 Con muốn đi đâu?
 </h3>
 {choices.map((c, i) => (
 <button
 key={i}
 onClick={() => goTo(c.target)}
 className="w-full p-4 rounded-[14px] flex items-center gap-3.5 mb-2.5 border-2 border-transparent bg-surface dark:bg-white/[0.04] hover:border-emerald-300 hover:bg-emerald-50 transition-all active:scale-[0.98] text-left"
 >
 <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold shrink-0">
 {i + 1}
 </div>
 <div>
 <strong className="text-[15px] font-bold block">
 {c.label || `Lựa chọn ${i + 1}`}
 </strong>
 {c.description && (
 <span className="text-xs text-txt-secondary dark:text-white/50">
 {c.description}
 </span>
 )}
 </div>
 </button>
 ))}
 </>
 )}

 {hasNext && (
 <button
 onClick={() => goTo(nextNumber)}
 className="w-full mt-2 py-4 rounded-[14px] bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold text-base shadow-lg shadow-emerald-500/30 active:scale-[0.98] transition-transform"
 >
 Tiếp Tục Câu Chuyện
 </button>
 )}

 {isEnding && (
 <div className="text-center mt-4">
 <p className="text-base font-extrabold text-emerald-700 mb-4">
 🎉 Hết truyện!
 </p>
 <button
 onClick={restart}
 className="w-full py-4 rounded-[14px] bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold text-base shadow-lg shadow-emerald-500/30 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
 >
 <RotateCcw size={18} /> Đọc Lại Từ Đầu
 </button>
 </div>
 )}

 {path.length > 1 && (
 <button
 onClick={goPrev}
 className="w-full mt-3 py-2.5 text-sm font-semibold text-txt-secondary dark:text-white/50"
 >
 ← Quay lại lựa chọn trước
 </button>
 )}
 </div>
 </div>
 </div>
 );
}
