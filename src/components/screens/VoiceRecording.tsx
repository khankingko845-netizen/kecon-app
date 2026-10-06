"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
 Mic, Loader2, Check, AlertCircle, Settings, Play, Square, Volume2, X, ShieldCheck, SpeakerSlash, Ruler, Hourglass, LockKey,
} from "@/components/ui/icons";
import { useSettings } from "@/lib/settings-context";
import { useData } from "@/lib/data-context";
import { cloneVoiceApi } from "@/lib/api-client";
import { uploadRecording, createVoiceProfile } from "@/lib/db";
import type { Screen } from "@/lib/types";
import Mascot from "@/components/ui/Mascot";

const SAMPLE_SCRIPTS = [
 {
 id: "cotich",
 label: "🧚 Cổ tích",
 text: "Ngày xửa ngày xưa, ở một vương quốc xa xôi, có một nàng công chúa xinh đẹp sống trong lâu đài tráng lệ. Mỗi đêm, nàng nhìn lên bầu trời đếm sao và mơ ước được bay xa.",
 },
 {
 id: "rungủ",
 label: "🌙 Ru ngủ",
 text: "Đêm đã khuya, trăng lên cao trên bầu trời trong vắt. Gió mang theo hương hoa nhài thoang thoảng. Bé nhắm mắt lại, nghe tiếng dế kêu rỉ rả ngoài vườn, rồi từ từ chìm vào giấc ngủ êm đềm.",
 },
 {
 id: "vuinhon",
 label: "🐻 Vui nhộn",
 text: "Gấu Bông thích ăn mật ong nhất! Một hôm, Gấu thấy tổ ong trên cây cao. Gấu trèo lên, trượt chân rơi bịch xuống đất! Các bạn thỏ cười lăn lộn, còn Gấu xoa đầu cười theo.",
 },
 {
 id: "giaoduc",
 label: "📚 Giáo dục",
 text: "Các con biết không, Trái Đất của chúng ta rất đặc biệt! Đây là hành tinh duy nhất có nước, có cây xanh và có cả hàng triệu loài động vật sinh sống. Chúng ta phải bảo vệ ngôi nhà chung này nhé!",
 },
 {
 id: "thoai",
 label: "🎭 Thoại",
 text: "Mẹ ơi, con muốn nghe chuyện! Được rồi con ngồi đây nha. Hôm nay mẹ kể cho con câu chuyện về chú Rùa thông minh. Rùa ơi rùa, bạn đi đâu thế? Mình đi tìm kho báu!",
 },
] as const;

interface VoiceRecordingProps {
 onBack: () => void;
 onNavigate?: (screen: Screen) => void;
}

