/**
 * Narration pacing — real pauses between sentences and paragraphs.
 *
 * TTS models read Vietnamese story text in one breath: sentence ends get a
 * ~0.15s gap and paragraphs barely more, so bedtime stories feel rushed.
 * We detect sentence/paragraph boundaries and compile them into the pause
 * syntax each provider/model actually understands:
 * - ElevenLabs v2-family (flash/turbo v2.5, multilingual v2…): SSML-style
 *   `<break time="0.6s" />`, capped per request (too many breaks destabilise).
 * - ElevenLabs v3: no break tags → line breaks + `[short pause]`/`[long pause]` audio tags on paragraphs.
 * - Fish Audio S2/S2.1: bracket tag `[pause]` on paragraphs, line breaks on sentences.
 * - Fish Audio S1: `(break)` / `(long-break)` control tokens.
 * Pure and deterministic (part of the audio identity).
 */
import type { NarrationPace } from "@/lib/story-brief";

export type PacingStyle = "eleven-break" | "eleven-v3" | "fish-s2" | "fish-s1" | "plain";

export interface PaceTimings {
  sentence: number;
  paragraph: number;
  /** ElevenLabs `voice_settings.speed` (0.7–1.2); Fish `prosody.speed`. */
  speed: number;
}

export const PACE_TIMINGS: Record<NarrationPace, PaceTimings> = {
  calm: { sentence: 0.7, paragraph: 1.2, speed: 0.92 },
  normal: { sentence: 0.45, paragraph: 0.85, speed: 1 },
};

/** ElevenLabs recommends sparse break tags; beyond this, keep punctuation only. */
export const MAX_BREAKS_PER_REQUEST = 8;

const ELEVEN_BREAK_MODELS = new Set([
  "eleven_flash_v2_5",
  "eleven_turbo_v2_5",
  "eleven_multilingual_v2",
  "eleven_flash_v2",
  "eleven_turbo_v2",
  "eleven_monolingual_v1",
  "eleven_multilingual_v1",
]);

export function pacingStyle(provider: "elevenlabs" | "fishaudio", model: string | null | undefined): PacingStyle {
  const m = (model ?? "").toLowerCase();
  if (provider === "fishaudio") return m === "s1" || m.startsWith("s1-") || m.startsWith("speech-1") ? "fish-s1" : "fish-s2";
  if (ELEVEN_BREAK_MODELS.has(m)) return "eleven-break";
  if (m.startsWith("eleven_v3") || m.startsWith("eleven_v4")) return "eleven-v3";
  return "plain";
}

// ── Boundary detection ─────────────────────────────────────────────────────

const ABBREVIATIONS = new Set([
  "tp", "q", "p", "ths", "ts", "gs", "pgs", "bs", "ks", "mr", "mrs", "ms", "dr", "st", "jr", "sr", "vs", "etc", "v.v", "e.g", "i.e", "no",
]);

