"use client";

import { ChevronLeft } from "lucide-react";

interface TopBarProps {
  title: string;
  onBack?: () => void;
  rightElement?: React.ReactNode;
  dark?: boolean;
}

export default function TopBar({ title, onBack, rightElement, dark }: TopBarProps) {
  return (
    <div className="flex items-center gap-3 px-5 pt-14 pb-2">
      {onBack && (
        <button
          onClick={onBack}
          className={`w-9 h-9 rounded-xl flex items-center justify-center ${
            dark ? "bg-white/5 text-white/60" : "bg-gray-100 text-txt"
          }`}
        >
          <ChevronLeft size={20} />
        </button>
      )}
      <h2
        className={`text-[17px] font-bold tracking-tight flex-1 ${
          dark ? "text-white" : "text-txt"
        }`}
      >
        {title}
      </h2>
      {rightElement}
    </div>
  );
}
