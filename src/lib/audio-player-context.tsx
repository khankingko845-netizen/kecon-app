"use client";

/**
 * App-wide narration that outlives the full player — the MiniPlayer
 * ("chế độ thu gọn"). All page logic lives in BackgroundPlayer
 * (src/lib/background-player.ts); this provider wires it to React, the lock
 * screen (MediaSession) and "Nghe tiếp" on Home.
 *
 * Re-render cost: `useAudioPlayer()` follows every progress tick (MiniPlayer
 * only). Screens that just need "is a story playing?" use `useAudioPlaying()`
 * and `useAudioControls()`, which do not re-render 4×/s while a story plays.
 */
import { useSettings } from "@/lib/settings-context";
import { updateLastPlayedPage } from "@/lib/last-played";
import { BackgroundPlayer, IDLE, sharedElementAudio, type AudioTrack, type PlayerDeps, type PlayerSnapshot, type Released } from "@/lib/background-player";
import { narrationAudio } from "@/lib/shared-audio";
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";

export type { AudioTrack, PlayerSnapshot, Released } from "@/lib/background-player";

const OFF: PlayerDeps = {
  createAudio: () => {
    throw new Error("no audio outside AudioPlayerProvider");
  },
  revoke: () => {},
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (t) => clearTimeout(t),
};
/** Used when a component renders outside the provider (tests, admin): every action is a no-op. */
const FALLBACK = new BackgroundPlayer(OFF, false);

const AudioPlayerContext = createContext<BackgroundPlayer>(FALLBACK);

/** Lock screen / background controls follow the mini player. */
function updateMediaSession(track: AudioTrack | null, player: BackgroundPlayer, playing: boolean) {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  if (!track) {
    ms.metadata = null;
    ms.playbackState = "none";
    return;
  }
  try {
    ms.metadata = new MediaMetadata({
      title: track.storyTitle,
      artist: `Trang ${track.pageNumber}/${track.totalPages}`,
      album: "KểCon",
      ...(track.coverUrl ? { artwork: [{ src: track.coverUrl }] } : {}),
    });
    ms.setActionHandler("play", () => player.resume());
    ms.setActionHandler("pause", () => player.pause());
    ms.setActionHandler("nexttrack", () => player.nextPage());
    ms.setActionHandler("previoustrack", () => player.prevPage());
    ms.setActionHandler("stop", () => player.stop());
  } catch {
    /* older browsers: metadata/actions unsupported — playback still works */
  }
  ms.playbackState = playing ? "playing" : "paused";
}

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const [player] = useState(
    () =>
      new BackgroundPlayer(
        {
          // The one narration element (src/lib/shared-audio.ts), shared with the full player.
          ...sharedElementAudio(narrationAudio),
          revoke: (url) => {
            if (url.startsWith("blob:")) URL.revokeObjectURL(url);
          },
          now: () => Date.now(),
          // Listening time: monotonic, unaffected by clock changes on the phone.
          clock: () => performance.now(),
          setTimer: (fn, ms) => setTimeout(fn, ms),
          clearTimer: (t) => clearTimeout(t),
        },
        settings.narrationEnabled,
      ),
  );

  useEffect(() => () => player.stop(), [player]);
  // "Giọng đọc truyện" off → the mini player stops and nothing starts.
  useEffect(() => {
    player.setEnabled(settings.narrationEnabled);
  }, [settings.narrationEnabled, player]);
  // Phone locked / app switched (it may be closed there): the listen heard so far is written.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") player.checkpoint();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [player]);

  const track = useSyncExternalStore(player.subscribe, () => player.getSnapshot().track, () => null);
  const playing = useSyncExternalStore(player.subscribe, () => player.getSnapshot().isPlaying, () => false);
  const storyId = track?.storyId;
  const page = track?.pageNumber;

  useEffect(() => {
    updateMediaSession(player.getSnapshot().track, player, playing);
  }, [player, storyId, page, playing]);

  // "Nghe tiếp" on Home follows the pages heard in the mini player.
  useEffect(() => {
    const t = player.getSnapshot().track;
    if (t) updateLastPlayedPage({ storyId: t.storyId, title: t.storyTitle, page: t.pageNumber, totalPages: t.totalPages });
  }, [player, storyId, page]);

  return <AudioPlayerContext.Provider value={player}>{children}</AudioPlayerContext.Provider>;
}

/** Called from a tap: the shared element may then start pages on its own (iPhone). */
const tap = () => narrationAudio.unlock();

/** Stable actions (never re-render on progress). */
export function useAudioControls() {
  const player = useContext(AudioPlayerContext);
  return useMemo(
    () => ({
      play: (track: AudioTrack) => player.play(track),
      pause: () => player.pause(),
      resume: () => {
        tap();
        player.resume();
      },
      stop: () => player.stop(),
      replay: () => {
        tap();
        player.replay();
      },
      seekTo: (pct: number) => player.seekTo(pct),
      nextPage: () => {
        tap();
        player.nextPage();
      },
      prevPage: () => {
        tap();
        player.prevPage();
      },
      dismissCelebration: () => player.dismissCelebration(),
      /** The full player was left while narrating: keep this element playing in the MiniPlayer. */
      adoptAudio: (audio: HTMLAudioElement, track: AudioTrack) => player.adopt(audio, track),
      /** The full player of this story opens: take the audio back without a restart. */
      release: (storyId: string): Released | null => player.release(storyId),
      /** Current state without subscribing. */
      peek: (): PlayerSnapshot => player.getSnapshot(),
    }),
    [player]
  );
}

/** True while a story plays (or turns its page) in the mini player. */
export function useAudioPlaying(): boolean {
  const player = useContext(AudioPlayerContext);
  return useSyncExternalStore(player.subscribe, () => player.getSnapshot().isPlaying, () => false);
}

/** Story id in the mini player (null = closed). */
export function useAudioStoryId(): string | null {
  const player = useContext(AudioPlayerContext);
  return useSyncExternalStore(player.subscribe, () => player.getSnapshot().track?.storyId ?? null, () => null);
}

/** Everything, re-rendering on each progress tick — for the MiniPlayer itself. */
export function useAudioPlayer() {
  const player = useContext(AudioPlayerContext);
  const snap = useSyncExternalStore(player.subscribe, player.getSnapshot, () => IDLE);
  const controls = useAudioControls();
  return { ...snap, currentTrack: snap.track, ...controls };
}
