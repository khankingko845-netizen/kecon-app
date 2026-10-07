"use client";
import { Volume2 } from "@/components/ui/icons";
import { useSettings } from "@/lib/settings-context";
export default function NarrationToggle() {
  const { settings, updateSettings } = useSettings();
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
        <span className="h-5 w-5 rounded-full bg-white" />
      </span>
    </button>
  );
}
