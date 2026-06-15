"use client";

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
});

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
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
    // Stop existing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    const audio = new Audio(track.audioUrl);
    audioRef.current = audio;

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
      // Try next page
      setState((prev) => {
        const t = prev.currentTrack;
        if (!t?.allPages) {
          return { ...prev, isPlaying: false, progress: 100 };
        }
        const nextIdx = t.allPages.findIndex((p) => p.pageNumber === t.pageNumber) + 1;
        if (nextIdx < t.allPages.length) {
          const nextPage = t.allPages[nextIdx];
          // Schedule next page play
          setTimeout(() => {
            play({
              ...t,
              pageNumber: nextPage.pageNumber,
              audioUrl: nextPage.audioUrl,
            });
          }, 0);
          return prev;
        }
        return { ...prev, isPlaying: false, progress: 100 };
      });
    };

    audio.play().catch(() => {});
    setState({
      currentTrack: track,
      isPlaying: true,
      progress: 0,
      currentTime: 0,
      duration: 0,
    });
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setState((s) => ({ ...s, isPlaying: false }));
  }, []);

  const resume = useCallback(() => {
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
  }, []);

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
      }}
    >
      {children}
    </AudioPlayerContext.Provider>
  );
}

export function useAudioPlayer() {
  return useContext(AudioPlayerContext);
}
