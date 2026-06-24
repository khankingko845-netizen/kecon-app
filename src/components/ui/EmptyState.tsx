"use client";

import { BookOpen, Mic, Heart, Search, FolderOpen, Sparkles } from "lucide-react";

type EmptyType = "library" | "favorites" | "search" | "voices" | "collections" | "generic";

interface EmptyStateProps {
 type: EmptyType;
 query?: string;
 onAction?: () => void;
}

const configs: Record<EmptyType, {
 icon: typeof BookOpen;
 gradient: string;
 title: string;
 subtitle: string;
 actionLabel?: string;
 particles: string[];
}> = {
 library: {
 icon: BookOpen,
 gradient: "from-violet-400 to-purple-500",
 title: "Thư viện đang chờ truyện đầu tiên!",
 subtitle: "Tạo truyện AI cho bé yêu — chỉ mất 30 giây ✨",
 actionLabel: "Tạo Truyện",
 particles: ["📖", "✨", "🌟"],
 },
 favorites: {
 icon: Heart,
 gradient: "from-rose-400 to-pink-500",
 title: "Chưa có truyện yêu thích",
 subtitle: "Nhấn ❤️ khi nghe truyện để lưu vào đây",
 particles: ["❤️", "💕", "💖"],
 },
 search: {
 icon: Search,
 gradient: "from-blue-400 to-cyan-500",
 title: "Không tìm thấy kết quả",
 subtitle: "Thử tìm với từ khoá khác nhé",
 particles: ["🔍", "📚", "🔎"],
 },
 voices: {
 icon: Mic,
 gradient: "from-emerald-400 to-teal-500",
 title: "Chưa có giọng đọc nào",
 subtitle: "Ghi âm 30 giây để AI clone giọng ba mẹ cho bé",
 actionLabel: "Ghi Âm Ngay",
 particles: ["🎤", "🎵", "🔊"],
 },
 collections: {
 icon: FolderOpen,
 gradient: "from-amber-400 to-orange-500",
 title: "Chưa có bộ sưu tập",
 subtitle: "Tạo bộ sưu tập để sắp xếp truyện theo chủ đề",
 actionLabel: "Tạo Bộ Sưu Tập",
 particles: ["📁", "⭐", "📚"],
 },
 generic: {
 icon: Sparkles,
 gradient: "from-gray-400 to-gray-500",
 title: "Chưa có gì ở đây",
 subtitle: "Hãy bắt đầu khám phá!",
 particles: ["✨", "💫", "⭐"],
 },
};

export default function EmptyState({ type, query, onAction }: EmptyStateProps) {
 const cfg = configs[type];
 const Icon = cfg.icon;

 return (
 <div className="flex flex-col items-center justify-center py-12 px-8">
 {/* Animated icon container */}
 <div className="relative mb-5">
 {/* Floating particles */}
 {cfg.particles.map((p, i) => (
 <span
 key={i}
 className="absolute text-lg opacity-40 animate-[float_5s_ease-in-out_infinite]"
 style={{
 top: `${-10 + (i * 15)}px`,
 left: `${-20 + (i * 30)}px`,
 animationDelay: `${i * 1.2}s`,
 animationDuration: `${4 + i}s`,
 }}
 >
 {p}
 </span>
 ))}

 <div className={`w-20 h-20 rounded-[24px] bg-gradient-to-br ${cfg.gradient} flex items-center justify-center text-white shadow-xl animate-[scaleIn_0.5s_ease]`}>
 <Icon size={32} />
 </div>
 </div>

 <h3 className="text-[16px] font-black text-center text-txt dark:text-white tracking-tight mb-1.5">
 {query ? `Không tìm thấy "${query}"` : cfg.title}
 </h3>
 <p className="text-[13px] text-txt-secondary dark:text-white/50 text-center max-w-[260px] leading-relaxed mb-5">
 {cfg.subtitle}
 </p>

 {cfg.actionLabel && onAction && (
 <button
 onClick={onAction}
 className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-accent to-pink-500 text-white text-[14px] font-bold active:scale-95 transition-transform shadow-lg shadow-accent/25"
 >
 <Sparkles size={16} /> {cfg.actionLabel}
 </button>
 )}
 </div>
 );
}
