/**
 * Sound + haptic feedback (UI v2, ticket UI-11) — pure helpers.
 *
 * UI sounds are tiny Web Audio "blips" synthesised on the fly (no audio files
 * to download or license); haptics use `navigator.vibrate` (Android browsers;
 * iOS Safari ignores it). Parents can turn each channel off in tab "Bố mẹ".
 * Sound and Đóm's voice go silent in Chế độ ngủ (bedtime) — FeedbackProvider
 * wires these helpers to the DOM.
 */

export const FEEDBACK_CUES = ["tap", "pop", "page", "success", "celebrate", "oops"] as const;
export type FeedbackCue = (typeof FEEDBACK_CUES)[number];

export interface ToneSpec {
  /** Start frequency (Hz). */
  freq: number;
  /** Optional glide target (Hz). */
  to?: number;
  /** Offset from the cue start (s). */
  at: number;
  /** Duration (s). */
  dur: number;
  type: "sine" | "triangle";
  /** Peak gain before the master volume (0–1). */
  gain: number;
}

const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;

/** Soft, short, never harsh: sine/triangle only, ≤ 0.6 s, quiet peaks. */
export const SFX: Record<FeedbackCue, readonly ToneSpec[]> = {
  tap: [{ freq: 880, to: 990, at: 0, dur: 0.05, type: "sine", gain: 0.16 }],
  pop: [{ freq: 520, to: 900, at: 0, dur: 0.09, type: "triangle", gain: 0.18 }],
  page: [{ freq: 420, to: 640, at: 0, dur: 0.12, type: "sine", gain: 0.1 }],
  success: [
    { freq: C5, at: 0, dur: 0.14, type: "sine", gain: 0.16 },
    { freq: E5, at: 0.08, dur: 0.14, type: "sine", gain: 0.16 },
    { freq: G5, at: 0.16, dur: 0.22, type: "sine", gain: 0.16 },
  ],
  celebrate: [
    { freq: C5, at: 0, dur: 0.12, type: "triangle", gain: 0.15 },
    { freq: E5, at: 0.07, dur: 0.12, type: "triangle", gain: 0.15 },
    { freq: G5, at: 0.14, dur: 0.12, type: "triangle", gain: 0.15 },
    { freq: C6, at: 0.21, dur: 0.3, type: "sine", gain: 0.15 },
  ],
  // A gentle "hmm?" glide down — not a buzzer: Đóm never makes errors scary.
  oops: [{ freq: 520, to: 392, at: 0, dur: 0.24, type: "triangle", gain: 0.12 }],
};

/** Vibration patterns (ms). Short taps only — long buzzing feels like an alarm. */
export const HAPTICS: Record<FeedbackCue, number | readonly number[]> = {
  tap: 8,
  pop: 12,
  page: 6,
  success: [14, 60, 20],
  celebrate: [18, 50, 18, 50, 28],
  oops: [24, 70, 24],
};

/** Overall loudness applied on top of each tone's gain. */
export const MASTER_VOLUME = 0.6;

export interface FeedbackPrefs {
  /** Tap/success sounds. */
  sound: boolean;
  /** Light vibration on taps. */
  haptics: boolean;
  /** Đóm reads its lines aloud. */
  voice: boolean;
}

export const DEFAULT_FEEDBACK_PREFS: FeedbackPrefs = { sound: true, haptics: true, voice: true };
export const FEEDBACK_STORAGE_KEY = "kecon-feedback";

export function parseFeedbackPrefs(raw: string | null | undefined): FeedbackPrefs {
  if (!raw) return { ...DEFAULT_FEEDBACK_PREFS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_FEEDBACK_PREFS };
  }
  const rec = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  const pick = (k: keyof FeedbackPrefs) => (typeof rec[k] === "boolean" ? (rec[k] as boolean) : DEFAULT_FEEDBACK_PREFS[k]);
  return { sound: pick("sound"), haptics: pick("haptics"), voice: pick("voice") };
}

export function serializeFeedbackPrefs(prefs: FeedbackPrefs): string {
  return JSON.stringify({ sound: prefs.sound, haptics: prefs.haptics, voice: prefs.voice });
}

export interface FeedbackEnv {
  /** Chế độ ngủ is active (pref "on", or "auto" inside 19:30–06:00). */
  bedtime: boolean;
  /** A story / lullaby is playing — Đóm must not talk over it. */
  mediaPlaying?: boolean;
  /** Tab hidden — never make noise in the background. */
  hidden?: boolean;
}

export interface FeedbackChannels {
  sound: boolean;
  haptics: boolean;
  voice: boolean;
}

/** Which channels may fire right now. Bedtime silences sound + voice, not the (silent) vibration. */
export function feedbackChannels(prefs: FeedbackPrefs, env: FeedbackEnv): FeedbackChannels {
  const awake = !env.bedtime && !env.hidden;
  return {
    sound: prefs.sound && awake,
    voice: prefs.voice && awake && !env.mediaPlaying,
    haptics: prefs.haptics && !env.hidden,
  };
}

/** Minimal slice of the Web Audio API we use (lets tests pass a fake). */
export interface AudioParamLike {
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
}
export interface AudioNodeLike {
  connect(destination: unknown): unknown;
}
export interface OscillatorLike extends AudioNodeLike {
  type: string;
  frequency: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
}
export interface GainLike extends AudioNodeLike {
  gain: AudioParamLike;
}
export interface AudioContextLike {
  currentTime: number;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
}

/** Schedules one cue on `ctx`, routed into `destination`. Returns the end time (s). */
export function scheduleCue(ctx: AudioContextLike, destination: unknown, cue: FeedbackCue, volume = MASTER_VOLUME): number {
  const t0 = ctx.currentTime + 0.005;
  let end = t0;
  for (const tone of SFX[cue]) {
    const start = t0 + tone.at;
    const stop = start + tone.dur;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = tone.type;
    osc.frequency.setValueAtTime(tone.freq, start);
    if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to, stop);
    // Click-free envelope: 8 ms attack, exponential release.
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.linearRampToValueAtTime(Math.max(0.0001, tone.gain * volume), start + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, stop);
    osc.connect(amp);
    amp.connect(destination);
    osc.start(start);
    osc.stop(stop + 0.02);
    end = Math.max(end, stop);
  }
  return end;
}

export interface VoiceLike {
  lang: string;
  name: string;
  localService?: boolean;
}

/** Best Vietnamese voice on the device (exact vi-VN first, local before network); none → stay silent. */
export function pickVietnameseVoice<V extends VoiceLike>(voices: readonly V[]): V | null {
  const vi = voices.filter((v) => /^vi([-_]|$)/i.test(v.lang));
  if (vi.length === 0) return null;
  const score = (v: V) => (/^vi[-_]VN$/i.test(v.lang) ? 2 : 0) + (v.localService ? 1 : 0);
  return [...vi].sort((a, b) => score(b) - score(a))[0];
}

/** Interactive elements that get the default tap feedback. */
export const TAP_TARGET_SELECTOR =
  'button, a[href], [role="button"], [role="tab"], [role="switch"], [role="menuitem"], [role="option"], input[type="checkbox"], input[type="radio"], summary';

/** `data-sfx` value → cue; "off" (or unknown) disables feedback for that subtree. */
export function cueFromAttr(value: string | null | undefined): FeedbackCue | null {
  if (value == null || value === "") return "tap";
  return (FEEDBACK_CUES as readonly string[]).includes(value) ? (value as FeedbackCue) : null;
}
