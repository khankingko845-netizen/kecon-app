"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Play, Pencil, Heart, Share2, Trash2, X } from "lucide-react";

interface MenuItem {
  id: string;
  icon: typeof Play;
  label: string;
  color?: string;
  destructive?: boolean;
}

interface LongPressMenuProps {
  items: MenuItem[];
  onSelect: (id: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}

const DEFAULT_ITEMS: MenuItem[] = [
  { id: "play", icon: Play, label: "Nghe truyện", color: "text-accent" },
  { id: "edit", icon: Pencil, label: "Chỉnh sửa", color: "text-blue-500" },
  { id: "favorite", icon: Heart, label: "Yêu thích", color: "text-pink-500" },
  { id: "share", icon: Share2, label: "Chia sẻ", color: "text-emerald-500" },
  { id: "delete", icon: Trash2, label: "Xoá", destructive: true },
];

export default function LongPressMenu({
  items = DEFAULT_ITEMS,
  onSelect,
  children,
  disabled,
}: LongPressMenuProps) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const movedRef = useRef(false);

  const startPress = useCallback(() => {
    if (disabled) return;
    movedRef.current = false;
    timerRef.current = setTimeout(() => {
      if (!movedRef.current) {
        setOpen(true);
        // Haptic feedback if available
        if (navigator.vibrate) navigator.vibrate(30);
      }
    }, 500);
  }, [disabled]);

  const cancelPress = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onMove = useCallback(() => {
    movedRef.current = true;
    cancelPress();
  }, [cancelPress]);

  useEffect(() => {
    return () => cancelPress();
  }, [cancelPress]);

  const handleSelect = (id: string) => {
    setOpen(false);
    onSelect(id);
  };

  return (
    <>
      <div
        onTouchStart={startPress}
        onTouchEnd={cancelPress}
        onTouchMove={onMove}
        onContextMenu={(e) => { e.preventDefault(); if (!disabled) setOpen(true); }}
      >
        {children}
      </div>

      {/* Overlay menu */}
      {open && (
        <div
          className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm flex items-end justify-center animate-[fadeIn_0.15s_ease]"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-[420px] bg-white dark:bg-[#1A1030] rounded-t-3xl p-2 pb-8 animate-[slideUp_0.25s_ease] safe-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-white/20 mx-auto mb-3" />

            {items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl active:bg-gray-50 dark:active:bg-white dark:bg-white/[0.04]/5 transition-colors ${
                    item.destructive ? "text-red-500" : ""
                  }`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    item.destructive
                      ? "bg-red-50 dark:bg-red-500/10"
                      : "bg-gray-50 dark:bg-white/5"
                  }`}>
                    <Icon size={18} className={item.destructive ? "text-red-500" : (item.color || "text-txt dark:text-white")} />
                  </div>
                  <span className={`text-[14px] font-bold ${
                    item.destructive ? "text-red-500" : "text-txt dark:text-white"
                  }`}>
                    {item.label}
                  </span>
                </button>
              );
            })}

            <button
              onClick={() => setOpen(false)}
              className="w-full mt-1 py-3.5 rounded-xl bg-gray-100 dark:bg-white/5 text-[14px] font-bold text-txt-secondary dark:text-white/50"
            >
              Đóng
            </button>
          </div>
        </div>
      )}
    </>
  );
}
