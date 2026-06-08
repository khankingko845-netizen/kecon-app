"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  ChevronLeft, MoreHorizontal, Play, Pause,
  SkipBack, SkipForward, Moon, Shuffle, Heart, SlidersHorizontal, Mic,
  Volume2, Loader2, X, Sparkles,
} from "lucide-react";
import type { Screen } from "@/lib/types";
import type { GeneratedStory } from "@/lib/story-ai";
import { useSettings } from "@/lib/settings-context";
import { useData } from "@/lib/data-context";
import { ttsApi } from "@/lib/api-client";
import { AmbientEngine, type AmbientType } from "@/lib/audio-engine";
import SceneEffects from "@/components/ui/SceneEffects";
import {
  effectForScene,
  asEffectType,
  EFFECT_LABELS,
  type EffectType,
} from "@/lib/scene-effects";
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
  onNavigate: (screen: Screen, data?: Record<string, string>) => void;
}

// Default ElevenLabs voice (used when the story's voice has no clone yet).
const DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB";

const AMBIENT_OPTIONS: { type: AmbientType; label: string }[] = [
  { type: "rain", label: "Mưa" },
  { type: "waves", label: "Sóng biển" },
  { type: "wind", label: "Gió" },
  { type: "fire", label: "Lửa trại" },
  { type: "forest", label: "Rừng" },
  { type: "night", label: "Đêm" },
  { type: "lullaby", label: "Ru ngủ" },
];

