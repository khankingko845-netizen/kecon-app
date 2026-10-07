"use client";

import { useState, useEffect } from "react";
import {
 Sparkles, AlertCircle, ArrowRight, ChevronRight, PenLine, Camera, Check,
} from "@/components/ui/icons";
import { GlowDots, KidLoading } from "@/components/ui/states";
import VoicePreviewButton from "@/components/ui/VoicePreviewButton";
import NarrationToggle from "@/components/ui/NarrationToggle";
import { useVoicePreview } from "@/lib/use-voice-preview";
import Mascot, { type MascotState } from "@/components/ui/Mascot";
import { Bubble, Button3D, KidHeader, CARD_SHADOW } from "@/components/ui/kit";
import { useSpeechInput } from "@/lib/use-speech-input";
import { Icon3D, type Icon3DName } from "@/components/ui/Icon3D";
import { AGE_BANDS, normalizeAgeBand } from "@/lib/age-bands";
import { storyThemes } from "@/lib/data";
import { useSettings } from "@/lib/settings-context";
import { useData } from "@/lib/data-context";
import { generateStoryApi } from "@/lib/api-client";
import { rankedDefaultsForLocale, resolveNarratorChoice, type NarratorChoice } from "@/lib/voice-selection";
import { DOM_LINES } from "@/lib/dom-lines";
import { useFeedback } from "@/lib/feedback-context";
import type { Screen } from "@/lib/types";

interface DefaultVoice {
 id: string;
 voice_id: string;
 name: string;
 language: string;
 sort_order?: number;
}

const LANGUAGES = [
 { code: "vi", label: "🇻🇳 Tiếng Việt" },
 { code: "en", label: "🇺🇸 English" },
 { code: "ja", label: "🇯🇵 日本語" },
] as const;

function storyLocaleFor(lang: string | undefined) {
 return lang === "en" ? "en-US" : lang === "ja" ? "ja-JP" : "vi-VN";
}

interface CreateStoryProps {
 onBack: () => void;
 onNavigate: (screen: Screen, data?: Record<string, string>) => void;
}

/** Step 2 — main character (concept board screen 4). */
const CHARACTERS: { id: string; label: string; icon: Icon3DName }[] = [
 { id: "thu-rung", label: "Bạn thú rừng", icon: "paw" },
 { id: "phi-hanh-gia", label: "Phi hành gia", icon: "rocket" },
 { id: "cong-chua", label: "Công chúa", icon: "castle" },
 { id: "chu-cuoi", label: "Chú Cuội", icon: "lantern" },
 { id: "co-tien", label: "Cô tiên nhỏ", icon: "wand" },
 { id: "hai-tac", label: "Bạn tìm kho báu", icon: "chest" },
];

const STEPS: { ask: string; mascot: MascotState }[] = [
 { ask: "Tối nay bé muốn nghe truyện gì nào?", mascot: "hello" },
 { ask: "Nhân vật chính của mình là ai nhỉ?", mascot: "thinking" },
 { ask: "Ai sẽ kể cho bé nghe đây?", mascot: "listen" },
 { ask: "Sẵn sàng chưa? Đóm viết ngay nhé!", mascot: "happy" },
];

