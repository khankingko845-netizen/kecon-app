"use client";

import { useState, useEffect } from "react";
import { Home, Books, Mic, ShieldCheck, Wand2 } from "@/components/ui/icons";
import type { TabId } from "@/lib/types";

interface TabBarProps {
  active: TabId;
  onTabChange: (tab: TabId) => void;
}

/**
 * Bottom navigation — 1:1 with the concept board (`.tab`): white bar, duotone
 * icons 28px, indigo active colour, raised coral "Tạo" button (66px, 6px base),
 * last tab is the parent area "Bố mẹ".
 */
const tabs: { id: TabId; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Trang chủ", icon: Home },
  { id: "library", label: "Thư viện", icon: Books },
  { id: "create", label: "Tạo", icon: Wand2 },
  { id: "voice", label: "Giọng đọc", icon: Mic },
  { id: "settings", label: "Bố mẹ", icon: ShieldCheck },
];

export default function TabBar({ active, onTabChange }: TabBarProps) {
  const [tapped, setTapped] = useState<TabId | null>(null);

  useEffect(() => {
    if (!tapped) return;
    const t = setTimeout(() => setTapped(null), 300);
    return () => clearTimeout(t);
  }, [tapped]);

  return (
    <nav
      aria-label="Điều hướng chính"
      className="safe-bottom fixed bottom-0 left-0 right-0 z-50 mx-auto flex max-w-[430px] items-start justify-around border-t border-[#EFE9F7] bg-white px-1 pb-6 pt-2.5 dark:border-white/5"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isCenter = tab.id === "create";
        const isActive = active === tab.id;
        const press = tapped === tab.id ? "scale-90" : "scale-100";

        if (isCenter) {
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setTapped(tab.id);
                onTabChange(tab.id);
              }}
              aria-current={isActive ? "page" : undefined}
              className="-mt-[30px] flex w-16 flex-col items-center gap-0.5 text-[12.5px] font-extrabold text-ink"
            >
              <span
                className={`flex h-[66px] w-[66px] items-center justify-center rounded-[24px] bg-cta text-white shadow-[0_6px_0_var(--color-cta-press)] transition-transform duration-200 ${press}`}
              >
                <Icon size={32} weight="fill" />
              </span>
              <span className="mt-1">{tab.label}</span>
            </button>
          );
        }

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setTapped(tab.id);
              onTabChange(tab.id);
            }}
            aria-current={isActive ? "page" : undefined}
            className={`flex min-h-tap-min w-16 flex-col items-center gap-0.5 text-[12.5px] font-extrabold transition-[color,transform] duration-200 ${press} ${
              isActive ? "text-brand dark:text-moon" : "text-[#9A93B8] dark:text-moon-2/70"
            }`}
          >
            <Icon size={28} weight="duotone" />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
