"use client";
/**
 * Short, non-blocking "you did it" card after a finished story (G-03/G-05).
 * Names what the child did, shows the stars/sticker the server recorded and
 * closes itself. Bedtime: no sound/voice/motion, dim and brief.
 */
import { useEffect } from "react";
import { Star, X } from "@/components/ui/icons";
import { Button3D } from "@/components/ui/kit";
import Mascot from "@/components/ui/Mascot";
import { ALL_DONE_LINE, milestoneLine, type Celebration } from "@/lib/missions";

export default function MissionCelebration({
  celebration,
  night,
  onClose,
  onOpenSky,
  docked = false,
}: {
  celebration: Celebration;
  night: boolean;
  onClose: () => void;
  onOpenSky: () => void;
  /** Inside the bottom dock, above the MiniPlayer (story finished in "chế độ thu gọn"). */
  docked?: boolean;
}) {
  useEffect(() => {
    const t = window.setTimeout(onClose, night ? 6000 : 12000);
    return () => window.clearTimeout(t);
  }, [onClose, night]);

  const { stars, line, sticker, milestone, allDone } = celebration;
  const milestoneText = milestone ? milestoneLine(milestone) : null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="mission-celebration"
      className={`${docked ? "pointer-events-auto relative mx-3 mb-2" : "fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+24px)] z-40 mx-auto max-w-[400px]"} rounded-[24px] bg-white p-4 text-ink shadow-[0_10px_30px_rgba(0,0,0,0.35)] ${night ? "night-dim" : "motion-safe:animate-[scaleIn_0.25s_ease]"}`}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Đóng"
        className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-2xl text-ink-2 active:bg-ink/5"
      >
        <X size={22} />
      </button>
      <div className="flex items-center gap-3 pr-9">
        <Mascot state="celebrate" size={64} label={null} glow={!night} still={night} />
        <div className="min-w-0">
          {stars > 0 && (
            <p className="flex items-center gap-1 font-display text-[22px] font-bold leading-tight">
              +{stars} <Star size={22} weight="fill" className="text-[#F2A900]" aria-hidden />
              <span className="sr-only">ngôi sao</span>
            </p>
          )}
          <p className="text-[16px] font-extrabold leading-snug">{line.text}</p>
        </div>
      </div>
      {sticker && (
        <div className="mt-3 flex items-center gap-2.5 rounded-2xl bg-glow-soft p-2">
          {sticker.cover_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sticker.cover_image_url} alt="" className="h-11 w-11 rounded-full object-cover" />
          ) : null}
          <p className="text-[14px] font-extrabold text-[#7A4A00]">
            Album có thêm bạn từ truyện “{sticker.title ?? "mới"}”
          </p>
        </div>
      )}
      {milestoneText && milestoneText !== line.text && <p className="mt-2 text-[14px] font-extrabold text-ink-2">{milestoneText}</p>}
      {allDone && <p className="mt-2 text-[14px] font-extrabold text-ink-2">{ALL_DONE_LINE}</p>}
      <Button3D tone="brand" size="sm" block className="mt-3" onClick={onOpenSky}>
        Xem bầu trời của Đóm
      </Button3D>
    </div>
  );
}