/** Big tappable option card (board `.opt`). */
function OptionCard({ selected, onClick, icon, label, sub, children }: { selected: boolean; onClick: () => void; icon: Icon3DName; label: string; sub?: string; children?: React.ReactNode }) {
 return (
 <div className="relative">
 <button
 type="button"
 onClick={onClick}
 aria-pressed={selected}
 data-say={label}
 className={`relative w-full rounded-[24px] border-[3px] px-2.5 pb-3.5 pt-2.5 text-center transition-colors active:scale-[0.98] ${CARD_SHADOW} ${
 selected ? "border-brand bg-[#F5F3FF]" : "border-transparent bg-white"
 }`}
 >
 <span className="mx-auto block h-[96px] w-[96px] overflow-hidden rounded-[22px]">
 <Icon3D name={icon} size={113} className="-m-[9%] max-w-none" />
 </span>
 <b className="mt-1 block text-[17px] font-black leading-tight text-ink">{label}</b>
 {sub && <small className="block text-[12px] font-bold text-ink-2">{sub}</small>}
 {selected && (
 <span aria-hidden className="absolute right-2.5 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-brand text-white">
 <Check size={16} weight="bold" />
 </span>
 )}
 </button>
 {children}
 </div>
 );
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
 const [voiceChoice,setVoiceChoice]=useState<NarratorChoice>(null);
 const [childName, setChildName] = useState(settings.childName || "");
 const [extraPrompt, setExtraPrompt] = useState("");
 const [isGenerating, setIsGenerating] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [step, setStep] = useState(0);
 const [character, setCharacter] = useState<string | null>(null);
 const [genProgress, setGenProgress] = useState(0);
 const { cue, say } = useFeedback();

 // Language & narrator voice
 const [storyLocale, setStoryLocale] = useState(settings.language || "vi");
 const speech = useSpeechInput(storyLocaleFor(storyLocale));
 const [defaultVoices, setDefaultVoices] = useState<DefaultVoice[]>([]);


 const preview=useVoicePreview(storyLocale);

 // Fetch default voices
 useEffect(() => {
 fetch("/api/voice/defaults")
 .then((r) => r.json())
 .then((data) => {
 if (data.voices) setDefaultVoices(data.voices);
 })
 .catch(() => {});
 }, []);

 const defaultVoicesForLocale = rankedDefaultsForLocale(defaultVoices,storyLocale);
 const activeNarrator=resolveNarratorChoice(voiceProfiles,defaultVoices,storyLocale,voiceChoice);
 const selectedVoice=activeNarrator?.kind==="family"?activeNarrator.id:null;
 const narratorVoiceId=activeNarrator?.kind==="default"?activeNarrator.voice_id:null;
 const effectiveVoice=selectedVoice;
 const { hasStoryProvider } = useSettings();
 const hasStoryKey=hasStoryProvider;

 const characterLabel = CHARACTERS.find((c) => c.id === character)?.label;
 const composedPrompt = [
 characterLabel ? `Nhân vật chính: ${characterLabel}` : null,
 speech.transcript ? `Bé kể: ${speech.transcript}` : null,
 extraPrompt || null,
 ]
 .filter(Boolean)
 .join(". ");

 // Fake-but-honest progress while the story is written (caps at 92% until done).
 useEffect(() => {
 if (!isGenerating) return;
 const t = setInterval(() => setGenProgress((p) => (p >= 92 ? p : p + Math.max(1, (92 - p) / 12))), 600);
 return () => clearInterval(t);
 }, [isGenerating]);

 const handleGenerate = async () => {
 if (!hasStoryKey) {
 onNavigate("settings");
 return;
 }

 setIsGenerating(true);
 setGenProgress(6);
 setError(null);
 // UI-11: Đóm báo đang nghĩ truyện (màn chờ đã có Đóm → chỉ giọng nói).
 say("thinking", { bubble: false });

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
 extraPrompt: composedPrompt || undefined,
 voiceId: effectiveVoice,
 narratorVoiceId: narratorVoiceId || undefined,
 narratorVoiceName: narratorVoiceId
 ? defaultVoices.find((v) => v.voice_id === narratorVoiceId)?.name
 : undefined,
 persist: true,
 });

 await refreshStories();
 cue("celebrate");
 say("created");

 if (story.storyId) {
 onNavigate("player", { storyId: story.storyId });
 } else {
 if (typeof window !== "undefined") {
 localStorage.setItem("kecon-generated-story", JSON.stringify(story));
 }
 onNavigate("player", { storyId: "__generated__" });
 }
 } catch (err) {
 cue("oops");
 setError(err instanceof Error ? err.message : "Đã xảy ra lỗi");
 } finally {
 setIsGenerating(false);
 }
 };

 const theme = storyThemes.find((t) => t.id === selectedTheme);
 const voiceName = narratorVoiceId
 ? defaultVoices.find((v) => v.voice_id === narratorVoiceId)?.name
 : voiceProfiles.find((v) => v.id === effectiveVoice)?.name;
 const ask = STEPS[step];
 const last = step === STEPS.length - 1;

 const back = () => (step > 0 ? setStep(step - 1) : onBack());
 const next = () => (last ? handleGenerate() : setStep(step + 1));

 const speakRow = (hint: string) =>
 speech.supported ? (
 <button
 type="button"
 onClick={speech.listening ? speech.stop : speech.start}
 aria-pressed={speech.listening}
 className="mt-3.5 flex min-h-[66px] w-full items-center gap-3 rounded-[22px] bg-glow-soft px-3.5 py-2.5 text-left text-[16px] font-black text-[#7A4A00]"
 >
 <span className="h-[46px] w-[46px] shrink-0 overflow-hidden rounded-2xl">
 <Icon3D name="mic" size={54} className="-m-[9%] max-w-none" />
 </span>
 <span className="min-w-0 flex-1">
 {speech.listening ? DOM_LINES.listen.text : speech.transcript ? `“${speech.transcript}”` : hint}
 </span>
 {speech.listening ? <GlowDots size={6} className="text-cta-ink" /> : <ChevronRight size={22} />}
 </button>
 ) : null;

 return (
 <div className="min-h-screen bg-cream px-5 pb-40 pt-12">
 {/* Writing state (board screen 6 "Đang tạo") */}
 {isGenerating && (
 <div className="fixed inset-0 z-[60] flex items-center justify-center bg-cream/95 px-5 backdrop-blur-sm">
 <KidLoading tag="Đang tạo" title="Đóm đang viết truyện cho bé…" funFact progress={genProgress} />
 </div>
 )}

 <KidHeader title="Tạo truyện mới" onBack={back} backLabel={step > 0 ? "Bước trước" : "Quay lại"} right={<small className="text-[14px] font-extrabold text-ink-2">Bước {step + 1}/{STEPS.length}</small>} />

 {/* Steps (board `.steps`) */}
 <div className="mt-3 flex gap-1.5" role="progressbar" aria-label="Tiến độ tạo truyện" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1}>
 {STEPS.map((_, i) => (
 <i key={i} className={`block h-2 flex-1 rounded-full ${i <= step ? "bg-brand" : "bg-[#E6E0F6]"}`} />
 ))}
 </div>

 {/* Đóm asks (board `.ask`) */}
 <div className="mt-4 flex items-end gap-1.5">
 <Mascot key={ask.mascot} state={ask.mascot} size={112} label={null} className="shrink-0" />
 <Bubble tail="left" className="mb-8 flex-1 font-display text-[20px] font-bold leading-[1.3]">
 <h2>{ask.ask}</h2>
 </Bubble>
 </div>

 {!hasStoryKey && (
 <button
 type="button"
 onClick={() => onNavigate("settings")}
 className="mb-3 flex w-full items-center gap-2.5 rounded-[20px] bg-glow-soft px-4 py-3 text-left active:scale-[0.98]"
 >
 <AlertCircle size={20} className="shrink-0 text-[#B26A00]" />
 <span className="flex-1">
 <b className="block text-[14px] font-black text-[#7A4A00]">Đóm chưa được bật AI</b>
 <small className="text-[12.5px] font-bold text-[#7A4A00]">Nhờ bố mẹ vào mục Bố mẹ để bật nhé</small>
 </span>
 <ChevronRight size={18} className="text-[#7A4A00]" />
 </button>
 )}

 {/* Step 1 — theme */}
 {step === 0 && (
 <>
 <div className="grid grid-cols-2 gap-3">
 {storyThemes.map((t) => (
 <OptionCard key={t.id} selected={selectedTheme === t.id} onClick={() => setSelectedTheme(t.id)} icon={THEME_ICON3D[t.icon] ?? "book"} label={t.name.replace("VN", "").replace("Ngủ Ngon", "Ru ngủ").trim()} />
 ))}
 </div>
 {speakRow("Hoặc bé tự nói cho Đóm nghe")}
 <div className="mt-3 grid grid-cols-2 gap-2.5">
 <button type="button" onClick={() => onNavigate("draw-story")} className={`flex min-h-[52px] items-center justify-center gap-2 rounded-[18px] bg-white text-[14px] font-extrabold text-brand-ink ${CARD_SHADOW}`}>
 <PenLine size={18} /> Bé vẽ, Đóm kể
 </button>
 <button type="button" onClick={() => onNavigate("scan-book")} className={`flex min-h-[52px] items-center justify-center gap-2 rounded-[18px] bg-white text-[14px] font-extrabold text-brand-ink ${CARD_SHADOW}`}>
 <Camera size={18} /> Chụp sách
 </button>
 </div>
 </>
 )}

 {/* Step 2 — character */}
 {step === 1 && (
 <>
 <div className="grid grid-cols-2 gap-3">
 {CHARACTERS.map((c) => (
 <OptionCard key={c.id} selected={character === c.id} onClick={() => setCharacter(character === c.id ? null : c.id)} icon={c.icon} label={c.label} />
 ))}
 </div>
 {speakRow("Hoặc bé tự nói cho Đóm nghe")}
 </>
 )}

 {/* Step 3 — narrator + age (+ language for parents) */}
 {step === 2 && (
 <>
 <NarrationToggle />
 {preview.error && <p role="alert" className="text-[14px] text-red-700 dark:text-red-300">{preview.error}</p>}
 {defaultVoicesForLocale.length > 0 || voiceProfiles.some((v) => v.elevenlabs_voice_id) ? (
 <div className="grid grid-cols-2 gap-3">
 {voiceProfiles
 .filter((v) => v.elevenlabs_voice_id)
 .map((v) => (
 <OptionCard key={v.id} selected={selectedVoice === v.id} onClick={() => { setVoiceChoice({kind:"family",id:v.id}); }} icon="mic" label={v.name} sub="Giọng nhà mình">
 <span className="absolute left-2.5 top-2"><VoicePreviewButton preview={preview} voiceId={v.elevenlabs_voice_id!} name={v.name} compact /></span>
 </OptionCard>
 ))}
 {defaultVoicesForLocale.map((v) => (
 <OptionCard key={v.id} selected={narratorVoiceId === v.voice_id && !selectedVoice} onClick={() => { setVoiceChoice({kind:"default",id:v.voice_id}); }} icon="headphones" label={v.name} sub="Giọng của Đóm">
 <span className="absolute left-2.5 top-2"><VoicePreviewButton preview={preview} voiceId={v.voice_id} name={v.name} compact /></span>
 </OptionCard>
 ))}
 </div>
 ) : (
 <button type="button" onClick={() => onNavigate("recording")} className={`flex w-full items-center gap-3 rounded-[22px] bg-white p-3 text-left ${CARD_SHADOW}`}>
 <Icon3D name="mic" size={56} />
 <span className="flex-1">
 <b className="block text-[16px] font-black text-ink">Chưa có giọng kể</b>
 <small className="text-[13px] font-bold text-ink-2">Bố mẹ ghi giọng để kể cho bé nhé</small>
 </span>
 <ChevronRight size={20} className="text-ink-2" />
 </button>
 )}

 <h3 className="mb-2 mt-5 font-display text-[19px] font-bold text-ink">Bé mấy tuổi?</h3>
 <div className="grid grid-cols-3 gap-2">
 {AGE_BANDS.map(({ id: age, label }) => (
 <button
 key={age}
 type="button"
 onClick={() => setSelectedAge(age)}
 aria-pressed={selectedAge === age}
 className={`min-h-[52px] rounded-[18px] text-[16px] font-black transition-colors ${selectedAge === age ? "bg-brand text-white shadow-[0_4px_0_var(--color-brand-press)]" : `bg-white text-ink ${CARD_SHADOW}`}`}
 >
 {label}
 </button>
 ))}
 </div>

 <h3 className="mb-2 mt-5 font-display text-[19px] font-bold text-ink">Kể bằng tiếng gì?</h3>
 <div className="grid grid-cols-3 gap-2">
 {LANGUAGES.map((lang) => (
 <button
 key={lang.code}
 type="button"
 onClick={() => { setStoryLocale(lang.code); setVoiceChoice(null); }}
 aria-pressed={storyLocale === lang.code}
 className={`min-h-[48px] rounded-[16px] text-[14px] font-extrabold transition-colors ${storyLocale === lang.code ? "bg-brand text-white" : `bg-white text-ink ${CARD_SHADOW}`}`}
 >
 {lang.label}
 </button>
 ))}
 </div>
 </>
 )}

 {/* Step 4 — summary + optional idea */}
 {step === 3 && (
 <>
 <div className={`flex items-center gap-3 rounded-[24px] bg-white p-3 ${CARD_SHADOW}`}>
 <span className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-[20px]">
 <Icon3D name={THEME_ICON3D[theme?.icon ?? ""] ?? "book"} size={85} className="-m-[9%] max-w-none" />
 </span>
 <span className="min-w-0 flex-1 text-[14px] font-bold leading-snug text-ink-2">
 <b className="block font-display text-[19px] font-bold text-ink">{theme?.name ?? "Truyện mới"}</b>
 {characterLabel ?? "Đóm chọn nhân vật"} · {AGE_BANDS.find((b) => b.id === selectedAge)?.label}
 {voiceName ? ` · ${voiceName}` : ""}
 </span>
 </div>

 <label htmlFor="child-name" className="mb-2 mt-5 block font-display text-[19px] font-bold text-ink">
 Tên bé <small className="font-sans text-[13px] font-bold text-ink-2">(không bắt buộc)</small>
 </label>
 <input
 id="child-name"
 value={childName}
 onChange={(e) => setChildName(e.target.value)}
 placeholder="VD: Bông, Bin, Na…"
 className={`h-14 w-full rounded-[18px] bg-white px-4 text-[16px] font-bold text-ink outline-none placeholder:text-ink-2/60 focus:ring-2 focus:ring-brand ${CARD_SHADOW}`}
 />

 <label htmlFor="story-idea" className="mb-2 mt-5 block font-display text-[19px] font-bold text-ink">
 Thêm ý tưởng <small className="font-sans text-[13px] font-bold text-ink-2">(bố mẹ gõ giúp bé)</small>
 </label>
 <textarea
 id="story-idea"
 value={extraPrompt}
 onChange={(e) => setExtraPrompt(e.target.value)}
 placeholder="Có khủng long, ở đáy biển, bài học chia sẻ…"
 className={`h-[88px] w-full resize-none rounded-[18px] bg-white px-4 py-3 text-[15px] font-bold text-ink outline-none placeholder:text-ink-2/60 focus:ring-2 focus:ring-brand ${CARD_SHADOW}`}
 />
 <div className="mt-2 flex flex-wrap gap-1.5">
 {["Có phép thuật", "Dưới đáy biển", "Trên vũ trụ", "Bài học chia sẻ", "Bài học dũng cảm", "Yêu thiên nhiên"].map((chip) => (
 <button
 key={chip}
 type="button"
 onClick={() => setExtraPrompt((prev) => (prev ? `${prev}, ${chip}` : chip))}
 className="min-h-[40px] rounded-2xl bg-brand-soft px-3 text-[13px] font-extrabold text-brand-ink active:scale-95"
 >
 + {chip}
 </button>
 ))}
 </div>

 {error && (
 <div role="alert" className="mt-4 flex items-start gap-2 rounded-[18px] bg-[#FDE8E3] p-3.5">
 <AlertCircle size={18} className="mt-0.5 shrink-0 text-cta-ink" />
 <p className="text-[14px] font-bold text-[#8A2E10]">{error}</p>
 </div>
 )}
 </>
 )}

 {/* CTA (board `.cr .btn`) */}
 <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[430px] bg-gradient-to-t from-cream via-cream/95 to-cream/0 px-5 pb-8 pt-6">
 <Button3D block onClick={next} disabled={isGenerating || (last && !hasStoryKey)}>
 {last ? (
 <>
 <Sparkles size={24} weight="fill" /> Tạo truyện cùng Đóm
 </>
 ) : (
 <>
 Tiếp tục <ArrowRight size={22} />
 </>
 )}
 </Button3D>
 </div>
 </div>
 );
}
