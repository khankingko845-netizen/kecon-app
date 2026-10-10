"use client";
import { useToast } from "@/components/ui/Toast";
import { useFeatureFlags } from "@/lib/feature-flags-context";

import { useState, useEffect, useRef } from "react";
import {
 Sparkles, AlertCircle, ArrowRight, ChevronRight, PenLine, Camera, Check, X,
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
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { CHARACTER_PRESETS, CHARACTER_TRAITS, VOICE_TYPE_LABEL, characterArtUrl } from "@/lib/story-characters";
import {
 LENGTH_LABEL, MAX_BRIEF_CHARACTERS, PACE_LABEL, STORY_LENGTHS, VOICE_TYPES, defaultPace, estimatedMinutes, pagePlan,
 type NarrationPace, type StoryLength, type VoiceType,
} from "@/lib/story-brief";
import type { StoryBriefCharacterInput } from "@/lib/api-client";

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

/** Step 2 — cast member (preset card, custom character or the child). */
interface CastMember {
 key: string;
 name: string;
 description: string;
 presetId?: string;
 voiceType?: VoiceType;
 appearance?: string;
 isChild?: boolean;
}

const PACE_SUB: Record<NarrationPace, string> = {
 calm: "Ngắt nghỉ dài, êm như lời ru",
 normal: "Tự nhiên, sinh động",
};

/** Accessible on/off row (role="switch"). */
function SwitchRow({ checked, onChange, label, sub }: { checked: boolean; onChange: (v: boolean) => void; label: string; sub: string }) {
 return (
 <button
 type="button"
 role="switch"
 aria-checked={checked}
 onClick={() => onChange(!checked)}
 className={`mt-3 flex min-h-14 w-full items-center gap-3 rounded-[20px] bg-white px-4 py-3 text-left text-ink ${CARD_SHADOW} focus-visible:outline-2 focus-visible:outline-brand`}
 >
 <span className="flex-1">
 <b className="block text-[15px] font-black">{label}</b>
 <span className="block text-[13px] font-bold text-ink-2">{sub}</span>
 </span>
 <span aria-hidden className={`flex h-7 w-12 shrink-0 items-center rounded-full p-1 ${checked ? "justify-end bg-brand" : "justify-start bg-gray-500"}`}>
 <span className="h-5 w-5 rounded-full bg-[#F7EFD8]" />
 </span>
 </button>
 );
}

/** Character card with its own portrait (not the theme tile). */
function CharacterCard({ selected, role, onClick, img, name, kind }: { selected: boolean; role?: "hero" | "friend"; onClick: () => void; img: string; name: string; kind: string }) {
 return (
 <button
 type="button"
 onClick={onClick}
 aria-pressed={selected}
 data-say={name}
 className={`relative w-full rounded-[22px] border-[3px] px-1.5 pb-2.5 pt-2 text-center transition-colors active:scale-[0.98] ${CARD_SHADOW} ${
 selected ? "border-brand bg-[#F5F3FF]" : "border-transparent bg-white"
 }`}
 >
 {/* eslint-disable-next-line @next/next/no-img-element */}
 <img src={img} alt="" width={84} height={84} className="mx-auto block h-[84px] w-[84px] rounded-[18px] object-cover" draggable={false} />
 <b className="mt-1 block text-[14px] font-black leading-tight text-ink">{name}</b>
 <small className="block text-[11.5px] font-bold leading-tight text-ink-2">{selected && role ? (role === "hero" ? "Nhân vật chính" : "Bạn đồng hành") : kind}</small>
 {selected && (
 <span aria-hidden className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-brand text-white">
 <Check size={14} weight="bold" />
 </span>
 )}
 </button>
 );
}

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


/** Wall-clock start of a generate request (event handler only; kept outside render for the React compiler). */
function generationStartMs(): number {
  return Date.now();
}

/** After a network drop, look for the story the server finished meanwhile (own stories only via RLS). */
async function findStoryCreatedSince(startedAt: number): Promise<string | null> {
 try {
 const supabase = createBrowserSupabase();
 const { data: auth } = await supabase.auth.getUser();
 if (!auth.user) return null;
 for (let i = 0; i < 12; i++) {
 const { data } = await supabase
 .from("stories")
 .select("id, created_at")
 .eq("user_id", auth.user.id)
 .eq("source", "ai")
 .gte("created_at", new Date(startedAt - 5000).toISOString())
 .order("created_at", { ascending: false })
 .limit(1);
 if (data?.[0]?.id) return data[0].id as string;
 await new Promise((r) => setTimeout(r, 10_000));
 }
 } catch {
 /* fall through */
 }
 return null;
}

function hasOtherVoice(voices: { voice_id: string }[], narratorId: string | null): boolean {
  return voices.some((v) => v.voice_id !== narratorId);
}

export default function CreateStory({ onBack, onNavigate }: CreateStoryProps) {
 const features = useFeatureFlags();
 const { settings, systemStatus } = useSettings();
 const { voiceProfiles, refreshStories } = useData();
 const [selectedTheme, setSelectedTheme] = useState("cotich");
 const [selectedAge, setSelectedAge] = useState<string>(normalizeAgeBand(settings.childAge));
 const [voiceChoice,setVoiceChoice]=useState<NarratorChoice>(null);
 const [childName, setChildName] = useState(settings.childName || "");
 const [extraPrompt, setExtraPrompt] = useState("");
 const [isGenerating, setIsGenerating] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const { toast } = useToast();
 const [step, setStep] = useState(0);
 const [cast, setCast] = useState<CastMember[]>([]);
 const [customOpen, setCustomOpen] = useState(false);
 const [customName, setCustomName] = useState("");
 const [customKind, setCustomKind] = useState("");
 const [customTraits, setCustomTraits] = useState<string[]>([]);
 const [customVoice, setCustomVoice] = useState<VoiceType | undefined>(undefined);
 const [storyLength, setStoryLength] = useState<StoryLength>("medium");
 const [paceChoice, setPaceChoice] = useState<NarrationPace | null>(null);
 const [castVoicesOn, setCastVoicesOn] = useState(true);
 const [ambienceOn, setAmbienceOn] = useState(true);
 const [illustrateOn, setIllustrateOn] = useState(true);
 const castSeq = useRef(0);
 const [genProgress, setGenProgress] = useState(0);
 const { cue, say } = useFeedback();

 // Language & narrator voice
 const [selectedStoryLocale, setStoryLocale] = useState(settings.language || "vi");
 const storyLocale = features.enabled("multilingual") ? selectedStoryLocale : "vi";
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
 // Characters can only get their own voice when a default voice other than the narrator exists.
 const canCastVoices=hasOtherVoice(defaultVoicesForLocale,narratorVoiceId);
 const { hasStoryProvider } = useSettings();
 const hasStoryKey=hasStoryProvider;

 const pace: NarrationPace = paceChoice ?? defaultPace(selectedAge, selectedTheme);
 const canIllustrate = features.enabled("ai_illustrations") && Boolean(systemStatus.hasIllustrationProvider);
 const childInCast = cast.some((c) => c.isChild);
 const castFull = cast.length >= MAX_BRIEF_CHARACTERS;
 const castName = (c: CastMember) => (c.isChild ? childName.trim() || "Bé" : c.name.trim());

 const toggleCast = (member: CastMember) => {
 setCast((prev) => {
 if (prev.some((c) => c.key === member.key)) return prev.filter((c) => c.key !== member.key);
 if (prev.length >= MAX_BRIEF_CHARACTERS) {
 toast("info", `Tối đa ${MAX_BRIEF_CHARACTERS} nhân vật cho một truyện nhé.`);
 return prev;
 }
 return member.isChild ? [member, ...prev] : [...prev, member];
 });
 };
 const togglePreset = (id: string) => {
 const p = CHARACTER_PRESETS.find((x) => x.id === id);
 if (!p) return;
 toggleCast({ key: `preset:${p.id}`, name: p.name, description: p.description, presetId: p.id, voiceType: p.voiceType, appearance: p.appearance });
 };
 const addCustom = () => {
 const name = customName.trim();
 if (!name) return;
 const description = [customKind.trim(), customTraits.length ? `tính cách ${customTraits.join(", ")}` : ""].filter(Boolean).join(", ");
 castSeq.current += 1;
 toggleCast({ key: `custom:${castSeq.current}`, name, description, voiceType: customVoice });
 setCustomName("");
 setCustomKind("");
 setCustomTraits([]);
 setCustomVoice(undefined);
 setCustomOpen(false);
 };
 const makeHero = (key: string) =>
 setCast((prev) => {
 const m = prev.find((c) => c.key === key);
 return m ? [m, ...prev.filter((c) => c.key !== key)] : prev;
 });
 const updateMember = (key: string, patch: Partial<CastMember>) =>
 setCast((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
 const briefCharacters: StoryBriefCharacterInput[] = cast
 .map((c, i) => ({
 name: castName(c),
 description: c.isChild ? "" : c.description,
 role: (i === 0 ? "hero" : "friend") as "hero" | "friend",
 ...(c.presetId ? { presetId: c.presetId } : {}),
 ...(c.isChild ? { isChild: true } : {}),
 ...(c.voiceType ? { voiceType: c.voiceType } : {}),
 ...(c.appearance ? { appearance: c.appearance } : {}),
 }))
 .filter((c) => c.name);
 const plan = pagePlan(selectedAge, storyLength);

 const composedPrompt = [
 speech.transcript ? `Bé kể: ${speech.transcript}` : null,
 extraPrompt || null,
 ]
 .filter(Boolean)
 .join(". ");

 // Fake-but-honest progress while the story is written (caps at 92% until done).
 useEffect(() => {
 if (!isGenerating) return;
 // Long stories take 1–3 minutes: creep slowly so the bar never looks stuck at the end.
 const t = setInterval(() => setGenProgress((p) => (p >= 94 ? p : p + Math.max(0.3, (94 - p) / 45))), 1000);
 return () => clearInterval(t);
 }, [isGenerating]);

 const handleGenerate = async () => {
 if (!hasStoryKey) {
 onNavigate("settings");
 return;
 }

 setIsGenerating(true);
 setGenProgress(4);
 setError(null);
 const startedAt = generationStartMs();
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
 characters: briefCharacters,
 length: storyLength,
 pace,
 castVoices: castVoicesOn && canCastVoices,
 illustrate: canIllustrate && illustrateOn,
 ambience: ambienceOn,
 }).catch(async (err) => {
 // A dropped connection does not stop the server: the story may already be saved.
 if (!(err instanceof TypeError)) throw err;
 const recovered = await findStoryCreatedSince(startedAt);
 if (!recovered) throw new Error("Mất kết nối khi Đóm đang viết. Thử lại hoặc mở Thư viện để xem truyện đã xong chưa.");
 return { title: "", summary: "", pages: [], storyId: recovered };
 });
 setGenProgress(100);

 await refreshStories();
 toast("success", "Đã tạo truyện.");
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
 toast("error", "Chưa tạo được truyện. Xem lỗi trước khi thử lại.");
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
 <KidLoading tag="Đang tạo" title="Đóm đang viết truyện cho bé…" message={`Truyện ${plan.pages} trang, khoảng ${estimatedMinutes(plan, pace)} phút nghe — Đóm cần 1–2 phút để viết thật hay nhé.`} progress={genProgress} />
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
 <button hidden={!features.canOpen("draw-story")} type="button" onClick={() => onNavigate("draw-story")} className={`flex min-h-[52px] items-center justify-center gap-2 rounded-[18px] bg-white text-[14px] font-extrabold text-brand-ink ${CARD_SHADOW}`}>
 <PenLine size={18} /> Bé vẽ, Đóm kể
 </button>
 <button hidden={!features.canOpen("scan-book")} type="button" onClick={() => onNavigate("scan-book")} className={`flex min-h-[52px] items-center justify-center gap-2 rounded-[18px] bg-white text-[14px] font-extrabold text-brand-ink ${CARD_SHADOW}`}>
 <Camera size={18} /> Chụp sách
 </button>
 </div>
 </>
 )}

 {/* Step 2 — cast: presets with their own portraits, custom characters, the child */}
 {step === 1 && (
 <>
 <p className="-mt-3 mb-3 text-[14px] font-bold text-ink-2">
 Chọn tối đa {MAX_BRIEF_CHARACTERS} nhân vật — bạn chọn đầu tiên là nhân vật chính. Có thể bỏ qua để Đóm tự nghĩ.
 </p>
 <SwitchRow
 checked={childInCast}
 onChange={(on) => (on ? toggleCast({ key: "child", name: "", description: "", isChild: true }) : setCast((prev) => prev.filter((c) => !c.isChild)))}
 label="Bé là nhân vật chính"
 sub="Đóm viết truyện về chính bé"
 />
 {childInCast && (
 <input
 aria-label="Tên của bé trong truyện"
 value={childName}
 onChange={(e) => setChildName(e.target.value)}
 placeholder="Tên bé, VD: Bông, Bin, Na…"
 maxLength={40}
 className={`mt-2 h-12 w-full rounded-[16px] bg-white px-4 text-[15px] font-bold text-ink outline-none placeholder:text-ink-2/70 focus:ring-2 focus:ring-brand ${CARD_SHADOW}`}
 />
 )}
 <div className="mt-3 grid grid-cols-3 gap-2.5">
 {CHARACTER_PRESETS.map((p) => {
 const index = cast.findIndex((c) => c.presetId === p.id);
 return (
 <CharacterCard
 key={p.id}
 selected={index >= 0}
 role={index === 0 ? "hero" : "friend"}
 onClick={() => togglePreset(p.id)}
 img={characterArtUrl(p.id)}
 name={p.name}
 kind={p.kind}
 />
 );
 })}
 <CharacterCard selected={customOpen} onClick={() => setCustomOpen(!customOpen)} img={characterArtUrl(null)} name="Tự tạo" kind="Nhân vật của bé" />
 </div>

 {customOpen && (
 <div className={`mt-3 rounded-[22px] bg-white p-3.5 ${CARD_SHADOW}`}>
 <label htmlFor="custom-name" className="block text-[15px] font-black text-ink">Tên nhân vật</label>
 <input
 id="custom-name"
 value={customName}
 onChange={(e) => setCustomName(e.target.value)}
 placeholder="VD: Mèo Mun, Bà Tiên Gió, Khủng long Su…"
 maxLength={40}
 className="mt-1.5 h-12 w-full rounded-[14px] bg-cream px-3.5 text-[15px] font-bold text-ink outline-none placeholder:text-ink-2/70 focus:ring-2 focus:ring-brand"
 />
 <label htmlFor="custom-kind" className="mt-3 block text-[15px] font-black text-ink">Là ai, con gì?</label>
 <input
 id="custom-kind"
 value={customKind}
 onChange={(e) => setCustomKind(e.target.value)}
 placeholder="VD: chú mèo đen thích nấu ăn"
 maxLength={160}
 className="mt-1.5 h-12 w-full rounded-[14px] bg-cream px-3.5 text-[15px] font-bold text-ink outline-none placeholder:text-ink-2/70 focus:ring-2 focus:ring-brand"
 />
 <p className="mt-3 text-[15px] font-black text-ink">Tính cách</p>
 <div className="mt-1.5 flex flex-wrap gap-1.5">
 {CHARACTER_TRAITS.map((t) => {
 const on = customTraits.includes(t);
 return (
 <button key={t} type="button" aria-pressed={on} onClick={() => setCustomTraits((prev) => (on ? prev.filter((x) => x !== t) : [...prev, t].slice(-3)))}
 className={`min-h-[40px] rounded-2xl px-3 text-[13px] font-extrabold ${on ? "bg-brand text-white" : "bg-brand-soft text-brand-ink"}`}>
 {t}
 </button>
 );
 })}
 </div>
 <p className="mt-3 text-[15px] font-black text-ink">Giọng nói</p>
 <div className="mt-1.5 flex flex-wrap gap-1.5">
 {VOICE_TYPES.map((v) => (
 <button key={v} type="button" aria-pressed={customVoice === v} onClick={() => setCustomVoice(customVoice === v ? undefined : v)}
 className={`min-h-[40px] rounded-2xl px-3 text-[13px] font-extrabold ${customVoice === v ? "bg-brand text-white" : "bg-brand-soft text-brand-ink"}`}>
 {VOICE_TYPE_LABEL[v]}
 </button>
 ))}
 </div>
 <Button3D block size="md" className="mt-3.5" onClick={addCustom} disabled={!customName.trim() || castFull}>
 Thêm vào truyện
 </Button3D>
 {castFull && <p className="mt-2 text-[13px] font-bold text-ink-2">Đã đủ {MAX_BRIEF_CHARACTERS} nhân vật — bỏ bớt một bạn để thêm.</p>}
 </div>
 )}

 {cast.length > 0 && (
 <section aria-label="Nhân vật trong truyện" className={`mt-3 rounded-[22px] bg-white p-3 ${CARD_SHADOW}`}>
 <h3 className="mb-2 text-[15px] font-black text-ink">Nhân vật trong truyện ({cast.length}/{MAX_BRIEF_CHARACTERS})</h3>
 <ul className="space-y-2">
 {cast.map((c, i) => (
 <li key={c.key} className="flex items-center gap-2.5 rounded-[16px] bg-cream p-2">
 {/* eslint-disable-next-line @next/next/no-img-element */}
 <img src={c.isChild ? "/characters/v1/hero.webp" : characterArtUrl(c.presetId)} alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-[12px] object-cover" />
 <span className="min-w-0 flex-1">
 {c.isChild ? (
 <b className="block truncate text-[15px] font-black text-ink">{castName(c)}</b>
 ) : (
 <input
 aria-label={`Tên nhân vật ${i + 1}`}
 value={c.name}
 onChange={(e) => updateMember(c.key, { name: e.target.value })}
 maxLength={40}
 className="h-9 w-full rounded-[10px] bg-white px-2.5 text-[14px] font-black text-ink outline-none focus:ring-2 focus:ring-brand"
 />
 )}
 <span className="mt-0.5 flex items-center gap-1.5 text-[12px] font-bold text-ink-2">
 {i === 0 ? (
 <span className="rounded-full bg-brand px-2 py-0.5 text-[11.5px] font-black text-white">Nhân vật chính</span>
 ) : (
 <button type="button" onClick={() => makeHero(c.key)} aria-label={`Chọn nhân vật ${i + 1} làm nhân vật chính`} className="min-h-[28px] rounded-full bg-brand-soft px-2 text-[11.5px] font-black text-brand-ink">
 Bạn đồng hành · đổi làm chính
 </button>
 )}
 {c.voiceType && <span>{VOICE_TYPE_LABEL[c.voiceType]}</span>}
 </span>
 </span>
 <button type="button" onClick={() => setCast((prev) => prev.filter((x) => x.key !== c.key))} aria-label={`Bỏ nhân vật ${i + 1}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-ink-2">
 <X size={16} />
 </button>
 </li>
 ))}
 </ul>
 </section>
 )}
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
 {LANGUAGES.filter((lang) => lang.code === "vi" || features.enabled("multilingual")).map((lang) => (
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

 <h3 className="mb-2 mt-5 font-display text-[19px] font-bold text-ink">Nhịp đọc</h3>
 <div className="grid grid-cols-2 gap-2">
 {(["calm", "normal"] as const).map((p) => (
 <button
 key={p}
 type="button"
 onClick={() => setPaceChoice(p)}
 aria-pressed={pace === p}
 className={`min-h-[64px] rounded-[18px] px-3 py-2 text-left transition-colors ${pace === p ? "bg-brand text-white shadow-[0_4px_0_var(--color-brand-press)]" : `bg-white text-ink ${CARD_SHADOW}`}`}
 >
 <b className="block text-[16px] font-black">{PACE_LABEL[p]}</b>
 <span className="block text-[12.5px] font-bold">{PACE_SUB[p]}</span>
 </button>
 ))}
 </div>
 {canCastVoices && (
 <SwitchRow checked={castVoicesOn} onChange={setCastVoicesOn} label="Nhân vật có giọng riêng" sub="Mỗi nhân vật nói bằng một giọng khác, như kịch truyền thanh" />
 )}
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
 {cast.length ? cast.map(castName).join(", ") : "Đóm chọn nhân vật"} · {AGE_BANDS.find((b) => b.id === selectedAge)?.label}
 {voiceName ? ` · ${voiceName}` : ""}
 </span>
 </div>

 <h3 className="mb-2 mt-5 font-display text-[19px] font-bold text-ink">Truyện dài bao nhiêu?</h3>
 <div className="grid grid-cols-3 gap-2">
 {STORY_LENGTHS.map((len) => {
 const pl = pagePlan(selectedAge, len);
 return (
 <button
 key={len}
 type="button"
 onClick={() => setStoryLength(len)}
 aria-pressed={storyLength === len}
 className={`min-h-[64px] rounded-[18px] px-2 py-2 transition-colors ${storyLength === len ? "bg-brand text-white shadow-[0_4px_0_var(--color-brand-press)]" : `bg-white text-ink ${CARD_SHADOW}`}`}
 >
 <b className="block text-[16px] font-black">{LENGTH_LABEL[len]}</b>
 <span className="block text-[12px] font-bold">~{estimatedMinutes(pl, pace)} phút · {pl.pages} trang</span>
 </button>
 );
 })}
 </div>
 <SwitchRow checked={ambienceOn} onChange={setAmbienceOn} label="Âm thanh khung cảnh" sub="Tiếng rừng, mưa, sóng… và hiệu ứng nhẹ theo từng trang" />
 {canIllustrate && (
 <SwitchRow checked={illustrateOn} onChange={setIllustrateOn} label="Tranh vẽ riêng cho từng trang" sub="Đóm vẽ thêm tranh theo truyện (vài phút đầu dùng tranh khung cảnh)" />
 )}

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
