"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Mic, Pause, Loader2, Check, AlertCircle, Settings } from "lucide-react";
import TopBar from "@/components/ui/TopBar";
import { useSettings } from "@/lib/settings-context";
import { cloneVoice } from "@/lib/elevenlabs";
import type { Screen } from "@/lib/types";

interface VoiceRecordingProps {
  onBack: () => void;
  onNavigate?: (screen: Screen) => void;
}

export default function VoiceRecording({ onBack, onNavigate }: VoiceRecordingProps) {
  const { settings } = useSettings();
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [voiceName, setVoiceName] = useState("");
  const [isCloning, setIsCloning] = useState(false);
  const [cloneResult, setCloneResult] = useState<{ voice_id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const hasElevenKey = Boolean(settings.elevenLabsApiKey);

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
      const result = await cloneVoice(
        settings.elevenLabsApiKey,
        voiceName.trim(),
        audioBlob
      );
      setCloneResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clone thất bại");
    } finally {
      setIsCloning(false);
    }
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const progress = (elapsed / 180) * 100;

  return (
    <div className="min-h-screen bg-white flex flex-col">
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
        <p className="text-sm text-txt-secondary text-center leading-relaxed mb-5">
          {cloneResult
            ? `Giọng "${cloneResult.name}" đã được tạo trên ElevenLabs`
            : "AI sẽ học giọng bạn từ đoạn ghi âm này. Đọc to, rõ ràng, tự nhiên."}
        </p>

        {/* Script Card */}
        <div className="w-full bg-surface rounded-2xl p-[18px] border border-gray-200 mb-5">
          <div className="text-[11px] font-bold tracking-widest uppercase text-accent-2 mb-2">
            Đoạn đọc mẫu
          </div>
          <p className="text-[15px] leading-relaxed italic text-txt">
            &ldquo;Ngày xưa, ở một ngôi làng nhỏ bên dòng sông, có một em bé
            rất thông minh. Em yêu thích những câu chuyện cổ tích mà bà
            thường kể mỗi đêm trước khi đi ngủ.&rdquo;
          </p>
        </div>

        {/* Progress */}
        <div className="w-full mb-1">
          <div className="w-full h-1 bg-gray-200 rounded-full">
            <div
              className="h-full bg-gradient-to-r from-accent-2 to-accent rounded-full transition-all duration-1000"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between text-xs font-semibold text-txt-secondary mt-2">
            <span>{formatTime(elapsed)}</span>
            <span>3:00</span>
          </div>
        </div>

        {/* Record Button */}
        {!cloneResult && (
          <button
            onClick={handleToggleRecording}
            disabled={isCloning}
            className="w-[72px] h-[72px] rounded-full border-4 border-gray-200 flex items-center justify-center text-white mt-4 active:scale-95 transition-transform disabled:opacity-50"
            style={{
              background: isRecording ? "#EF4444" : "#EF4444",
              boxShadow: "0 6px 20px -4px rgba(239,68,68,0.35)",
            }}
          >
            {isRecording ? <Pause size={24} /> : <Mic size={24} />}
          </button>
        )}
        {!cloneResult && !audioBlob && (
          <p className="text-xs text-txt-secondary mt-2 font-medium">
            {isRecording ? "Nhấn để dừng" : "Nhấn để bắt đầu ghi âm"}
          </p>
        )}

        {/* Clone Section */}
        {audioBlob && !cloneResult && (
          <div className="w-full mt-5 space-y-3">
            <input
              type="text"
              value={voiceName}
              onChange={(e) => setVoiceName(e.target.value)}
              placeholder="Tên giọng nói (VD: Mẹ Lan)"
              className="w-full px-4 py-3.5 rounded-xl border-[1.5px] border-gray-200 bg-surface text-[15px] font-semibold text-txt outline-none focus:border-accent transition-colors"
            />
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
            <button
              onClick={onBack}
              className="mt-3 px-6 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-bold active:scale-95 transition-transform"
            >
              Hoàn Tất
            </button>
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
