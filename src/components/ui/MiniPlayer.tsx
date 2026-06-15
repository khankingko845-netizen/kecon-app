"use client";

import { Play, Pause, X, SkipBack, SkipForward } from "lucide-react";
import { useAudioPlayer } from "@/lib/audio-player-context";

export default function MiniPlayer() {
  const {
    currentTrack,
    isPlaying,
    progress,
    pause,
    resume,
    stop,
    nextPage,
    prevPage,
    seekTo,
  } = useAudioPlayer();

  if (!currentTrack) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 max-w-[430px] mx-auto">
      {/* Seekable progress bar */}
      <div
        className="w-full h-[5px] bg-black/10 cursor-pointer group relative"
        onPointerDown={(e) => {
          const bar = e.currentTarget;
          const rect = bar.getBoundingClientRect();

          const doSeek = (clientX: number) => {
            const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
            seekTo(pct);
          };

          doSeek(e.clientX);
          bar.setPointerCapture(e.pointerId);

          const onMove = (ev: PointerEvent) => doSeek(ev.clientX);
          const onUp = () => {
            bar.removeEventListener("pointermove", onMove);
            bar.removeEventListener("pointerup", onUp);
          };
          bar.addEventListener("pointermove", onMove);
          bar.addEventListener("pointerup", onUp);
        }}
      >
        <div
          className="h-full bg-gradient-to-r from-[#FF6B3D] to-[#FF3D77] transition-[width] duration-150"
          style={{ width: `${progress}%` }}
        />
        {/* Seek thumb — visible on hover/drag */}
        <div
          className="absolute top-[-3px] w-3 h-3 rounded-full bg-white shadow-md opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity"
          style={{ left: `${Math.max(0, Math.min(progress, 97))}%` }}
        />
      </div>

      {/* Player bar */}
      <div className="bg-white/95 backdrop-blur-xl border-t border-black/5 px-4 py-2.5 flex items-center gap-3">
        {/* Story icon */}
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FF6B3D] to-[#FF3D77] flex items-center justify-center text-white shrink-0 shadow-md">
          <span className="text-[14px] font-black">📖</span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-txt truncate">
            {currentTrack.storyTitle}
          </p>
          <p className="text-[11px] text-txt-secondary font-medium">
            Trang {currentTrack.pageNumber}/{currentTrack.totalPages}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={prevPage}
            className="w-8 h-8 rounded-full flex items-center justify-center text-txt-secondary hover:bg-gray-100 transition-colors"
          >
            <SkipBack size={14} />
          </button>
          <button
            onClick={() => (isPlaying ? pause() : resume())}
            className="w-10 h-10 rounded-full bg-gradient-to-br from-[#FF6B3D] to-[#FF3D77] flex items-center justify-center text-white shadow-md active:scale-95 transition-transform"
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
          </button>
          <button
            onClick={nextPage}
            className="w-8 h-8 rounded-full flex items-center justify-center text-txt-secondary hover:bg-gray-100 transition-colors"
          >
            <SkipForward size={14} />
          </button>
          <button
            onClick={stop}
            className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-red-400 hover:bg-red-50 transition-colors ml-1"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
