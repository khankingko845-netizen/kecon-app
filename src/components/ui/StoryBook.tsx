"use client";
/**
 * Picture-book page for the story player: scene picture on top, text below,
 * page number at the foot. Turning to another page plays a 3D page-flip
 * (the old page turns over and reveals the new one); with reduced motion it
 * is a short crossfade. Night mode uses a dim paper (never pure white).
 */
import { useEffect, useRef, useState, type ReactNode, type Ref, type TouchEvent } from "react";
import LyricsText from "@/components/ui/LyricsText";

export interface BookPage {
  art: string;
  text: string;
}

interface StoryBookProps {
  pages: BookPage[];
  index: number;
  isNight: boolean;
  progress: number;
  isPlaying: boolean;
  /** Overlay inside the picture (mascot, "Đóm đang vẽ" chip…). */
  pictureOverlay?: ReactNode;
  onTouchStart?: (e: TouchEvent) => void;
  onTouchEnd?: (e: TouchEvent) => void;
}

function Paper({
  art,
  body,
  number,
  total,
  isNight,
  overlay,
  textRef,
  dense,
}: {
  art?: string;
  body: ReactNode;
  number: number;
  total: number;
  isNight: boolean;
  overlay?: ReactNode;
  textRef?: Ref<HTMLDivElement>;
  /** Long pages (v2 stories run 80–145 words) use a slightly smaller type. */
  dense?: boolean;
}) {
  return (
    <div className={`kc-paper flex h-full flex-col overflow-hidden rounded-[22px] ${isNight ? "kc-paper-night" : ""}`}>
      <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden">
        {art && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={art}
            alt=""
            draggable={false}
            className="h-full w-full object-cover"
            style={{ filter: isNight ? "brightness(.72) saturate(.85)" : undefined }}
          />
        )}
        {overlay}
      </div>
      <div
        ref={textRef}
        className={`kc-page-text min-h-[120px] max-h-[34vh] flex-1 overflow-y-auto whitespace-pre-line px-[18px] pb-2 pt-3.5 font-bold no-scrollbar ${dense ? "text-[16.5px] leading-[1.6]" : "text-[18px] leading-[1.65]"}`}
      >
        {body}
      </div>
      <div className="kc-page-number shrink-0 pb-2.5 text-center text-[13px] font-extrabold">
        {number} / {total}
      </div>
    </div>
  );
}

export default function StoryBook({ pages, index, isNight, progress, isPlaying, pictureOverlay, onTouchStart, onTouchEnd }: StoryBookProps) {
  const total = Math.max(pages.length, 1);
  const [shownIndex, setShownIndex] = useState(index);
  const [flip, setFlip] = useState<{ from: number; dir: 1 | -1; id: number } | null>(null);
  // Derived-state pattern: a page change starts a flip from the page shown before.
  if (shownIndex !== index) {
    setFlip({ from: shownIndex, dir: index > shownIndex ? 1 : -1, id: (flip?.id ?? 0) + 1 });
    setShownIndex(index);
  }
  useEffect(() => {
    if (!flip) return;
    const t = setTimeout(() => setFlip(null), 1000);
    return () => clearTimeout(t);
  }, [flip]);

  // Keep the line being read in view; start each page at the top.
  const textRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = textRef.current;
    if (!el || !isPlaying) return;
    const room = el.scrollHeight - el.clientHeight;
    if (room > 0) el.scrollTop = room * Math.max(0, Math.min(1, (progress / 100 - 0.2) / 0.7));
  }, [progress, isPlaying]);
  useEffect(() => {
    if (textRef.current) textRef.current.scrollTop = 0;
  }, [index]);

  const page = pages[index];
  const from = flip ? pages[flip.from] : undefined;
  const isDense = (text?: string) => (text ?? "").split(/\s+/).length > 70;
  return (
    <section
      aria-label={`Trang ${index + 1} trên ${total}`}
      data-testid="story-book"
      className="kc-book relative h-full"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <Paper
        art={page?.art}
        number={index + 1}
        total={total}
        isNight={isNight}
        overlay={pictureOverlay}
        textRef={textRef}
        dense={isDense(page?.text)}
        body={
          page?.text ? (
            <LyricsText
              text={page.text}
              progress={progress}
              isPlaying={isPlaying}
              currentClassName={isNight ? "rounded-md bg-amber/[0.14] px-[3px] text-amber" : "rounded-md bg-[#FFE2A8] px-[3px] text-[#5A3600]"}
            />
          ) : (
            <span>…</span>
          )
        }
      />
      {flip && from && (
        <div
          key={flip.id}
          aria-hidden
          data-testid="page-flip"
          className={`kc-flip absolute inset-0 z-10 ${flip.dir === 1 ? "kc-flip-forward" : "kc-flip-back"}`}
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget) setFlip(null);
          }}
        >
          <div className="kc-face-front absolute inset-0">
            <Paper art={from.art} number={flip.from + 1} total={total} isNight={isNight} dense={isDense(from.text)} body={from.text || "…"} />
            <span className="kc-flip-shade" />
          </div>
          <div className={`kc-face-back absolute inset-0 rounded-[22px] ${isNight ? "kc-paper-night" : "kc-paper"}`} />
        </div>
      )}
    </section>
  );
}
