"use client";
import { Volume2 } from "@/components/ui/icons";
import { useSettings } from "@/lib/settings-context";
export default function NarrationToggle({ compact = false }: { compact?: boolean }) {
  const { settings, updateSettings } = useSettings();
  const on = settings.narrationEnabled;
  if (compact)
    // Player (night surface): one 44 px row, so the whole player fits one screen.
    return (
      <button
        type="button"
        role="switch"
        aria-label="Giọng đọc truyện"
        aria-checked={on}
        onClick={() => updateSettings({ narrationEnabled: !on })}
        className="flex h-11 w-full items-center gap-2.5 rounded-2xl border border-moon/[0.12] bg-moon/[0.08] px-3.5 text-left text-[#DCD3EE] focus-visible:outline-2 focus-visible:outline-amber"
      >
        <Volume2 size={18} className="shrink-0 text-amber" />
        <span className="min-w-0 flex-1 truncate text-[14px] font-extrabold">
          Giọng đọc truyện <span className="font-semibold text-moon-2">· {on ? "Đang bật" : "Đọc yên lặng"}</span>
        </span>
        <span aria-hidden className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 ${on ? "justify-end bg-amber" : "justify-start bg-moon/25"}`}>
          <span className="h-5 w-5 rounded-full bg-[#F7EFD8]" />
        </span>
      </button>
    );
  return (
    <button
      type="button"
      role="switch"
      aria-label="Giọng đọc truyện"
      aria-checked={settings.narrationEnabled}
      onClick={() =>
        updateSettings({ narrationEnabled: !settings.narrationEnabled })
      }
      className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-brand-soft px-4 py-3 text-left text-ink dark:bg-white/10 dark:text-[#F7EFD8] focus-visible:outline-2 focus-visible:outline-brand"
    >
      <Volume2 size={20} />
      <span className="flex-1 text-[14px] font-bold">
        Giọng đọc truyện{" "}
        <span className="block text-[14px] font-normal">
          {settings.narrationEnabled ? "Đang bật" : "Đã tắt · đọc yên lặng"}
        </span>
      </span>
      <span
        aria-hidden
        className={`flex h-7 w-12 items-center rounded-full p-1 ${settings.narrationEnabled ? "justify-end bg-brand" : "justify-start bg-gray-500"}`}
      >
        <span className="h-5 w-5 rounded-full bg-[#F7EFD8]" />
      </span>
    </button>
  );
}
