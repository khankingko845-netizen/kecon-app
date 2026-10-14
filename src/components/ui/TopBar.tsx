"use client";

import { ChevronLeft } from "@/components/ui/icons";

interface TopBarProps {
 title: string;
 onBack?: () => void;
 rightElement?: React.ReactNode;
 dark?: boolean;
 /** Accessible name of the back button (icon only). */
 backLabel?: string;
}

/** Legacy screen header. Mobile rules: 44×44 back target with a name, one h1, title never pushes the back button. */
export default function TopBar({ title, onBack, rightElement, dark, backLabel = "Quay lại" }: TopBarProps) {
 return (
 <div className="flex items-center gap-3 px-5 pt-14 pb-2">
 {onBack && (
 <button
 type="button"
 onClick={onBack}
 aria-label={backLabel}
 className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
 dark ? "bg-white/5 text-white/60" : "bg-gray-100 dark:bg-white/[0.06] text-txt dark:text-white"
 }`}
 >
 <ChevronLeft size={20} />
 </button>
 )}
 <h1
 className={`min-w-0 flex-1 truncate text-[17px] font-bold tracking-tight ${
 dark ? "text-white" : "text-txt dark:text-white"
 }`}
 >
 {title}
 </h1>
 {rightElement}
 </div>
 );
}
