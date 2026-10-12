import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LIBRARY_TAG_PREFIX,
  LibraryStorySchema,
  buildLibraryImportSql,
  buildLibraryRecastSql,
  buildLibraryRollbackSql,
  libraryCasting,
  libraryStoryProblems,
  packProblems,
  type LibraryStory,
} from "@/lib/library-pack";
import { assessStory } from "@/lib/story-ai";
import { pagePlan } from "@/lib/story-brief";
import { castVoices } from "@/lib/voice-casting";

function loadPack(version: string) {
  const dir = path.join(process.cwd(), "content/library", version);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const raw = files.map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as unknown);
  return { files, raw, pack: raw.map((r) => LibraryStorySchema.parse(r)) };
}
const PACKS = {
  v1: { count: 12, categories: ["fairy_tale", "folk", "bedtime"] },
  v2: { count: 18, categories: ["fairy_tale", "animal", "educational", "folk", "adventure"] },
  v3: { count: 10, categories: ["educational"] },
} as const;
const LOADED = Object.fromEntries(Object.keys(PACKS).map((v) => [v, loadPack(v)])) as Record<keyof typeof PACKS, ReturnType<typeof loadPack>>;
const { pack } = LOADED.v1;
const ALL = Object.values(LOADED).flatMap((l) => l.pack);

/** The Vietnamese default voices on staging (default_voices, PR #42). */
const VOICES = [
  { voice_id: "iSFxP4Z6YNcx9OXl62Ic", name: "Viên - Narrative, Warm and Clear (northern)", gender: null, description: null, sort_order: 1 },
  { voice_id: "aHC3XZOMg3HZuXVYK6hy", name: "Yuna — bé gái tinh nghịch", gender: "female", description: "Giọng bé gái trẻ em, trong trẻo, tinh nghịch, tò mò (giọng nhân vật).", sort_order: 2 },
  { voice_id: "IovBBFnLZ6QzJhFLLroy", name: "Tâm — cô kể chuyện cổ tích", gender: "female", description: "Giọng cô người lớn, ấm áp, dịu dàng, hợp truyện cổ tích.", sort_order: 3 },
  { voice_id: "KVzG2JMdZJKi6y7cwERP", name: "Quang — chú trầm ấm", gender: "male", description: "Giọng chú người lớn, trầm ấm, miền Bắc.", sort_order: 4 },
  { voice_id: "oLR5l8TbWm0sNc5LspDA", name: "Thanh — ông hiền từ", gender: "male", description: "Giọng ông cao tuổi, trầm, chậm rãi, hiền từ, miền Nam.", sort_order: 5 },
];
/** T18 batch 2 added a boy, a grandma and a young-woman voice (sort 6–8). */
const BIN = "4iqKdEXMW8NRF8USiS3Q";
const HIEN = "e66uATAVqVXOM9VOINfq";
const KIM = "nXpBQckSqPfSghXiaOwA";
const VOICES_8 = [
  ...VOICES,
  { voice_id: BIN, name: "Bin — bé trai lém lỉnh", gender: "male", description: "Giọng bé trai trẻ em, hồn nhiên, lém lỉnh, hơi khàn (giọng nhân vật).", sort_order: 6 },
  { voice_id: HIEN, name: "Hiền — bà hiền hậu", gender: "female", description: "Giọng bà cao tuổi, ấm áp, chậm rãi, hiền hậu, miền Bắc.", sort_order: 7 },
  { voice_id: KIM, name: "Kim — chị gái dịu dàng", gender: "female", description: "Giọng chị gái người lớn, dịu dàng, trong trẻo, hợp vai nàng tiên, cô gái trong truyện cổ tích (giọng nhân vật).", sort_order: 8 },
];
const OWNER = "7783d62b-0fa9-4a06-a7f6-775a73331635";

