"use client";

/**
 * FeedbackProvider (UI v2, ticket UI-11): tap sounds, light haptics and Đóm's
 * spoken lines, all switchable in tab "Bố mẹ" and silent in Chế độ ngủ.
 *
 * - Every button/link gets a soft tap + 8 ms vibration via one delegated click
 *   listener. Override per element/subtree with `data-sfx="pop|page|success|…"`,
 *   or `data-sfx="off"` to opt out.
 * - `cue("success")` for moments without a click (KidSuccess, toasts…).
 * - `say("story-end")` shows Đóm's bubble and reads the line aloud with the
 *   device's Vietnamese voice (none installed → bubble only).
 * - `data-say="Cổ tích"` on an icon button: read aloud on tap when the age
 *   band asks for spoken labels (UI-13, `html[data-say-labels]`).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Mascot from "@/components/ui/Mascot";
import { useTheme } from "@/lib/theme-context";
import { useAudioPlayer } from "@/lib/audio-player-context";
import { DOM_LINES, wordCount, type DomLine, type DomMoment } from "@/lib/dom-lines";
import {
  DEFAULT_FEEDBACK_PREFS,
  FEEDBACK_STORAGE_KEY,
  HAPTICS,
  MASTER_VOLUME,
  TAP_TARGET_SELECTOR,
  cueFromAttr,
  feedbackChannels,
  parseFeedbackPrefs,
  pickVietnameseVoice,
  scheduleCue,
  serializeFeedbackPrefs,
  type AudioContextLike,
  type FeedbackChannels,
  type FeedbackCue,
  type FeedbackPrefs,
} from "@/lib/feedback";

export interface SayOptions {
  /** Show Đóm's floating bubble (default true). Use false where the line is already on screen. */
  bubble?: boolean;
  /** Never read aloud this time (e.g. a story is narrating). */
  quiet?: boolean;
}

interface FeedbackContextValue {
  prefs: FeedbackPrefs;
  setPrefs: (partial: Partial<FeedbackPrefs>) => void;
  /** What may fire right now (prefs × bedtime × media). */
  channels: FeedbackChannels;
  /** Sound/voice are muted only because Chế độ ngủ is on. */
  silencedByBedtime: boolean;
  supportsHaptics: boolean;
  /** Device has a Vietnamese text-to-speech voice. */
  hasVoice: boolean;
  cue: (cue: FeedbackCue) => void;
  say: (moment: DomMoment, opts?: SayOptions) => DomLine;
}

const noop = () => {};
const FeedbackContext = createContext<FeedbackContextValue>({
  prefs: DEFAULT_FEEDBACK_PREFS,
  setPrefs: noop,
  channels: { sound: false, haptics: false, voice: false },
  silencedByBedtime: false,
  supportsHaptics: false,
  hasVoice: false,
  cue: noop,
  say: (moment) => DOM_LINES[moment],
});

export function useFeedback() {
  return useContext(FeedbackContext);
}

/**
 * Fire feedback once when a component appears (success/error states, locks):
 * an optional cue plus an optional Đóm line (`bubble: false` → voice only,
 * for screens that already show the line).
 */
export function useFeedbackOnMount(
  cue: FeedbackCue | null,
  opts: { say?: DomMoment; bubble?: boolean; enabled?: boolean } = {},
) {
  const { cue: fire, say } = useFeedback();
  const ref = useRef({ fire, say });
  useEffect(() => {
    ref.current = { fire, say };
  }, [fire, say]);
  const { say: moment, bubble, enabled = true } = opts;
  useEffect(() => {
    if (!enabled) return;
    if (cue) ref.current.fire(cue);
    if (moment) ref.current.say(moment, { bubble });
  }, [cue, moment, bubble, enabled]);
}

/* ── Prefs store (localStorage, synced across tabs) ── */
const prefListeners = new Set<() => void>();
function subscribePrefs(cb: () => void) {
  prefListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === FEEDBACK_STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    prefListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}
let cachedRaw: string | null | undefined;
let cachedPrefs: FeedbackPrefs = DEFAULT_FEEDBACK_PREFS;
function getPrefs(): FeedbackPrefs {
  const raw = localStorage.getItem(FEEDBACK_STORAGE_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedPrefs = parseFeedbackPrefs(raw);
  }
  return cachedPrefs;
}
const getServerPrefs = () => DEFAULT_FEEDBACK_PREFS;

