import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  BriefCharactersSchema,
  defaultPace,
  estimatedMinutes,
  pagePlan,
  spokenWordCount,
} from "@/lib/story-brief";
import { pacingStyle, paceNarration, pageGap, segmentGap, splitParagraphs, splitSentences, MAX_BREAKS_PER_REQUEST } from "@/lib/narration-pacing";
import { castVoices, castingNarrator } from "@/lib/voice-casting";
import { SCENE_IDS, sceneArtUrl, sceneForPage } from "@/lib/scene-library";
import { SFX_EFFECTS, STORY_SFX_IDS, storySfx } from "@/lib/sfx-library";
import { buildIllustrationPrompt, charactersOnPage } from "@/lib/illustration-prompt";
import { assessStory, buildStoryPrompt, normalizePageText, normalizeStory } from "@/lib/story-ai";
import { storyAudioKey } from "@/lib/story-audio";
import { CHARACTER_PRESETS, characterArtUrl } from "@/lib/story-characters";

const pub = (p: string) => join(process.cwd(), "public", p);

describe("story brief", () => {
  it("length × age → page plan; minutes follow pace", () => {
    expect(pagePlan("3-5", "short")).toEqual({ pages: 6, words: [40, 55] });
    expect(pagePlan("6-8")).toEqual({ pages: 10, words: [80, 100] });
    expect(pagePlan("10+", "long").pages).toBe(14);
    const plan = pagePlan("6-8", "medium");
    expect(estimatedMinutes(plan, "calm")).toBeGreaterThan(estimatedMinutes(plan, "normal"));
  });

  it("bedtime and 3–5 default to a calm pace", () => {
    expect(defaultPace("3-5", "phieuluu")).toBe("calm");
    expect(defaultPace("6-8", "ngungon")).toBe("calm");
    expect(defaultPace("6-8", "phieuluu")).toBe("normal");
  });

  it("cast: max 3, unique names, exactly one hero first, custom fields kept", () => {
    const parsed = BriefCharactersSchema.parse([
      { name: "Mèo Mun", description: "chú mèo đen thích nấu ăn", voiceType: "boy" },
      { name: " thỏ  bông ", role: "hero", presetId: "bunny", appearance: "white  bunny" },
      { name: "Mèo mun" },
    ]);
    expect(parsed.map((c) => c.role)).toEqual(["hero", "friend"]);
    expect(parsed[0]).toMatchObject({ presetId: "bunny", appearance: "white bunny" });
    expect(parsed[1]).toMatchObject({ name: "Mèo Mun", voiceType: "boy" });
    expect(() => BriefCharactersSchema.parse([{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }])).toThrow();
    expect(() => BriefCharactersSchema.parse([{ name: "a", voiceType: "alien" }])).toThrow();
  });

  it("spoken words ignore voice markup", () => {
    expect(spokenWordCount("[narrator]Một hai ba.[/narrator]\n[character:Thỏ]Bốn năm![/character]")).toBe(5);
  });
});

describe("narration pacing", () => {
  it("maps provider/model to the pause syntax it supports", () => {
    expect(pacingStyle("elevenlabs", "eleven_flash_v2_5")).toBe("eleven-break");
    expect(pacingStyle("elevenlabs", "eleven_multilingual_v2")).toBe("eleven-break");
    expect(pacingStyle("elevenlabs", "eleven_v3")).toBe("eleven-v3");
    expect(pacingStyle("fishaudio", "s2.1-pro")).toBe("fish-s2");
    expect(pacingStyle("fishaudio", "s1")).toBe("fish-s1");
  });

  it("splits sentences without breaking abbreviations or initials", () => {
    expect(splitSentences("Bé đến TP. Hồ Chí Minh. Trời đẹp quá! Ai đó?")).toEqual(["Bé đến TP. Hồ Chí Minh.", "Trời đẹp quá!", "Ai đó?"]);
    expect(splitParagraphs("A b. C d.\nE f.")).toEqual([["A b.", "C d."], ["E f."]]);
  });

  it("ElevenLabs v2: break tags, longer for paragraphs and calm, capped per request", () => {
    const out = paceNarration("Một. Hai.\nBa.", "eleven-break", "calm");
    expect(out).toBe('Một. <break time="0.7s" /> Hai. <break time="1.2s" />\nBa.');
    const many = Array.from({ length: 30 }, (_, i) => `Câu số ${i + 1}.`).join(" ");
    expect((paceNarration(many, "eleven-break", "normal").match(/<break/g) ?? []).length).toBe(MAX_BREAKS_PER_REQUEST);
  });

  it("Fish/v3 use their own pause tags; existing markup is left alone", () => {
    expect(paceNarration("Một.\nHai.", "fish-s2", "normal")).toBe("Một.\n[pause]\nHai.");
    expect(paceNarration("Một.\nHai.", "eleven-v3", "calm")).toBe("Một.\n[long pause]\nHai.");
    expect(paceNarration("Một. (break) Hai.", "fish-s1", "calm")).toBe("Một. (break) Hai.");
    expect(paceNarration("Không dấu câu", "eleven-break", "normal")).toBe("Không dấu câu.");
  });

  it("client gaps grow with a calmer pace (legacy keeps 0.4s)", () => {
    expect(segmentGap(null)).toBe(0.4);
    expect(segmentGap("calm")).toBeGreaterThan(segmentGap("normal"));
    expect(pageGap("calm")).toBeGreaterThan(pageGap("normal"));
    expect(pageGap("normal")).toBeGreaterThan(pageGap(null));
  });
});

