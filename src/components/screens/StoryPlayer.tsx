"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
 ChevronDown, MoreHorizontal, Play, Pause, Moon, MoonStars, Shuffle, Heart,
 SlidersHorizontal, Volume2, X, Sparkles, Share2, Star, MessageSquare, Send,
 Bookmark, Pencil, RotateCcw, RotateCw, Waveform, Headphones,
} from "@/components/ui/icons";
import { GlowDots, KidError, KidLoading } from "@/components/ui/states";
import { useParentalControls } from "@/lib/parental-controls-context";
import { isStoryAllowed } from "@/lib/content-filter";
import { CHIP, ScreenOff, ScreenOffButton, SleepTimerButton, useSleepTimer } from "@/components/ui/NightControls";
import Mascot from "@/components/ui/Mascot";
import { saveLastPlayed } from "@/lib/last-played";
import { useTheme } from "@/lib/theme-context";
import type { Screen } from "@/lib/types";
import type { GeneratedStory } from "@/lib/story-ai";
import { useSettings } from "@/lib/settings-context";
import { useData } from "@/lib/data-context";
import { useAudioPlayer } from "@/lib/audio-player-context";
import { mergeAudioBlobs, getPageAtTime, type MergeResult } from "@/lib/audio-merger";
import { ttsApi } from "@/lib/api-client";
import { getStoryCharacters, updateStory, type StoryCharacterRow } from "@/lib/db";
import { parseVoiceMarkup } from "@/lib/elevenlabs";
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
 castle: "fire", // fireplace crackling for castles
 adventure: "wind",
 home: "fire", // cozy fireplace
 suspense: "wind",
 lullaby: "lullaby",
 magic: "lullaby", // gentle chimes similar to lullaby
 underwater: "waves",
 playful: "forest", // lightest background
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

// Snapshot of the active audio element's clock, used for the time display.
interface AudioClock {
 currentTime: number;
 duration: number;
}

function readAudioClock(audio: HTMLAudioElement): AudioClock | null {
 return audio.duration ? { currentTime: audio.currentTime, duration: audio.duration } : null;
}

