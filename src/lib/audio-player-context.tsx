"use client";

import { useSettings } from "@/lib/settings-context";
import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";

export interface AudioTrack {
  storyId: string;
  storyTitle: string;
  pageNumber: number;
  totalPages: number;
  audioUrl: string;
  /** All page audio URLs for auto-advance */
  allPages?: { pageNumber: number; audioUrl: string }[];
}

interface AudioPlayerState {
  currentTrack: AudioTrack | null;
  isPlaying: boolean;
  progress: number; // 0-100
  currentTime: number;
  duration: number;
}

interface AudioPlayerContextType extends AudioPlayerState {
  play: (track: AudioTrack) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  seekTo: (pct: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  /** Take over an existing Audio element (e.g. from StoryPlayer leaving) */
  adoptAudio: (audio: HTMLAudioElement, track: AudioTrack) => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextType>({
  currentTrack: null,
  isPlaying: false,
  progress: 0,
  currentTime: 0,
  duration: 0,
  play: () => {},
  pause: () => {},
  resume: () => {},
  stop: () => {},
  seekTo: () => {},
  nextPage: () => {},
  prevPage: () => {},
  adoptAudio: () => {},
});

/** Update MediaSession metadata + action handlers for lock screen / background control */
function updateMediaSession(track: AudioTrack | null, handlers: {
  onPlay?: () => void;
  onPause?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onStop?: () => void;
}) {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  if (!track) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = "none";
    return;
  }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.storyTitle,
    artist: `Trang ${track.pageNumber}/${track.totalPages}`,
    album: "KểCon",
  });
  navigator.mediaSession.setActionHandler("play", handlers.onPlay || null);
  navigator.mediaSession.setActionHandler("pause", handlers.onPause || null);
  navigator.mediaSession.setActionHandler("nexttrack", handlers.onNext || null);
  navigator.mediaSession.setActionHandler("previoustrack", handlers.onPrev || null);
  navigator.mediaSession.setActionHandler("stop", handlers.onStop || null);
}

type AudioRef = React.RefObject<HTMLAudioElement | null>;
type SetPlayerState = React.Dispatch<React.SetStateAction<AudioPlayerState>>;

/** Attach progress / auto-advance listeners to an Audio element */
function wireAudioEvents(audio: HTMLAudioElement, audioRef: AudioRef, setState: SetPlayerState, enabled: React.RefObject<boolean>) {
  audio.onloadedmetadata = () => {
    setState((s) => ({ ...s, duration: audio.duration }));
  };

  audio.ontimeupdate = () => {
    if (audio.duration) {
      setState((s) => ({
        ...s,
        currentTime: audio.currentTime,
        progress: (audio.currentTime / audio.duration) * 100,
      }));
    }
  };

  audio.onended = () => {
    if (!enabled.current || audioRef.current !== audio) return;
    setState((prev) => {
      const t = prev.currentTrack;
      if (!t?.allPages) {
        return { ...prev, isPlaying: false, progress: 100 };
      }
      const nextIdx = t.allPages.findIndex((p) => p.pageNumber === t.pageNumber) + 1;
      if (nextIdx < t.allPages.length) {
        const nextPage = t.allPages[nextIdx];
        setTimeout(() => {
          if (!enabled.current || audioRef.current !== audio) return;
          startTrack({
            ...t,
            pageNumber: nextPage.pageNumber,
            audioUrl: nextPage.audioUrl,
          }, audioRef, setState, enabled);
        }, 0);
        return prev;
      }
      return { ...prev, isPlaying: false, progress: 100 };
    });
  };
}

