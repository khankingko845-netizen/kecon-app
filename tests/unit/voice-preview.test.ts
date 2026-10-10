import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoicePreviewPlayer, VOICE_PREVIEW_TEXT } from "@/lib/voice-preview";
const fetchMock = vi.fn();
const audios: FakeAudio[] = [];
class FakeAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn();
  play = vi.fn(async () => {});
  constructor(public src: string) {
    audios.push(this);
  }
}
let player: VoicePreviewPlayer;
beforeEach(() => {
  audios.length = 0;
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("Audio", FakeAudio);
  vi.spyOn(URL, "createObjectURL").mockImplementation(
    () => `blob:${Math.random()}`,
  );
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  fetchMock
    .mockReset()
    .mockResolvedValue(
      new Response(new Blob(["audio"], { type: "audio/mpeg" })),
    );
  player = new VoicePreviewPlayer();
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
    audios[1].onended?.();
    expect(player.getSnapshot().status).toBe("idle");
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
    expect(audios).toHaveLength(1);
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
    expect(audios).toHaveLength(0);
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
});
