"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Mic, Pause, Loader2, Check, AlertCircle, Settings, Play, Square, Volume2 } from "lucide-react";
import TopBar from "@/components/ui/TopBar";
import { useSettings } from "@/lib/settings-context";
import { useData } from "@/lib/data-context";
import { cloneVoiceApi } from "@/lib/api-client";
import { uploadRecording, createVoiceProfile } from "@/lib/db";
import type { Screen } from "@/lib/types";

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

  return (
    <div className="min-h-screen bg-white dark:bg-white/[0.04] flex flex-col">
      <TopBar title="Ghi Âm Giọng Nói" onBack={onBack} />

      <div className="flex-1 flex flex-col items-center px-7 pt-6 pb-10">
        {/* API warning */}
        {!hasElevenKey && (
          <button
            onClick={() => onNavigate?.("settings")}
            className="w-full mb-4 p-3 rounded-2xl bg-amber-50 border border-amber-200 flex items-center gap-2.5 active:scale-[0.98] transition-transform"
          >
            <AlertCircle size={16} className="text-amber-500 shrink-0" />
            <p className="flex-1 text-left text-[12px] font-bold text-amber-800">
              Thêm ElevenLabs API key để clone giọng
            </p>
            <Settings size={14} className="text-amber-500" />
          </button>
        )}

        {/* Mic Ring */}
        <div className="w-40 h-40 rounded-full bg-gradient-to-br from-accent-2/10 to-accent/10 flex items-center justify-center relative mb-6">
          {isRecording && (
            <>
              <div
                className="absolute inset-[-8px] rounded-full border-2 border-accent-2/15"
                style={{ animation: "pulse-ring 2s ease-in-out infinite" }}
              />
              <div
                className="absolute inset-[-20px] rounded-full border-2 border-accent-2/8"
                style={{ animation: "pulse-ring 2s ease-in-out infinite 0.5s" }}
              />
            </>
          )}
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-accent-2 to-accent flex items-center justify-center text-white shadow-lg shadow-accent-2/35">
            <Mic size={36} />
          </div>
        </div>

        <h2 className="text-[22px] font-extrabold tracking-tight mb-1.5 text-center">
          {cloneResult
            ? "Clone thành công!"
            : isRecording
            ? "Đang ghi âm..."
            : audioBlob
            ? "Ghi âm hoàn tất"
            : "Đọc đoạn văn sau"}
        </h2>
        <p className="text-sm text-txt-secondary dark:text-white/50 text-center leading-relaxed mb-5">
          {cloneResult
            ? `Giọng "${cloneResult.name}" đã được tạo trên ElevenLabs`
            : "AI sẽ học giọng bạn từ đoạn ghi âm này. Đọc to, rõ ràng, tự nhiên."}
        </p>

        {/* Script Selector */}
        <div className="w-full mb-2">
          <div className="text-[11px] font-bold tracking-widest uppercase text-accent-2 mb-2">
            Chọn đoạn đọc mẫu
          </div>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
            {SAMPLE_SCRIPTS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedScript(s.id)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap border transition-all ${
                  selectedScript === s.id
                    ? "border-accent bg-orange-50 text-accent"
                    : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-txt-secondary dark:text-white/50"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Script Card */}
        <div className="w-full bg-surface dark:bg-white/[0.04] rounded-2xl p-[18px] border border-gray-200 dark:border-white/10 mb-5">
          <p className="text-[15px] leading-relaxed italic text-txt dark:text-white">
            &ldquo;{SAMPLE_SCRIPTS.find((s) => s.id === selectedScript)?.text}&rdquo;
          </p>
        </div>

        {/* Progress */}
        <div className="w-full mb-1">
          <div className="w-full h-1 bg-gray-200 dark:bg-white/[0.08] rounded-full">
            <div
              className="h-full bg-gradient-to-r from-accent-2 to-accent rounded-full transition-all duration-1000"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between text-xs font-semibold text-txt-secondary dark:text-white/50 mt-2">
            <span>{formatTime(elapsed)}</span>
            <span>3:00</span>
          </div>
        </div>

        {/* Record Button */}
        {!cloneResult && (
          <button
            onClick={handleToggleRecording}
            disabled={isCloning}
            className="w-[72px] h-[72px] rounded-full border-4 border-gray-200 dark:border-white/10 flex items-center justify-center text-white mt-4 active:scale-95 transition-transform disabled:opacity-50"
            style={{
              background: isRecording ? "#EF4444" : "#EF4444",
              boxShadow: "0 6px 20px -4px rgba(239,68,68,0.35)",
            }}
          >
            {isRecording ? <Pause size={24} /> : <Mic size={24} />}
          </button>
        )}
        {!cloneResult && !audioBlob && (
          <p className="text-xs text-txt-secondary dark:text-white/50 mt-2 font-medium">
            {isRecording ? "Nhấn để dừng" : "Nhấn để bắt đầu ghi âm"}
          </p>
        )}

        {/* Recording playback */}
        {audioBlob && !cloneResult && (
          <button
            onClick={toggleRecordingPlayback}
            className="mt-3 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 text-[13px] font-bold active:scale-95 transition-transform"
          >
            {isRecordingPlaying ? <Square size={14} /> : <Play size={14} />}
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
      </div>
    </div>
  );
}
