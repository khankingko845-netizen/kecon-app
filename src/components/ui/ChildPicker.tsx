"use client";

/**
 * T10 · "Ai đang nghe truyện?" — siblings switch the child chosen on this device
 * (greeting, kid UI age band, suggestions, story creation). Kid-facing: big targets,
 * Escape / backdrop / Đóng close it, focus returns to the greeting.
 */
import { useEffect, useRef } from "react";
import { Check, X } from "@/components/ui/icons";
import { useChildProfiles } from "@/lib/child-profiles-context";
import { ageLabel, childInitial } from "@/lib/child-profiles";

const COLORS = ["bg-brand-soft text-brand-ink", "bg-glow-soft text-[#7A4A00]", "bg-success-soft text-success", "bg-[#FDE7DF] text-cta-press"];

export default function ChildPicker({ onClose }: { onClose: () => void }) {
  const { kids, activeChild, setActiveChild } = useChildProfiles();
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("[aria-pressed='true'], button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40" onClick={onClose} data-testid="child-picker-backdrop">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="child-picker-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[430px] rounded-t-[28px] bg-cream px-5 pb-8 pt-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="child-picker-title" className="font-display text-[22px] font-bold text-ink">
            Ai đang nghe truyện?
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-ink"
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {kids.map((child, i) => {
            const on = child.id === activeChild?.id;
            return (
              <button
                key={child.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setActiveChild(child.id);
                  onClose();
                }}
                className={`relative flex min-h-[112px] flex-col items-center justify-center gap-1.5 rounded-[22px] border-2 bg-white px-2 py-3 ${on ? "border-brand" : "border-transparent"}`}
              >
                <span aria-hidden className={`flex h-12 w-12 items-center justify-center rounded-full font-display text-[22px] font-bold ${COLORS[i % COLORS.length]}`}>
                  {childInitial(child.display_name)}
                </span>
                <span className="max-w-full truncate text-[17px] font-extrabold text-ink">{child.display_name}</span>
                <span className="text-[13px] font-bold text-ink-2">{ageLabel(child.birth_year)}</span>
                {on && (
                  <span aria-hidden className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-brand text-white">
                    <Check size={14} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
