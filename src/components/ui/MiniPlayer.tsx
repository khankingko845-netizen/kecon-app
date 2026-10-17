"use client";

/**
 * Trình nghe thu gọn — the story keeps going after the child leaves the full
 * player. Docked above the tab bar (AppShell's bottom dock), clear of the
 * raised "Tạo" button, so every tab stays tappable. Tap the title to open the
 * full player on the same page, without restarting the audio.
 */
import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw, SkipBack, SkipForward, Timer, X } from "@/components/ui/icons";
import MissionCelebration from "@/components/ui/MissionCelebration";
import { useAudioPlayer } from "@/lib/audio-player-context";
import { visiblePage } from "@/lib/background-player";
import { useTheme } from "@/lib/theme-context";

/** Card height + the gap that clears the raised "Tạo" button (see the spacer in AppShell). */
export const MINI_PLAYER_SPACE = 86;

function useMinutesLeft(endAt: number | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [endAt]);
  return endAt ? Math.max(1, Math.ceil((endAt - Math.min(now, endAt)) / 60_000)) : null;
}

const ICON_BTN =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors active:bg-ink/5 disabled:opacity-35 dark:text-moon-2 dark:active:bg-white/10";

export default function MiniPlayer({ onOpen, onOpenSky }: { onOpen: (storyId: string, page: number) => void; onOpenSky: () => void }) {
  const p = useAudioPlayer();
  const { isBedtime } = useTheme();
  const track = p.currentTrack;
  const minutesLeft = useMinutesLeft(track?.sleepEndAt);
  if (!track) return null;

  const { status, progress } = p;
  const page = visiblePage(p);
  const ended = status === "ended";
  const subtitle =
    status === "turning"
      ? `Sang trang ${page}…`
      : status === "error"
        ? (p.error ?? "Chưa phát được")
        : ended
          ? "Hết truyện rồi!"
          : `Trang ${track.pageNumber}/${track.totalPages}`;
  const main = ended
    ? { label: "Nghe lại từ đầu", icon: <RotateCcw size={18} weight="bold" />, run: p.replay }
    : p.isPlaying
      ? { label: "Tạm dừng", icon: <Pause size={16} weight="fill" />, run: p.pause }
      : { label: "Nghe tiếp", icon: <Play size={16} weight="fill" className="ml-0.5" />, run: p.resume };

  return (
    <>
      {p.celebration && (
        <MissionCelebration
          docked
          celebration={p.celebration}
          night={isBedtime}
          onClose={p.dismissCelebration}
          onOpenSky={() => {
            p.dismissCelebration();
            onOpenSky();
          }}
        />
      )}
      <section
        aria-label="Trình nghe thu gọn"
        data-testid="mini-player"
        data-status={status}
        className="pointer-events-auto relative mx-2 mb-[26px] flex h-[60px] items-center gap-1 overflow-hidden rounded-[20px] bg-white/95 pl-2 pr-1 shadow-[0_8px_24px_rgba(21,18,51,0.18)] ring-1 ring-black/5 backdrop-blur-xl dark:bg-[#0F0628]/95 dark:ring-white/10"
      >
        <button
          type="button"
          onClick={() => onOpen(track.storyId, page)}
          aria-label={`Mở trình nghe: ${track.storyTitle}, trang ${page}/${track.totalPages}`}
          className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-2xl text-left"
        >
          <span aria-hidden className="hidden h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-[#FF6B3D] to-[#FF3D77] shadow-md min-[380px]:flex min-[380px]:items-center min-[380px]:justify-center">
            {track.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={track.coverUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-[16px]">📖</span>
            )}
          </span>
          <span className="min-w-0">
            <b className="block truncate text-[14px] font-extrabold leading-tight text-ink dark:text-moon">{track.storyTitle}</b>
            <span className={`flex items-center gap-1 truncate text-[12.5px] font-bold leading-tight ${status === "error" ? "text-[#C2410C] dark:text-[#FDBA74]" : "text-ink-2 dark:text-moon-2"}`}>
              <span className="truncate">{subtitle}</span>
              {minutesLeft !== null && !ended && (
                <span className="flex shrink-0 items-center gap-0.5" aria-label={`Hẹn giờ ngủ còn ${minutesLeft} phút`}>
                  · <Timer size={12} weight="bold" />
                  {minutesLeft}′
                </span>
              )}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center">
          <button type="button" onClick={p.prevPage} disabled={page <= 1} aria-label="Trang trước" className={ICON_BTN}>
            <SkipBack size={16} weight="fill" />
          </button>
          <button
            type="button"
            onClick={main.run}
            aria-label={main.label}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#FF6B3D] to-[#FF3D77] text-white shadow-md transition-transform active:scale-95"
          >
            {main.icon}
          </button>
          <button type="button" onClick={p.nextPage} disabled={ended || page >= track.totalPages} aria-label="Trang sau" className={ICON_BTN}>
            <SkipForward size={16} weight="fill" />
          </button>
          <button type="button" onClick={p.stop} aria-label="Tắt trình phát" className={ICON_BTN}>
            <X size={16} weight="bold" />
          </button>
        </div>

        <div
          role="progressbar"
          aria-label={`Tiến độ trang ${track.pageNumber}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          className="absolute inset-x-0 bottom-0 h-[3px] bg-ink/[0.06] dark:bg-white/10"
        >
          <div className="h-full bg-gradient-to-r from-[#FF6B3D] to-[#FF3D77] transition-[width] duration-200" style={{ width: `${progress}%` }} />
        </div>
      </section>
    </>
  );
}
