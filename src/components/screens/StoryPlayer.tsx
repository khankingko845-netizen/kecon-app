"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  ChevronLeft, MoreHorizontal, Play, Pause,
  SkipBack, SkipForward, Moon, Shuffle, Heart, Share2, Mic,
  Volume2, Loader2,
} from "lucide-react";
import type { Screen } from "@/lib/types";
import type { GeneratedStory } from "@/lib/story-ai";
import { useSettings } from "@/lib/settings-context";
import { useData } from "@/lib/data-context";
import { ttsApi } from "@/lib/api-client";
import {
  getStory,
  getStoryPages,
  logPlaySession,
  logBehavior,
  likeStory,
  gradientFor,
  type StoryRow,
  type StoryPageRow,
} from "@/lib/db";

interface StoryPlayerProps {
  storyId?: string;
  onBack: () => void;
  onNavigate: (screen: Screen) => void;
}

// Default ElevenLabs voice (used when the story's voice has no clone yet).
const DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB";

export default function StoryPlayer({ storyId, onBack, onNavigate }: StoryPlayerProps) {
  const { settings } = useSettings();
  const { voiceProfiles } = useData();
  const isGenerated = storyId === "__generated__";

  const [generatedStory] = useState<GeneratedStory | null>(() => {
    if (storyId === "__generated__" && typeof window !== "undefined") {
      const saved = localStorage.getItem("kecon-generated-story");
      if (saved) {
        try {
          return JSON.parse(saved) as GeneratedStory;
        } catch {}
      }
    }
    return null;
  });

  const [story, setStory] = useState<StoryRow | null>(null);
  const [pages, setPages] = useState<StoryPageRow[]>([]);
  const [loading, setLoading] = useState(!isGenerated);
  const [currentPage, setCurrentPage] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isTTSLoading, setIsTTSLoading] = useState(false);
  const [liked, setLiked] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(Date.now());
  const pagesListenedRef = useRef<Set<number>>(new Set());

  // Load real story + pages from DB.
  useEffect(() => {
    if (isGenerated || !storyId) return;
    let active = true;
    setLoading(true);
    Promise.all([getStory(storyId), getStoryPages(storyId)])
      .then(([s, p]) => {
        if (!active) return;
        setStory(s);
        setPages(p);
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [storyId, isGenerated]);

  const title = isGenerated
    ? generatedStory?.title || "Truyện AI"
    : story?.title || "Truyện";

  const totalPages = isGenerated
    ? generatedStory?.pages.length || 1
    : Math.max(pages.length, 1);

  const currentText = isGenerated
    ? generatedStory?.pages[currentPage]?.text || ""
    : pages[currentPage]?.content || "";

  // Resolve which ElevenLabs voice to use for TTS.
  const storyVoice = story?.voice_id
    ? voiceProfiles.find((v) => v.id === story.voice_id)
    : voiceProfiles.find((v) => v.elevenlabs_voice_id);
  const elevenVoiceId = storyVoice?.elevenlabs_voice_id || DEFAULT_VOICE_ID;
  const voiceLabel = storyVoice?.name || "Giọng mẫu";

  const gradient = isGenerated
    ? "from-accent-2 to-accent"
    : story
    ? gradientFor(story.id)
    : "from-accent-2 to-accent";

  // Log play session on unmount.
  const flushSession = useCallback(() => {
    if (isGenerated || !storyId) return;
    const duration = Math.round((Date.now() - startRef.current) / 1000);
    if (duration < 2) return;
    const listened = pagesListenedRef.current.size;
    logPlaySession({
      storyId,
      voiceId: story?.voice_id ?? null,
      duration,
      pagesListened: listened,
      completed: listened >= totalPages,
    }).catch(() => {});
  }, [isGenerated, storyId, story, totalPages]);

  useEffect(() => {
    startRef.current = Date.now();
    if (storyId && !isGenerated) logBehavior("play", storyId).catch(() => {});
    return () => {
      flushSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId]);

  useEffect(() => {
    pagesListenedRef.current.add(currentPage);
  }, [currentPage]);

  // Fake progress when there is no audio element (no API key configured).
  useEffect(() => {
    if (isPlaying && !audioRef.current) {
      intervalRef.current = setInterval(() => {
        setProgress((p) => {
          if (p >= 100) {
            if (currentPage < totalPages - 1) {
              setCurrentPage((c) => c + 1);
              return 0;
            }
            setIsPlaying(false);
            return 100;
          }
          return p + 0.5;
        });
      }, 500);
    } else if (!isPlaying && intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, currentPage, totalPages]);

  const playWithTTS = useCallback(async () => {
    if (!settings.elevenLabsApiKey || !currentText) {
      setIsPlaying(true);
      return;
    }

    setIsTTSLoading(true);
    try {
      const blob = await ttsApi(
        elevenVoiceId,
        currentText,
        settings.elevenLabsApiKey,
        settings.elevenLabsModelId
      );

      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        setIsPlaying(false);
        if (currentPage < totalPages - 1) {
          setCurrentPage((c) => c + 1);
          setProgress(0);
        } else {
          if (storyId && !isGenerated) logBehavior("complete", storyId).catch(() => {});
        }
      };

      audio.ontimeupdate = () => {
        if (audio.duration) {
          setProgress((audio.currentTime / audio.duration) * 100);
        }
      };

      await audio.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(true);
    } finally {
      setIsTTSLoading(false);
    }
  }, [settings.elevenLabsApiKey, settings.elevenLabsModelId, currentText, currentPage, totalPages, elevenVoiceId, storyId, isGenerated]);

  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
      audioRef.current?.pause();
    } else {
      playWithTTS();
    }
  };

  const goPage = (delta: number) => {
    const next = currentPage + delta;
    if (next >= 0 && next < totalPages) {
      setCurrentPage(next);
      setProgress(0);
      setIsPlaying(false);
      audioRef.current?.pause();
      audioRef.current = null;
    }
  };

  const handleLike = () => {
    if (isGenerated || !storyId) return;
    const next = !liked;
    setLiked(next);
    likeStory(storyId, next).catch(() => {});
  };

  const actions = [
    { icon: Moon, label: "Ru Ngủ", action: () => onNavigate("lullaby"), active: false },
    { icon: Shuffle, label: "Rẽ Nhánh", action: () => onNavigate("adventure"), active: false },
    { icon: Heart, label: "Yêu Thích", action: handleLike, active: liked },
    { icon: Share2, label: "Chia Sẻ", action: () => {}, active: false },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#1A0F3A] to-[#0F0628] flex items-center justify-center text-white">
        <Loader2 size={28} className="animate-spin text-accent-2" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1A0F3A] to-[#0F0628] flex flex-col text-white">
      {/* Top Bar */}
      <div className="flex justify-between items-center px-5 pt-14 pb-2">
        <button
          onClick={() => {
            audioRef.current?.pause();
            onBack();
          }}
          className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center"
        >
          <ChevronLeft size={20} className="text-white/60" />
        </button>
        <div className="flex items-center gap-2">
          {settings.elevenLabsApiKey && (
            <span className="px-2.5 py-1 rounded-lg bg-accent-2/20 text-[10px] font-bold text-accent-2 flex items-center gap-1">
              <Volume2 size={10} /> ElevenLabs
            </span>
          )}
          <button className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center">
            <MoreHorizontal size={20} className="text-white/60" />
          </button>
        </div>
      </div>

      {/* Album Art */}
      <div className="flex-1 flex flex-col items-center px-7 pt-5">
        <div
          className={`w-64 h-64 rounded-[28px] bg-gradient-to-br ${gradient} flex items-center justify-center text-white mb-7 shadow-2xl shadow-black/50 relative`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-16 h-16 opacity-80">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
          </svg>
          <span className="absolute bottom-3 right-4 px-3 py-1 rounded-lg bg-black/40 backdrop-blur-sm text-[11px] font-bold text-white/70">
            Trang {currentPage + 1}/{totalPages}
          </span>
        </div>

        <h2 className="text-2xl font-extrabold tracking-tight mb-1 text-center">
          {title}
        </h2>
        <p className="text-sm text-white/40 font-medium flex items-center gap-1.5 mb-2">
          <Mic size={14} />
          {isGenerated ? "AI Generated" : `Giọng đọc: ${voiceLabel}`}
        </p>

        {/* Text Preview */}
        <div className="w-full px-[18px] py-3.5 bg-white/[0.04] rounded-[14px] border border-white/[0.06] text-sm italic text-white/50 leading-relaxed mb-5 max-h-[120px] overflow-y-auto no-scrollbar">
          {currentText ? `\u201C${currentText}\u201D` : "..."}
        </div>

        {/* Seek Bar */}
        <div className="w-full mb-1">
          <div className="w-full h-1 bg-white/[0.08] rounded-full relative">
            <div
              className="h-full bg-gradient-to-r from-accent-2 to-accent rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
            <div
              className="absolute top-[-5px] w-3.5 h-3.5 rounded-full bg-white shadow-md"
              style={{ left: `${Math.max(0, Math.min(progress, 98))}%` }}
            />
          </div>
          <div className="flex justify-between text-xs font-semibold text-white/30 mt-2">
            <span>{currentPage + 1}/{totalPages}</span>
            <span>{isGenerated ? "AI Story" : `${totalPages} trang`}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-7 mt-4">
          <button onClick={() => goPage(-1)} className="text-white/40">
            <SkipBack size={22} />
          </button>
          <span className="text-xs font-bold text-white/40">Prev</span>
          <button
            onClick={togglePlay}
            disabled={isTTSLoading}
            className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-lg shadow-white/20 active:scale-95 transition-transform disabled:opacity-60"
          >
            {isTTSLoading ? (
              <Loader2 size={24} className="text-[#0F0628] animate-spin" />
            ) : isPlaying ? (
              <Pause size={24} className="text-[#0F0628]" />
            ) : (
              <Play size={24} className="text-[#0F0628]" fill="#0F0628" />
            )}
          </button>
          <span className="text-xs font-bold text-white/40">Next</span>
          <button onClick={() => goPage(1)} className="text-white/40">
            <SkipForward size={22} />
          </button>
        </div>
      </div>

      {/* Bottom Actions */}
      <div className="flex justify-around px-5 pt-5 pb-10">
        {actions.map((a) => (
          <button key={a.label} onClick={a.action} className="text-center">
            <a.icon
              size={20}
              className={`mx-auto ${a.active ? "text-accent" : "text-white/40"}`}
              fill={a.active ? "currentColor" : "none"}
            />
            <span className="text-[10px] font-semibold text-white/30 mt-1 block">
              {a.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