function formatClock(seconds: number): string {
 return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

const CATEGORY_LABEL: Record<string, string> = {
 fairy_tale: "Cổ tích",
 adventure: "Phiêu lưu",
 bedtime: "Ru ngủ",
 animal: "Động vật",
 educational: "Học chơi",
 folk: "Dân gian",
};

export default function StoryPlayer({ storyId, onBack, onNavigate }: StoryPlayerProps) {
 const { settings, hasElevenLabs } = useSettings();
 // UI-08 night mode: bedtime palette, sleep timer, screen-off.
 const { isBedtime } = useTheme();
 // Sleep mode follows the 19:30–06:00 window (or the parent's choice); the pill overrides it for this story.
 const [sleepOverride, setSleepOverride] = useState<boolean | null>(null);
 const isNight = sleepOverride ?? isBedtime;
 const [showMore, setShowMore] = useState(false);
 const [screenOff, setScreenOff] = useState(false);
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
 const { contentRules } = useParentalControls();
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
 const startRef = useRef<number>(0); // set to Date.now() by the mount effect below
 const pagesListenedRef = useRef<Set<number>>(new Set());
 // Audio prefetch cache: pageIndex → objectURL or remote URL
 const prefetchCache = useRef<Map<number, string>>(new Map());
 // Render-safe snapshot of audioRef.current's time/duration (null = no active audio)
 const [audioClock, setAudioClock] = useState<AudioClock | null>(null);

 // Continuous playback: merged audio for gapless background play
 const [mergeStatus, setMergeStatus] = useState<"idle" | "generating" | "merging" | "ready" | "playing">("idle");
 const [mergeProgress, setMergeProgress] = useState("");
 const mergedRef = useRef<MergeResult | null>(null);
 // Render-safe mirror of mergedRef (page tick marks on the seek bar)
 const [mergedResult, setMergedResult] = useState<MergeResult | null>(null);
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

 // Get illustration URL for the current page
 const currentIllustration = isGenerated
 ? null
 : pages[currentPage]?.illustration_url;

 // Resolve which ElevenLabs voice to use for TTS.
 // Priority: 1) user-selected 2) remembered (last used for this story) 3) family cloned voices 4) narrator 5) defaults 6) fallback
 const storyVoice = story?.voice_id
 ? voiceProfiles.find((v) => v.id === story.voice_id)
 : voiceProfiles.find((v) => v.elevenlabs_voice_id);

 const storyLocale = story?.locale || "vi";
 const narratorVoiceId = story?.narrator_voice_id ?? null;
 const narratorVoiceName = story?.narrator_voice_name ?? null;
 const rememberedVoiceId = story?.last_voice_id ?? null;
 const rememberedVoiceName = story?.last_voice_name ?? null;
 const defaultsForLocale = defaultVoices.filter((v) => v.language === storyLocale);
 // First family cloned voice (prioritized over system defaults)
 const firstClonedVoice = voiceProfiles.find((v) => v.elevenlabs_voice_id);

 // Determine active voice
 const resolvedVoiceId = selectedVoiceId
 || rememberedVoiceId
 || firstClonedVoice?.elevenlabs_voice_id
 || narratorVoiceId
 || storyVoice?.elevenlabs_voice_id
 || defaultVoices.find((v) => v.language === storyLocale)?.voice_id
 || defaultVoices[0]?.voice_id
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
 storyLocale
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
 storyLocale
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
 }, [storyCharacters, elevenVoiceId, narratorVoiceName, settings.elevenLabsApiKey, settings.elevenLabsModelId, storyLocale, currentPage, pages]);

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
 storyLocale
 );
 }
 } else {
 blob = await ttsApi(
 elevenVoiceId, pageRow.content,
 settings.elevenLabsApiKey || undefined,
 settings.elevenLabsModelId || undefined,
 storyLocale
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
 setMergedResult(result);
 setMergeStatus("ready");
 setMergeProgress("🎧 Audio liên tục sẵn sàng");
 } catch {
 setMergeStatus("idle"); // allow retry
 setMergeProgress("");
 }
 }, [mergeStatus, isGenerated, hasElevenLabs, totalPages, pages, elevenVoiceId, settings.elevenLabsApiKey, settings.elevenLabsModelId, storyLocale]);

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
 setAudioClock(null);

 // Seek to current page position
 const seekTime = merged.pageMarkers[currentPage] || 0;

 audio.onloadedmetadata = () => {
 audio.currentTime = seekTime;
 };

 audio.ontimeupdate = () => {
 if (audioRef.current === audio) setAudioClock(readAudioClock(audio));
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
 setAudioClock(null);
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
 setAudioClock(null);

 audio.onloadedmetadata = () => {
 if (audioRef.current === audio) setAudioClock(readAudioClock(audio));
 };

 audio.onended = () => {
 audioRef.current = null;
 setAudioClock(null);
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
 if (audioRef.current === audio) setAudioClock(readAudioClock(audio));
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

 // Effects below are declared after playWithTTS (which they call) but keep
 // their original relative order: auto-play runs before fake-progress.
 // Auto-play next page when audio ends and advances
 useEffect(() => {
 if (pendingAutoPlay) {
 setPendingAutoPlay(false);
 playWithTTS();
 }
 }, [pendingAutoPlay, currentPage, playWithTTS]);

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

 const pauseForSleep = useCallback(() => {
 setIsPlaying(false);
 audioRef.current?.pause();
 engineRef.current?.stopAll();
 }, []);
 const sleep = useSleepTimer(pauseForSleep);
 // "Nghe tiếp" on Home
 useEffect(() => {
 if (isGenerated || !storyId || !story) return;
 saveLastPlayed({ storyId, title: story.title, page: currentPage + 1, totalPages, voice: voiceLabel, category: story.category });
 }, [isGenerated, storyId, story, currentPage, totalPages, voiceLabel]);

 const togglePlay = () => {
 // At bedtime, starting playback arms the default sleep timer (parent can change/cancel it).
 if (!isPlaying && isNight && !sleep.active) sleep.start(settings.sleepTimerDefault || 15);
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
 setAudioClock(null);
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
 if (dx < 0) goPage(1); // swipe left → next
 else goPage(-1); // swipe right → prev
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

 type MoreId = "lullaby" | "adventure" | "save" | "share" | "mixer" | "ai" | "rating" | "edit";
 const moreItems: { id: MoreId; icon: typeof Moon; label: string; active?: boolean; loading?: boolean }[] = [
 { id: "lullaby", icon: Moon, label: "Ru ngủ" },
 { id: "adventure", icon: Shuffle, label: "Rẽ nhánh" },
 { id: "save", icon: Bookmark, label: isFav ? "Đã lưu" : "Lưu", active: isFav, loading: favLoading },
 { id: "share", icon: Share2, label: "Chia sẻ" },
 { id: "mixer", icon: SlidersHorizontal, label: "Trộn âm" },
 { id: "ai", icon: Sparkles, label: "Đóm AI" },
 { id: "rating", icon: Star, label: ratingCount > 0 ? `Đánh giá ${avgRating.toFixed(1)}` : "Đánh giá" },
 ...(!isGenerated && storyId ? [{ id: "edit" as const, icon: Pencil, label: "Chỉnh sửa" }] : []),
 ];

 function runMore(id: MoreId) {
 setShowMore(false);
 if (id === "lullaby") onNavigate("lullaby");
 else if (id === "adventure") onNavigate("adventure", story?.is_branching && storyId ? { storyId } : undefined);
 else if (id === "save") handleToggleFavorite();
 else if (id === "share") setShowShare(true);
 else if (id === "mixer") setShowMixer(true);
 else if (id === "ai") setShowAIMenu(true);
 else if (id === "rating") setShowRating(true);
 else if (id === "edit" && storyId) {
 audioRef.current?.pause();
 onNavigate("editor", { storyId });
 }
 }

 if (loading) {
 return (
 <KidLoading fullScreen tone="night" title="Đóm đang mở truyện…" />
 );
 }

 // T19: a story hidden by Parental controls can't be opened from any link.
 if (story && !isStoryAllowed(story, contentRules)) {
 return (
 <KidError
 fullScreen
 tone="night"
 title="Truyện này bố mẹ đang ẩn"
 message="Bé chọn truyện khác cùng Đóm nhé!"
 tag="Bố mẹ đã ẩn"
 onRetry={onBack}
 retryLabel="Chọn truyện khác"
 />
 );
 }

 const handleBack = () => {
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
 setAudioClock(null);
 } else {
 audioRef.current?.pause();
 }
 // Clean up merge refs but don't revoke blob (MiniPlayer may use it)
 mergeAbortRef.current = true;
 onBack();
 };

 const onSeekPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
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
 };

 /** ⟲ / ⟳ — skip 15s inside the audio; before audio exists they turn the page. */
 const skip = (dir: -1 | 1) => {
 const a = audioRef.current;
 if (a && a.duration && audioClock) {
 a.currentTime = Math.max(0, Math.min(a.duration - 0.25, a.currentTime + dir * 15));
 if (mergeStatus === "playing" && mergedRef.current) {
 setCurrentPage(getPageAtTime(a.currentTime, mergedRef.current.pageMarkers));
 }
 return;
 }
 goPage(dir);
 };

 const activeAmbient = AMBIENT_OPTIONS.find(({ type }) => ambientOn[type]);
 const categoryLabel = story?.category ? CATEGORY_LABEL[story.category] : undefined;

 return (
 <div className="relative flex min-h-screen flex-col overflow-hidden bg-night text-moon">
 {/* Scene (board `.pbg` + `.pov`): the page illustration, else the night sky */}
 <div aria-hidden className="absolute inset-0">
 {currentIllustration ? (
 // eslint-disable-next-line @next/next/no-img-element
 <img
 key={`art-${currentPage}`}
 src={currentIllustration}
 alt=""
 className="fx-page-enter h-full w-full object-cover"
 style={{ filter: isNight ? "brightness(.62) saturate(.85)" : "brightness(.9)" }}
 />
 ) : (
 <div
 className="h-full w-full bg-cover bg-center"
 style={{ backgroundImage: "url(/images/night-bg.webp)", filter: isNight ? "brightness(.8) saturate(.9)" : "brightness(1.05) saturate(1.05)" }}
 />
 )}
 <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(21,18,51,0.15)_0%,rgba(21,18,51,0.1)_38%,rgba(21,18,51,0.88)_62%,#151233_100%)]" />
 </div>
 <SceneEffects effect={activeEffect} active={isPlaying && !isNight} />

 {/* Top bar (board `.ptop`) */}
 <div className="relative z-10 flex items-center justify-between px-4 pt-12">
 <button type="button" onClick={handleBack} aria-label="Quay lại" className="flex h-11 w-11 items-center justify-center rounded-2xl text-moon/85 active:bg-moon/10">
 <ChevronDown size={26} />
 </button>
 <button
 type="button"
 onClick={() => setSleepOverride(!isNight)}
 aria-pressed={isNight}
 data-testid="sleep-mode-pill"
 className={`flex h-10 items-center gap-1.5 rounded-[14px] border px-3 text-[14px] font-extrabold transition-colors ${
 isNight ? "border-amber/35 bg-amber/[0.16] text-amber" : "border-moon/15 bg-night/30 text-moon-2"
 }`}
 >
 <MoonStars size={18} weight="fill" /> Chế độ ngủ
 </button>
 <button type="button" onClick={() => setShowMore(true)} aria-label="Thêm tuỳ chọn" className="flex h-11 w-11 items-center justify-center rounded-2xl text-moon/85 active:bg-moon/10">
 <MoreHorizontal size={26} />
 </button>
 </div>

 {/* Đóm (board `.sleepy` + `.zz`) — swipe area for pages */}
 <div className="relative z-10 min-h-[170px] flex-1" onTouchStart={onSwipeStart} onTouchEnd={onSwipeEnd}>
 {isNight && (
 <span aria-hidden className="absolute bottom-[136px] right-[30px] font-display text-[22px] font-bold text-amber/70">
 z z
 </span>
 )}
 <Mascot
 state={isNight ? "sleepy" : "story"}
 size={122}
 label={null}
 className={`absolute bottom-1 right-[26px] ${isNight ? "brightness-[.82]" : ""}`}
 />
 </div>

 <div className="relative z-10 px-[22px] pb-9">
 {/* Title + meta (board `.ptitle`) */}
 <h2 className="font-display text-[31px] font-bold leading-[1.1] text-moon">{title}</h2>
 <div className="relative mt-1 flex flex-wrap items-center gap-x-1.5 text-[15px] font-bold text-moon-2">
 <button type="button" onClick={handleLike} aria-pressed={liked} aria-label={liked ? "Bỏ thích" : "Thích truyện"} className="-ml-1 flex h-9 w-8 items-center justify-center">
 <Heart size={16} weight="fill" className={liked ? "text-[#FF8FA3]" : "text-moon-2"} />
 </button>
 {isGenerated ? (
 <span>Đóm sáng tác</span>
 ) : (
 <button
 type="button"
 onClick={() => setShowVoicePicker(!showVoicePicker)}
 aria-expanded={showVoicePicker}
 className="flex min-h-[36px] items-center gap-1"
 >
 Giọng: {voiceLabel}
 {(defaultVoices.length > 0 || voiceProfiles.length > 0) && (
 <ChevronDown size={12} className={`transition-transform ${showVoicePicker ? "rotate-180" : ""}`} />
 )}
 </button>
 )}
 {categoryLabel && <span>· {categoryLabel}</span>}
 <span>· Trang {currentPage + 1}/{totalPages}</span>
 {showVoicePicker && (
 <div className="absolute top-full left-0 right-0 mt-1 bg-night-card/95 backdrop-blur-sm border border-white/10 rounded-xl z-20 max-h-48 overflow-y-auto">
 {/* User's cloned voices */}
 {voiceProfiles.filter((v) => v.elevenlabs_voice_id).length > 0 && (
 <>
 <div className="px-3 py-1.5 text-[10px] font-bold text-moon/30 uppercase tracking-wider">Giọng của bạn</div>
 {voiceProfiles.filter((v) => v.elevenlabs_voice_id).map((v) => (
 <button
 key={v.id}
 onClick={() => handleVoiceSelect(v.elevenlabs_voice_id!, v.name)}
 className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 transition-colors ${
 resolvedVoiceId === v.elevenlabs_voice_id ? "text-accent font-bold" : "text-moon/70"
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
 <div className="px-3 py-1.5 text-[10px] font-bold text-moon/30 uppercase tracking-wider">
 Giọng {storyLocale === "vi" ? "Tiếng Việt" : storyLocale === "ja" ? "日本語" : "English"}
 </div>
 {defaultsForLocale.map((v) => (
 <button
 key={v.id}
 onClick={() => handleVoiceSelect(v.voice_id, v.name)}
 className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 transition-colors ${
 resolvedVoiceId === v.voice_id ? "text-accent font-bold" : "text-moon/70"
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
 <div className="px-3 py-1.5 text-[10px] font-bold text-moon/30 uppercase tracking-wider">Ngôn ngữ khác</div>
 {defaultVoices.filter((v) => v.language !== storyLocale).map((v) => (
 <button
 key={v.id}
 onClick={() => handleVoiceSelect(v.voice_id, v.name)}
 className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 transition-colors ${
 resolvedVoiceId === v.voice_id ? "text-accent font-bold" : "text-moon/70"
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

 {/* Status chips: continuous playback, scene effect, speaker */}
 {(mergeStatus !== "idle" || activeEffect || currentSpeaker) && (
 <div className="mt-2 flex flex-wrap items-center gap-1.5">
 {mergeStatus === "ready" && (
 <button type="button" onClick={switchToMerged} className="flex min-h-[32px] items-center gap-1.5 rounded-full bg-amber/15 px-3 text-[12px] font-bold text-amber active:scale-95">
 <Headphones size={14} /> Bật phát liên tục
 </button>
 )}
 {(mergeStatus === "generating" || mergeStatus === "merging") && (
 <span className="flex items-center gap-1.5 text-[11px] text-moon-2/70">
 <GlowDots size={3} /> {mergeProgress}
 </span>
 )}
 {mergeStatus === "playing" && (
 <span className="flex items-center gap-1 rounded-full bg-amber/10 px-2.5 py-1 text-[11px] font-bold text-amber">
 <Headphones size={12} /> Phát liên tục
 </span>
 )}
 {activeEffect && (
 <span className="flex items-center gap-1.5 rounded-full bg-moon/[0.08] px-2.5 py-1 text-[11px] font-bold text-moon-2">
 <Sparkles size={11} className="text-amber" /> {EFFECT_LABELS[activeEffect]}
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
 <span className="text-[11px] font-bold text-moon/60">{currentSpeaker}</span>
 </>
 );
 })()}
 </div>
 )}


 </div>
 )}

 {/* Karaoke text (board `.kar`) */}
 <div
 key={`txt-${currentPage}`}
 className="fx-page-enter mt-4 max-h-[150px] overflow-y-auto rounded-[22px] border border-moon/[0.08] bg-[rgba(34,28,74,0.72)] px-[18px] py-4 text-[19px] font-bold leading-[1.6] text-[#CFC6E6] no-scrollbar"
 >
 {displayText ? <LyricsText text={displayText} progress={progress} isPlaying={isPlaying} /> : <span className="text-moon-2/60">…</span>}
 </div>

 {/* Progress (board `.prog` + `.times`) */}
 <div
 className="relative mt-[18px] h-1.5 cursor-pointer touch-none rounded-full bg-moon/15"
 role="slider"
 aria-label="Tiến độ"
 aria-valuemin={0}
 aria-valuemax={100}
 aria-valuenow={Math.round(progress)}
 onPointerDown={onSeekPointerDown}
 >
 {/* Page markers (tick marks) for merged mode */}
 {mergeStatus === "playing" && mergedResult && mergedResult.pageMarkers.length > 1 && (
 mergedResult.pageMarkers.slice(1).map((marker, i) => (
 <div
 key={i}
 className="absolute top-0 w-0.5 h-full bg-white/20 rounded-full"
 style={{ left: `${(marker / mergedResult.totalDuration) * 100}%` }}
 />
 ))
 )}
 <i className="block h-full rounded-full bg-amber transition-[width] duration-150" style={{ width: `${progress}%` }} />
 <i className="absolute -top-[5px] block h-4 w-4 -translate-x-1/2 rounded-full bg-amber" style={{ left: `${Math.max(0, Math.min(progress, 100))}%` }} />
 </div>
 <div className="mt-2 flex justify-between text-[13px] font-bold text-[#9F95C2]">
 <span>{audioClock ? formatClock(audioClock.currentTime) : `Trang ${currentPage + 1}`}</span>
 <span>{audioClock ? `-${formatClock(Math.max(0, audioClock.duration - audioClock.currentTime))}` : `${totalPages} trang`}</span>
 </div>

 {/* Controls (board `.ctl`) */}
 <div className="mt-2.5 flex items-center justify-center gap-10">
 <button type="button" onClick={() => skip(-1)} aria-label={audioClock ? "Lùi 15 giây" : "Trang trước"} className="flex h-12 w-12 items-center justify-center text-moon/85 active:scale-90">
 <RotateCcw size={36} weight="bold" />
 </button>
 <button
 type="button"
 onClick={togglePlay}
 disabled={isTTSLoading}
 aria-label={isPlaying ? "Tạm dừng" : "Phát"}
 className="flex h-[86px] w-[86px] items-center justify-center rounded-full bg-amber shadow-[0_0_40px_rgba(255,181,71,0.35)] transition-transform active:scale-95 disabled:opacity-70"
 >
 {isTTSLoading ? (
 <GlowDots size={8} className="text-night" label="Đang chuẩn bị giọng đọc" />
 ) : isPlaying ? (
 <Pause size={40} weight="fill" className="text-night" />
 ) : (
 <Play size={40} weight="fill" className="ml-1 text-night" />
 )}
 </button>
 <button type="button" onClick={() => skip(1)} aria-label={audioClock ? "Tới 15 giây" : "Trang sau"} className="flex h-12 w-12 items-center justify-center text-moon/85 active:scale-90">
 <RotateCw size={36} weight="bold" />
 </button>
 </div>

 {/* Bedtime chips (board `.chips`) */}
 <div className="mt-[22px] flex justify-center gap-1.5">
 <SleepTimerButton variant="chip" remaining={sleep.remaining} onStart={sleep.start} onCancel={sleep.cancel} />
 <button type="button" onClick={() => setShowMixer(true)} className={CHIP}>
 <Waveform size={18} weight="fill" className="text-amber" /> {activeAmbient ? activeAmbient.label : "Âm nền"}
 </button>
 <ScreenOffButton variant="chip" onClick={() => setScreenOff(true)} />
 </div>
 </div>

 {/* "⋯" sheet: everything that used to crowd the player */}
 {showMore && (
 <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setShowMore(false)}>
 <div
 role="dialog"
 aria-modal="true"
 aria-label="Tuỳ chọn truyện"
 className="w-full max-w-[430px] rounded-t-[28px] bg-night-card px-5 pb-10 pt-5 animate-[slideUp_0.3s_ease]"
 onClick={(e) => e.stopPropagation()}
 >
 <div className="mb-4 flex items-center justify-between">
 <h3 className="font-display text-[20px] font-bold text-moon">Tuỳ chọn</h3>
 <button type="button" onClick={() => setShowMore(false)} aria-label="Đóng" className="flex h-11 w-11 items-center justify-center rounded-full bg-moon/10 text-moon">
 <X size={18} />
 </button>
 </div>
 <div className="grid grid-cols-3 gap-2.5">
 {moreItems.map((m) => (
 <button
 key={m.id}
 type="button"
 disabled={m.loading}
 onClick={() => runMore(m.id)}
 className="flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-[20px] bg-moon/[0.06] px-2 text-[13px] font-extrabold text-moon active:scale-95 disabled:opacity-50"
 >
 <m.icon size={26} weight={m.active ? "fill" : "duotone"} className="text-amber" />
 {m.label}
 </button>
 ))}
 </div>
 </div>
 </div>
 )}

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
 className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-moon/70"
 >
 <X size={16} />
 </button>
 </div>

 {/* Overall rating */}
 <div className="text-center mb-5">
 <p className="text-4xl font-black text-moon mb-1">
 {avgRating > 0 ? avgRating.toFixed(1) : "—"}
 </p>
 <RatingStars value={avgRating} size={28} readonly dark />
 <p className="text-[12px] text-moon/40 mt-1">
 {ratingCount} đánh giá
 </p>
 </div>

 {/* User's rating */}
 <div className="bg-white/5 rounded-2xl p-4 mb-5">
 <p className="text-[13px] font-bold text-moon/70 mb-3">
 Đánh giá của bạn
 </p>
 <div className="flex justify-center">
 <RatingStars value={userRating} onChange={handleRate} size={32} dark />
 </div>
 </div>

 {/* Write review */}
 <div className="bg-white/5 rounded-2xl p-4 mb-5">
 <p className="text-[13px] font-bold text-moon/70 mb-3 flex items-center gap-1.5">
 <MessageSquare size={14} /> Viết nhận xét
 </p>
 <textarea
 value={reviewText}
 onChange={(e) => setReviewText(e.target.value)}
 placeholder="Chia sẻ cảm nhận của bạn..."
 rows={3}
 className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-[13px] text-moon placeholder-moon/30 outline-none focus:border-accent-2/50 resize-none"
 />
 <button
 onClick={handleSubmitReview}
 disabled={!reviewText.trim() || submittingReview}
 className="mt-2 w-full py-2.5 rounded-xl bg-accent-2/20 text-accent-2 text-[13px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-40"
 >
 {submittingReview ? (
 <GlowDots size={4} />
 ) : (
 <Send size={14} />
 )}
 Gửi nhận xét
 </button>
 </div>

 {/* Reviews list */}
 <div>
 <p className="text-[13px] font-bold text-moon/70 mb-3">
 Nhận xét ({reviews.length})
 </p>
 {reviews.length === 0 ? (
 <p className="text-[12px] text-moon/30 text-center py-4">
 Chưa có nhận xét nào. Hãy là người đầu tiên!
 </p>
 ) : (
 <div className="space-y-3">
 {reviews.map((r) => (
 <div key={r.id} className="bg-white/5 rounded-xl p-3">
 <div className="flex items-center gap-2 mb-1.5">
 <span className="text-[12px] font-bold text-moon/60">
 {r.display_name || "Phụ huynh"}
 </span>
 {r.rating && (
 <RatingStars value={r.rating} size={12} readonly dark />
 )}
 <span className="text-[10px] text-moon/30 ml-auto">
 {new Date(r.created_at).toLocaleDateString("vi-VN")}
 </span>
 </div>
 <p className="text-[13px] text-moon/50 leading-relaxed">
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

 {/* Night mode: screen off, audio keeps playing */}
 {screenOff && <ScreenOff onWake={() => setScreenOff(false)} remaining={sleep.remaining} />}

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
 className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-moon/70"
 >
 <X size={16} />
 </button>
 </div>

 <button
 onClick={() => setAutoAmbient((v) => !v)}
 className={`w-full mb-4 py-2.5 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2 transition-colors ${
 autoAmbient
 ? "bg-accent-2/20 text-accent-2"
 : "bg-white/5 text-moon/50"
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
 on ? "bg-accent text-moon" : "bg-white/5 text-moon/50"
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
 : "bg-white/5 text-moon/50"
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
 ? "bg-accent text-moon"
 : "bg-white/5 text-moon/50"
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
 ? "bg-accent text-moon"
 : "bg-white/5 text-moon/50"
 }`}
 >
 {EFFECT_LABELS[type]}
 </button>
 ))}
 </div>
 {autoEffect && !manualEffect && (
 <p className="text-[11px] text-moon/30 mt-2">
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
 <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 rounded-2xl bg-violet-600/95 backdrop-blur-sm text-moon text-sm font-bold shadow-xl shadow-violet-900/50 max-w-[380px] text-center animate-[slideDown_0.3s_ease]">
 {(isIllustrating || isPersonalizing || isTranslating) && (
 <GlowDots size={4} className="mr-2" />
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
 className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-moon/70"
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
 <div className="text-sm font-bold text-moon">Tạo Minh Hoạ</div>
 <div className="text-[11px] text-moon/50 mt-0.5">AI vẽ hình cho mỗi trang</div>
 </button>

 {/* Personalize */}
 <button
 onClick={() => { setShowAIMenu(false); handlePersonalize(); }}
 disabled={isPersonalizing}
 className="p-4 rounded-2xl bg-white/5 border border-white/10 text-left active:scale-[0.97] transition-transform disabled:opacity-50"
 >
 <div className="text-2xl mb-2">🧒</div>
 <div className="text-sm font-bold text-moon">Cá Nhân Hoá</div>
 <div className="text-[11px] text-moon/50 mt-0.5">Đưa tên bé vào truyện</div>
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
 <div className="text-sm font-bold text-moon">Từ Vựng & Quiz</div>
 <div className="text-[11px] text-moon/50 mt-0.5">Học từ mới + trả lời quiz</div>
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
 <div className="text-sm font-bold text-moon">Dịch Truyện</div>
 <div className="text-[11px] text-moon/50 mt-0.5">Dịch sang ngôn ngữ khác</div>
 </button>

 {/* Ambient Sounds */}
 <button
 onClick={() => { setShowAIMenu(false); setShowMixer(true); }}
 className="p-4 rounded-2xl bg-white/5 border border-white/10 text-left active:scale-[0.97] transition-transform"
 >
 <div className="text-2xl mb-2">🎵</div>
 <div className="text-sm font-bold text-moon">Âm Nền</div>
 <div className="text-[11px] text-moon/50 mt-0.5">Nhạc + âm thanh môi trường</div>
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
 <div className="text-sm font-bold text-moon">Chỉnh Sửa</div>
 <div className="text-[11px] text-moon/50 mt-0.5">Sửa nội dung truyện</div>
 </button>
 )}
 </div>
 </div>
 </div>
 )}
 </div>
 );
}
