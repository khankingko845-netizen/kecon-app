"use client";
import { Loader2, Square, Volume2 } from "@/components/ui/icons";
import type { VoicePreview } from "@/lib/use-voice-preview";
export default function VoicePreviewButton({
  preview,
  voiceId,
  name,
  language,
  compact = false,
  onBeforePlay,
}: {
  preview: VoicePreview;
  voiceId: string;
  name: string;
  language?: string;
  compact?: boolean;
  onBeforePlay?: () => void;
}) {
  const active =
    preview.voiceId === voiceId &&
    (!language || preview.language === language) &&
    preview.status !== "idle";
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${active ? "Dừng nghe thử" : "Nghe thử"}: ${name}`}
      onClick={(e) => {
        e.stopPropagation();
        onBeforePlay?.();
        preview.toggle(voiceId, language);
      }}
      className={`voice-preview-button inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-brand-soft px-2.5 text-[14px] font-bold text-brand-ink dark:bg-white/10 dark:text-[#F7EFD8] focus-visible:outline-2 focus-visible:outline-brand ${compact ? "" : "whitespace-nowrap"}`}
    >
      {active && preview.status === "loading" ? (
        <Loader2 size={16} className="animate-spin" />
      ) : active ? (
        <Square size={16} />
      ) : (
        <Volume2 size={16} />
      )}
      {!compact && (active ? "Dừng" : "Nghe thử")}
    </button>
  );
}