// AI auto-matching: pick an ambient layer from a page's scene description.
function ambientForScene(text: string): AmbientType | null {
  const t = text.toLowerCase();
  if (/mưa|rain|giông|bão/.test(t)) return "rain";
  if (/biển|sóng|đại dương|sea|ocean|wave/.test(t)) return "waves";
  if (/gió|wind|bão|đồi|núi/.test(t)) return "wind";
  if (/lửa|fire|bếp|trại|nến|ấm/.test(t)) return "fire";
  if (/rừng|cây|chim|forest|vườn|lá/.test(t)) return "forest";
  if (/đêm|tối|sao|trăng|night|ngủ/.test(t)) return "night";
  return null;
}

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

  // Sound mixer (Web Audio ambient layers).
  const engineRef = useRef<AmbientEngine | null>(null);
  const [showMixer, setShowMixer] = useState(false);
  const [ambientOn, setAmbientOn] = useState<Record<string, boolean>>({});
  const [ambientVol, setAmbientVol] = useState<Record<string, number>>({});
  const [autoAmbient, setAutoAmbient] = useState(true);

  // Visual effects (scene-matched particles). manualEffect overrides auto.
  const [autoEffect, setAutoEffect] = useState(true);
  const [manualEffect, setManualEffect] = useState<EffectType | null>(null);

  const getEngine = useCallback(() => {
    if (!engineRef.current) engineRef.current = new AmbientEngine();
    return engineRef.current;
  }, []);

  const toggleAmbient = useCallback(
    (type: AmbientType, on: boolean) => {
      getEngine().toggle(type, on);
      setAmbientOn((prev) => ({ ...prev, [type]: on }));
    },
    [getEngine]
  );

  const changeAmbientVol = useCallback(
    (type: AmbientType, v: number) => {
      getEngine().setVolume(type, v);
      setAmbientVol((prev) => ({ ...prev, [type]: v }));
    },
    [getEngine]
  );

  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

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

  // AI auto-matching: swap ambient layer to match the current page's scene.
  const sceneDesc = isGenerated
    ? generatedStory?.pages[currentPage]?.sceneDescription || ""
    : pages[currentPage]?.scene_description || "";

  // Resolve the visual effect for this page. Priority:
  // 1) manual override, 2) effect authored on the page, 3) heuristic match.
  const authoredEffect = isGenerated
    ? null
    : asEffectType(pages[currentPage]?.particle_effect);
  const autoMatchedEffect =
    authoredEffect ?? effectForScene(`${sceneDesc} ${currentText}`);
  const activeEffect: EffectType | null =
    manualEffect ?? (autoEffect ? autoMatchedEffect : null);
  useEffect(() => {
    if (!autoAmbient || !isPlaying) return;
    const match = ambientForScene(`${sceneDesc} ${currentText}`);
    if (!match) return;
    const engine = getEngine();
    AMBIENT_OPTIONS.forEach(({ type }) => {
      if (type !== match && engine.isPlaying(type) && !ambientOn[type]) {
        engine.stopLayer(type);
      }
    });
    if (!engine.isPlaying(match)) {
      engine.setVolume(match, 0.4);
      engine.play(match);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneDesc, autoAmbient, isPlaying, currentPage]);

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

  const anyAmbientOn = AMBIENT_OPTIONS.some((o) => ambientOn[o.type]);
  const actions = [
    { icon: Moon, label: "Ru Ngủ", action: () => onNavigate("lullaby"), active: false },
    {
      icon: Shuffle,
      label: "Rẽ Nhánh",
      action: () =>
        onNavigate(
          "adventure",
          story?.is_branching && storyId ? { storyId } : undefined
        ),
      active: false,
    },
    { icon: Heart, label: "Yêu Thích", action: handleLike, active: liked },
    { icon: SlidersHorizontal, label: "Âm Nền", action: () => setShowMixer(true), active: anyAmbientOn },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#1A0F3A] to-[#0F0628] flex items-center justify-center text-white">
        <Loader2 size={28} className="animate-spin text-accent-2" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-[#1A0F3A] to-[#0F0628] flex flex-col text-white">
      {/* Scene-matched visual effects (particles), behind all content */}
      <SceneEffects effect={activeEffect} active={isPlaying} />

      {/* Top Bar */}
      <div className="relative z-10 flex justify-between items-center px-5 pt-14 pb-2">
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
      <div className="relative z-10 flex-1 flex flex-col items-center px-7 pt-5">
        <div
          key={`art-${currentPage}`}
          className={`w-64 h-64 rounded-[28px] bg-gradient-to-br ${gradient} flex items-center justify-center text-white mb-7 shadow-2xl shadow-black/50 relative fx-page-enter`}
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

        {/* Active visual-effect indicator */}
        {activeEffect && (
          <span className="mb-3 px-3 py-1 rounded-full bg-white/[0.08] text-[11px] font-bold text-white/70 flex items-center gap-1.5">
            <Sparkles size={11} className="text-accent-2" />
            Hiệu ứng: {EFFECT_LABELS[activeEffect]}
          </span>
        )}

        {/* Text Preview */}
        <div
          key={`txt-${currentPage}`}
          className="fx-page-enter w-full px-[18px] py-3.5 bg-white/[0.04] rounded-[14px] border border-white/[0.06] text-sm italic text-white/50 leading-relaxed mb-5 max-h-[120px] overflow-y-auto no-scrollbar"
        >
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
      <div className="relative z-10 flex justify-around px-5 pt-5 pb-10">
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

      {/* Sound Mixer (3-layer: voice TTS + ambient + auto-match) */}
      {showMixer && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-[430px] bg-[#160C33] rounded-t-3xl p-6 pb-9 animate-[slideUp_0.3s_ease] border-t border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[17px] font-black tracking-tight flex items-center gap-2">
                <SlidersHorizontal size={18} className="text-accent-2" /> Trộn Âm Thanh
              </h3>
              <button
                onClick={() => setShowMixer(false)}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/70"
              >
                <X size={16} />
              </button>
            </div>

            <button
              onClick={() => setAutoAmbient((v) => !v)}
              className={`w-full mb-4 py-2.5 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2 transition-colors ${
                autoAmbient
                  ? "bg-accent-2/20 text-accent-2"
                  : "bg-white/5 text-white/50"
              }`}
            >
              <Volume2 size={14} />
              AI tự chọn âm nền theo cảnh: {autoAmbient ? "BẬT" : "TẮT"}
            </button>

            <div className="space-y-3 max-h-[40vh] overflow-y-auto no-scrollbar">
              {AMBIENT_OPTIONS.map(({ type, label }) => {
                const on = ambientOn[type] ?? false;
                const vol = ambientVol[type] ?? 0.6;
                return (
                  <div key={type} className="flex items-center gap-3">
                    <button
                      onClick={() => toggleAmbient(type, !on)}
                      className={`w-20 shrink-0 py-2 rounded-lg text-[12px] font-bold transition-colors ${
                        on ? "bg-accent text-white" : "bg-white/5 text-white/50"
                      }`}
                    >
                      {label}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={vol}
                      disabled={!on}
                      onChange={(e) => changeAmbientVol(type, Number(e.target.value))}
                      className="flex-1 accent-accent-2 disabled:opacity-30"
                    />
                  </div>
                );
              })}
            </div>

            {/* Visual effects (scene-matched particles) */}
            <div className="mt-5 pt-4 border-t border-white/10">
              <h4 className="text-[13px] font-black tracking-tight flex items-center gap-2 mb-3">
                <Sparkles size={15} className="text-accent-2" /> Hiệu Ứng Hình Ảnh
              </h4>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    setAutoEffect(true);
                    setManualEffect(null);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-colors ${
                    autoEffect && !manualEffect
                      ? "bg-accent-2 text-[#0F0628]"
                      : "bg-white/5 text-white/50"
                  }`}
                >
                  AI tự chọn
                </button>
                <button
                  onClick={() => {
                    setAutoEffect(false);
                    setManualEffect(null);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-colors ${
                    !autoEffect && !manualEffect
                      ? "bg-accent text-white"
                      : "bg-white/5 text-white/50"
                  }`}
                >
                  Tắt
                </button>
                {(Object.keys(EFFECT_LABELS) as EffectType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => setManualEffect(type)}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-colors ${
                      manualEffect === type
                        ? "bg-accent text-white"
                        : "bg-white/5 text-white/50"
                    }`}
                  >
                    {EFFECT_LABELS[type]}
                  </button>
                ))}
              </div>
              {autoEffect && !manualEffect && (
                <p className="text-[11px] text-white/30 mt-2">
                  {autoMatchedEffect
                    ? `Đang khớp cảnh: ${EFFECT_LABELS[autoMatchedEffect]}`
                    : "Trang này chưa khớp hiệu ứng nào"}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