/** A sentence end: terminal punctuation (+ closing quotes) followed by whitespace and a new sentence. */
const SENTENCE_END = /([.!?…]+|\.{3})(["'”’»)\]]*)(\s+)(?=["'“‘«(\[-–—]?\s*[\p{Lu}\p{N}])/gu;
/** Japanese/Chinese full-width ends need no following space. */
const CJK_END = /([。！？]+)(?=\S)/gu;

/** Split one paragraph into sentences (keeps punctuation, trims spaces). */
export function splitSentences(paragraph: string): string[] {
  const text = paragraph.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const cuts: number[] = [];
  for (const m of text.matchAll(SENTENCE_END)) {
    const end = (m.index ?? 0) + m[1].length + m[2].length;
    if (m[1] === ".") {
      const before = text.slice(0, m.index).match(/([\p{L}.]+)$/u)?.[1] ?? "";
      if (ABBREVIATIONS.has(before.toLowerCase()) || /^\p{Lu}$/u.test(before)) continue;
    }
    cuts.push(end);
  }
  for (const m of text.matchAll(CJK_END)) cuts.push((m.index ?? 0) + m[1].length);
  cuts.sort((a, b) => a - b);
  const out: string[] = [];
  let start = 0;
  for (const cut of cuts) {
    const s = text.slice(start, cut).trim();
    if (s) out.push(s);
    start = cut;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** Paragraphs = non-empty lines (segments are joined with "\n"). */
export function splitParagraphs(text: string): string[][] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map(splitSentences)
    .filter((p) => p.length > 0);
}

/** Make sure a sentence ends with punctuation so models land the cadence. */
function terminated(sentence: string): string {
  return /[.!?…。！？"'”’»)\]]$/u.test(sentence) ? sentence : `${sentence}.`;
}

// ── Compilation ───────────────────────────────────────────────────────────

type Boundary = "sentence" | "paragraph";

function seconds(value: number): string {
  return `${value.toFixed(1)}s`;
}

/** Choose which boundaries get an explicit break when capped: paragraphs first, then evenly spaced sentences. */
function pickBreaks(kinds: Boundary[], cap: number): Set<number> {
  const chosen = new Set<number>();
  kinds.forEach((k, i) => {
    if (k === "paragraph" && chosen.size < cap) chosen.add(i);
  });
  const sentences = kinds.map((k, i) => (k === "sentence" ? i : -1)).filter((i) => i >= 0);
  const room = cap - chosen.size;
  if (room <= 0 || sentences.length === 0) return chosen;
  if (sentences.length <= room) sentences.forEach((i) => chosen.add(i));
  else {
    const step = sentences.length / room;
    for (let j = 0; j < room; j++) chosen.add(sentences[Math.floor(j * step + step / 2)]);
  }
  return chosen;
}

/**
 * Compile plain narration text (no voice markup) into provider pause syntax.
 * Text already containing explicit pause markup is returned unchanged.
 */
export function paceNarration(text: string, style: PacingStyle, pace: NarrationPace): string {
  if (/<break\b|\(break\)|\(long-break\)|\[(short |long )?pause\]/i.test(text)) return text.trim();
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length === 0) return text.trim();
  const t = PACE_TIMINGS[pace];
  const sentences: string[] = [];
  const kinds: Boundary[] = []; // kinds[i] = boundary after sentences[i]
  paragraphs.forEach((p, pi) => {
    p.forEach((s, si) => {
      sentences.push(terminated(s));
      if (si < p.length - 1) kinds.push("sentence");
      else if (pi < paragraphs.length - 1) kinds.push("paragraph");
    });
  });
  const join = (gap: (kind: Boundary, i: number) => string) =>
    sentences.map((s, i) => (i < kinds.length ? s + gap(kinds[i], i) : s)).join("").trim();

  switch (style) {
    case "eleven-break": {
      const chosen = pickBreaks(kinds, MAX_BREAKS_PER_REQUEST);
      return join((kind, i) => {
        const nl = kind === "paragraph" ? "\n" : " ";
        return chosen.has(i) ? ` <break time="${seconds(kind === "paragraph" ? t.paragraph : t.sentence)}" />${nl}` : nl;
      });
    }
    case "eleven-v3":
      return join((kind) => (kind === "paragraph" ? (pace === "calm" ? "\n[long pause]\n" : "\n[short pause]\n") : "\n"));
    case "fish-s2":
      return join((kind) => (kind === "paragraph" ? "\n[pause]\n" : pace === "calm" ? "\n" : " "));
    case "fish-s1":
      return join((kind) => (kind === "paragraph" ? " (long-break) " : pace === "calm" ? " (break) " : " "));
    default:
      return join((kind) => (kind === "paragraph" ? "\n\n" : "\n"));
  }
}

/** Silence (seconds) the client inserts between audio pieces. */
export function segmentGap(pace: NarrationPace | null | undefined): number {
  return pace === "calm" ? 0.65 : pace === "normal" ? 0.5 : 0.4;
}
export function pageGap(pace: NarrationPace | null | undefined): number {
  return pace === "calm" ? 1.6 : pace === "normal" ? 1.1 : 0.4;
}
