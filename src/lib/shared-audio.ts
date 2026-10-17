/**
 * One <audio> element per kind of sound — story narration (the full player and
 * the MiniPlayer share it) and auditions (voice samples, "Nghe thử").
 *
 * Why: on iPhone/iPad every browser is WebKit, and WebKit only lets an element
 * make sound from script once that very element was played inside a tap. A
 * `new Audio()` per page works on a computer or Android, but on iOS the next
 * page (auto-advance), narration that starts after an await (voice synthesis,
 * hashing the audio key) and the MiniPlayer were refused with NotAllowedError —
 * and the player showed the browser's raw English text ("The request is not
 * allowed by the user agent or the platform in the current context…").
 *
 * So: `unlock()` runs synchronously in the tap (before any await) and every page
 * reuses the same element — only `src` changes. Whoever plays on it (`take` /
 * `adopt`) becomes its owner; the previous owner is told (`lost`), so two
 * players never drive one element.
 */

export interface AudioOwner {
  /** Another owner took the element: forget it — don't pause or rewire it, the new owner does. */
  lost(): void;
}

export interface SharedAudio {
  /** The element (created on first use, in the browser only). */
  element(): HTMLAudioElement;
  /**
   * Load `url` for `owner`: the previous owner is told, the element stops, its
   * on… handlers are cleared and `url` starts loading (like a new Audio(url)).
   */
  take(owner: AudioOwner, url: string): HTMLAudioElement;
  /** `owner` goes on with the element as it is (a hand-over while it plays). */
  adopt(owner: AudioOwner): void;
  owns(owner: AudioOwner): boolean;
  /** `owner` is done (closed): nobody is told when the element is taken next. */
  release(owner: AudioOwner): void;
  /** Call synchronously inside a tap/click/key handler that may start sound. */
  unlock(): void;
  /** The element has played once — script may start it from now on. */
  readonly unlocked: boolean;
}

const HANDLERS = ["onloadedmetadata", "ontimeupdate", "onplay", "onplaying", "onpause", "onended", "onerror", "onseeked", "onwaiting"] as const;

/** 0.1 s of silence: 8 kHz, 8-bit mono PCM WAV as a data: URL. */
function silentWav(samples = 800): string {
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, "data");
  view.setUint32(40, samples, true);
  bytes.fill(0x80, 44); // 8-bit PCM silence
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:audio/wav;base64,${btoa(bin)}`;
}

/** What unlock() plays on an element that never had a source. */
export const SILENCE = silentWav();

export function createSharedAudio(make: () => HTMLAudioElement = () => new Audio()): SharedAudio {
  let el: HTMLAudioElement | null = null;
  let owner: AudioOwner | null = null;
  let unlocked = false;

  const element = () => {
    if (!el) {
      el = make();
      el.preload = "auto";
      // Sound really started once: from now on script may start this element.
      el.addEventListener("playing", () => {
        unlocked = true;
      });
    }
    return el;
  };
  const switchTo = (next: AudioOwner) => {
    if (owner === next) return;
    const prev = owner;
    owner = next;
    prev?.lost();
  };

  return {
    element,
    take(next, url) {
      const a = element();
      switchTo(next);
      a.pause();
      for (const h of HANDLERS) (a as unknown as Record<string, unknown>)[h] = null;
      if (url) a.src = url;
      else {
        a.removeAttribute("src");
        a.load();
      }
      return a;
    },
    adopt(next) {
      element();
      switchTo(next);
    },
    owns: (o) => owner === o,
    release(o) {
      if (owner === o) owner = null;
    },
    unlock() {
      if (unlocked) return;
      const a = element();
      try {
        if (!a.getAttribute("src")) {
          // Never used: play a moment of silence inside this tap.
          a.src = SILENCE;
          a.play()?.then(
            () => {
              unlocked = true;
              if (a.src === SILENCE) a.pause();
            },
            () => {},
          );
        } else if (a.paused) {
          // A page is loaded but its play() was refused: play() inside the tap lifts the
          // block, the pause() right after keeps it silent (no media event reaches the owner
          // but "play"/"pause", which no owner listens to while it is paused).
          a.play()?.catch(() => {});
          a.pause();
        }
      } catch {
        /* very old browsers: the next play() reports the problem */
      }
    },
    get unlocked() {
      return unlocked;
    },
  };
}

/** Story narration: the full player (StoryPlayer) and the MiniPlayer (src/lib/background-player.ts). */
export const narrationAudio = createSharedAudio();
/** Auditions: voice samples (src/lib/voice-preview.ts, voice cloning) and "Nghe thử" in the library. */
export const sampleAudio = createSharedAudio();

export type PlayFailure = "blocked" | "interrupted" | "failed";

/** NotAllowedError = the browser wants a tap first; AbortError = a newer pause/load/request replaced this one. */
export function playFailure(error: unknown): PlayFailure {
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
  if (name === "NotAllowedError") return "blocked";
  if (name === "AbortError") return "interrupted";
  return "failed";
}

export const TAP_TO_LISTEN = "Bấm ▶ để nghe nhé.";
export const LISTEN_FAILED = "Chưa phát được giọng đọc. Bấm ▶ để thử lại.";

/**
 * Text to show when sound could not start. Browser errors (DOMException such as
 * NotAllowedError, network TypeError "Load failed" / "Failed to fetch") never
 * show their raw English text; our own messages (Vietnamese) pass through.
 * null = show nothing (a newer action interrupted this one).
 */
export function listenErrorMessage(error: unknown, opts: { blocked?: string; fallback?: string } = {}): string | null {
  const blocked = opts.blocked ?? TAP_TO_LISTEN;
  const fallback = opts.fallback ?? LISTEN_FAILED;
  switch (playFailure(error)) {
    case "blocked":
      return blocked;
    case "interrupted":
      return null;
  }
  if (typeof DOMException !== "undefined" && error instanceof DOMException) return fallback;
  if (error instanceof TypeError) return fallback;
  return error instanceof Error && error.message ? error.message : fallback;
}