describe.each(Object.entries(PACKS))("library pack %s", (version, spec) => {
  const { files, raw, pack } = LOADED[version as keyof typeof PACKS];
  it(`ships ${spec.count} stories with one file per slug`, () => {
    expect(files).toHaveLength(spec.count);
    expect(files).toEqual(pack.map((s) => `${s.slug}.json`).sort());
  });

  it.each(files.map((f, i) => [f, raw[i]] as const))("%s passes the editorial checks", (_f, story) => {
    expect(libraryStoryProblems(story)).toEqual([]);
  });

  it("has no duplicate slugs or titles and covers the kid library filters", () => {
    expect(packProblems(raw)).toEqual([]);
    expect(new Set(pack.map((s) => s.category))).toEqual(new Set(spec.categories));
  });

  it("every story clears the generator's own quality gate", () => {
    for (const s of pack) {
      const story = { title: s.title, pages: s.pages.map((p) => ({ text: p.text, sceneDescription: p.sceneDescription })) };
      const verdict = assessStory(story as never, pagePlan(s.band, s.length), s.characters);
      expect(verdict.ok, `${s.slug}: ${verdict.reasons.join("; ")}`).toBe(true);
      expect(verdict.shortPages, s.slug).toEqual([]);
    }
  });

  it("records provenance and adaptation notes for every tale", () => {
    for (const s of pack) {
      expect(s.origin.length, s.slug).toBeGreaterThan(20);
      expect(s.adaptation.length, s.slug).toBeGreaterThan(0);
    }
  });
});

describe("library packs together", () => {
  it("keeps slugs and titles unique across every pack", () => {
    expect(ALL).toHaveLength(40);
    expect(packProblems(ALL)).toEqual([]);
  });
  it("only the edited Sọ Dừa replaces an older platform story", () => {
    expect(ALL.filter((s) => s.replaces).map((s) => [s.slug, s.replaces?.title])).toEqual([["so-dua", "Sọ Dừa"]]);
  });
  it("v3 good-habit stories follow the series rules", () => {
    for (const s of LOADED.v3.pack) {
      expect(s.tags.slice(0, 3), s.slug).toEqual(["thoi-quen-tot", "ky-nang-song", "bo-va-su"]);
      expect(s.origin, s.slug).toMatch(/23\/2010\/TT-BGDĐT\), chỉ số \d+/);
      expect(s.adaptation.at(-1), s.slug).toMatch(/^Gợi ý cho cha mẹ: /);
      expect(s.characters.some((c) => c.name === "Bo" || c.name === "Su"), s.slug).toBe(true);
      // Ends by inviting the listening child to answer or try the strategy.
      expect(s.pages.at(-1)!.text, s.slug).toMatch(/\[narrator\]Bé ơi,[^[]*[?!]/);
    }
  });
});

describe("library editorial checks", () => {
  const base = () => structuredClone(pack[0]) as LibraryStory;
  it("rejects blocked phrases, unknown speakers, broken markup and castle art", () => {
    const s = base();
    s.pages[0].text = s.pages[0].text.replace("[/narrator]", " rồi bà chết.[/narrator]");
    s.pages[1].text += "\n[character:Ai Đó]Xin chào[/character]";
    s.pages[2].text += "\nlời không có thẻ";
    s.pages[3].scene = "castle";
    const problems = libraryStoryProblems(s).join("\n");
    expect(problems).toMatch(/blocked phrase "chết"/);
    expect(problems).toMatch(/unknown speaker "Ai Đó"/);
    expect(problems).toMatch(/malformed line/);
    expect(problems).toMatch(/scene "castle"/);
  });
  it("does not flag syllables that merely contain a blocked word", () => {
    const s = base();
    s.pages[0].text = s.pages[0].text.replace("[/narrator]", " Bà ngủ ngon.[/narrator]");
    expect(libraryStoryProblems(s).filter((p) => p.includes("blocked"))).toEqual([]);
  });
  it("rejects pages outside the age-band word plan and non-NFC text", () => {
    const s = base();
    s.pages[4].text = "[narrator]Ngắn quá.[/narrator]\n[character:Tích Chu]Dạ.[/character]";
    const problems = libraryStoryProblems({ ...s, title: s.title.normalize("NFD") }).join("\n");
    expect(problems).toMatch(/page 5: \d+ words/);
    expect(problems).toMatch(/NFC/);
  });
});

