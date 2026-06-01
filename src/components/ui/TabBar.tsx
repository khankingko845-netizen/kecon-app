"use client";

import { Home, BookOpen, Mic, Settings, Sparkles } from "lucide-react";
import type { TabId } from "@/lib/types";

interface TabBarProps {
  active: TabId;
  onTabChange: (tab: TabId) => void;
}

const tabs: { id: TabId; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "library", label: "Library", icon: BookOpen },
  { id: "create", label: "", icon: Sparkles },
  { id: "voice", label: "Voice", icon: Mic },
  { id: "settings", label: "Settings", icon: Settings },
];

export default function TabBar({ active, onTabChange }: TabBarProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex items-start justify-around px-2 pt-2 pb-6 z-50 safe-bottom">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isCenter = tab.id === "create";
        const isActive = active === tab.id;

        if (isCenter) {
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className="-mt-5 flex flex-col items-center"
            >
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent to-pink-500 flex items-center justify-center text-white shadow-lg shadow-accent/40">
                <Icon size={24} />
              </div>
            </button>
          );
        }

        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className="flex flex-col items-center gap-1 min-w-[48px]"
          >
            <Icon
              size={22}
              className={isActive ? "text-accent" : "text-gray-400"}
            />
            <span
              className={`text-[10px] font-semibold ${
                isActive ? "text-accent" : "text-gray-400"
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
