import { describe, expect, it } from "vitest";
import { planStoryAudio, playerNarrator, type PrerenderStory } from "@/lib/library-audio";
import { storyAudioKey, storyAudioSegments } from "@/lib/story-audio";

const DEFAULTS = [
  { id: "b", voice_id: "VIEN", name: "Viên", language: "vi", sort_order: 1 },
  { id: "a", voice_id: "TAM", name: "Tâm", language: "vi", sort_order: 3 },
  { id: "c", voice_id: "OFF", name: "Tắt", language: "vi", sort_order: 0, is_active: false },
  { id: "d", voice_id: "EN", name: "Ann", language: "en", sort_order: 0 },
];
const story = (over: Partial<PrerenderStory> = {}): PrerenderStory => ({
  id: "s1", locale: "vi", narrator_voice_id: "VIEN", narration_pace: "calm", cast_voices: true, ...over,
});
const CAST = [{ name: "Bo", voice_id: "BIN", voice_name: "Bin" }];
const PAGE2 = "[narrator]Bo chạy ra sân.[/narrator]\n[character:Bo]Chào cô ạ![/character]";

describe("library pre-render plan", () => {
  it("narrates like the player: the story's narrator if still offered, else the top active default", () => {
    expect(playerNarrator(story(), DEFAULTS)).toBe("VIEN");
    expect(playerNarrator(story({ narrator_voice_id: "GONE" }), DEFAULTS)).toBe("VIEN");
    expect(playerNarrator(story({ narrator_voice_id: "TAM" }), DEFAULTS)).toBe("TAM");
    expect(playerNarrator(story({ narrator_voice_id: null }), DEFAULTS.slice(2))).toBeNull();
  });

  it("plans pages in order with the player's audio key and skips empty pages", async () => {
    const pages = [
      { id: "p2", page_number: 2, content: PAGE2, audio_url: null, audio_key: null },
      { id: "p1", page_number: 1, content: "[narrator]Ngày xưa.[/narrator]", audio_url: null, audio_key: null },
      { id: "p3", page_number: 3, content: null, audio_url: null, audio_key: null },
    ];
    const plan = await planStoryAudio(story(), pages, CAST, DEFAULTS, "eleven_flash_v2_5");
    expect(plan).toMatchObject({ narrator: "VIEN", model: "eleven_flash_v2_5", pace: "calm", multiVoice: true });
    expect(plan.pages.map((p) => p.pageId)).toEqual(["p1", "p2"]);
    const seg = storyAudioSegments(PAGE2, "VIEN", CAST, true);
    expect(plan.pages[1].segments).toEqual(seg);
    expect(seg.map((s) => s.voiceId)).toEqual(["VIEN", "BIN"]);
    expect(plan.pages[1].key).toBe(await storyAudioKey(seg, "vi", "eleven_flash_v2_5", "calm"));
    expect(plan.pages[1].chars).toBe(seg.reduce((n, s) => n + s.text.length, 0));
    expect(plan.pages.every((p) => !p.upToDate)).toBe(true);
  });

  it("marks saved audio up to date only when the key still matches", async () => {
    const first = await planStoryAudio(story(), [{ id: "p2", page_number: 2, content: PAGE2, audio_url: null, audio_key: null }], CAST, DEFAULTS, "eleven_flash_v2_5");
    const key = first.pages[0].key;
    const saved = [{ id: "p2", page_number: 2, content: PAGE2, audio_url: "https://x/a.mp3", audio_key: key }];
    expect((await planStoryAudio(story(), saved, CAST, DEFAULTS, "eleven_flash_v2_5")).pages[0].upToDate).toBe(true);
    // A recast (Bo gets another voice) changes the identity, so the page is rendered again.
    const recast = [{ name: "Bo", voice_id: "QUANG", voice_name: "Quang" }];
    expect((await planStoryAudio(story(), saved, recast, DEFAULTS, "eleven_flash_v2_5")).pages[0].upToDate).toBe(false);
    // Single-voice stories read every line with the narrator.
    const single = await planStoryAudio(story({ cast_voices: false }), saved, CAST, DEFAULTS, "eleven_flash_v2_5");
    expect(single.pages[0].segments.every((s) => s.voiceId === "VIEN")).toBe(true);
  });

  it("refuses to plan without a default voice for the locale", async () => {
    await expect(planStoryAudio(story({ locale: "vi" }), [], CAST, DEFAULTS.slice(3), "eleven_flash_v2_5")).rejects.toThrow(/no default voice/);
  });
});