describe("voice casting", () => {
  const voices = [
    { voice_id: "narr", name: "Giọng kể", gender: "female" },
    { voice_id: "girl", name: "Bé Na", gender: "female", description: "giọng bé gái trẻ em" },
    { voice_id: "man", name: "Chú Ba", gender: "male", description: "người lớn" },
    { voice_id: "grandpa", name: "Ông Tư", gender: "male", description: "giọng ông già" },
  ];
  it("fits voice type, keeps voices distinct and never reuses the narrator", () => {
    const cast = castVoices(
      [
        { name: "Thỏ Bông", voiceType: "girl", role: "hero" },
        { name: "Ông Bụt", voiceType: "grandpa" },
        { name: "Chú Gấu", voiceType: "man" },
      ],
      voices,
      "narr",
    );
    expect(cast.get("Thỏ Bông")?.voice_id).toBe("girl");
    expect(cast.get("Ông Bụt")?.voice_id).toBe("grandpa");
    expect(cast.get("Chú Gấu")?.voice_id).toBe("man");
    expect([...cast.values()].some((v) => v.voice_id === "narr")).toBe(false);
  });
  it("reads Vietnamese gender/age words in names and descriptions (no ASCII-only \\b)", () => {
    const pool = [
      { voice_id: "ong", name: "Ông Tư" },
      { voice_id: "be", name: "Bé Na", gender: "female" },
      { voice_id: "co", name: "Cô Lan", description: "giọng người lớn, dịu dàng" },
      { voice_id: "chu", name: "Chú Ba", description: "người lớn" },
    ];
    const cast = castVoices(
      [
        { name: "Ông Bụt", voiceType: "grandpa" },
        { name: "Thỏ", voiceType: "girl" },
        { name: "Mẹ Thỏ", voiceType: "woman" },
        { name: "Bác Gấu", voiceType: "man" },
      ],
      pool,
      "narr",
    );
    expect(cast.get("Ông Bụt")?.voice_id).toBe("ong");
    expect(cast.get("Thỏ")?.voice_id).toBe("be");
    expect(cast.get("Mẹ Thỏ")?.voice_id).toBe("co");
    expect(cast.get("Bác Gấu")?.voice_id).toBe("chu");
    // Without a gender column only the Vietnamese words tell "Bà" from "Ông".
    const elders = castVoices([{ name: "Bà Tiên", voiceType: "grandma" }], [{ voice_id: "a-ong", name: "Ông Tư" }, { voice_id: "b-ba", name: "Bà Năm" }], "narr");
    expect(elders.get("Bà Tiên")?.voice_id).toBe("b-ba");
  });
  it("no narrator chosen → casting avoids the voice the player will narrate with", () => {
    const pool = [
      { voice_id: "vien", name: "Viên", gender: "female", description: "giọng kể", sort_order: 0 },
      { voice_id: "yuna", name: "Yuna", gender: "female", description: "giọng bé gái tinh nghịch", sort_order: 1 },
    ];
    expect(castingNarrator("chosen", "clone", pool)).toBe("chosen");
    expect(castingNarrator(null, "clone", pool)).toBe("clone");
    expect(castingNarrator(null, null, pool)).toBe("vien");
    expect(castingNarrator(null, null, [])).toBeNull();
    const cast = castVoices([{ name: "Thỏ", voiceType: "girl" }], pool, castingNarrator(null, null, pool));
    expect(cast.get("Thỏ")?.voice_id).toBe("yuna");
    // Only the narrator's voice exists → the narrator reads the character instead of a "cast" copy of itself.
    const solo = castVoices([{ name: "Thỏ", voiceType: "girl" }], pool.slice(0, 1), castingNarrator(null, null, pool.slice(0, 1)));
    expect(solo.get("Thỏ")?.voice_id ?? null).toBeNull();
  });
  it("no other voice → the narrator reads that character (null)", () => {
    const cast = castVoices([{ name: "Rồng", voiceType: "creature" }], [{ voice_id: "narr", name: "Giọng kể" }], "narr");
    expect(cast.get("Rồng")?.voice_id ?? null).toBeNull();
  });
});