type AudioCtor = new () => AudioContext;
function audioCtor(): AudioCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/* ── Device capabilities (client only; SSR → false) ── */
const getFalse = () => false;
const subscribeNothing = () => () => {};
const getSupportsHaptics = () => typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
const getSynth = () => (typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null);
function subscribeVoices(cb: () => void) {
  const s = getSynth();
  s?.addEventListener?.("voiceschanged", cb);
  return () => s?.removeEventListener?.("voiceschanged", cb);
}
const getHasVoice = () => {
  const s = getSynth();
  return s ? pickVietnameseVoice(s.getVoices()) !== null : false;
};

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs, getServerPrefs);
  const { isBedtime, isNight } = useTheme();
  const sleepy = isBedtime || isNight;
  const { isPlaying } = useAudioPlayer();
  const channels = useMemo(
    () => feedbackChannels(prefs, { bedtime: isBedtime, mediaPlaying: isPlaying }),
    [prefs, isBedtime, isPlaying],
  );
  const channelsRef = useRef(channels);
  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  const supportsHaptics = useSyncExternalStore(subscribeNothing, getSupportsHaptics, getFalse);
  const hasVoice = useSyncExternalStore(subscribeVoices, getHasVoice, getFalse);
  const [speech, setSpeech] = useState<{ line: DomLine; id: number } | null>(null);
  const ctxRef = useRef<{ ctx: AudioContext; out: GainNode } | null>(null);

  const setPrefs = useCallback((partial: Partial<FeedbackPrefs>) => {
    localStorage.setItem(FEEDBACK_STORAGE_KEY, serializeFeedbackPrefs({ ...getPrefs(), ...partial }));
    prefListeners.forEach((cb) => cb());
  }, []);

  const playSound = useCallback((cue: FeedbackCue) => {
    const Ctor = audioCtor();
    if (!Ctor) return;
    try {
      if (!ctxRef.current) {
        const ctx = new Ctor();
        const out = ctx.createGain();
        out.gain.value = 1;
        out.connect(ctx.destination);
        ctxRef.current = { ctx, out };
      }
      const { ctx, out } = ctxRef.current;
      if (ctx.state === "suspended") void ctx.resume().catch(noop);
      scheduleCue(ctx as unknown as AudioContextLike, out, cue, MASTER_VOLUME);
    } catch {
      /* audio unavailable (autoplay policy, old WebView) — feedback is best-effort */
    }
  }, []);

  const cue = useCallback(
    (c: FeedbackCue) => {
      if (hidden()) return;
      const ch = channelsRef.current;
      if (ch.sound) playSound(c);
      if (ch.haptics && typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        try {
          navigator.vibrate(HAPTICS[c] as number | number[]);
        } catch {
          /* ignore */
        }
      }
    },
    [playSound],
  );

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const voice = pickVietnameseVoice(synth.getVoices());
    if (!voice) return; // never read Vietnamese with a foreign voice
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = voice.lang;
      try {
        u.voice = voice;
      } catch {
        /* some engines only accept their own voice objects */
      }
      u.rate = 0.95;
      u.pitch = 1.2;
      u.volume = 0.9;
      synth.speak(u);
    } catch {
      /* ignore */
    }
  }, []);

  const say = useCallback(
    (moment: DomMoment, opts: SayOptions = {}) => {
      const line = DOM_LINES[moment];
      if (opts.bubble !== false) setSpeech({ line, id: Date.now() });
      if (line.speak && !opts.quiet && channelsRef.current.voice && !hidden()) speak(line.text);
      return line;
    },
    [speak],
  );

  /* Stop talking as soon as voice is no longer allowed (bedtime, toggle off, story starts). */
  useEffect(() => {
    if (!channels.voice && typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
  }, [channels.voice]);

  /* Default tap feedback for every interactive element (one listener for the whole app). */
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const el = target?.closest(TAP_TARGET_SELECTOR);
      if (!el || el.matches(":disabled") || el.getAttribute("aria-disabled") === "true") return;
      const c = cueFromAttr(el.closest("[data-sfx]")?.getAttribute("data-sfx"));
      if (c) cue(c);
      // UI-13: for pre-readers (3–5) Đóm reads the tapped icon's name.
      const label = el.getAttribute("data-say");
      if (label && document.documentElement.dataset.sayLabels === "1" && channelsRef.current.voice && !hidden()) speak(label);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [cue, speak]);

  /* Bubble auto-hides after a reading-friendly delay. */
  useEffect(() => {
    if (!speech) return;
    const ms = Math.max(3500, wordCount(speech.line.text) * 450);
    const t = setTimeout(() => setSpeech(null), ms);
    return () => clearTimeout(t);
  }, [speech]);

  const value = useMemo<FeedbackContextValue>(
    () => ({
      prefs,
      setPrefs,
      channels,
      silencedByBedtime: isBedtime && (prefs.sound || prefs.voice),
      supportsHaptics,
      hasVoice,
      cue,
      say,
    }),
    [prefs, setPrefs, channels, isBedtime, supportsHaptics, hasVoice, cue, say],
  );

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 top-0 z-[80] mx-auto flex max-w-[430px] justify-center px-3 pt-[max(env(safe-area-inset-top),12px)]">
        {speech && (
          <button
            key={speech.id}
            type="button"
            data-sfx="off"
            data-testid="dom-speech"
            onClick={() => setSpeech(null)}
            aria-label={`Đóm nói: ${speech.line.text}. Chạm để đóng`}
            className="dom-speech-in pointer-events-auto flex w-full items-end gap-1.5 text-left"
          >
            <Mascot state={speech.line.mascot} size={64} label={null} still glow={!sleepy} className="-mb-1 flex-none" />
            {/* Bedtime: dimmed night card — never a bright white bubble on sleep surfaces. */}
            <span
              data-tone={sleepy ? "night" : "day"}
              className={`mb-2 flex-1 rounded-[22px] px-[18px] py-3 font-display text-[17px] font-bold leading-snug ${
                sleepy
                  ? "border border-moon/[0.12] bg-night-card text-moon shadow-[0_6px_18px_rgba(0,0,0,0.35)]"
                  : "bg-white text-ink shadow-[0_6px_18px_rgba(43,35,80,0.12)]"
              }`}
            >
              {speech.line.text}
            </span>
          </button>
        )}
      </div>
    </FeedbackContext.Provider>
  );
}
