import { beforeEach, describe, expect, it, vi } from "vitest";
import { modelForLanguage, supportsLanguageCode } from "@/lib/tts-models";
import { storyAudioKey, storyAudioSegments } from "@/lib/story-audio";
import { ambientForScene } from "@/lib/story-ambient";
import { textToSpeech } from "@/lib/elevenlabs";
import { validateStoryNarrator } from "@/lib/story-narrator";
const characters = [
  { name: "Thỏ", voice_id: "oldRabbit" },
  { name: "Gấu", voice_id: "oldBear" },
];
const markup =
  "[narrator]Đóm kể chuyện.[/narrator][character:Thỏ]Chào bạn![/character][character:Gấu]Cùng chơi nhé.[/character]";
beforeEach(() => vi.unstubAllGlobals());
describe("Vietnamese provider contract", () => {
  it.each([
    "eleven_multilingual_v2",
    "eleven_monolingual_v1",
    "eleven_flash_v2",
    "eleven_turbo_v2",
  ])("never sends vi to incompatible %s", (model) =>
    expect(modelForLanguage(model, "vi-VN")).toBe("eleven_flash_v2_5"),
  );
  it.each(["eleven_v3", "eleven_flash_v2_5", "eleven_turbo_v2_5"])(
    "preserves compatible %s",
    (model) => expect(modelForLanguage(model, "vi")).toBe(model),
  );
  it("keeps supported en/ja v2 and does not send unsupported language_code", () => {
    expect(modelForLanguage("eleven_multilingual_v2", "en")).toBe(
      "eleven_multilingual_v2",
    );
    expect(modelForLanguage("eleven_multilingual_v2", "ja")).toBe(
      "eleven_multilingual_v2",
    );
    expect(supportsLanguageCode("eleven_flash_v2")).toBe(false);
  });
  it("sends Vietnamese text with explicit vi and compatible model to exact voice endpoint", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("audio", { headers: { "content-type": "audio/mpeg" } }),
    );
    vi.stubGlobal("fetch", fetcher);
    await textToSpeech(
      "secret",
      "newVi",
      "Xin chào bé. Bạn Thỏ chia sẻ quả táo.",
      "eleven_multilingual_v2",
      "vi",
    );
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain("/newVi/stream");
    expect(JSON.parse(init.body as string)).toMatchObject({
      model_id: "eleven_flash_v2_5",
      language_code: "vi",
      text: "Xin chào bé. Bạn Thỏ chia sẻ quả táo.",
    });
  });
});
describe("single source of audio identity", () => {
  it("selected narrator reads ALL characters unless multi-voice explicitly enabled", () => {
    expect(storyAudioSegments(markup, "newVi", characters)).toEqual([
      {
        speaker: "narrator",
        voiceId: "newVi",
        text: "Đóm kể chuyện.\nChào bạn!\nCùng chơi nhé.",
        voiceName: undefined,
      },
    ]);
    expect(
      storyAudioSegments(markup, "newVi", characters, true).map(
        (s) => s.voiceId,
      ),
    ).toEqual(["newVi", "oldRabbit", "oldBear"]);
  });
  it("play/merge share fingerprint and changes of voice/text/locale/model/character invalidate it", async () => {
    const base = storyAudioSegments(markup, "newVi", characters);
    const key = await storyAudioKey(base, "vi", "eleven_flash_v2_5");
    expect(key).toHaveLength(64);
    expect(await storyAudioKey(base, "vi", "eleven_flash_v2_5")).toBe(key);
    for (const [segments, locale, model] of [
      [
        storyAudioSegments(markup, "other", characters),
        "vi",
        "eleven_flash_v2_5",
      ],
      [
        storyAudioSegments(markup + " Kết thúc.", "newVi", characters),
        "vi",
        "eleven_flash_v2_5",
      ],
      [base, "en", "eleven_flash_v2_5"],
      [base, "vi", "eleven_v3"],
      [
        storyAudioSegments(markup, "newVi", characters, true),
        "vi",
        "eleven_flash_v2_5",
      ],
    ] as const)
      expect(await storyAudioKey([...segments], locale, model)).not.toBe(key);
  });
  it("ambience only uses unambiguous scene cues and leaves unknown/home/magic quiet", () => {
    expect(ambientForScene("Căn phòng ấm áp, có nến")).toBeNull();
    expect(ambientForScene("", "magic")).toBeNull();
    expect(ambientForScene("Bãi biển buổi sáng")).toBe("waves");
    expect(ambientForScene("", "rain")).toBe("rain");
  });
});
describe("creation narrator snapshot", () => {
  const client = (data: unknown) => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data, error: null }),
    };
    return { from: () => q } as never;
  };
  it("rejects competing selectors and unavailable/other locale choices", async () => {
    expect(
      await validateStoryNarrator(
        client(null),
        "me",
        "vi",
        "family",
        "default",
      ),
    ).toHaveProperty("error");
    expect(
      await validateStoryNarrator(
        client(null),
        "me",
        "vi",
        undefined,
        "enVoice",
      ),
    ).toHaveProperty("error");
  });
  it("stores actual cloned provider id and server name instead of caller label", async () => {
    expect(
      await validateStoryNarrator(
        client({ id: "family", name: "Bà", elevenlabs_voice_id: "cloneNew" }),
        "me",
        "vi",
        "family",
      ),
    ).toEqual({ voiceId: "family", narratorId: "cloneNew", name: "Bà" });
  });
});