/** Stop the current Audio element (if any) and start playing `track` */
function startTrack(track: AudioTrack, audioRef: AudioRef, setState: SetPlayerState, enabled: React.RefObject<boolean>) {
  if (!enabled.current) return;
  if (audioRef.current) {
    audioRef.current.pause();
    audioRef.current = null;
  }

  const audio = new Audio(track.audioUrl);
  audioRef.current = audio;
  wireAudioEvents(audio, audioRef, setState, enabled);

  audio.play().catch(() => {});
  setState({
    currentTrack: track,
    isPlaying: true,
    progress: 0,
    currentTime: 0,
    duration: 0,
  });
}

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const {settings}=useSettings();
  const enabledRef=useRef(settings.narrationEnabled);
  useEffect(()=>{enabledRef.current=settings.narrationEnabled;},[settings.narrationEnabled]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<AudioPlayerState>({
    currentTrack: null,
    isPlaying: false,
    progress: 0,
    currentTime: 0,
    duration: 0,
  });

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const play = useCallback((track: AudioTrack) => {
    startTrack(track, audioRef, setState, enabledRef);
  }, []);

  /** Adopt an already-playing Audio element from StoryPlayer so it keeps playing in MiniPlayer */
  const adoptAudio = useCallback((audio: HTMLAudioElement, track: AudioTrack) => {
    if (!enabledRef.current) {audio.pause();return;}
    if (audioRef.current && audioRef.current !== audio) {
      audioRef.current.pause();
    }
    audioRef.current = audio;
    wireAudioEvents(audio, audioRef, setState, enabledRef);

    const isCurrentlyPlaying = !audio.paused && !audio.ended;
    setState({
      currentTrack: track,
      isPlaying: isCurrentlyPlaying,
      progress: audio.duration ? (audio.currentTime / audio.duration) * 100 : 0,
      currentTime: audio.currentTime,
      duration: audio.duration || 0,
    });
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setState((s) => ({ ...s, isPlaying: false }));
  }, []);

  const resume = useCallback(() => {
    if (!enabledRef.current) return;
    audioRef.current?.play().catch(() => {});
    setState((s) => ({ ...s, isPlaying: true }));
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setState({
      currentTrack: null,
      isPlaying: false,
      progress: 0,
      currentTime: 0,
      duration: 0,
    });
    updateMediaSession(null, {});
  }, []);

  useEffect(()=>{if(!settings.narrationEnabled) stop();},[settings.narrationEnabled,stop]);

  const seekTo = useCallback((pct: number) => {
    if (audioRef.current && audioRef.current.duration) {
      audioRef.current.currentTime = (pct / 100) * audioRef.current.duration;
    }
  }, []);

  const nextPage = useCallback(() => {
    setState((prev) => {
      const t = prev.currentTrack;
      if (!t?.allPages) return prev;
      const curIdx = t.allPages.findIndex((p) => p.pageNumber === t.pageNumber);
      const nextIdx = curIdx + 1;
      if (nextIdx < t.allPages.length) {
        const np = t.allPages[nextIdx];
        setTimeout(() => play({ ...t, pageNumber: np.pageNumber, audioUrl: np.audioUrl }), 0);
      }
      return prev;
    });
  }, [play]);

  const prevPage = useCallback(() => {
    setState((prev) => {
      const t = prev.currentTrack;
      if (!t?.allPages) return prev;
      const curIdx = t.allPages.findIndex((p) => p.pageNumber === t.pageNumber);
      const prevIdx = curIdx - 1;
      if (prevIdx >= 0) {
        const pp = t.allPages[prevIdx];
        setTimeout(() => play({ ...t, pageNumber: pp.pageNumber, audioUrl: pp.audioUrl }), 0);
      }
      return prev;
    });
  }, [play]);

  // Update MediaSession whenever track or playing state changes
  useEffect(() => {
    updateMediaSession(state.currentTrack, {
      onPlay: resume,
      onPause: pause,
      onNext: nextPage,
      onPrev: prevPage,
      onStop: stop,
    });
    if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
      navigator.mediaSession.playbackState = state.isPlaying ? "playing" : "paused";
    }
  }, [state.currentTrack, state.isPlaying, resume, pause, nextPage, prevPage, stop]);

  return (
    <AudioPlayerContext.Provider
      value={{
        ...state,
        play,
        pause,
        resume,
        stop,
        seekTo,
        nextPage,
        prevPage,
        adoptAudio,
      }}
    >
      {children}
    </AudioPlayerContext.Provider>
  );
}

export function useAudioPlayer() {
  return useContext(AudioPlayerContext);
}