describe("library voice casting with the staging voices", () => {
  const TAM = "IovBBFnLZ6QzJhFLLroy";
  const YUNA = "aHC3XZOMg3HZuXVYK6hy";
  const MEN = ["KVzG2JMdZJKi6y7cwERP", "oLR5l8TbWm0sNc5LspDA"];
  it("narrates with Viên, matches gender, and never gives an elder the child voice", () => {
    for (const s of pack) {
      const { narrator, cast } = libraryCasting(s, VOICES);
      expect(narrator?.voice_id).toBe("iSFxP4Z6YNcx9OXl62Ic");
      for (const c of s.characters) {
        const v = cast.get(c.name)?.voice_id;
        const who = `${s.slug}/${c.name}`;
        expect(v, who).not.toBe("iSFxP4Z6YNcx9OXl62Ic");
        if (c.voiceType === "grandma") expect(v, who).toBe(TAM);
        if (c.voiceType === "woman" || c.voiceType === "girl") expect([TAM, YUNA], who).toContain(v);
        if (c.voiceType === "man" || c.voiceType === "grandpa" || c.voiceType === "boy") expect(MEN, who).toContain(v);
      }
    }
  });
  it("documents the five-voice gaps: no boy voice, one adult woman voice", () => {
    const tich = pack.find((s) => s.slug === "tich-chu")!;
    const { cast } = libraryCasting(tich, VOICES);
    expect(cast.get("Tích Chu")?.voice_id).toBe("KVzG2JMdZJKi6y7cwERP"); // boy read by the adult male voice
    expect(cast.get("Bà")?.voice_id).toBe(TAM);
    expect(cast.get("Bà Tiên")?.voice_id).toBe(TAM); // a grown-up reuses Tâm rather than the child voice
  });
  it("prefers the adjacent age group: grandma → adult woman, not a girl", () => {
    const cast = castVoices([{ name: "Bà", voiceType: "grandma" }], VOICES, "iSFxP4Z6YNcx9OXl62Ic");
    expect(cast.get("Bà")?.voice_id).toBe("IovBBFnLZ6QzJhFLLroy");
  });
});

