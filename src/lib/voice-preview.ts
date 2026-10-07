/** Fixed, non-personal samples. Preview requests cannot supply arbitrary text. */
export const VOICE_PREVIEW_TEXT = {
  vi: "Xin chào bé! Đóm sẽ kể một câu chuyện nhỏ. Trong khu vườn, bạn Thỏ và bạn Gấu cùng chia sẻ một quả táo ngọt.",
  en: "Hello, little one! Here is a short story. In the garden, Rabbit and Bear share a sweet apple and become good friends.",
  ja: "こんにちは。短いお話を聞いてね。お庭で、うさぎさんとくまさんが甘いりんごを分け合い、仲良くなりました。",
} as const;
export type PreviewLocale = keyof typeof VOICE_PREVIEW_TEXT;

export interface PreviewState {
  voiceId: string | null;
  language: PreviewLocale | null;
  status: "idle" | "loading" | "playing";
  error: string | null;
}
/** One owner, one playing sample; cancellation/stale results never start audio. */
export class VoicePreviewPlayer {
  private state: PreviewState = {
    voiceId: null,
    language: null,
    status: "idle",
    error: null,
  };
  private listeners = new Set<() => void>();
  private audio: HTMLAudioElement | null = null;
  private abort: AbortController | null = null;
  private sequence = 0;
  private cache = new Map<string, string>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: PreviewState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  stop = () => {
    this.sequence++;
    this.abort?.abort();
    this.abort = null;
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio = null;
    }
    this.publish({
      voiceId: null,
      language: null,
      status: "idle",
      error: null,
    });
  };
  dispose = () => {
    this.stop();
    this.cache.forEach((url) => URL.revokeObjectURL(url));
    this.cache.clear();
  };
  async toggle(voiceId: string, language: PreviewLocale) {
    if (
      this.state.voiceId === voiceId &&
      this.state.language === language &&
      this.state.status !== "idle"
    ) {
      this.stop();
      return;
    }
    this.stop();
    const sequence = this.sequence;
    const key = `${language}:${voiceId}`;
    this.publish({ voiceId, language, status: "loading", error: null });
    this.abort = new AbortController();
    try {
      let url = this.cache.get(key);
      if (!url) {
        const response = await fetch("/api/voice/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ voiceId, language }),
          signal: this.abort.signal,
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(
            data.error || "Chưa nghe thử được giọng. Vui lòng thử lại.",
          );
        }
        const blob = await response.blob();
        if (sequence !== this.sequence) return;
        if (!blob.size || !blob.type.startsWith("audio/"))
          throw new Error("Nhà cung cấp chưa trả về âm thanh hợp lệ.");
        url = URL.createObjectURL(blob);
        this.cache.set(key, url);
        if (this.cache.size > 8) {
          const oldest = this.cache.keys().next().value!;
          URL.revokeObjectURL(this.cache.get(oldest)!);
          this.cache.delete(oldest);
        }
      }
      if (sequence !== this.sequence) return;
      const audio = new Audio(url);
      this.audio = audio;
      audio.onended = () => {
        if (sequence === this.sequence) this.stop();
      };
      audio.onerror = () => {
        if (sequence !== this.sequence) return;
        this.stop();
        URL.revokeObjectURL(this.cache.get(key)!);
        this.cache.delete(key);
        this.publish({
          voiceId: null,
          language: null,
          status: "idle",
          error: "Trình duyệt chưa phát được âm thanh. Hãy thử lại.",
        });
      };
      await audio.play();
      if (sequence !== this.sequence) {
        audio.pause();
        return;
      }
      this.publish({ voiceId, language, status: "playing", error: null });
    } catch (error) {
      if (sequence !== this.sequence) return;
      this.stop();
      this.publish({
        voiceId: null,
        language: null,
        status: "idle",
        error:
          error instanceof Error ? error.message : "Chưa nghe thử được giọng.",
      });
    }
  }
}