describe("scene art + sound effects + character art (bundled, licensed)", () => {
  it("every scene id has art and a manifest entry", () => {
    const manifest = JSON.parse(readFileSync(pub("scenes/v1/manifest.json"), "utf8"));
    for (const id of SCENE_IDS) {
      expect(existsSync(pub(sceneArtUrl(id).slice(1)))).toBe(true);
      const item = manifest.items.find((i: { id: string }) => i.id === id);
      expect(item?.sha256).toBe(createHash("sha256").update(readFileSync(pub(`scenes/v1/${id}.webp`))).digest("hex"));
    }
    expect(manifest.note).toContain("AI-generated for KểCon");
  });

  it("picks scene by authored id → place words → night → theme", () => {
    expect(sceneForPage({ sceneId: "castle" })).toBe("castle");
    expect(sceneForPage({ sceneId: "evil", sceneDescription: "Bờ suối trong veo" })).toBe("stream");
    expect(sceneForPage({ sceneDescription: "Khu rừng đêm trăng sáng" })).toBe("forest-night");
    expect(sceneForPage({ text: "Bé lên phi thuyền bay vào vũ trụ." })).toBe("space");
    expect(sceneForPage({ text: "Bé buồn ngủ, chúc ngủ ngon." , theme: "cotich"})).toBe("bedroom");
    expect(sceneForPage({ text: "Một ngày nọ.", theme: "cotich" })).toBe("village");
  });

  it("sound effects: files match the CC0 manifest; story effects exclude UI cues, max 2", () => {
    for (const e of SFX_EFFECTS) {
      const bytes = readFileSync(pub(e.url.slice(1)));
      expect(bytes.length).toBe(e.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(e.sha256);
      expect(e.license).toMatch(/CC0/);
    }
    expect(STORY_SFX_IDS).not.toContain("page-turn");
    expect(storySfx(["Door Knock", "page-turn", "bell", "coins", "nope"])).toEqual(["door-knock", "bell"]);
  });

  it("each preset has its own portrait, distinct from theme tiles", () => {
    for (const p of CHARACTER_PRESETS) {
      expect(existsSync(pub(characterArtUrl(p.id).slice(1)))).toBe(true);
      expect(characterArtUrl(p.id)).toMatch(/^\/characters\/v1\//);
    }
    expect(characterArtUrl("unknown")).toBe("/characters/v1/custom.webp");
    expect(CHARACTER_PRESETS.filter((p) => /Phi hành gia/.test(p.name))).toHaveLength(1);
  });
});

describe("illustration prompt", () => {
  const characters = [
    { name: "Thỏ Bông", role: "hero", appearance: "small white bunny with a mint scarf" },
    { name: "Bác Rùa", role: "friend", appearance: "old green turtle with round glasses" },
  ];
  it("repeats the character bible for characters on the page, no text in pictures", () => {
    const prompt = buildIllustrationPrompt({ title: "Thỏ đi chơi", illustration: "Bác Rùa waves by the stream at sunset", characters });
    expect(prompt).toContain("Bác Rùa: old green turtle with round glasses");
    expect(prompt).not.toContain("Thỏ Bông:");
    expect(prompt).toMatch(/No text/);
    expect(prompt).toMatch(/clay/);
  });
  it("falls back to the hero when nobody is named; markup is stripped", () => {
    expect(charactersOnPage({ text: "[narrator]Trời mưa.[/narrator]", characters }).map((c) => c.name)).toEqual(["Thỏ Bông"]);
    expect(buildIllustrationPrompt({ text: "[narrator]Trời mưa.[/narrator]", style: "watercolor" })).not.toContain("[narrator]");
  });
});

describe("story writer v2", () => {
  const params = {
    theme: "dongvat",
    childName: "Na",
    age: "3-5",
    language: "vi",
    length: "long" as const,
    pace: "calm" as const,
    characters: BriefCharactersSchema.parse([
      { name: "Thỏ Bông", role: "hero", presetId: "bunny", voiceType: "girl", appearance: "white bunny, mint scarf" },
      { name: "Mèo Mun", description: "chú mèo đen thích nấu ăn" },
    ]),
  };

  it("prompt asks for exact length, the family's cast, dialogue and scene/sound fields", () => {
    const prompt = buildStoryPrompt(params);
    expect(prompt).toContain("ĐÚNG 10 trang");
    expect(prompt).toContain("Mỗi trang 65–85 chữ");
    expect(prompt).toContain('"Thỏ Bông" — nhân vật chính');
    expect(prompt).toContain('"Mèo Mun" — bạn đồng hành — chú mèo đen thích nấu ăn');
    expect(prompt).toContain("chậm rãi");
    for (const field of ['"scene"', '"ambient"', '"sfx"', '"mood"', '"appearance"', '"voiceType"']) expect(prompt).toContain(field);
  });

  it("normalizes text into markup lines and forces the family's cast", () => {
    expect(normalizePageText("Ngày xưa có một bạn thỏ.")).toBe("[narrator]Ngày xưa có một bạn thỏ.[/narrator]");
    expect(normalizePageText("[narrator]A.[/narrator] [character: Thỏ  Bông ]B![/character]")).toBe("[narrator]A.[/narrator]\n[character:Thỏ Bông]B![/character]");
    const story = normalizeStory(
      {
        title: "T",
        summary: "",
        characters: [{ name: "Mèo Mun", description: "", personality: "", role: "hero", voiceType: "man" } as never],
        pages: [
          { text: "[narrator]Hi.[/narrator]\n[character:Cáo Đỏ]Chào![/character]", sceneDescription: "rừng", scene: "forest", ambient: "Forest", sfx: ["bell", "x"], mood: "happy" } as never,
        ],
      },
      params,
    );
    expect(story.characters?.map((c) => [c.name, c.role])).toEqual([
      ["Thỏ Bông", "hero"],
      ["Mèo Mun", "friend"],
      ["Cáo Đỏ", "friend"],
    ]);
    expect(story.characters?.[0]).toMatchObject({ voiceType: "girl", appearance: "white bunny, mint scarf" });
    expect(story.pages[0]).toMatchObject({ scene: "forest", ambient: "forest", sfx: ["bell"], mood: "happy" });
  });

  it("assessment flags short stories, missing cast and missing dialogue", () => {
    const plan = pagePlan("3-5", "medium");
    const thin = assessStory({ title: "t", summary: "", pages: [{ text: "[narrator]Ngắn.[/narrator]", sceneDescription: "" }] }, plan, params.characters);
    expect(thin.ok).toBe(false);
    expect(thin.reasons.join(" ")).toMatch(/trang/);
    expect(thin.reasons.join(" ")).toMatch(/Thỏ Bông/);
    const page = "[narrator]" + "Thỏ Bông và Mèo Mun chơi đùa vui vẻ. ".repeat(8) + "[/narrator]\n[character:Thỏ Bông]Vui quá![/character]";
    const good = assessStory({ title: "t", summary: "", pages: Array.from({ length: 8 }, () => ({ text: page, sceneDescription: "" })) }, plan, params.characters);
    expect(good).toMatchObject({ ok: true, reasons: [] });
  });
});

describe("story audio identity", () => {
  const segments = [{ speaker: "narrator", voiceId: "v1", text: "Xin chào." }] as never;
  it("paced audio gets its own key; unpaced keeps the legacy key", async () => {
    const legacy = await storyAudioKey(segments, "vi", "m");
    expect(await storyAudioKey(segments, "vi", "m", null)).toBe(legacy);
    const calm = await storyAudioKey(segments, "vi", "m", "calm");
    const normal = await storyAudioKey(segments, "vi", "m", "normal");
    expect(new Set([legacy, calm, normal]).size).toBe(3);
  });
});

describe("writer v2: expansion pass + sound fallback", () => {
  const target = { provider: "openai" as const, apiKey: "k", model: "gpt-4o-mini" };
  const brief = { theme: "phieuluu", childName: "", age: "6-8", language: "vi", length: "medium" as const, characters: [{ name: "Mèo Mướp", description: "chú mèo", role: "hero" as const, appearance: undefined }] };
  const shortPage = (i: number) => `[narrator]Trang ${i}: Mèo Mướp đi vào rừng xanh.[/narrator]\n[character:Mèo Mướp]Đi thôi![/character]`;
  const longPage = (i: number) =>
    `[narrator]Trang ${i}: ` + "Mèo Mướp bước chậm qua khu rừng xanh mát, nghe chim hót líu lo trên cành cao. ".repeat(6) + `[/narrator]\n[character:Mèo Mướp]Rừng hôm nay đẹp quá![/character]`;
  const reply = (body: unknown) =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });

  it("short pages are rewritten in parallel chunks; structure kept, no full rewrite", async () => {
    const { generateStoryWithUsage } = await import("@/lib/story-ai");
    const prompts: string[] = [];
    const fetchImpl = async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const prompt = body.messages.map((m: { content: string }) => m.content).join("\n");
      prompts.push(prompt);
      if (prompts.length === 1)
        return reply({ title: "Mèo Mướp", summary: "S", characters: [{ name: "Mèo Mướp", description: "chú mèo" }], pages: Array.from({ length: 10 }, (_, i) => ({ text: shortPage(i + 1), sceneDescription: "rừng", scene: "forest" })) });
      const pages = [...prompt.matchAll(/các trang ([\d, ]+) đang QUÁ NGẮN/g)][0][1].split(",").map((n: string) => Number(n.trim()));
      return reply({ pages: pages.map((n: number) => ({ page: n, text: longPage(n) })) });
    };
    const out = await generateStoryWithUsage(target, brief, fetchImpl as never, { qualityRetry: true, budgetMs: 200_000 });
    expect(prompts).toHaveLength(1 + 4); // draft + ceil(10 / 3) expansion chunks
    expect(prompts.slice(1).every((p) => !p.includes("CHƯA ĐẠT"))).toBe(true);
    expect(out.story.pages).toHaveLength(10);
    expect(out.story.pages.every((p, i) => p.text.startsWith(`[narrator]Trang ${i + 1}:`))).toBe(true);
    expect(out.assessment.shortPages).toEqual([]);
    expect(out.assessment.ok).toBe(true);
    expect(out.attempts).toBe(2);
    expect(out.story.pages[0].scene).toBe("forest");
  });

  it("a failed or non-longer expansion keeps the original page", async () => {
    const { expandShortPages } = await import("@/lib/story-ai");
    const story = { title: "t", summary: "", pages: [1, 2, 3, 4].map((i) => ({ text: shortPage(i), sceneDescription: "" })) };
    let call = 0;
    const fetchImpl = async () => (++call === 1 ? reply({ pages: [{ page: 1, text: "[narrator]Ngắn.[/narrator]" }, { page: 2, text: longPage(2) }, { page: 9, text: longPage(9) }] }) : new Response("{}", { status: 500 }));
    const { story: out, expanded } = await expandShortPages(target, story, brief, pagePlan("6-8"), [0, 1, 2, 3], 10_000, fetchImpl as never);
    expect(expanded).toBe(1);
    expect(out.pages[1].text).toContain("líu lo");
    expect(out.pages[0].text).toBe(story.pages[0].text);
    expect(out.pages[3].text).toBe(story.pages[3].text);
  });

  it("pages that describe a sound get a matching effect; writer choices win", async () => {
    const { inferSfx, withInferredSfx } = await import("@/lib/story-ai");
    expect(inferSfx("[narrator]Cốc cốc! Có tiếng gõ cửa.[/narrator]")).toEqual(["door-knock"]);
    expect(inferSfx("[narrator]Cô tiên vẫy đũa thần, phép màu lấp lánh.[/narrator]")).toEqual(["magic-sparkle"]);
    expect(inferSfx("[narrator]Bé ngủ ngon.[/narrator]")).toEqual([]);
    const story = withInferredSfx({ title: "t", summary: "", pages: [
      { text: "[narrator]Leng keng, tiếng chuông reo.[/narrator]", sceneDescription: "", sfx: ["coins"] },
      { text: "[narrator]Leng keng, tiếng chuông reo.[/narrator]", sceneDescription: "" },
    ] });
    expect(story.pages.map((p) => p.sfx)).toEqual([["coins"], ["bell"]]);
  });
});
