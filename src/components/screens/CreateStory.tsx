"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
 Sparkles, User, UserRound, Loader2, AlertCircle, Settings, Globe, Mic, Volume2, Square, PenLine, Camera,
} from "@/components/ui/icons";
import TopBar from "@/components/ui/TopBar";
import Mascot from "@/components/ui/Mascot";
import { Icon3D, type Icon3DName } from "@/components/ui/Icon3D";
import { AGE_BANDS, normalizeAgeBand } from "@/lib/age-bands";
import { storyThemes } from "@/lib/data";
import { useSettings } from "@/lib/settings-context";
import { useData } from "@/lib/data-context";
import { generateStoryApi } from "@/lib/api-client";
import type { Screen } from "@/lib/types";

interface DefaultVoice {
 id: string;
 voice_id: string;
 name: string;
 language: string;
}

const LANGUAGES = [
 { code: "vi", label: "🇻🇳 Tiếng Việt" },
 { code: "en", label: "🇺🇸 English" },
 { code: "ja", label: "🇯🇵 日本語" },
] as const;

interface CreateStoryProps {
 onBack: () => void;
 onNavigate: (screen: Screen, data?: Record<string, string>) => void;
}

/** Theme → 3D tile (UI v2). */
const THEME_ICON3D: Record<string, Icon3DName> = {
 castle: "castle",
 rocket: "rocket",
 moon: "moon",
 paw: "paw",
 blocks: "blocks",
 pencil: "brush",
};


