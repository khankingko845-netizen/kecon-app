import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoicePreviewPlayer, VOICE_PREVIEW_TEXT } from "@/lib/voice-preview";
import { createSharedAudio, SILENCE, type SharedAudio } from "@/lib/shared-audio";

const fetchMock = vi.fn();
const audios: FakeAudio[] = [];
/** Just enough of HTMLAudioElement for the shared audition element. */
class FakeAudio {
  src = "";
  preload = "";
  paused = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  /** Every src play() was called with, in order. */
  plays: string[] = [];
  /** Set to make play() reject (e.g. iPhone's NotAllowedError). */
  refuse: Error | null = null;
  private events = new Map<string, Array<() => void>>();
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
  play = vi.fn(() => {
    this.plays.push(this.src);
    if (this.refuse) return Promise.reject(this.refuse);
    this.paused = false;
    this.events.get("playing")?.forEach((fn) => fn());
    return Promise.resolve();
  });
  constructor() {
    audios.push(this);
  }
  addEventListener(type: string, fn: () => void) {
    this.events.set(type, [...(this.events.get(type) ?? []), fn]);
  }
  getAttribute(name: string) {
    return name === "src" && this.src ? this.src : null;
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
}
let shared: SharedAudio;
let player: VoicePreviewPlayer;
const urls: string[] = [];
beforeEach(() => {
  audios.length = 0;
  urls.length = 0;
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    const url = `blob:sample-${urls.length + 1}`;
    urls.push(url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  fetchMock
    .mockReset()
    .mockResolvedValue(
      new Response(new Blob(["audio"], { type: "audio/mpeg" })),
    );
  shared = createSharedAudio(() => new FakeAudio() as unknown as HTMLAudioElement);
  player = new VoicePreviewPlayer(shared);
});
afterEach(() => {
  player.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("one voice preview at a time", () => {
  it("uses fixed samples for all supported languages", () => {
    expect(VOICE_PREVIEW_TEXT.vi).toContain("Xin chào");
    expect(VOICE_PREVIEW_TEXT.en).toContain("Hello");
    expect(VOICE_PREVIEW_TEXT.ja).toContain("こんにちは");
    for (const text of Object.values(VOICE_PREVIEW_TEXT))
      expect(text.length).toBeLessThan(1000);
  });
  it("sends only id/locale, stops on second click and reuses the session cache", async () => {
    await player.toggle("clone", "ja");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      voiceId: "clone",
      language: "ja",
    });
    expect(player.getSnapshot()).toMatchObject({
      voiceId: "clone",
      status: "playing",
    });
    await player.toggle("clone", "ja");
    expect(audios[0].pause).toHaveBeenCalled();
    expect(player.getSnapshot().status).toBe("idle");
    await player.toggle("clone", "ja");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    audios[0].onended?.();
    expect(player.getSnapshot().status).toBe("idle");
    // One element for every sample (iPhone only lets an element that played in a tap play again).
    expect(audios).toHaveLength(1);
    expect(audios[0].plays).toEqual([SILENCE, urls[0], urls[0]]);
  });
  it("unlocks the element inside the tap, before the sample is fetched", async () => {
    let release!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const pending = player.toggle("voice", "vi");
    // Synchronously, in the same tap: silence already played on the element.
    expect(audios[0].plays).toEqual([SILENCE]);
    expect(shared.unlocked).toBe(true);
    release(new Response(new Blob(["audio"], { type: "audio/mpeg" })));
    await pending;
    expect(audios[0].plays).toEqual([SILENCE, urls[0]]);
    expect(player.getSnapshot().status).toBe("playing");
  });
  it("never plays late responses after switching or leaving", async () => {
    let release!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const old = player.toggle("old", "vi");
    await player.toggle("new", "en");
    release(new Response(new Blob(["old"], { type: "audio/mpeg" })));
    await old;
    expect(urls).toHaveLength(1);
    expect(audios).toHaveLength(1);
    expect(audios[0].plays).toEqual([SILENCE, urls[0]]);
    expect(player.getSnapshot().voiceId).toBe("new");
    player.dispose();
    expect(audios[0].pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
  it("allows cancelling while loading, aborts and ignores the old promise", async () => {
    let release!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const pending = player.toggle("voice", "vi");
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    await player.toggle("voice", "vi");
    expect(signal.aborted).toBe(true);
    release(new Response(new Blob(["old"], { type: "audio/mpeg" })));
    await pending;
    // Only the unlock's silence ever played.
    expect(audios[0].plays).toEqual([SILENCE]);
    expect(player.getSnapshot().status).toBe("idle");
  });
  it("shows quota/provider/media errors rather than pretending to play", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "Hết hạn mức" }, { status: 402 }),
    );
    await player.toggle("voice", "vi");
    expect(player.getSnapshot()).toMatchObject({
      status: "idle",
      error: "Hết hạn mức",
    });
    fetchMock.mockResolvedValueOnce(new Response("not audio"));
    await player.toggle("voice", "vi");
    expect(player.getSnapshot().error).toContain("âm thanh hợp lệ");
    await player.toggle("voice", "vi");
    audios[0].onerror?.();
    expect(player.getSnapshot().error).toContain("Trình duyệt");
  });
  it("a refused play() (iPhone) asks for a tap in Vietnamese, never the browser's English text", async () => {
    const webkit =
      "The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.";
    shared.element();
    audios[0].refuse = new DOMException(webkit, "NotAllowedError");
    await player.toggle("voice", "vi");
    expect(player.getSnapshot()).toMatchObject({
      status: "idle",
      error: "Bấm Nghe thử lần nữa để nghe nhé.",
    });
    // Safari's network failure is a TypeError("Load failed"): also never shown raw.
    audios[0].refuse = null;
    fetchMock.mockRejectedValueOnce(new TypeError("Load failed"));
    await player.toggle("other", "vi");
    expect(player.getSnapshot().error).toBe("Chưa nghe thử được giọng.");
    // The tap that follows plays.
    await player.toggle("voice", "vi");
    expect(player.getSnapshot()).toMatchObject({ status: "playing", error: null });
  });
  it("another audition taking the element ends this preview quietly", async () => {
    await player.toggle("voice", "vi");
    expect(player.getSnapshot().status).toBe("playing");
    const other = { lost: vi.fn() };
    shared.take(other, "blob:library-sample");
    expect(player.getSnapshot()).toMatchObject({ status: "idle", voiceId: null, error: null });
    // The preview no longer drives the element: stopping it leaves the other sample alone.
    const pauses = audios[0].pause.mock.calls.length;
    player.stop();
    expect(audios[0].pause).toHaveBeenCalledTimes(pauses);
    // Tapping the preview again takes the element back.
    await player.toggle("voice", "vi");
    expect(other.lost).toHaveBeenCalledTimes(1);
    expect(player.getSnapshot().status).toBe("playing");
  });
});
