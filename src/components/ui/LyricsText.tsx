"use client";

import { useMemo } from "react";

interface LyricsTextProps {
  text: string;
  progress: number; // 0-100
  isPlaying: boolean;
}

/**
 * Lyrics-style text with word-by-word highlight based on audio progress.
 * Estimates word timing from progress % (no word-level timestamps needed).
 */
export default function LyricsText({ text, progress, isPlaying }: LyricsTextProps) {
  const words = useMemo(() => {
    // Split into words preserving punctuation
    return text.split(/(\s+)/).filter(Boolean);
  }, [text]);

  const totalWords = words.filter(w => w.trim()).length;
  // Which word index should be highlighted based on progress
  const highlightIdx = Math.floor((progress / 100) * totalWords);

  let wordCount = 0;

  return (
    <span className="leading-relaxed">
      {words.map((word, i) => {
        const isSpace = !word.trim();
        if (isSpace) return <span key={i}>{word}</span>;

        const idx = wordCount;
        wordCount++;

        const isPast = isPlaying && idx < highlightIdx;
        const isCurrent = isPlaying && idx === highlightIdx;

        return (
          <span
            key={i}
            className={`transition-all duration-300 ${
              isCurrent
                ? "text-white font-semibold scale-[1.02] inline-block"
                : isPast
                  ? "text-white/70"
                  : "text-white/30"
            }`}
          >
            {word}
          </span>
        );
      })}
    </span>
  );
}
