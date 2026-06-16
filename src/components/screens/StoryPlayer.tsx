"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  ChevronLeft, ChevronDown, MoreHorizontal, Play, Pause,
  SkipBack, SkipForward, Moon, Shuffle, Heart, SlidersHorizontal, Mic,
  Volume2, Loader2, X, Sparkles, Share2, Star, MessageSquare, Send,
  Bookmark, Pencil,
} from "lucide-react";
import type { Screen } from "@/lib/types";
import type { GeneratedStory } from "@/lib/story-ai";
import { useSettings } from "@/lib/settings-context";
import { useData } from "@/lib/data-context";
import { useAudioPlayer } from "@/lib/audio-player-context";
import { mergeAudioBlobs, getPageAtTime, type MergeResult } from "@/lib/audio-merger";
import { ttsApi } from "@/lib/api-client";
import { getStoryCharacters, updateStory, type StoryCharacterRow } from "@/lib/db";
import { parseVoiceMarkup, type ParsedSegment } from "@/lib/elevenlabs";
import { AmbientEngine, type AmbientType } from "@/lib/audio-engine";
import SceneEffects from "@/components/ui/SceneEffects";
import RatingStars from "@/components/ui/RatingStars";
import ShareModal from "@/components/ui/ShareModal";
import LyricsText from "@/components/ui/LyricsText";
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
  getStoryRating,
  rateStory,
  getStoryReviews,
  createReview,
  isFavorited,
  toggleFavorite,
  updateReadingStreak,
  uploadTtsAudio,
  savePageAudio,
  type StoryRow,
  type StoryPageRow,
  type StoryReviewRow,
} from "@/lib/db";

interface StoryPlayerProps {
  storyId?: string;
  onBack: () => void;
  onNavigate: (screen: Screen, data?: Record<string, string>) => void;
}

// Hardcoded fallback if no default voices configured.
const FALLBACK_VOICE_ID = "pNInz6obpgDQGcFmaJgB";

interface DefaultVoice {
  id: string;
  voice_id: string;
  name: string;
  language: string;
}

const AMBIENT_OPTIONS: { type: AmbientType; label: string }[] = [
  { type: "rain", label: "Mưa" },
  { type: "waves", label: "Sóng biển" },
  { type: "wind", label: "Gió" },
  { type: "fire", label: "Lửa trại" },
  { type: "forest", label: "Rừng" },
  { type: "night", label: "Đêm" },
  { type: "lullaby", label: "Ru ngủ" },
];

// Map ambient category IDs (from editor) to AmbientType (audio engine)
const CATEGORY_TO_AMBIENT: Record<string, AmbientType> = {
  forest: "forest",
  night: "night",
  ocean: "waves",
  rain: "rain",
  castle: "fire",      // fireplace crackling for castles
  adventure: "wind",
  home: "fire",         // cozy fireplace
  suspense: "wind",
  lullaby: "lullaby",
  magic: "lullaby",     // gentle chimes similar to lullaby
  underwater: "waves",
  playful: "forest",    // lightest background
};

// AI auto-matching: pick an ambient layer from a page's scene description.
function ambientForScene(text: string, pageAmbient?: string | null): AmbientType | null {
  // Priority: editor-set category > heuristic match
  if (pageAmbient && CATEGORY_TO_AMBIENT[pageAmbient]) {
    return CATEGORY_TO_AMBIENT[pageAmbient];
  }
  const t = text.toLowerCase();
  if (/mưa|rain|giông|bão/.test(t)) return "rain";
  if (/biển|sóng|đại dương|sea|ocean|wave/.test(t)) return "waves";
  if (/gió|wind|bão|đồi|núi/.test(t)) return "wind";
  if (/lửa|fire|bếp|trại|nến|ấm/.test(t)) return "fire";
  if (/rừng|cây|chim|forest|vườn|lá/.test(t)) return "forest";
  if (/đêm|tối|sao|trăng|night|ngủ/.test(t)) return "night";
  if (/ngủ|ru|lullaby|giấc mơ/.test(t)) return "lullaby";
  return null;
}

