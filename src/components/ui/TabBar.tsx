"use client";

import { useState, useEffect } from "react";
import { Home, BookOpen, Mic, Settings, Sparkles } from "lucide-react";
import type { TabId } from "@/lib/types";

interface TabBarProps {
 active: TabId;
 onTabChange: (tab: TabId) => void;
}

const tabs: { id: TabId; label: string; icon: typeof Home }[] = [
 { id: "home", label: "Trang Chủ", icon: Home },
 { id: "library", label: "Thư Viện", icon: BookOpen },
 { id: "create", label: "Tạo", icon: Sparkles },
 { id: "voice", label: "Giọng Đọc", icon: Mic },
 { id: "settings", label: "Cài Đặt", icon: Settings },
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
 <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-lg border-t border-gray-200 dark:border-white/10 flex items-start justify-around px-2 pt-2 pb-6 z-50 safe-bottom dark:bg-[#0F0628]/95 dark:border-white/5">
 {tabs.map((tab) => {
 const Icon = tab.icon;
 const isCenter = tab.id === "create";
 const isActive = active === tab.id;

 if (isCenter) {
 return (
 <button
 key={tab.id}
 onClick={() => { setTapped(tab.id); onTabChange(tab.id); }}
 className="-mt-5 flex flex-col items-center"
 >
 <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br from-accent to-pink-500 flex items-center justify-center text-white shadow-lg shadow-accent/40 transition-transform duration-200 ${tapped === tab.id ? "scale-90" : "scale-100"}`}>
 <Icon size={24} />
 </div>
 <span className="text-[9px] font-bold text-accent mt-1">{tab.label}</span>
 </button>
 );
 }

 return (
 <button
 key={tab.id}
 onClick={() => { setTapped(tab.id); onTabChange(tab.id); }}
 className={`flex flex-col items-center gap-0.5 min-w-[52px] pt-0.5 transition-transform duration-200 ${tapped === tab.id ? "scale-90" : "scale-100"}`}
 >
 <div className="relative">
 <Icon
 size={22}
 className={`transition-colors duration-200 ${isActive ? "text-accent" : "text-gray-400 dark:text-white/40"}`}
 />
 {isActive && (
 <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent" />
 )}
 </div>
 <span
 className={`text-[10px] font-semibold transition-colors duration-200 ${
 isActive ? "text-accent" : "text-gray-400 dark:text-white/40"
 }`}
 >
 {tab.label}
 </span>
 </button>
 );
 })}
 </div>
 );
}
