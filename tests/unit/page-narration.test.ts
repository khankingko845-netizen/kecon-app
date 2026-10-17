import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  ttsApi: vi.fn(),
  uploadTtsAudio: vi.fn(),
  savePageAudio: vi.fn(),
  mergeAudioBlobs: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ ttsApi: m.ttsApi }));
vi.mock("@/lib/db", () => ({ uploadTtsAudio: m.uploadTtsAudio, savePageAudio: m.savePageAudio }));
vi.mock("@/lib/audio-merger", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/audio-merger")>()), mergeAudioBlobs: m.mergeAudioBlobs }));

import { segmentGap } from "@/lib/narration-pacing";
import { makePageResolver, synthesizeSegments, type NarrationSetup } from "@/lib/page-narration";
import { storyAudioKey, storyAudioSegments } from "@/lib/story-audio";
import type { ParsedSegment } from "@/lib/elevenlabs";

/**
 * The MiniPlayer narrates the next pages itself once the full player is
 * closed — with the same voice setup, reusing saved narration and saving
 * what it makes (so a page is never paid for twice).
 */
const setup: NarrationSetup = { voiceId: "narrator", characters: [], multiVoice: false, locale: "vi", model: "eleven_multilingual_v2", pace: "calm" };
const P1 = "Sóc Nhỏ thức dậy, bụng đói meo.";
const P2 = "Sóc Nhỏ tìm thấy một hạt dẻ thật to!";
const keyFor = (text: string, s: NarrationSetup = setup) => storyAudioKey(storyAudioSegments(text, s.voiceId, s.characters, s.multiVoice), s.locale, s.model, s.pace);
const flush = () => new Promise<void>((done) => setTimeout(done, 0));

beforeEach(() => {
  m.ttsApi.mockReset().mockResolvedValue(new Blob(["mp3"], { type: "audio/mpeg" }));
  m.uploadTtsAudio.mockReset().mockResolvedValue("https://cdn/new-p2.mp3");
  m.savePageAudio.mockReset().mockResolvedValue(undefined);
  m.mergeAudioBlobs.mockReset();
});

describe("makePageResolver (MiniPlayer narration for the next pages)", () => {
  it("reuses saved narration that matches this voice setup — no TTS", async () => {
    const resolve = makePageResolver([{ id: "p1", content: P1, audio_url: "https://cdn/p1.mp3", audio_key: await keyFor(P1) }], setup);
    expect(await resolve(1)).toBe("https://cdn/p1.mp3");
    expect(m.ttsApi).not.toHaveBeenCalled();
  });

  it("narrates a page whose saved audio is for another voice, saves it, and reuses it next time", async () => {
    const rows = [
      { id: "p1", content: P1, audio_url: "https://cdn/p1.mp3", audio_key: await keyFor(P1) },
      { id: "p2", content: P2, audio_url: "https://cdn/old-voice.mp3", audio_key: "v3:other-voice" },
    ];
    const resolve = makePageResolver(rows, setup);
    const url = await resolve(2);
    expect(url).toMatch(/^blob:/);
    expect(m.ttsApi).toHaveBeenCalledTimes(1);
    expect(m.ttsApi).toHaveBeenCalledWith("narrator", P2, undefined, undefined, "vi", "calm");
    await flush();
    expect(m.uploadTtsAudio).toHaveBeenCalledWith("p2", expect.any(Blob));
    expect(m.savePageAudio).toHaveBeenCalledWith("p2", "https://cdn/new-p2.mp3", 0, await keyFor(P2), ["narrator"]);
    expect(await resolve(2)).toBe("https://cdn/new-p2.mp3");
    expect(m.ttsApi).toHaveBeenCalledTimes(1);
    URL.revokeObjectURL(url!);
  });

  it("with the parent's own ElevenLabs key the chosen model is sent too", async () => {
    const own = { ...setup, apiKey: "sk-parent", model: "eleven_turbo_v2_5" };
    const url = await makePageResolver([{ id: "p1", content: P1, audio_url: null, audio_key: null }], own)(1);
    expect(m.ttsApi).toHaveBeenCalledWith("narrator", P1, "sk-parent", "eleven_turbo_v2_5", "vi", "calm");
    URL.revokeObjectURL(url!);
  });

  it("returns null (the mini player shows an error) when there is nothing to narrate", async () => {
    const rows = [{ id: "p1", content: "", audio_url: null, audio_key: null }];
    expect(await makePageResolver(rows, setup)(1)).toBeNull();
    expect(await makePageResolver(rows, setup)(5)).toBeNull();
    expect(await makePageResolver([{ id: "p1", content: P1, audio_url: null, audio_key: null }], { ...setup, voiceId: "" })(1)).toBeNull();
    expect(m.ttsApi).not.toHaveBeenCalled();
  });

  it("a failed upload does not stop the story", async () => {
    m.uploadTtsAudio.mockRejectedValue(new Error("storage down"));
    const resolve = makePageResolver([{ id: "p1", content: P1, audio_url: null, audio_key: null }], setup);
    const url = await resolve(1);
    expect(url).toMatch(/^blob:/);
    await flush();
    expect(m.savePageAudio).not.toHaveBeenCalled();
    URL.revokeObjectURL(url!);
  });

  it("a TTS failure rejects (the mini player shows 'Chưa tải được trang N')", async () => {
    m.ttsApi.mockRejectedValue(new Error("TTS 503"));
    await expect(makePageResolver([{ id: "p1", content: P1, audio_url: null, audio_key: null }], setup)(1)).rejects.toThrow("TTS 503");
  });
});

describe("synthesizeSegments", () => {
  const segs = [
    { speaker: "narrator", voiceId: "narrator", text: "Ngày xưa…" },
    { speaker: "Sóc", voiceId: "squirrel", text: "Hạt dẻ đâu rồi?" },
  ] as ParsedSegment[];

  it("one voice per segment, merged with the pace's gap", async () => {
    const merged = new Blob(["merged"], { type: "audio/wav" });
    m.mergeAudioBlobs.mockResolvedValue({ blobUrl: "blob:merged-page" });
    const fetchMock = vi.fn(async () => new Response(merged));
    vi.stubGlobal("fetch", fetchMock);
    const out = await synthesizeSegments(segs, setup);
    expect(m.ttsApi.mock.calls.map((c) => c[0])).toEqual(["narrator", "squirrel"]);
    expect(m.mergeAudioBlobs).toHaveBeenCalledWith([expect.any(Blob), expect.any(Blob)], undefined, { gap: segmentGap("calm") });
    expect(fetchMock).toHaveBeenCalledWith("blob:merged-page");
    expect(await out.text()).toBe("merged");
  });

  it("stops between segments once the page is no longer wanted", async () => {
    let alive = true;
    m.ttsApi.mockImplementation(async () => {
      alive = false;
      return new Blob(["mp3"]);
    });
    await expect(synthesizeSegments(segs, setup, () => alive)).rejects.toThrow("Đã dừng giọng đọc.");
    expect(m.ttsApi).toHaveBeenCalledTimes(1);
  });
});