export default function CreateStory({ onBack, onNavigate }: CreateStoryProps) {
 const { settings, systemStatus } = useSettings();
 const { voiceProfiles, refreshStories } = useData();
 const [selectedTheme, setSelectedTheme] = useState("cotich");
 const [selectedAge, setSelectedAge] = useState<string>(normalizeAgeBand(settings.childAge));
 const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
 const [childName, setChildName] = useState(settings.childName || "");
 const [extraPrompt, setExtraPrompt] = useState("");
 const [isGenerating, setIsGenerating] = useState(false);
 const [error, setError] = useState<string | null>(null);

 // Language & narrator voice
 const [storyLocale, setStoryLocale] = useState(settings.language || "vi");
 const [defaultVoices, setDefaultVoices] = useState<DefaultVoice[]>([]);
 const [narratorVoiceId, setNarratorVoiceId] = useState<string | null>(null);

 // Voice preview
 const [previewVoiceId, setPreviewVoiceId] = useState<string | null>(null);
 const [loadingPreview, setLoadingPreview] = useState(false);
 const previewAudioRef = useRef<HTMLAudioElement | null>(null);

 const playVoicePreview = useCallback(async (voiceId: string, e: React.MouseEvent) => {
 e.stopPropagation();
 if (previewVoiceId === voiceId && previewAudioRef.current) {
 previewAudioRef.current.pause();
 previewAudioRef.current = null;
 setPreviewVoiceId(null);
 return;
 }
 if (previewAudioRef.current) { previewAudioRef.current.pause(); previewAudioRef.current = null; }
 setLoadingPreview(true);
 setPreviewVoiceId(voiceId);
 try {
 const res = await fetch("/api/voice/tts", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 voiceId,
 text: "Xin chào! Đây là giọng kể chuyện dành cho bé yêu của bạn.",
 language: storyLocale,
 }),
 });
 if (!res.ok) throw new Error();
 const blob = await res.blob();
 const url = URL.createObjectURL(blob);
 const audio = new Audio(url);
 previewAudioRef.current = audio;
 audio.onended = () => { setPreviewVoiceId(null); URL.revokeObjectURL(url); };
 audio.play();
 } catch {
 setPreviewVoiceId(null);
 }
 setLoadingPreview(false);
 }, [previewVoiceId, storyLocale]);

 // Fetch default voices
 useEffect(() => {
 fetch("/api/voice/defaults")
 .then((r) => r.json())
 .then((data) => {
 if (data.voices) setDefaultVoices(data.voices);
 })
 .catch(() => {});
 }, []);

 // Auto-select first default voice for locale when locale changes
 useEffect(() => {
 const forLocale = defaultVoices.filter((v) => v.language === storyLocale);
 if (forLocale.length > 0 && !narratorVoiceId) {
 setNarratorVoiceId(forLocale[0].voice_id);
 }
 }, [storyLocale, defaultVoices, narratorVoiceId]);

 const defaultVoicesForLocale = defaultVoices.filter((v) => v.language === storyLocale);

 const { hasStoryProvider } = useSettings();
 const hasStoryKey = hasStoryProvider;
 const effectiveVoice =
 selectedVoice ?? (voiceProfiles.length > 0 ? voiceProfiles[0].id : null);

 const handleGenerate = async () => {
 if (!hasStoryKey) {
 onNavigate("settings");
 return;
 }

 setIsGenerating(true);
 setError(null);

 try {
 const story = await generateStoryApi({
 provider: settings.storyApiKey
 ? settings.storyProvider
 : (systemStatus.defaultStoryProvider || settings.storyProvider) as import("@/lib/settings-context").StoryProvider,
 model: settings.storyApiKey
 ? settings.storyModel
 : (systemStatus.defaultStoryModel || settings.storyModel),
 apiKey: settings.storyApiKey || undefined,
 baseUrl: settings.storyBaseUrl || undefined,
 theme: selectedTheme,
 childName: childName || undefined,
 age: selectedAge,
 language: storyLocale,
 extraPrompt: extraPrompt || undefined,
 voiceId: effectiveVoice,
 narratorVoiceId: narratorVoiceId || undefined,
 narratorVoiceName: narratorVoiceId
 ? defaultVoices.find((v) => v.voice_id === narratorVoiceId)?.name
 : undefined,
 persist: true,
 });

 await refreshStories();

 if (story.storyId) {
 onNavigate("player", { storyId: story.storyId });
 } else {
 if (typeof window !== "undefined") {
 localStorage.setItem("kecon-generated-story", JSON.stringify(story));
 }
 onNavigate("player", { storyId: "__generated__" });
 }
 } catch (err) {
 setError(err instanceof Error ? err.message : "Đã xảy ra lỗi");
 } finally {
 setIsGenerating(false);
 }
 };

 return (
 <div className="min-h-screen bg-white dark:bg-night">
 <TopBar title="Tạo truyện mới" onBack={onBack} />

 {/* Generating state — Đóm suy nghĩ (UI-06) */}
 {isGenerating && (
 <div
 role="status"
 aria-live="polite"
 className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-cream/95 dark:bg-night/95 backdrop-blur-sm px-8 text-center"
 >
 <Mascot state="thinking" size={180} label="Đóm đang suy nghĩ để viết truyện" priority />
 <p className="mt-4 font-display text-[24px] font-extrabold text-ink dark:text-moon">
 Đóm đang viết truyện cho bé…
 </p>
 <p className="mt-1.5 text-[15px] text-ink-2 dark:text-moon-2 max-w-xs">
 Thường mất khoảng 15–30 giây. Ba mẹ chờ Đóm một chút nhé!
 </p>
 <div className="mt-5 flex gap-2" aria-hidden>
 {[0, 1, 2].map((i) => (
 <span
 key={i}
 className="h-3 w-3 rounded-full bg-glow animate-bounce"
 style={{ animationDelay: `${i * 0.15}s` }}
 />
 ))}
 </div>
 </div>
 )}

 <div className="px-5 pt-2 pb-10">
 {/* API Status */}
 {!hasStoryKey && (
 <button
 onClick={() => onNavigate("settings")}
 className="w-full mb-4 p-3.5 rounded-2xl bg-amber-50 border border-amber-200 flex items-center gap-2.5 active:scale-[0.98] transition-transform"
 >
 <AlertCircle size={18} className="text-amber-500 shrink-0" />
 <div className="flex-1 text-left">
 <p className="text-[13px] font-bold text-amber-800">
 Chưa cấu hình AI
 </p>
 <p className="text-[11px] text-amber-700">
 Nhấn để thêm API key
 </p>
 </div>
 <Settings size={16} className="text-amber-500" />
 </button>
 )}

 {/* Theme */}
 <div className="mb-5">
 <label className="text-[13px] font-bold text-txt dark:text-white mb-2.5 block">
 Chủ Đề
 </label>
 <div className="grid grid-cols-3 gap-2">
 {storyThemes.map((theme) => {
 const icon3d = THEME_ICON3D[theme.icon] ?? "book";
 const selected = selectedTheme === theme.id;
 return (
 <button
 key={theme.id}
 onClick={() => setSelectedTheme(theme.id)}
 aria-pressed={selected}
 className={`rounded-tile py-3 px-1.5 text-center border-2 transition-all active:scale-95 ${
 selected
 ? "border-brand bg-brand-soft dark:bg-white/10"
 : "border-transparent bg-cream dark:bg-white/[0.04]"
 }`}
 >
 <Icon3D name={icon3d} size={48} className="mx-auto mb-1.5" />
 <div
 className={`text-[12px] font-extrabold ${
 selected ? "text-brand dark:text-moon" : "text-ink dark:text-white"
 }`}
 >
 {theme.name}
 </div>
 </button>
 );
 })}
 </div>
 </div>

 {/* Child Name (optional) */}
 <div className="mb-5">
 <label className="text-[13px] font-bold text-txt dark:text-white mb-2.5 flex items-center gap-2">
 Tên Bé
 <span className="text-[11px] font-normal text-txt-secondary dark:text-white/50">(tuỳ chọn — để trống nếu không cần)</span>
 </label>
 <input
 type="text"
 value={childName}
 onChange={(e) => setChildName(e.target.value)}
 placeholder="VD: Minh, Bảo, Hà..."
 className="w-full px-4 py-3.5 rounded-xl border-[1.5px] border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-[15px] font-semibold text-txt dark:text-white outline-none focus:border-accent transition-colors"
 />
 </div>

 {/* Age */}
 <div className="mb-5">
 <label className="text-[13px] font-bold text-txt dark:text-white mb-2.5 block">
 Độ Tuổi
 </label>
 <div className="flex gap-2">
 {AGE_BANDS.map(({ id: age, label }) => (
 <button
 key={age}
 onClick={() => setSelectedAge(age)}
 aria-pressed={selectedAge === age}
 className={`flex-1 py-3 rounded-xl border-[1.5px] text-sm font-bold text-center transition-all ${
 selectedAge === age
 ? "border-accent bg-orange-50 text-accent"
 : "border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-txt-secondary dark:text-white/50"
 }`}
 >
 {label}
 </button>
 ))}
 </div>
 </div>

 {/* Language */}
 <div className="mb-5">
 <label className="text-[13px] font-bold text-txt dark:text-white mb-2.5 flex items-center gap-1.5">
 <Globe size={14} /> Ngôn Ngữ Truyện
 </label>
 <div className="flex gap-2">
 {LANGUAGES.map((lang) => (
 <button
 key={lang.code}
 onClick={() => { setStoryLocale(lang.code); setNarratorVoiceId(null); }}
 className={`flex-1 py-3 rounded-xl border-[1.5px] text-sm font-bold text-center transition-all ${
 storyLocale === lang.code
 ? "border-accent bg-orange-50 text-accent"
 : "border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-txt-secondary dark:text-white/50"
 }`}
 >
 {lang.label}
 </button>
 ))}
 </div>
 </div>

 {/* Narrator Voice */}
 <div className="mb-5">
 <label className="text-[13px] font-bold text-txt dark:text-white mb-2.5 flex items-center gap-1.5">
 <Mic size={14} /> Giọng Người Kể
 </label>

 {/* Default voices for this language */}
 {defaultVoicesForLocale.length > 0 || voiceProfiles.filter(v => v.elevenlabs_voice_id).length > 0 ? (
 <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
 {/* Default voices from admin */}
 {defaultVoicesForLocale.map((v) => {
 const selected = narratorVoiceId === v.voice_id;
 return (
 <button
 key={v.id}
 onClick={() => { setNarratorVoiceId(v.voice_id); setSelectedVoice(null); }}
 className={`min-w-[88px] py-3 px-2 rounded-[14px] border-2 text-center transition-all ${
 selected
 ? "border-accent bg-orange-50"
 : "border-transparent bg-surface"
 }`}
 >
 <div className="flex justify-center mb-1">
 <Mic
 size={20}
 className={selected ? "text-accent" : "text-gray-500 dark:text-white/40"}
 />
 </div>
 <div className="text-xs font-bold truncate">{v.name}</div>
 <div className="text-[10px] text-txt-secondary dark:text-white/50 font-medium">⭐ Mặc định</div>
 <button
 onClick={(e) => playVoicePreview(v.voice_id, e)}
 className="mt-1 w-6 h-6 rounded-full bg-violet-100 flex items-center justify-center text-violet-600 mx-auto"
 >
 {loadingPreview && previewVoiceId === v.voice_id ? (
 <Loader2 size={10} className="animate-spin" />
 ) : previewVoiceId === v.voice_id ? (
 <Square size={9} />
 ) : (
 <Volume2 size={11} />
 )}
 </button>
 </button>
 );
 })}
 {/* User's cloned voices */}
 {voiceProfiles.filter(v => v.elevenlabs_voice_id).map((v) => {
 const selected = selectedVoice === v.id;
 return (
 <button
 key={v.id}
 onClick={() => { setSelectedVoice(v.id); setNarratorVoiceId(null); }}
 className={`min-w-[88px] py-3 px-2 rounded-[14px] border-2 text-center transition-all ${
 selected
 ? "border-accent bg-orange-50"
 : "border-transparent bg-surface"
 }`}
 >
 <div className="flex justify-center mb-1">
 {v.gender === "female" ? (
 <UserRound
 size={20}
 className={selected ? "text-accent" : "text-gray-500 dark:text-white/40"}
 />
 ) : (
 <User
 size={20}
 className={selected ? "text-accent" : "text-gray-500 dark:text-white/40"}
 />
 )}
 </div>
 <div className="text-xs font-bold truncate">{v.name}</div>
 <div className="text-[10px] text-txt-secondary dark:text-white/50 font-medium">🎙️ Clone</div>
 {v.elevenlabs_voice_id && (
 <button
 onClick={(e) => playVoicePreview(v.elevenlabs_voice_id!, e)}
 className="mt-1 w-6 h-6 rounded-full bg-violet-100 flex items-center justify-center text-violet-600 mx-auto"
 >
 {loadingPreview && previewVoiceId === v.elevenlabs_voice_id ? (
 <Loader2 size={10} className="animate-spin" />
 ) : previewVoiceId === v.elevenlabs_voice_id ? (
 <Square size={9} />
 ) : (
 <Volume2 size={11} />
 )}
 </button>
 )}
 </button>
 );
 })}
 </div>
 ) : (
 <div className="py-3 px-3.5 rounded-[14px] bg-surface dark:bg-white/[0.04] text-center">
 <p className="text-[12px] text-txt-secondary dark:text-white/50">
 Chưa có giọng nào cho ngôn ngữ này.
 </p>
 <button
 onClick={() => onNavigate("recording")}
 className="mt-1 text-[12px] text-accent font-bold"
 >
 Ghi âm giọng đọc ›
 </button>
 </div>
 )}
 </div>

 {/* Description with suggestions */}
 <div className="mb-6">
 <label className="text-[13px] font-bold text-txt dark:text-white mb-2.5 block">
 💡 Mô Tả Truyện
 </label>
 <textarea
 value={extraPrompt}
 onChange={(e) => setExtraPrompt(e.target.value)}
 placeholder={"Mô tả chi tiết hơn để AI tạo truyện hay hơn:\n• Nhân vật yêu thích (khủng long, công chúa, siêu nhân...)\n• Bối cảnh (rừng xanh, vũ trụ, đáy biển...)\n• Bài học mong muốn (chia sẻ, dũng cảm, yêu thiên nhiên...)"}
 className="w-full px-4 py-3.5 rounded-xl border-[1.5px] border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-sm text-txt dark:text-white outline-none focus:border-accent transition-colors resize-none h-[88px]"
 />
 {/* Quick suggestion chips */}
 <div className="flex flex-wrap gap-1.5 mt-2">
 {[
 "🦕 Có khủng long",
 "🧚 Có phép thuật",
 "🌊 Dưới đáy biển",
 "🚀 Trên vũ trụ",
 "🤝 Bài học chia sẻ",
 "💪 Bài học dũng cảm",
 "🌿 Yêu thiên nhiên",
 "👨‍👩‍👧 Gia đình",
 ].map((chip) => (
 <button
 key={chip}
 onClick={() => setExtraPrompt((prev) => prev ? `${prev}, ${chip}` : chip)}
 className="px-2.5 py-1.5 rounded-lg bg-orange-50 border border-orange-200 text-[11px] font-bold text-orange-700 active:scale-95 transition-transform"
 >
 {chip}
 </button>
 ))}
 </div>
 </div>

 {/* Error */}
 {error && (
 <div className="mb-4 p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2">
 <AlertCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
 <p className="text-[13px] text-red-700">{error}</p>
 </div>
 )}

 {/* CTA */}
 <button
 onClick={handleGenerate}
 disabled={isGenerating}
 className="w-full min-h-tap-kid rounded-btn bg-cta text-white font-extrabold text-[17px] flex items-center justify-center gap-2 shadow-[0_5px_0_var(--color-cta-press)] active:translate-y-0.5 active:shadow-none transition disabled:opacity-60"
 >
 {isGenerating ? (
 <>
 <Loader2 size={20} className="animate-spin" />
 Đóm đang viết truyện…
 </>
 ) : (
 <>
 <Sparkles size={22} weight="fill" />
 {hasStoryKey ? "Tạo truyện cùng Đóm" : "Cấu hình AI trước"}
 </>
 )}
 </button>

 {hasStoryKey && (
 <p className="text-[11px] text-txt-secondary dark:text-white/50 text-center mt-2.5">
 Powered by {settings.storyProvider === "openai" ? "OpenAI" : settings.storyProvider === "gemini" ? "Google Gemini" : settings.storyProvider === "anthropic" ? "Anthropic" : "Custom"} · {settings.storyModel}
 </p>
 )}

 {/* Alternative creation methods */}
 <div className="mt-5 pt-4 border-t border-gray-100 dark:border-white/[0.06] space-y-3">
 <button
 onClick={() => onNavigate("draw-story")}
 className="w-full py-3.5 rounded-[14px] bg-white dark:bg-white/[0.04] border-2 border-dashed border-violet-300 text-violet-600 font-bold text-[14px] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
 >
 <PenLine size={18} /> Vẽ truyện — bé vẽ, Đóm kể
 </button>
 <button
 onClick={() => onNavigate("scan-book")}
 className="w-full py-3.5 rounded-[14px] bg-white dark:bg-white/[0.04] border-2 border-dashed border-accent/30 text-accent font-bold text-[14px] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
 >
 <Camera size={18} /> Chụp truyện từ sách
 </button>
 <p className="text-[11px] text-txt-secondary dark:text-white/50 text-center">
 Chụp ảnh trang sách → AI tự động nhận dạng nội dung
 </p>
 </div>
 </div>
 </div>
 );
}
