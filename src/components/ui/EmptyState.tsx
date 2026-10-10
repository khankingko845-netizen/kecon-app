"use client";

import { Sparkles } from "@/components/ui/icons";
import Mascot, { type MascotState } from "@/components/ui/Mascot";
import { DOM_LINES } from "@/lib/dom-lines";

type EmptyType = "library" | "favorites" | "search" | "voices" | "collections" | "generic";

interface EmptyStateProps {
 type: EmptyType;
 query?: string;
 onAction?: () => void;
}

// UI v2: Đóm replaces the gradient icon box + emoji particles (UI-04/UI-06).
const configs: Record<EmptyType, {
 mascot: MascotState;
 title: string;
 subtitle: string;
 actionLabel?: string;
}> = {
 library: {
 mascot: "story",
 title: "Thư viện đang chờ truyện đầu tiên!",
 subtitle: "Đóm cùng bé tạo truyện mới — chỉ mất 30 giây",
 actionLabel: "Tạo Truyện",
 },
 favorites: {
 mascot: "hello",
 title: "Chưa có truyện yêu thích",
 subtitle: "Nhấn trái tim khi nghe truyện để lưu vào đây nhé",
 },
 search: {
 mascot: "oops",
 title: "Không tìm thấy kết quả",
 subtitle: "Đóm tìm mãi chưa thấy — thử từ khoá khác nhé",
 },
 voices: {
 mascot: "listen",
 title: "Chưa có giọng đọc nào",
 subtitle: "Ghi âm 30 giây để bé nghe truyện bằng giọng ba mẹ",
 actionLabel: "Ghi Âm Ngay",
 },
 collections: {
 mascot: "thinking",
 title: "Chưa có bộ sưu tập",
 subtitle: "Tạo bộ sưu tập để sắp xếp truyện theo chủ đề",
 actionLabel: "Tạo Bộ Sưu Tập",
 },
 generic: {
 mascot: "hello",
 title: "Chưa có gì ở đây",
 subtitle: DOM_LINES.empty.text,
 },
};

export default function EmptyState({ type, query, onAction }: EmptyStateProps) {
 const cfg = configs[type];

 return (
 <div className="flex flex-col items-center justify-center py-10 px-8" data-empty-state={type}>
 <Mascot state={cfg.mascot} size={148} className="mb-3" />

 <h3 className="font-display text-[19px] font-extrabold text-center text-ink dark:text-moon leading-tight mb-1.5">
 {query ? `Không tìm thấy "${query}"` : cfg.title}
 </h3>
 <p className="text-[14px] font-semibold text-ink-2 dark:text-moon-2 text-center max-w-[270px] leading-relaxed mb-5">
 {cfg.subtitle}
 </p>

 {cfg.actionLabel && onAction && (
 <button
 onClick={onAction}
 className="inline-flex items-center gap-2 px-6 min-h-tap-min rounded-btn bg-cta text-white font-display text-[19px] font-extrabold active:translate-y-0.5 active:shadow-none transition-all shadow-[0_4px_0_var(--color-cta-press)]"
 >
 <Sparkles size={18} weight="fill" /> {cfg.actionLabel}
 </button>
 )}
 </div>
 );
}