export default function VoiceRecording({ onBack, onNavigate }: VoiceRecordingProps) {
 const { settings, hasElevenLabs: hasSystemElevenLabs } = useSettings();
 const { refreshVoices } = useData();
 const [isRecording, setIsRecording] = useState(false);
 const [elapsed, setElapsed] = useState(0);
 const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
 const [voiceName, setVoiceName] = useState("");
 const [gender, setGender] = useState<"male" | "female">("female");
 const [voiceLang, setVoiceLang] = useState<string>("vi");
 const [isCloning, setIsCloning] = useState(false);
 const [cloneResult, setCloneResult] = useState<{ voice_id: string; name: string } | null>(null);
 const [error, setError] = useState<string | null>(null);
 const [selectedScript, setSelectedScript] = useState<string>(SAMPLE_SCRIPTS[0].id);
 const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
 const [isLoadingPreview, setIsLoadingPreview] = useState(false);

 const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
 const mediaRecorderRef = useRef<MediaRecorder | null>(null);
 const chunksRef = useRef<Blob[]>([]);
 const previewAudioRef = useRef<HTMLAudioElement | null>(null);
 const recordingAudioRef = useRef<HTMLAudioElement | null>(null);
 const [isRecordingPlaying, setIsRecordingPlaying] = useState(false);

 const hasElevenKey = Boolean(settings.elevenLabsApiKey) || hasSystemElevenLabs;

 const stopRecording = useCallback(() => {
 if (mediaRecorderRef.current?.state === "recording") {
 mediaRecorderRef.current.stop();
 }
 setIsRecording(false);
 }, []);

 useEffect(() => {
 if (isRecording) {
 intervalRef.current = setInterval(() => {
 setElapsed((e) => {
 if (e >= 180) {
 stopRecording();
 return e;
 }
 return e + 1;
 });
 }, 1000);
 } else if (intervalRef.current) {
 clearInterval(intervalRef.current);
 }
 return () => {
 if (intervalRef.current) clearInterval(intervalRef.current);
 };
 }, [isRecording, stopRecording]);

 const startRecording = useCallback(async () => {
 try {
 const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
 const mediaRecorder = new MediaRecorder(stream, {
 mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4",
 });

 chunksRef.current = [];
 mediaRecorder.ondataavailable = (e) => {
 if (e.data.size > 0) chunksRef.current.push(e.data);
 };
 mediaRecorder.onstop = () => {
 const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType });
 setAudioBlob(blob);
 stream.getTracks().forEach((t) => t.stop());
 };

 mediaRecorder.start(1000);
 mediaRecorderRef.current = mediaRecorder;
 setIsRecording(true);
 setElapsed(0);
 setAudioBlob(null);
 setCloneResult(null);
 setError(null);
 } catch {
 setError("Không thể truy cập microphone. Vui lòng cho phép quyền mic.");
 }
 }, []);

 const handleToggleRecording = () => {
 if (isRecording) {
 stopRecording();
 } else {
 startRecording();
 }
 };

 const handleClone = async () => {
 if (!audioBlob || !voiceName.trim()) return;
 if (!hasElevenKey) {
 onNavigate?.("settings");
 return;
 }

 setIsCloning(true);
 setError(null);

 try {
 const result = await cloneVoiceApi(
 voiceName.trim(),
 audioBlob,
 settings.elevenLabsApiKey || undefined,
 voiceLang
 );

 // Persist sample recording + voice profile to Supabase.
 let sampleUrl: string | null = null;
 try {
 sampleUrl = await uploadRecording(audioBlob);
 } catch {
 /* storage upload is best-effort */
 }
 await createVoiceProfile({
 name: voiceName.trim(),
 relation: "parent",
 gender,
 elevenlabs_voice_id: result.voice_id,
 sample_audio_url: sampleUrl,
 quality_score: 90,
 });
 await refreshVoices();

 setCloneResult(result);
 } catch (err) {
 setError(err instanceof Error ? err.message : "Clone thất bại");
 } finally {
 setIsCloning(false);
 }
 };

 // Play recording preview
 const toggleRecordingPlayback = useCallback(() => {
 if (!audioBlob) return;
 if (isRecordingPlaying && recordingAudioRef.current) {
 recordingAudioRef.current.pause();
 setIsRecordingPlaying(false);
 return;
 }
 const url = URL.createObjectURL(audioBlob);
 const audio = new Audio(url);
 recordingAudioRef.current = audio;
 audio.onended = () => { setIsRecordingPlaying(false); URL.revokeObjectURL(url); };
 audio.play();
 setIsRecordingPlaying(true);
 }, [audioBlob, isRecordingPlaying]);

 // Play cloned voice preview via TTS
 const playVoicePreview = useCallback(async () => {
 if (!cloneResult) return;
 if (isPreviewPlaying && previewAudioRef.current) {
 previewAudioRef.current.pause();
 setIsPreviewPlaying(false);
 return;
 }
 setIsLoadingPreview(true);
 try {
 const res = await fetch("/api/voice/tts", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 voiceId: cloneResult.voice_id,
 text: "Xin chào! Đây là giọng nói của tôi trên KểCon. Mỗi tối, tôi sẽ kể cho con nghe những câu chuyện thật hay!",
 language: voiceLang,
 }),
 });
 if (!res.ok) throw new Error("TTS failed");
 const blob = await res.blob();
 const url = URL.createObjectURL(blob);
 const audio = new Audio(url);
 previewAudioRef.current = audio;
 audio.onended = () => { setIsPreviewPlaying(false); URL.revokeObjectURL(url); };
 audio.play();
 setIsPreviewPlaying(true);
 } catch {
 setError("Không thể phát giọng mẫu");
 }
 setIsLoadingPreview(false);
 }, [cloneResult, isPreviewPlaying, voiceLang]);

 const formatTime = (s: number) => {
 const m = Math.floor(s / 60);
 const sec = s % 60;
 return `${m}:${sec.toString().padStart(2, "0")}`;
 };

 const progress = (elapsed / 180) * 100;

 const scriptIdx = Math.max(0, SAMPLE_SCRIPTS.findIndex((x) => x.id === selectedScript));
 const scriptText: string = SAMPLE_SCRIPTS[scriptIdx].text;
 const sentences = scriptText.match(/[^.!?]+[.!?]*\s*/g) ?? [scriptText];
 // While recording, gently move the highlight one sentence every ~6 s (board `.script p b`).
 const readingIdx = isRecording ? Math.min(sentences.length - 1, Math.floor(elapsed / 6)) : 0;
 const litBars = Math.round((Math.min(progress, 100) / 100) * WAVE.length);
 const listenTitle = cloneResult
 ? "Đóm đã học giọng của bạn!"
 : isRecording
 ? "Đóm đang lắng nghe…"
 : audioBlob
 ? "Ghi xong rồi!"
 : "Đóm sẵn sàng nghe bạn đọc";

 return (
 <div className="flex min-h-screen flex-col bg-parent-bg px-5 pb-10 pt-12 font-parent text-ink">
 {/* Top (board `.vtop`) */}
 <header className="flex min-h-[48px] items-center gap-2.5">
 <button type="button" onClick={onBack} aria-label="Đóng" className="-ml-2 flex h-11 w-11 items-center justify-center rounded-2xl active:bg-ink/5">
 <X size={24} weight="bold" />
 </button>
 <h1 className="font-parent text-[19px] font-bold">Ghi giọng bố mẹ</h1>
 <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-success-soft px-2.5 py-1.5 text-[12.5px] font-semibold text-success">
 <ShieldCheck size={15} weight="fill" /> Phụ huynh
 </span>
 </header>

 {!hasElevenKey && (
 <button
 type="button"
 onClick={() => onNavigate?.("settings")}
 className="mt-3 flex w-full items-center gap-2.5 rounded-[16px] bg-glow-soft px-3.5 py-3 text-left active:scale-[0.98]"
 >
 <AlertCircle size={18} className="shrink-0 text-[#B26A00]" />
 <span className="flex-1 text-[13px] font-semibold text-[#7A4A00]">Cần bật ElevenLabs trong Cài đặt để Đóm học giọng</span>
 <Settings size={16} className="text-[#B26A00]" />
 </button>
 )}

 {/* Đóm listening (board `.lis`) */}
 <div className="mt-4 flex items-center gap-3 rounded-[20px] bg-white px-3.5 py-2.5 shadow-[0_2px_10px_rgba(43,35,80,0.06)]" role="status" aria-live="polite">
 <Mascot state={cloneResult ? "celebrate" : audioBlob && !isRecording ? "happy" : "listen"} size={64} priority label={null} />
 <div>
 <b className="block text-[16px] font-bold">{listenTitle}</b>
 <small className="text-[13.5px] text-ink-2">
 {cloneResult ? `Giọng "${cloneResult.name}" đã sẵn sàng kể cho bé` : "Đọc tự nhiên như kể cho bé nghe nhé"}
 </small>
 </div>
 </div>

 {/* Script picker */}
 <div className="-mx-5 mt-3 flex gap-1.5 overflow-x-auto px-5 pb-1 no-scrollbar" role="tablist" aria-label="Đoạn đọc mẫu">
 {SAMPLE_SCRIPTS.map((x) => (
 <button
 key={x.id}
 type="button"
 role="tab"
 aria-selected={selectedScript === x.id}
 onClick={() => setSelectedScript(x.id)}
 disabled={isRecording}
 className={`min-h-[40px] whitespace-nowrap rounded-xl border px-3 text-[13px] font-semibold transition-colors ${
 selectedScript === x.id ? "border-brand bg-brand-soft text-brand" : "border-[#E7E3F2] bg-white text-ink-2"
 }`}
 >
 {x.label}
 </button>
 ))}
 </div>

 {/* Script (board `.script`) */}
 <div className="mt-2.5 rounded-[20px] bg-white p-4 shadow-[0_2px_10px_rgba(43,35,80,0.06)]">
 <small className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2">
 Đoạn {scriptIdx + 1}/{SAMPLE_SCRIPTS.length} · Đọc to
 </small>
 <p className="mt-2 text-[18px] leading-[1.6] text-[#9C96B5]">
 {sentences.map((sen, i) =>
 i === readingIdx ? (
 <b key={i} className="rounded-md bg-glow-soft px-[3px] font-semibold text-ink">
 {sen}
 </b>
 ) : (
 <span key={i}>{sen}</span>
 ),
 )}
 </p>
 </div>

 {/* Waveform + timer (board `.wave`, `.timer`) */}
 <div className="mt-5 flex h-[70px] items-center justify-center gap-1" aria-hidden>
 {WAVE.map((h, i) => (
 <i
 key={i}
 className={`block w-[5px] rounded-[3px] ${i < litBars || isRecording ? "bg-brand" : "bg-[#D9D3EE]"} ${isRecording ? "kid-wave" : ""}`}
 style={{ height: h, animationDelay: `${(i % 7) * 0.09}s` }}
 />
 ))}
 </div>
 <p className="mt-1.5 text-center text-[28px] font-bold tabular-nums">
 {formatTime(elapsed)} <small className="text-[16px] font-medium text-ink-2">/ 3:00</small>
 </p>

 {/* Record ring (board `.rec`) */}
 {!cloneResult && (
 <button
 type="button"
 onClick={handleToggleRecording}
 disabled={isCloning}
 aria-label={isRecording ? "Dừng ghi âm" : audioBlob ? "Ghi lại" : "Bắt đầu ghi âm"}
 aria-pressed={isRecording}
 className="mx-auto mt-4 flex h-28 w-28 items-center justify-center rounded-full active:scale-95 disabled:opacity-50"
 style={{ background: `conic-gradient(var(--color-cta) 0 ${Math.max(progress, isRecording ? 2 : 0)}%, #F0E2DB ${Math.max(progress, isRecording ? 2 : 0)}% 100%)` }}
 >
 <span className="flex h-[92px] w-[92px] items-center justify-center rounded-full bg-white">
 {isRecording ? <i className="block h-[38px] w-[38px] rounded-[10px] bg-cta" /> : <Mic size={40} weight="fill" className="text-cta" />}
 </span>
 </button>
 )}
 {!cloneResult && !audioBlob && (
 <p className="mt-2 text-center text-[13px] font-medium text-ink-2">{isRecording ? "Chạm để dừng" : "Chạm để bắt đầu ghi âm"}</p>
 )}

 {/* Tips (board `.tips`) */}
 <div className="mt-[18px] flex flex-wrap justify-center gap-1.5">
 {[
 { icon: SpeakerSlash, label: "Phòng yên tĩnh" },
 { icon: Ruler, label: "Cách mic 20 cm" },
 { icon: Hourglass, label: "Đọc chậm" },
 ].map(({ icon: Icon, label }) => (
 <span key={label} className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-[#E7E3F2] bg-white px-2.5 py-[7px] text-[12.5px] font-semibold">
 <Icon size={16} className="text-brand" /> {label}
 </span>
 ))}
 </div>

 {/* Recording playback */}
 {audioBlob && !cloneResult && (
 <button
 type="button"
 onClick={toggleRecordingPlayback}
 className="mx-auto mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-brand-soft px-4 text-[14px] font-semibold text-brand active:scale-95"
 >
 {isRecordingPlaying ? <Square size={14} weight="fill" /> : <Play size={14} weight="fill" />}
 {isRecordingPlaying ? "Dừng phát" : "Nghe lại bản ghi"}
 </button>
 )}

 {/* Clone Section */}
 {audioBlob && !cloneResult && (
 <div className="w-full mt-5 space-y-3">
 <input
 type="text"
 value={voiceName}
 onChange={(e) => setVoiceName(e.target.value)}
 placeholder="Tên giọng nói (VD: Mẹ Lan)"
 className="w-full px-4 py-3.5 rounded-xl border-[1.5px] border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-[15px] font-semibold text-txt dark:text-white outline-none focus:border-accent transition-colors"
 />
 <div className="grid grid-cols-2 gap-2.5">
 {(["female", "male"] as const).map((gOpt) => (
 <button
 key={gOpt}
 onClick={() => setGender(gOpt)}
 className={`py-3 rounded-xl text-[14px] font-bold border-[1.5px] transition-colors ${
 gender === gOpt
 ? "border-accent bg-accent/10 text-accent"
 : "border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-txt-secondary dark:text-white/50"
 }`}
 >
 {gOpt === "female" ? "Giọng Nữ" : "Giọng Nam"}
 </button>
 ))}
 </div>
 {/* Language selector for voice clone */}
 <div>
 <label className="text-[12px] font-bold text-txt-secondary dark:text-white/50 mb-1.5 block">
 Ngôn ngữ giọng nói
 </label>
 <div className="grid grid-cols-3 gap-2">
 {([
 { id: "vi", label: "🇻🇳 Tiếng Việt" },
 { id: "en", label: "🇺🇸 English" },
 { id: "ja", label: "🇯🇵 日本語" },
 ] as const).map((lang) => (
 <button
 key={lang.id}
 onClick={() => setVoiceLang(lang.id)}
 className={`py-2.5 rounded-xl text-[12px] font-bold border-[1.5px] transition-colors ${
 voiceLang === lang.id
 ? "border-accent bg-accent/10 text-accent"
 : "border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-txt-secondary dark:text-white/50"
 }`}
 >
 {lang.label}
 </button>
 ))}
 </div>
 </div>
 <button
 onClick={handleClone}
 disabled={isCloning || !voiceName.trim()}
 className="w-full py-[16px] rounded-[14px] bg-gradient-to-r from-accent-2 to-accent text-white font-bold text-[15px] flex items-center justify-center gap-2 shadow-lg shadow-accent-2/30 disabled:opacity-50 active:scale-[0.98] transition-transform"
 >
 {isCloning ? (
 <>
 <Loader2 size={18} className="animate-spin" />
 Đang clone giọng...
 </>
 ) : (
 <>
 <Mic size={18} />
 {hasElevenKey ? "Clone Giọng Nói (ElevenLabs)" : "Cấu Hình ElevenLabs"}
 </>
 )}
 </button>
 </div>
 )}

 {/* Success */}
 {cloneResult && (
 <div className="w-full mt-4 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-center">
 <Check size={32} className="text-emerald-500 mx-auto mb-2" />
 <p className="text-[15px] font-bold text-emerald-800">
 Voice ID: {cloneResult.voice_id.slice(0, 12)}...
 </p>
 <p className="text-[12px] text-emerald-600 mt-1">
 Giọng nói đã sẵn sàng để kể chuyện
 </p>
 <div className="flex items-center justify-center gap-2 mt-3">
 <button
 onClick={playVoicePreview}
 disabled={isLoadingPreview}
 className="px-5 py-2.5 rounded-xl bg-violet-500 text-white text-sm font-bold active:scale-95 transition-transform disabled:opacity-50 inline-flex items-center gap-1.5"
 >
 {isLoadingPreview ? (
 <Loader2 size={14} className="animate-spin" />
 ) : isPreviewPlaying ? (
 <Square size={14} />
 ) : (
 <Volume2 size={14} />
 )}
 {isPreviewPlaying ? "Dừng" : "Nghe thử giọng"}
 </button>
 <button
 onClick={onBack}
 className="px-5 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-bold active:scale-95 transition-transform"
 >
 Hoàn Tất
 </button>
 </div>
 </div>
 )}

 {/* Error */}
 {error && (
 <div className="w-full mt-4 p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2">
 <AlertCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
 <p className="text-[13px] text-red-700">{error}</p>
 </div>
 )}

 {/* Privacy (board `.priv`) */}
 <p className="mx-1 mt-[18px] flex gap-2 text-[13px] leading-normal text-ink-2">
 <LockKey size={18} weight="fill" className="shrink-0 text-success" />
 Giọng nói chỉ dùng trong gia đình bạn và có thể xoá bất cứ lúc nào.
 </p>
 </div>
 );
}

/** Bar heights from the concept board waveform. */
const WAVE = [14, 22, 36, 50, 30, 58, 44, 64, 40, 28, 52, 60, 34, 20, 46, 56, 30, 18, 40, 26, 12, 8, 6, 6, 6, 6];