export default function StoryPlayer({ storyId, onBack, onNavigate }: StoryPlayerProps) {
  const { settings, hasElevenLabs } = useSettings();
  const { voiceProfiles } = useData();
  const globalPlayer = useAudioPlayer();
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

  // New state: Rating, Reviews, Share, Favorites
  const [showRating, setShowRating] = useState(false);
  const [avgRating, setAvgRating] = useState(0);
  const [ratingCount, setRatingCount] = useState(0);
  const [userRating, setUserRating] = useState(0);
  const [reviews, setReviews] = useState<StoryReviewRow[]>([]);
  const [reviewText, setReviewText] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [isFav, setIsFav] = useState(false);

  // Swipe gesture
  const swipeRef = useRef({ x: 0, y: 0, time: 0 });
  const [favLoading, setFavLoading] = useState(false);

  // Default voices from admin + user voice selection
  const [defaultVoices, setDefaultVoices] = useState<DefaultVoice[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  // Auto-advance: when audio ends, go to next page and auto-play
  const [pendingAutoPlay, setPendingAutoPlay] = useState(false);

  // Multi-voice: characters + current speaker indicator
  const [storyCharacters, setStoryCharacters] = useState<StoryCharacterRow[]>([]);
  const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(Date.now());
  const pagesListenedRef = useRef<Set<number>>(new Set());
  // Audio prefetch cache: pageIndex → objectURL or remote URL
  const prefetchCache = useRef<Map<number, string>>(new Map());

  // Continuous playback: merged audio for gapless background play
  const [mergeStatus, setMergeStatus] = useState<"idle" | "generating" | "merging" | "ready" | "playing">("idle");
  const [mergeProgress, setMergeProgress] = useState("");
  const mergedRef = useRef<MergeResult | null>(null);
  const mergeAbortRef = useRef(false);

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

  // Load default voices from admin settings
  useEffect(() => {
    fetch("/api/voice/defaults")
      .then((r) => r.json())
      .then((data) => {
        if (data.voices) setDefaultVoices(data.voices);
      })
      .catch(() => {});
  }, []);

  // Load story characters for multi-voice
  useEffect(() => {
    if (isGenerated || !storyId) return;
    getStoryCharacters(storyId).then(setStoryCharacters).catch(() => {});
  }, [storyId, isGenerated]);

  // Load rating, reviews, and favorite status
  useEffect(() => {
    if (isGenerated || !storyId) return;
    getStoryRating(storyId).then((r) => {
      setAvgRating(r.avgRating);
      setRatingCount(r.ratingCount);
      setUserRating(r.userRating ?? 0);
    }).catch(() => {});
    getStoryReviews(storyId).then(setReviews).catch(() => {});
    isFavorited(storyId).then(setIsFav).catch(() => {});
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

  // Strip voice markup for display — show clean text
  const displayText = currentText
    .replace(/\[(narrator|character:[^\]]*)\]/g, "")
    .replace(/\[\/(narrator|character)\]/g, "")
    .trim();

  // Simple markdown → HTML for story display
  const renderMarkdown = (text: string): string => {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^---$/gm, '<hr class="my-2 border-white/10">')
      .replace(/^> (.+)$/gm, '<span class="opacity-70 pl-2 border-l-2 border-white/20">$1</span>')
      .replace(/\n/g, '<br>');
  };

  // Get illustration URL for the current page
  const currentIllustration = isGenerated
    ? null
    : pages[currentPage]?.illustration_url;

  // Resolve which ElevenLabs voice to use for TTS.
  // Priority: 1) user-selected  2) remembered (last used for this story)  3) family cloned voices  4) narrator  5) defaults  6) fallback
  const storyVoice = story?.voice_id
    ? voiceProfiles.find((v) => v.id === story.voice_id)
    : voiceProfiles.find((v) => v.elevenlabs_voice_id);

  const storyLocale = story?.locale || "vi";
  const narratorVoiceId = story?.narrator_voice_id ?? null;
  const narratorVoiceName = story?.narrator_voice_name ?? null;
  const rememberedVoiceId = story?.last_voice_id ?? null;
  const rememberedVoiceName = story?.last_voice_name ?? null;
  const defaultsForLocale = defaultVoices.filter((v) => v.language === storyLocale);
  const allDefaults = defaultVoices.length > 0 ? defaultVoices : [];
  // First family cloned voice (prioritized over system defaults)
  const firstClonedVoice = voiceProfiles.find((v) => v.elevenlabs_voice_id);

  // Determine active voice
  const resolvedVoiceId = selectedVoiceId
    || rememberedVoiceId
    || firstClonedVoice?.elevenlabs_voice_id
    || narratorVoiceId
    || storyVoice?.elevenlabs_voice_id
    || defaultsForLocale[0]?.voice_id
    || allDefaults[0]?.voice_id
    || FALLBACK_VOICE_ID;
  const elevenVoiceId = resolvedVoiceId;

  // Save voice choice to story when user manually picks
  const handleVoiceSelect = useCallback((voiceId: string, voiceName: string) => {
    setSelectedVoiceId(voiceId);
    setShowVoicePicker(false);
    // Persist to DB
    if (storyId && !isGenerated) {
      updateStory(storyId, {
        last_voice_id: voiceId,
        last_voice_name: voiceName,
      }).catch(() => {});
    }
  }, [storyId, isGenerated]);

  // Label for display
  const selectedDefault = defaultVoices.find((v) => v.voice_id === resolvedVoiceId);
  const selectedClone = voiceProfiles.find((v) => v.elevenlabs_voice_id === resolvedVoiceId);
  const voiceLabel = selectedVoiceId
    ? (selectedClone?.name || selectedDefault?.name || "Giọng đã chọn")
    : rememberedVoiceId
    ? (rememberedVoiceName || "Giọng đã dùng")
    : selectedClone?.name
    ? `🎙️ ${selectedClone.name}`
    : narratorVoiceId
    ? (narratorVoiceName || "Narrator")
    : storyVoice?.name
    ? storyVoice.name
    : selectedDefault?.name || "Giọng mẫu";

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
    // Update reading streak
    const minutes = Math.round(duration / 60);
    if (minutes > 0) {
      updateReadingStreak(minutes).catch(() => {});
    }
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
    const pageAmbient = isGenerated ? null : pages[currentPage]?.ambient_sound;
    const match = ambientForScene(`${sceneDesc} ${currentText}`, pageAmbient);
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

  // Auto-play next page when audio ends and advances
  useEffect(() => {
    if (pendingAutoPlay) {
      setPendingAutoPlay(false);
      playWithTTS();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoPlay, currentPage]);

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

  // Helper: generate TTS for a page text and return an audio URL (objectURL or remote)
  const generatePageAudio = useCallback(async (
    text: string,
    pageIdx: number,
  ): Promise<string> => {
    const hasMarkup = /\[(narrator|character:[^\]]+)\]/.test(text);
    let blob: Blob;

    if (hasMarkup && storyCharacters.length > 0) {
      const charVoiceMap: Record<string, { voiceId: string; voiceName?: string }> = {};
      for (const c of storyCharacters) {
        if (c.voice_id) {
          charVoiceMap[c.name] = { voiceId: c.voice_id, voiceName: c.voice_name || c.name };
        }
      }
      const segments = parseVoiceMarkup(text, charVoiceMap, elevenVoiceId, narratorVoiceName || "Narrator");
      const audioBlobs: Blob[] = [];
      for (const seg of segments) {
        if (pageIdx === currentPage) {
          setCurrentSpeaker(seg.speaker === "narrator" ? null : seg.speaker);
        }
        const segBlob = await ttsApi(
          seg.voiceId, seg.text,
          settings.elevenLabsApiKey || undefined,
          settings.elevenLabsModelId || undefined,
          story?.locale || "vi"
        );
        audioBlobs.push(segBlob);
      }
      if (audioBlobs.length === 1) {
        blob = audioBlobs[0];
      } else {
        const parts: ArrayBuffer[] = [];
        for (const b of audioBlobs) parts.push(await b.arrayBuffer());
        const totalLength = parts.reduce((s, p) => s + p.byteLength, 0);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const part of parts) { combined.set(new Uint8Array(part), offset); offset += part.byteLength; }
        blob = new Blob([combined], { type: "audio/mpeg" });
      }
      if (pageIdx === currentPage) setCurrentSpeaker(null);
    } else {
      blob = await ttsApi(
        elevenVoiceId, text,
        settings.elevenLabsApiKey || undefined,
        settings.elevenLabsModelId || undefined,
        story?.locale || "vi"
      );
    }

    // Save audio to Supabase for future reuse (fire-and-forget)
    const pageRow = pages[pageIdx];
    if (pageRow && !pageRow.audio_url) {
      uploadTtsAudio(pageRow.id, blob).then((remoteUrl) => {
        savePageAudio(pageRow.id, remoteUrl, 0).catch(() => {});
        // Update local pages state so we don't regenerate
        setPages((prev) =>
          prev.map((p) => (p.id === pageRow.id ? { ...p, audio_url: remoteUrl } : p))
        );
      }).catch(() => {});
    }

    return URL.createObjectURL(blob);
  }, [storyCharacters, elevenVoiceId, narratorVoiceName, settings.elevenLabsApiKey, settings.elevenLabsModelId, story?.locale, currentPage, pages]);

  // Prefetch next page audio in background
  const prefetchNextPage = useCallback((fromPageIdx: number) => {
    const nextIdx = fromPageIdx + 1;
    if (nextIdx >= totalPages || !hasElevenLabs) return;
    if (prefetchCache.current.has(nextIdx)) return; // already prefetched
    const nextPageRow = pages[nextIdx];
    if (!nextPageRow) return;
    // If it already has a saved audio_url, preload that
    if (nextPageRow.audio_url) {
      prefetchCache.current.set(nextIdx, nextPageRow.audio_url);
      // Preload into browser cache
      const preloadAudio = new Audio(nextPageRow.audio_url);
      preloadAudio.preload = "auto";
      preloadAudio.load();
      return;
    }
    // Otherwise generate TTS in background
    const nextText = nextPageRow.content;
    if (!nextText) return;
    generatePageAudio(nextText, nextIdx).then((url) => {
      prefetchCache.current.set(nextIdx, url);
    }).catch(() => {});
  }, [totalPages, hasElevenLabs, pages, generatePageAudio]);

  // Background merge: generate TTS for all pages and merge into single audio
  const startBackgroundMerge = useCallback(async () => {
    if (mergeStatus !== "idle" || isGenerated || !hasElevenLabs) return;
    if (totalPages <= 1) return; // no need to merge single page

    setMergeStatus("generating");
    mergeAbortRef.current = false;

    try {
      const blobs: Blob[] = [];

      for (let i = 0; i < totalPages; i++) {
        if (mergeAbortRef.current) return;
        setMergeProgress(`Chuẩn bị audio ${i + 1}/${totalPages}`);

        const pageRow = pages[i];
        if (!pageRow?.content) continue;

        let blob: Blob;
        // Check if page already has saved audio
        if (pageRow.audio_url) {
          try {
            const res = await fetch(pageRow.audio_url);
            blob = await res.blob();
          } catch {
            blob = await ttsApi(
              elevenVoiceId, pageRow.content,
              settings.elevenLabsApiKey || undefined,
              settings.elevenLabsModelId || undefined,
              story?.locale || "vi"
            );
          }
        } else {
          blob = await ttsApi(
            elevenVoiceId, pageRow.content,
            settings.elevenLabsApiKey || undefined,
            settings.elevenLabsModelId || undefined,
            story?.locale || "vi"
          );
          // Save to DB for future reuse
          uploadTtsAudio(pageRow.id, blob).then((remoteUrl) => {
            savePageAudio(pageRow.id, remoteUrl, 0).catch(() => {});
            setPages((prev) =>
              prev.map((p) => (p.id === pageRow.id ? { ...p, audio_url: remoteUrl } : p))
            );
          }).catch(() => {});
        }
        blobs.push(blob);
      }

      if (mergeAbortRef.current || blobs.length === 0) return;

      // Merge all blobs
      setMergeStatus("merging");
      setMergeProgress("Đang ghép audio liên tục...");

      const result = await mergeAudioBlobs(blobs, (p) => {
        if (p.phase === "decoding") {
          setMergeProgress(`Xử lý ${p.current}/${p.total}`);
        }
      });

      if (mergeAbortRef.current) {
        URL.revokeObjectURL(result.blobUrl);
        return;
      }

      mergedRef.current = result;
      setMergeStatus("ready");
      setMergeProgress("🎧 Audio liên tục sẵn sàng");
    } catch {
      setMergeStatus("idle"); // allow retry
      setMergeProgress("");
    }
  }, [mergeStatus, isGenerated, hasElevenLabs, totalPages, pages, elevenVoiceId, settings.elevenLabsApiKey, settings.elevenLabsModelId, story?.locale]);

  // Switch to merged audio playback
  const switchToMerged = useCallback(() => {
    const merged = mergedRef.current;
    if (!merged) return;

    // Stop current per-page audio
    if (audioRef.current) {
      audioRef.current.pause();
      if (audioRef.current.src.startsWith("blob:")) {
        URL.revokeObjectURL(audioRef.current.src);
      }
    }

    const audio = new Audio(merged.blobUrl);
    audioRef.current = audio;

    // Seek to current page position
    const seekTime = merged.pageMarkers[currentPage] || 0;

    audio.onloadedmetadata = () => {
      audio.currentTime = seekTime;
    };

    audio.ontimeupdate = () => {
      if (audio.duration) {
        // Update overall progress
        setProgress((audio.currentTime / audio.duration) * 100);
        // Update current page based on time markers
        const pageIdx = getPageAtTime(audio.currentTime, merged.pageMarkers);
        setCurrentPage(pageIdx);
      }
    };

    audio.onended = () => {
      audioRef.current = null;
      setIsPlaying(false);
      setProgress(100);
      setMergeStatus("ready");
      if (storyId && !isGenerated) logBehavior("complete", storyId).catch(() => {});
    };

    audio.play().catch(() => {});
    setIsPlaying(true);
    setMergeStatus("playing");
  }, [currentPage, storyId, isGenerated]);

  const playWithTTS = useCallback(async () => {
    if (!hasElevenLabs || !currentText) {
      setIsPlaying(true);
      return;
    }

    setIsTTSLoading(true);
    setCurrentSpeaker(null);
    try {
      let url: string;
      const pageRow = !isGenerated ? pages[currentPage] : null;

      // 1. Check if page already has saved audio_url in DB
      if (pageRow?.audio_url) {
        url = pageRow.audio_url;
      }
      // 2. Check prefetch cache
      else if (prefetchCache.current.has(currentPage)) {
        url = prefetchCache.current.get(currentPage)!;
        prefetchCache.current.delete(currentPage);
      }
      // 3. Generate new TTS
      else {
        url = await generatePageAudio(currentText, currentPage);
      }

      if (audioRef.current) {
        audioRef.current.pause();
        // Only revoke blob URLs, not remote URLs
        if (audioRef.current.src.startsWith("blob:")) {
          URL.revokeObjectURL(audioRef.current.src);
        }
      }

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        audioRef.current = null;
        if (currentPage < totalPages - 1) {
          setCurrentPage((c) => c + 1);
          setProgress(0);
          setPendingAutoPlay(true);
        } else {
          setIsPlaying(false);
          setProgress(100);
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

      // Start prefetching next page while this one plays
      prefetchNextPage(currentPage);

      // Start background merge for continuous playback (only once)
      if (mergeStatus === "idle" && totalPages > 1) {
        startBackgroundMerge();
      }
    } catch {
      setIsPlaying(true);
    } finally {
      setIsTTSLoading(false);
    }
  }, [hasElevenLabs, currentText, currentPage, totalPages, storyId, isGenerated, pages, generatePageAudio, prefetchNextPage, mergeStatus, startBackgroundMerge]);

  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
      audioRef.current?.pause();
    } else if (mergeStatus === "ready") {
      // Merged audio ready — use continuous playback
      switchToMerged();
    } else if (mergeStatus === "playing" && audioRef.current) {
      // Resume merged playback
      audioRef.current.play().catch(() => {});
      setIsPlaying(true);
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

  // Swipe handlers for page navigation
  const onSwipeStart = (e: React.TouchEvent) => {
    swipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() };
  };
  const onSwipeEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - swipeRef.current.x;
    const dy = e.changedTouches[0].clientY - swipeRef.current.y;
    const dt = Date.now() - swipeRef.current.time;
    // Only register horizontal swipes (not vertical scroll)
    if (Math.abs(dx) > Math.abs(dy) * 1.2 && Math.abs(dx) > 60 && dt < 500) {
      if (dx < 0) goPage(1);  // swipe left → next
      else goPage(-1);         // swipe right → prev
    }
  };

  const handleLike = () => {
    if (isGenerated || !storyId) return;
    const next = !liked;
    setLiked(next);
    likeStory(storyId, next).catch(() => {});
  };

  const handleRate = async (rating: number) => {
    if (!storyId || isGenerated) return;
    setUserRating(rating);
    try {
      await rateStory(storyId, rating);
      const r = await getStoryRating(storyId);
      setAvgRating(r.avgRating);
      setRatingCount(r.ratingCount);
    } catch {}
  };

  const handleSubmitReview = async () => {
    if (!storyId || !reviewText.trim() || isGenerated) return;
    setSubmittingReview(true);
    try {
      await createReview(storyId, reviewText.trim(), userRating || undefined);
      setReviewText("");
      const r = await getStoryReviews(storyId);
      setReviews(r);
    } catch {}
    setSubmittingReview(false);
  };

  const handleToggleFavorite = async () => {
    if (!storyId || isGenerated) return;
    setFavLoading(true);
    try {
      const result = await toggleFavorite(storyId);
      setIsFav(result);
    } catch {}
    setFavLoading(false);
  };

  const anyAmbientOn = AMBIENT_OPTIONS.some((o) => ambientOn[o.type]);
  // --- AI Feature States ---
  const [isIllustrating, setIsIllustrating] = useState(false);
  const [showAIMenu, setShowAIMenu] = useState(false);
  const [isPersonalizing, setIsPersonalizing] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);

  const handleAutoIllustrate = async () => {
    if (!storyId || isIllustrating) return;
    setIsIllustrating(true);
    setAiMessage("Đang tạo minh hoạ AI...");
    try {
      const res = await fetch("/api/story/illustrate-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId, style: "watercolor" }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const successCount = data.results?.filter((r: { url?: string }) => r.url).length || 0;
      setAiMessage(`✅ Đã tạo ${successCount} minh hoạ!`);
      // Reload pages to show illustrations
      const freshPages = await getStoryPages(storyId);
      if (freshPages) setPages(freshPages);
    } catch (err) {
      setAiMessage(`❌ ${err instanceof Error ? err.message : "Lỗi tạo minh hoạ"}`);
    }
    setIsIllustrating(false);
    setTimeout(() => setAiMessage(null), 3000);
  };

  const handlePersonalize = async () => {
    if (!storyId || isPersonalizing) return;
    const childName = prompt("Tên bé:");
    if (!childName) return;
    const interests = prompt("Sở thích bé (tuỳ chọn):");
    setIsPersonalizing(true);
    setAiMessage("Đang cá nhân hoá truyện...");
    try {
      const res = await fetch("/api/story/personalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId, childName, interests }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAiMessage(`✅ Truyện cho ${childName} đã tạo!`);
      setTimeout(() => {
        onNavigate("player", { storyId: data.storyId });
      }, 1500);
    } catch (err) {
      setAiMessage(`❌ ${err instanceof Error ? err.message : "Lỗi"}`);
    }
    setIsPersonalizing(false);
    setTimeout(() => setAiMessage(null), 4000);
  };

  const handleTranslate = async (targetLang: string, bilingual: boolean) => {
    if (!storyId || isTranslating) return;
    setIsTranslating(true);
    setAiMessage("Đang dịch truyện...");
    try {
      const res = await fetch("/api/story/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId, targetLanguage: targetLang, bilingual }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAiMessage(`✅ Đã dịch xong!`);
      setTimeout(() => {
        onNavigate("player", { storyId: data.storyId });
      }, 1500);
    } catch (err) {
      setAiMessage(`❌ ${err instanceof Error ? err.message : "Lỗi"}`);
    }
    setIsTranslating(false);
    setTimeout(() => setAiMessage(null), 4000);
  };

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
    { icon: Bookmark, label: "Lưu", action: handleToggleFavorite, active: isFav, loading: favLoading },
    { icon: Share2, label: "Chia Sẻ", action: () => setShowShare(true), active: false },
    { icon: Sparkles, label: "AI ✨", action: () => setShowAIMenu(true), active: false },
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
            // Hand off playing audio to MiniPlayer for background playback
            if (audioRef.current && !audioRef.current.paused && story) {
              // If merged audio is playing, it's a single continuous track
              const isMerged = mergeStatus === "playing";
              const allPageAudios = isMerged
                ? undefined // merged = single track, no page switching needed
                : pages
                    .filter((p) => p.audio_url)
                    .map((p) => ({ pageNumber: p.page_number, audioUrl: p.audio_url! }));
              globalPlayer.adoptAudio(audioRef.current, {
                storyId: story.id,
                storyTitle: story.title,
                pageNumber: currentPage + 1,
                totalPages,
                audioUrl: audioRef.current.src,
                allPages: allPageAudios && allPageAudios.length > 0 ? allPageAudios : undefined,
              });
              audioRef.current = null; // Don't pause — MiniPlayer owns it now
            } else {
              audioRef.current?.pause();
            }
            // Clean up merge refs but don't revoke blob (MiniPlayer may use it)
            mergeAbortRef.current = true;
            onBack();
          }}
          className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center"
        >
          <ChevronLeft size={20} className="text-white/60" />
        </button>
        <div className="flex items-center gap-2">
          {hasElevenLabs && (
            <span className="px-2.5 py-1 rounded-lg bg-accent-2/20 text-[10px] font-bold text-accent-2 flex items-center gap-1">
              <Volume2 size={10} /> ElevenLabs
            </span>
          )}
          {/* Rating badge */}
          {ratingCount > 0 && (
            <button
              onClick={() => setShowRating(true)}
              className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-[10px] font-bold text-amber-400 flex items-center gap-1"
            >
              <Star size={10} fill="currentColor" /> {avgRating.toFixed(1)}
            </button>
          )}
          {!isGenerated && storyId && (
            <button
              onClick={() => {
                audioRef.current?.pause();
                onNavigate("editor", { storyId });
              }}
              className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center"
              title="Chỉnh sửa truyện"
            >
              <Pencil size={16} className="text-white/60" />
            </button>
          )}
          <button
            onClick={() => setShowRating(!showRating)}
            className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center"
          >
            <MoreHorizontal size={20} className="text-white/60" />
          </button>
        </div>
      </div>

      {/* Album Art — now shows illustration if available */}
      <div
        className="relative z-10 flex-1 flex flex-col items-center px-7 pt-5"
        onTouchStart={onSwipeStart}
        onTouchEnd={onSwipeEnd}
      >
        <div
          key={`art-${currentPage}`}
          className={`w-64 h-64 rounded-[28px] ${
            currentIllustration ? "" : `bg-gradient-to-br ${gradient}`
          } flex items-center justify-center text-white mb-7 shadow-2xl shadow-black/50 relative fx-page-enter overflow-hidden`}
        >
          {currentIllustration ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentIllustration}
              alt={`Minh hoạ trang ${currentPage + 1}`}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-16 h-16 opacity-80">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
            </svg>
          )}
          <span className="absolute bottom-3 right-4 px-3 py-1 rounded-lg bg-black/40 backdrop-blur-sm text-[11px] font-bold text-white/70">
            Trang {currentPage + 1}/{totalPages}
          </span>
          {/* Favorite heart overlay */}
          <button
            onClick={handleLike}
            className="absolute top-3 right-4 w-8 h-8 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center"
          >
            <Heart
              size={16}
              className={liked ? "text-red-400" : "text-white/60"}
              fill={liked ? "currentColor" : "none"}
            />
          </button>
        </div>

        <h2 className="text-2xl font-extrabold tracking-tight mb-1 text-center">
          {title}
        </h2>
        {isGenerated ? (
          <p className="text-sm text-white/40 font-medium flex items-center gap-1.5 mb-2">
            <Mic size={14} /> AI Generated
          </p>
        ) : (
          <div className="relative mb-2">
            <button
              onClick={() => setShowVoicePicker(!showVoicePicker)}
              className="text-sm text-white/50 font-medium flex items-center gap-1.5 hover:text-white/70 transition-colors"
            >
              <Mic size={14} />
              Giọng đọc: {voiceLabel}
              {(defaultVoices.length > 0 || voiceProfiles.length > 0) && (
                <ChevronDown size={12} className={`transition-transform ${showVoicePicker ? "rotate-180" : ""}`} />
              )}
            </button>
            {showVoicePicker && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-gray-900/95 backdrop-blur-sm border border-white/10 rounded-xl z-20 max-h-48 overflow-y-auto">
                {/* User's cloned voices */}
                {voiceProfiles.filter((v) => v.elevenlabs_voice_id).length > 0 && (
                  <>
                    <div className="px-3 py-1.5 text-[10px] font-bold text-white/30 uppercase tracking-wider">Giọng của bạn</div>
                    {voiceProfiles.filter((v) => v.elevenlabs_voice_id).map((v) => (
                      <button
                        key={v.id}
                        onClick={() => handleVoiceSelect(v.elevenlabs_voice_id!, v.name)}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 transition-colors ${
                          resolvedVoiceId === v.elevenlabs_voice_id ? "text-accent font-bold" : "text-white/70"
                        }`}
                      >
                        🎙️ {v.name}
                      </button>
                    ))}
                  </>
                )}
                {/* Default voices for this locale */}
                {defaultsForLocale.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 text-[10px] font-bold text-white/30 uppercase tracking-wider">
                      Giọng {storyLocale === "vi" ? "Tiếng Việt" : storyLocale === "ja" ? "日本語" : "English"}
                    </div>
                    {defaultsForLocale.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => handleVoiceSelect(v.voice_id, v.name)}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 transition-colors ${
                          resolvedVoiceId === v.voice_id ? "text-accent font-bold" : "text-white/70"
                        }`}
                      >
                        ⭐ {v.name}
                      </button>
                    ))}
                  </>
                )}
                {/* Default voices for other languages */}
                {defaultVoices.filter((v) => v.language !== storyLocale).length > 0 && (
                  <>
                    <div className="px-3 py-1.5 text-[10px] font-bold text-white/30 uppercase tracking-wider">Ngôn ngữ khác</div>
                    {defaultVoices.filter((v) => v.language !== storyLocale).map((v) => (
                      <button
                        key={v.id}
                        onClick={() => handleVoiceSelect(v.voice_id, v.name)}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 transition-colors ${
                          resolvedVoiceId === v.voice_id ? "text-accent font-bold" : "text-white/70"
                        }`}
                      >
                        {v.language === "vi" ? "🇻🇳" : v.language === "ja" ? "🇯🇵" : "🇺🇸"} {v.name}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Continuous playback indicator */}
        {mergeStatus !== "idle" && mergeStatus !== "playing" && (
          <div className="mb-2">
            {mergeStatus === "ready" ? (
              <button
                onClick={switchToMerged}
                className="text-[11px] font-bold text-accent-2 bg-accent-2/15 px-3 py-1 rounded-full flex items-center gap-1.5 active:scale-95 transition-transform"
              >
                🎧 Bật phát liên tục
              </button>
            ) : (
              <span className="text-[10px] text-white/30 flex items-center gap-1.5">
                <Loader2 size={10} className="animate-spin" /> {mergeProgress}
              </span>
            )}
          </div>
        )}
        {mergeStatus === "playing" && (
          <span className="text-[10px] font-bold text-accent-2 bg-accent-2/10 px-2.5 py-0.5 rounded-full mb-2 inline-flex items-center gap-1">
            🎧 Phát liên tục
          </span>
        )}

        {/* Inline rating stars */}
        {!isGenerated && storyId && (
          <button
            onClick={() => setShowRating(true)}
            className="mb-2 flex items-center gap-2"
          >
            <RatingStars value={userRating || avgRating} size={16} readonly dark />
            <span className="text-[11px] text-white/40">
              {ratingCount > 0 ? `(${ratingCount})` : "Đánh giá"}
            </span>
          </button>
        )}

        {/* Active visual-effect indicator */}
        {activeEffect && (
          <span className="mb-3 px-3 py-1 rounded-full bg-white/[0.08] text-[11px] font-bold text-white/70 flex items-center gap-1.5">
            <Sparkles size={11} className="text-accent-2" />
            Hiệu ứng: {EFFECT_LABELS[activeEffect]}
          </span>
        )}

        {/* Current speaker indicator */}
        {currentSpeaker && (
          <div className="flex items-center gap-1.5 mb-1.5">
            {(() => {
              const char = storyCharacters.find((c) => c.name === currentSpeaker);
              return (
                <>
                  <span className="text-sm">{char?.emoji || "💬"}</span>
                  <span className="text-[11px] font-bold text-white/60">{currentSpeaker}</span>
                </>
              );
            })()}
          </div>
        )}

        {/* Text Preview — Lyrics-style word highlight */}
        <div
          key={`txt-${currentPage}`}
          className="fx-page-enter w-full px-[18px] py-3.5 bg-white/[0.04] rounded-[14px] border border-white/[0.06] text-sm italic leading-relaxed mb-5 max-h-[120px] overflow-y-auto no-scrollbar"
        >
          {displayText ? (
            <LyricsText
              text={`\u201C${displayText}\u201D`}
              progress={progress}
              isPlaying={isPlaying}
            />
          ) : <span className="text-white/50">...</span>}
        </div>

        {/* Seek Bar — draggable */}
        <div className="w-full mb-1">
          <div
            className="w-full h-2.5 bg-white/[0.08] rounded-full relative cursor-pointer group"
            role="slider"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
            onPointerDown={(e) => {
              const bar = e.currentTarget;
              const rect = bar.getBoundingClientRect();

              const seekTo = (clientX: number) => {
                const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
                setProgress(pct);

                // Seek in audio
                if (audioRef.current && audioRef.current.duration) {
                  audioRef.current.currentTime = (pct / 100) * audioRef.current.duration;

                  // Update current page from merged markers
                  if (mergeStatus === "playing" && mergedRef.current) {
                    const pageIdx = getPageAtTime(audioRef.current.currentTime, mergedRef.current.pageMarkers);
                    setCurrentPage(pageIdx);
                  }
                } else if (!audioRef.current && mergeStatus !== "playing") {
                  // Per-page mode with no audio: jump to page by %
                  const targetPage = Math.floor((pct / 100) * totalPages);
                  setCurrentPage(Math.min(targetPage, totalPages - 1));
                }
              };

              seekTo(e.clientX);
              bar.setPointerCapture(e.pointerId);

              const onMove = (ev: PointerEvent) => seekTo(ev.clientX);
              const onUp = () => {
                bar.removeEventListener("pointermove", onMove);
                bar.removeEventListener("pointerup", onUp);
              };
              bar.addEventListener("pointermove", onMove);
              bar.addEventListener("pointerup", onUp);
            }}
          >
            {/* Page markers (tick marks) for merged mode */}
            {mergeStatus === "playing" && mergedRef.current && mergedRef.current.pageMarkers.length > 1 && (
              mergedRef.current.pageMarkers.slice(1).map((marker, i) => (
                <div
                  key={i}
                  className="absolute top-0 w-0.5 h-full bg-white/20 rounded-full"
                  style={{ left: `${(marker / mergedRef.current!.totalDuration) * 100}%` }}
                />
              ))
            )}
            <div
              className="h-full bg-gradient-to-r from-accent-2 to-accent rounded-full transition-[width] duration-150"
              style={{ width: `${progress}%` }}
            />
            <div
              className="absolute top-[-3px] w-4 h-4 rounded-full bg-white shadow-md shadow-black/30 group-active:scale-125 transition-transform"
              style={{ left: `${Math.max(0, Math.min(progress, 97))}%` }}
            />
          </div>
          {/* Time display */}
          <div className="flex justify-between text-xs font-semibold text-white/30 mt-2">
            <span>
              {audioRef.current && audioRef.current.duration
                ? `${Math.floor(audioRef.current.currentTime / 60)}:${String(Math.floor(audioRef.current.currentTime % 60)).padStart(2, "0")}`
                : `${currentPage + 1}/${totalPages}`
              }
            </span>
            <span>
              {audioRef.current && audioRef.current.duration
                ? `${Math.floor(audioRef.current.duration / 60)}:${String(Math.floor(audioRef.current.duration % 60)).padStart(2, "0")}`
                : isGenerated ? "AI Story" : `${totalPages} trang`
              }
            </span>
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
          <button key={a.label} onClick={a.action} className="text-center" disabled={"loading" in a && a.loading}>
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

      {/* Rating & Reviews Panel */}
      {showRating && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-[430px] bg-[#160C33] rounded-t-3xl p-6 pb-9 animate-[slideUp_0.3s_ease] border-t border-white/10 max-h-[80vh] overflow-y-auto no-scrollbar">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-[17px] font-black tracking-tight flex items-center gap-2">
                <Star size={18} className="text-amber-400" /> Đánh Giá & Nhận Xét
              </h3>
              <button
                onClick={() => setShowRating(false)}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/70"
              >
                <X size={16} />
              </button>
            </div>

            {/* Overall rating */}
            <div className="text-center mb-5">
              <p className="text-4xl font-black text-white mb-1">
                {avgRating > 0 ? avgRating.toFixed(1) : "—"}
              </p>
              <RatingStars value={avgRating} size={28} readonly dark />
              <p className="text-[12px] text-white/40 mt-1">
                {ratingCount} đánh giá
              </p>
            </div>

            {/* User's rating */}
            <div className="bg-white/5 rounded-2xl p-4 mb-5">
              <p className="text-[13px] font-bold text-white/70 mb-3">
                Đánh giá của bạn
              </p>
              <div className="flex justify-center">
                <RatingStars value={userRating} onChange={handleRate} size={32} dark />
              </div>
            </div>

            {/* Write review */}
            <div className="bg-white/5 rounded-2xl p-4 mb-5">
              <p className="text-[13px] font-bold text-white/70 mb-3 flex items-center gap-1.5">
                <MessageSquare size={14} /> Viết nhận xét
              </p>
              <textarea
                value={reviewText}
                onChange={(e) => setReviewText(e.target.value)}
                placeholder="Chia sẻ cảm nhận của bạn..."
                rows={3}
                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-[13px] text-white placeholder-white/30 outline-none focus:border-accent-2/50 resize-none"
              />
              <button
                onClick={handleSubmitReview}
                disabled={!reviewText.trim() || submittingReview}
                className="mt-2 w-full py-2.5 rounded-xl bg-accent-2/20 text-accent-2 text-[13px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-40"
              >
                {submittingReview ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
                Gửi nhận xét
              </button>
            </div>

            {/* Reviews list */}
            <div>
              <p className="text-[13px] font-bold text-white/70 mb-3">
                Nhận xét ({reviews.length})
              </p>
              {reviews.length === 0 ? (
                <p className="text-[12px] text-white/30 text-center py-4">
                  Chưa có nhận xét nào. Hãy là người đầu tiên!
                </p>
              ) : (
                <div className="space-y-3">
                  {reviews.map((r) => (
                    <div key={r.id} className="bg-white/5 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[12px] font-bold text-white/60">
                          {r.display_name || "Phụ huynh"}
                        </span>
                        {r.rating && (
                          <RatingStars value={r.rating} size={12} readonly dark />
                        )}
                        <span className="text-[10px] text-white/30 ml-auto">
                          {new Date(r.created_at).toLocaleDateString("vi-VN")}
                        </span>
                      </div>
                      <p className="text-[13px] text-white/50 leading-relaxed">
                        {r.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {showShare && storyId && !isGenerated && (
        <ShareModal
          storyId={storyId}
          storyTitle={title}
          onClose={() => setShowShare(false)}
        />
      )}

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
      {/* AI Feature Toast */}
      {aiMessage && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 rounded-2xl bg-violet-600/95 backdrop-blur-sm text-white text-sm font-bold shadow-xl shadow-violet-900/50 max-w-[380px] text-center animate-[slideDown_0.3s_ease]">
          {(isIllustrating || isPersonalizing || isTranslating) && (
            <Loader2 size={14} className="inline animate-spin mr-2" />
          )}
          {aiMessage}
        </div>
      )}

      {/* AI Menu */}
      {showAIMenu && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-[430px] bg-[#160C33] rounded-t-3xl p-6 pb-9 animate-[slideUp_0.3s_ease] border-t border-white/10">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-[17px] font-black tracking-tight flex items-center gap-2">
                <Sparkles size={18} className="text-violet-400" /> Tính Năng AI
              </h3>
              <button
                onClick={() => setShowAIMenu(false)}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/70"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Auto-Illustrate */}
              <button
                onClick={() => { setShowAIMenu(false); handleAutoIllustrate(); }}
                disabled={isIllustrating}
                className="p-4 rounded-2xl bg-white/5 border border-white/10 text-left active:scale-[0.97] transition-transform disabled:opacity-50"
              >
                <div className="text-2xl mb-2">🎨</div>
                <div className="text-sm font-bold text-white">Tạo Minh Hoạ</div>
                <div className="text-[11px] text-white/50 mt-0.5">AI vẽ hình cho mỗi trang</div>
              </button>

              {/* Personalize */}
              <button
                onClick={() => { setShowAIMenu(false); handlePersonalize(); }}
                disabled={isPersonalizing}
                className="p-4 rounded-2xl bg-white/5 border border-white/10 text-left active:scale-[0.97] transition-transform disabled:opacity-50"
              >
                <div className="text-2xl mb-2">🧒</div>
                <div className="text-sm font-bold text-white">Cá Nhân Hoá</div>
                <div className="text-[11px] text-white/50 mt-0.5">Đưa tên bé vào truyện</div>
              </button>

              {/* Vocabulary & Quiz */}
              <button
                onClick={() => {
                  setShowAIMenu(false);
                  if (storyId) {
                    onNavigate("vocab-quiz", { storyId, storyTitle: story?.title || "" });
                  }
                }}
                className="p-4 rounded-2xl bg-white/5 border border-white/10 text-left active:scale-[0.97] transition-transform"
              >
                <div className="text-2xl mb-2">📚</div>
                <div className="text-sm font-bold text-white">Từ Vựng & Quiz</div>
                <div className="text-[11px] text-white/50 mt-0.5">Học từ mới + trả lời quiz</div>
              </button>

              {/* Translate */}
              <button
                onClick={() => {
                  setShowAIMenu(false);
                  const locale = story?.locale || "vi";
                  const targetLang = locale === "vi" ? "en" : "vi";
                  const bilingual = confirm(
                    `Dịch sang ${targetLang === "en" ? "English" : "Tiếng Việt"}?\n\n[OK] = Song ngữ\n[Cancel] = Chỉ ngôn ngữ đích`
                  );
                  handleTranslate(targetLang, bilingual);
                }}
                disabled={isTranslating}
                className="p-4 rounded-2xl bg-white/5 border border-white/10 text-left active:scale-[0.97] transition-transform disabled:opacity-50"
              >
                <div className="text-2xl mb-2">🌍</div>
                <div className="text-sm font-bold text-white">Dịch Truyện</div>
                <div className="text-[11px] text-white/50 mt-0.5">Dịch sang ngôn ngữ khác</div>
              </button>

              {/* Ambient Sounds */}
              <button
                onClick={() => { setShowAIMenu(false); setShowMixer(true); }}
                className="p-4 rounded-2xl bg-white/5 border border-white/10 text-left active:scale-[0.97] transition-transform"
              >
                <div className="text-2xl mb-2">🎵</div>
                <div className="text-sm font-bold text-white">Âm Nền</div>
                <div className="text-[11px] text-white/50 mt-0.5">Nhạc + âm thanh môi trường</div>
              </button>

              {/* Edit Story */}
              {storyId && !isGenerated && (
                <button
                  onClick={() => {
                    setShowAIMenu(false);
                    onNavigate("editor", { storyId });
                  }}
                  className="p-4 rounded-2xl bg-white/5 border border-white/10 text-left active:scale-[0.97] transition-transform"
                >
                  <div className="text-2xl mb-2">✏️</div>
                  <div className="text-sm font-bold text-white">Chỉnh Sửa</div>
                  <div className="text-[11px] text-white/50 mt-0.5">Sửa nội dung truyện</div>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
