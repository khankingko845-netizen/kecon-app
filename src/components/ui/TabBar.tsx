"use client";

import { useState, useEffect } from "react";
import { Home, BookOpen, Mic, Settings, Sparkles } from "@/components/ui/icons";
import type { TabId } from "@/lib/types";

interface TabBarProps {
 active: TabId;
 onTabChange: (tab: TabId) => void;
}

/** Bottom navigation — UI v2: sentence-case labels, filled icon when active, CTA-orange centre button. */
const tabs: { id: TabId; label: string; icon: typeof Home }[] = [
 { id: "home", label: "Trang chủ", icon: Home },
 { id: "library", label: "Thư viện", icon: BookOpen },
 { id: "create", label: "Tạo", icon: Sparkles },
 { id: "voice", label: "Giọng đọc", icon: Mic },
 { id: "settings", label: "Cài đặt", icon: Settings },
];

export default function TabBar({ active, onTabChange }: TabBarProps) {
 const [tapped, setTapped] = useState<TabId | null>(null);

 useEffect(() => {
 if (tapped) {
 const t = setTimeout(() => setTapped(null), 300);
 return () => clearTimeout(t);
 }
 }, [tapped]);

 return (
 <nav
 aria-label="Điều hướng chính"
 className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-lg border-t border-ink/5 flex items-start justify-around px-2 pt-1.5 pb-6 z-50 safe-bottom dark:bg-night/95 dark:border-white/5"
 >
 {tabs.map((tab) => {
 const Icon = tab.icon;
 const isCenter = tab.id === "create";
 const isActive = active === tab.id;

 if (isCenter) {
 return (
 <button
 key={tab.id}
 onClick={() => { setTapped(tab.id); onTabChange(tab.id); }}
 aria-current={isActive ? "page" : undefined}
 className="-mt-5 flex flex-col items-center min-w-tap-min"
 >
 <div className={`w-14 h-14 rounded-[20px] bg-cta flex items-center justify-center text-white shadow-[0_5px_0_var(--color-cta-press)] transition-transform duration-200 ${tapped === tab.id ? "scale-90" : "scale-100"}`}>
 <Icon size={26} weight="fill" />
 </div>
 <span className="text-[11px] font-extrabold text-cta mt-1">{tab.label}</span>
 </button>
 );
 }

 return (
 <button
 key={tab.id}
 onClick={() => { setTapped(tab.id); onTabChange(tab.id); }}
 aria-current={isActive ? "page" : undefined}
 className={`flex flex-col items-center gap-0.5 min-w-[60px] min-h-tap-min pt-1 transition-transform duration-200 ${tapped === tab.id ? "scale-90" : "scale-100"}`}
 >
 <span
 className={`flex h-8 w-12 items-center justify-center rounded-full transition-colors duration-200 ${
 isActive ? "bg-brand-soft dark:bg-white/10" : ""
 }`}
 >
 <Icon
 size={24}
 weight={isActive ? "fill" : "regular"}
 className={`transition-colors duration-200 ${isActive ? "text-brand dark:text-moon" : "text-ink-2/70 dark:text-moon-2/60"}`}
 />
 </span>
 <span
 className={`text-[11px] transition-colors duration-200 ${
 isActive ? "font-extrabold text-brand dark:text-moon" : "font-semibold text-ink-2/80 dark:text-moon-2/60"
 }`}
 >
 {tab.label}
 </span>
 </button>
 );
 })}
 </nav>
 );
}
