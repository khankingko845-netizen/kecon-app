"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useAudioPlayer } from "@/lib/audio-player-context";
import { normalizeVoiceLanguage } from "@/lib/voice-selection";
import { VoicePreviewPlayer, type PreviewLocale } from "@/lib/voice-preview";

export function useVoicePreview(language: string) {
  const [player] = useState(() => new VoicePreviewPlayer());
  const { pause } = useAudioPlayer();
  const state = useSyncExternalStore(
    player.subscribe,
    player.getSnapshot,
    player.getSnapshot,
  );
  const locale = normalizeVoiceLanguage(language);
  useEffect(() => {
    player.stop();
  }, [locale, player]);
  useEffect(() => () => player.dispose(), [player]);
  const toggle = useCallback(
    (voiceId: string, overrideLanguage?: string) => {
      const language =
        normalizeVoiceLanguage(overrideLanguage) || locale || "vi";
      if (!["vi", "en", "ja"].includes(language)) return;
      pause();
      void player.toggle(voiceId, language as PreviewLocale);
    },
    [pause, player, locale],
  );
  return { ...state, toggle, stop: player.stop };
}
export type VoicePreview = ReturnType<typeof useVoicePreview>;