describe("library voice casting with the eight T18 voices", () => {
  const KIDS = [BIN, "aHC3XZOMg3HZuXVYK6hy"];
  it("gives the boy, grandma and young-woman roles their new voices", () => {
    const tich = libraryCasting(pack.find((s) => s.slug === "tich-chu")!, VOICES_8).cast;
    expect(tich.get("Tích Chu")?.voice_id).toBe(BIN);
    expect(tich.get("Bà")?.voice_id).toBe(HIEN);
    expect(tich.get("Bà Tiên")?.voice_id).toBe("IovBBFnLZ6QzJhFLLroy");
    const son = libraryCasting(pack.find((s) => s.slug === "son-tinh-thuy-tinh")!, VOICES_8).cast;
    expect(son.get("Mị Nương")?.voice_id).toBe(KIM);
  });
  it.each(ALL.map((s) => [s.slug, s] as const))("%s: children get child voices, grown-ups never do", (_slug, s) => {
    const { narrator, cast } = libraryCasting(s, VOICES_8);
    expect(narrator?.voice_id).toBe("iSFxP4Z6YNcx9OXl62Ic");
    for (const c of s.characters) {
      const v = cast.get(c.name)?.voice_id ?? null;
      const who = `${s.slug}/${c.name}`;
      expect(v, who).not.toBeNull();
      if (c.voiceType === "boy") expect(v, who).toBe(BIN);
      if (c.voiceType === "girl") expect(v, who).toBe("aHC3XZOMg3HZuXVYK6hy");
      if (c.voiceType !== "boy" && c.voiceType !== "girl" && c.voiceType !== "creature") expect(KIDS, who).not.toContain(v);
      if (c.voiceType === "grandma") expect(v, who).toBe(HIEN);
    }
  });
  it("recast SQL updates only changed characters per tagged story and audits it", () => {
    const sql = buildLibraryRecastSql(pack, VOICES_8, "Thêm giọng T18");
    expect(sql.startsWith("BEGIN;")).toBe(true);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    for (const s of pack) expect(sql).toContain(`'${LIBRARY_TAG_PREFIX}${s.slug}' = ANY (tags) AND is_platform_content AND deleted_at IS NULL`);
    expect(sql).toContain("IS DISTINCT FROM v.voice_id");
    expect(sql).toContain(`('Tích Chu', '${BIN}'::text`);
    expect(sql.match(/audit_write\('story\.update'/g)).toHaveLength(pack.length);
  });
});

describe("library import SQL", () => {
  const sql = buildLibraryImportSql(pack, { ownerId: OWNER, voices: VOICES, version: "v1", reason: "T18 kho truyện v1" });
  it("is one transaction, idempotent per slug tag, and audited", () => {
    expect(sql.startsWith("BEGIN;")).toBe(true);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    for (const s of pack) {
      expect(sql).toContain(`WHERE NOT EXISTS (SELECT 1 FROM public.stories WHERE '${LIBRARY_TAG_PREFIX}${s.slug}' = ANY (tags) AND deleted_at IS NULL)`);
    }
    expect(sql.match(/public\.audit_write\('story\.create'/g)).toHaveLength(12);
    expect(sql.match(/'published', true, true/g)).toHaveLength(12);
  });
  it("escapes quotes and refuses a bad owner id or a broken pack", () => {
    const s = structuredClone(pack[0]);
    s.title = "Bà's test";
    expect(buildLibraryImportSql([s], { ownerId: OWNER, voices: VOICES, version: "v1", reason: "x" })).toContain("'Bà''s test'");
    expect(() => buildLibraryImportSql(pack, { ownerId: "nope", voices: VOICES, version: "v1", reason: "x" })).toThrow(/uuid/);
    const broken = structuredClone(pack[0]);
    broken.pages = broken.pages.slice(0, 5);
    expect(() => buildLibraryImportSql([broken], { ownerId: OWNER, voices: VOICES, version: "v1", reason: "x" })).toThrow(/pages/);
  });
  it("trashes the older untagged Sọ Dừa only once the library version exists", () => {
    const v2 = buildLibraryImportSql(LOADED.v2.pack, { ownerId: OWNER, voices: VOICES_8, version: "v2", reason: "T18 v2" });
    expect(v2.match(/ replaces /g)).toHaveLength(1);
    const block = v2.slice(v2.indexOf("-- so-dua replaces Sọ Dừa"));
    expect(block).toContain("WHERE o.title = 'Sọ Dừa' AND o.is_platform_content AND o.deleted_at IS NULL");
    expect(block).toContain("NOT EXISTS (SELECT 1 FROM unnest(o.tags) x WHERE x LIKE 'kc-lib:%')");
    expect(block).toContain("EXISTS (SELECT 1 FROM public.stories n WHERE 'kc-lib:so-dua' = ANY (n.tags)");
    expect(block).toContain("'replaced_by', 'so-dua'");
    expect(v2.indexOf("-- so-dua replaces")).toBeGreaterThan(v2.indexOf("-- so-dua\n"));
    expect(sql).not.toContain(" replaces ");
    const bad = structuredClone(LOADED.v2.pack[0]) as LibraryStory;
    expect(LibraryStorySchema.safeParse({ ...bad, replaces: { title: "Sọ Dừa", reason: "x" } }).success).toBe(false);
  });
  it("rollback trashes only tagged platform rows and audits it", () => {
    const rb = buildLibraryRollbackSql(["tich-chu"], "rollback");
    expect(rb).toContain("tags && ARRAY['kc-lib:tich-chu']::text[] AND is_platform_content");
    expect(rb).toContain("audit_write('story.trash'");
    expect(rb).toContain("a.after ->> 'replaced_by' = ANY (ARRAY['tich-chu']::text[])");
    expect(rb).toContain("audit_write('story.restore'");
  });
});
