"use client";

/**
 * T12 · Step 1 of "Ghi giọng bố mẹ": the contributor reads the consent sentence aloud,
 * with their name, before any voice sample is recorded. The recording is stored
 * privately with the text version / hash (POST /api/voice/consent); a parent confirms
 * with the PIN (or the adult question when no PIN is set). Only then can a voice be
 * cloned, and only once per consent.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getParentProof } from "@/lib/parent-proof";
import {
  CONSENT_MAX_MS,
  CONSENT_MIN_MS,
  SPEAKER_NAME_MAX,
  consentSentence,
  fetchVoiceConsentDocument,
  normalizeSpeakerName,
  speakerNameValid,
  submitVoiceConsent,
  type SavedVoiceConsent,
  type VoiceConsentDocument,
} from "@/lib/voice-consent";
import ParentGate from "@/components/parent/ParentGate";
import PolicyText from "@/components/parent/PolicyText";
import { CARD_SHADOW } from "@/components/ui/kit";
import { ChevronDown, Loader2, Mic, Play, ShieldCheck, Square } from "@/components/ui/icons";

const MIME_CHOICES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return MIME_CHOICES.find((m) => MediaRecorder.isTypeSupported(m));
}

const seconds = (ms: number) => `0:${String(Math.min(59, Math.floor(ms / 1000))).padStart(2, "0")}`;

interface Take {
  blob: Blob;
  durationMs: number;
  url: string;
}

export default function VoiceConsentStep({ onConsented }: { onConsented: (consent: SavedVoiceConsent) => void }) {
  const [doc, setDoc] = useState<VoiceConsentDocument | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showFull, setShowFull] = useState(false);
  const [speaker, setSpeaker] = useState("");
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState<"form" | "pin" | "saving">("form");
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const takeUrlRef = useRef<string | null>(null);

  const [docAttempt, setDocAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchVoiceConsentDocument(createClient(), "vi").then(
      (d) => {
        if (!alive) return;
        setDoc(d);
        setLoadError(null);
      },
      (e: unknown) => alive && setLoadError(e instanceof Error ? e.message : "Chưa tải được văn bản đồng ý giọng nói."),
    );
    return () => {
      alive = false;
    };
  }, [docAttempt]);
  const loadDocument = useCallback(() => {
    setLoadError(null);
    setDocAttempt((n) => n + 1);
  }, []);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };
  const clearTick = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  };
  const dropTake = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(false);
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    takeUrlRef.current = null;
    setTake(null);
  }, []);

  useEffect(
    () => () => {
      clearTick();
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        rec.onstop = null;
        rec.stop();
      }
      stopTracks();
      audioRef.current?.pause();
      if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    },
    [],
  );

  const stop = useCallback(() => {
    clearTick();
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    setRecording(false);
  }, []);

  async function start() {
    setError(null);
    dropTake();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Không thể truy cập microphone. Vui lòng cho phép quyền mic.");
      return;
    }
    const mime = pickMime();
    let rec: MediaRecorder;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setError("Trình duyệt này chưa ghi âm được. Thử Chrome hoặc Safari mới nhất nhé.");
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const durationMs = Math.round(performance.now() - startedAtRef.current);
      stopTracks();
      recorderRef.current = null;
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || mime || "audio/webm" });
      chunksRef.current = [];
      if (durationMs < CONSENT_MIN_MS || blob.size === 0) {
        setError("Bản ghi quá ngắn — người góp giọng đọc trọn câu đồng ý nhé (ít nhất 3 giây).");
        return;
      }
      const url = URL.createObjectURL(blob);
      takeUrlRef.current = url;
      setTake({ blob, durationMs: Math.min(durationMs, CONSENT_MAX_MS), url });
    };
    recorderRef.current = rec;
    startedAtRef.current = performance.now();
    rec.start(500);
    setElapsedMs(0);
    setRecording(true);
    tickRef.current = setInterval(() => {
      const ms = performance.now() - startedAtRef.current;
      setElapsedMs(ms);
      if (ms >= CONSENT_MAX_MS) stop();
    }, 200);
  }

  function togglePlayback() {
    if (!take) return;
    if (playing && audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
      return;
    }
    const audio = new Audio(take.url);
    audioRef.current = audio;
    audio.onended = () => setPlaying(false);
    setPlaying(true);
    audio.play().catch(() => setPlaying(false));
  }

  // A parent confirms every consent: the PIN (or, without a PIN, the adult question) unless the
  // parent area was unlocked with the PIN a moment ago (the proof is still valid).
  function confirmAndSave() {
    if (!doc || !take || !speakerNameValid(speaker)) return;
    audioRef.current?.pause();
    setPlaying(false);
    if (getParentProof()) void save();
    else setStep("pin");
  }

  async function save() {
    if (!doc || !take || !speakerNameValid(speaker)) return;
    audioRef.current?.pause();
    setPlaying(false);
    setStep("saving");
    setError(null);
    const result = await submitVoiceConsent({
      document: doc,
      speakerName: speaker,
      audio: take.blob,
      durationMs: take.durationMs,
      proof: getParentProof(),
    });
    if (result.ok) {
      onConsented(result);
      return;
    }
    if (result.reason === "parent_proof_required") {
      setStep("pin");
      return;
    }
    if (result.reason === "stale") {
      dropTake();
      setDoc(null);
      loadDocument();
    }
    setError(result.message);
    setStep("form");
  }

  const name = normalizeSpeakerName(speaker);
  const nameOk = speakerNameValid(speaker);
  const busy = step === "saving";

  return (
    <>
      {step === "pin" && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-cream">
          <ParentGate
            title="Bố mẹ xác nhận lời đồng ý"
            bubble="Bố mẹ xác nhận để lưu lời đồng ý giọng nói nhé."
            cancelLabel="Quay lại"
            onCancel={() => setStep("form")}
            onUnlock={save}
            onPinReset={save}
          />
        </div>
      )}
      <section className={`mt-4 rounded-[20px] bg-white p-4 dark:bg-white/[0.05] ${CARD_SHADOW}`} aria-labelledby="voice-consent-title" data-testid="voice-consent-step">
        <p className="text-[12.5px] font-semibold uppercase tracking-[0.06em] text-ink-2">Bước 1/2 · Lời đồng ý</p>
        {!doc && !loadError && (
          <div className="flex h-24 items-center justify-center" role="status" aria-label="Đang tải văn bản đồng ý">
            <Loader2 size={24} className="animate-spin text-brand-ink" />
          </div>
        )}
        {loadError && (
          <div role="alert" className="mt-3 rounded-2xl bg-[#FDE8E3] px-3 py-2 text-[13.5px] font-semibold text-cta-ink">
            {loadError}{" "}
            <button type="button" onClick={loadDocument} className="underline">
              Thử lại
            </button>
          </div>
        )}
        {doc && (
          <>
            <h2 id="voice-consent-title" className="mt-1 text-[17px] font-bold leading-snug text-ink dark:text-white">
              {doc.title}
            </h2>
            <p className="mt-0.5 text-[13px] font-medium text-ink-2 dark:text-white/50">Bản {doc.version}</p>
            <PolicyText text={doc.summary} className="mt-2" />
            <button
              type="button"
              aria-expanded={showFull}
              aria-controls="voice-consent-full"
              onClick={() => setShowFull((v) => !v)}
              className="mt-3 flex min-h-11 w-full items-center justify-between rounded-2xl bg-parent-bg px-4 text-left text-[14.5px] font-semibold text-brand-ink dark:bg-white/[0.06]"
            >
              {showFull ? "Thu gọn toàn văn" : "Đọc toàn văn lời đồng ý"}
              <ChevronDown size={18} className={showFull ? "rotate-180 transition-transform" : "transition-transform"} />
            </button>
            {showFull && (
              <div id="voice-consent-full" className="mt-3">
                <PolicyText text={doc.body} />
              </div>
            )}

            <label htmlFor="voice-consent-speaker" className="mt-4 block text-[14px] font-semibold text-ink dark:text-white">
              Tên người góp giọng
            </label>
            <input
              id="voice-consent-speaker"
              type="text"
              value={speaker}
              maxLength={SPEAKER_NAME_MAX}
              onChange={(e) => setSpeaker(e.target.value)}
              disabled={recording || busy}
              placeholder="VD: Bà Lan"
              autoComplete="off"
              className="mt-1.5 w-full rounded-xl border-[1.5px] border-[#E7E3F2] bg-white px-4 py-3 text-[15px] font-semibold text-ink outline-none focus:border-brand dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
            />

            <div className="mt-4 rounded-2xl bg-glow-soft px-4 py-3" aria-live="polite">
              <p className="text-[13px] font-semibold text-[#7A4A00] dark:text-[#FFD98A]">Người góp giọng tự đọc to câu này:</p>
              <p className="mt-1.5 text-[17px] font-semibold leading-relaxed text-ink dark:text-white" data-testid="voice-consent-sentence">
                “{consentSentence(doc.spoken_text, name)}”
              </p>
            </div>
            <p className="mt-2 text-[13px] leading-normal text-ink-2 dark:text-white/60">
              Nếu người góp giọng không đồng ý, đừng ghi âm. Bản ghi câu này được lưu riêng tư làm bằng chứng; bố mẹ nghe lại hoặc rút đồng ý trong Cài đặt › Đồng ý giọng nói.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={recording ? stop : start}
                disabled={!nameOk || busy}
                aria-pressed={recording}
                className={`inline-flex min-h-12 items-center gap-2 rounded-2xl px-4 text-[15px] font-bold text-white disabled:opacity-50 bg-cta-press`}
              >
                {recording ? <Square size={16} weight="fill" /> : <Mic size={18} weight="fill" />}
                {recording ? "Dừng ghi" : take ? "Ghi lại câu đồng ý" : "Ghi câu đồng ý"}
              </button>
              {recording && (
                <span className="text-[15px] font-bold tabular-nums text-ink dark:text-white" role="timer">
                  {seconds(elapsedMs)} <small className="font-medium text-ink-2">/ 0:30</small>
                </span>
              )}
              {take && !recording && (
                <button
                  type="button"
                  onClick={togglePlayback}
                  disabled={busy}
                  className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-brand-soft px-4 text-[14.5px] font-semibold text-brand-ink"
                >
                  {playing ? <Square size={14} weight="fill" /> : <Play size={14} weight="fill" />}
                  {playing ? "Dừng phát" : `Nghe lại (${seconds(take.durationMs)})`}
                </button>
              )}
            </div>
            {!nameOk && !recording && (
              <p className="mt-2 text-[12.5px] font-medium text-ink-2">Nhập tên người góp giọng trước khi ghi.</p>
            )}

            {error && (
              <p role="alert" className="mt-3 rounded-2xl bg-[#FDE8E3] px-3 py-2 text-[13.5px] font-semibold text-cta-ink">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={confirmAndSave}
              disabled={!take || !nameOk || recording || busy}
              className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand px-4 text-[15px] font-bold text-white disabled:opacity-50"
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} weight="fill" />}
              {busy ? "Đang lưu lời đồng ý…" : "Bố mẹ xác nhận & lưu lời đồng ý"}
            </button>
          </>
        )}
      </section>
    </>
  );
}
