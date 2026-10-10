import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LIBRARY_TAG_PREFIX,
  LibraryStorySchema,
  buildLibraryImportSql,
  buildLibraryRollbackSql,
  libraryCasting,
  libraryStoryProblems,
  packProblems,
  type LibraryStory,
} from "@/lib/library-pack";
import { assessStory } from "@/lib/story-ai";
import { pagePlan } from "@/lib/story-brief";
import { castVoices } from "@/lib/voice-casting";

const DIR = path.join(process.cwd(), "content/library/v1");
const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
const raw = files.map((f) => JSON.parse(readFileSync(path.join(DIR, f), "utf8")) as unknown);
const pack = raw.map((r) => LibraryStorySchema.parse(r));

/** The Vietnamese default voices on staging (default_voices, PR #42). */
const VOICES = [
  { voice_id: "iSFxP4Z6YNcx9OXl62Ic", name: "Viên - Narrative, Warm and Clear (northern)", gender: null, description: null, sort_order: 1 },
  { voice_id: "aHC3XZOMg3HZuXVYK6hy", name: "Yuna — bé gái tinh nghịch", gender: "female", description: "Giọng bé gái trẻ em, trong trẻo, tinh nghịch, tò mò (giọng nhân vật).", sort_order: 2 },
  { voice_id: "IovBBFnLZ6QzJhFLLroy", name: "Tâm — cô kể chuyện cổ tích", gender: "female", description: "Giọng cô người lớn, ấm áp, dịu dàng, hợp truyện cổ tích.", sort_order: 3 },
  { voice_id: "KVzG2JMdZJKi6y7cwERP", name: "Quang — chú trầm ấm", gender: "male", description: "Giọng chú người lớn, trầm ấm, miền Bắc.", sort_order: 4 },
  { voice_id: "oLR5l8TbWm0sNc5LspDA", name: "Thanh — ông hiền từ", gender: "male", description: "Giọng ông cao tuổi, trầm, chậm rãi, hiền từ, miền Nam.", sort_order: 5 },
];
const OWNER = "7783d62b-0fa9-4a06-a7f6-775a73331635";

describe("library pack v1", () => {
  it("ships 12 stories with one file per slug", () => {
    expect(files).toHaveLength(12);
    expect(files).toEqual(pack.map((s) => `${s.slug}.json`).sort());
  });

  it.each(files.map((f, i) => [f, raw[i]] as const))("%s passes the editorial checks", (_f, story) => {
    expect(libraryStoryProblems(story)).toEqual([]);
  });

  it("has no duplicate slugs or titles and covers the kid library filters", () => {
    expect(packProblems(raw)).toEqual([]);
    const cats = new Set(pack.map((s) => s.category));
    expect(cats).toEqual(new Set(["fairy_tale", "folk", "bedtime"]));
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
  it("documents today's gaps: no boy voice, one adult woman voice", () => {
    const tich = pack.find((s) => s.slug === "tich-chu")!;
    const { cast } = libraryCasting(tich, VOICES);
    expect(cast.get("Tích Chu")?.voice_id).toBe("KVzG2JMdZJKi6y7cwERP"); // boy read by the adult male voice
    expect(cast.get("Bà")?.voice_id).toBe(TAM);
    expect(cast.get("Bà Tiên")?.voice_id).toBe(YUNA); // second woman falls back to the bright child voice
  });
  it("prefers the adjacent age group: grandma → adult woman, not a girl", () => {
    const cast = castVoices([{ name: "Bà", voiceType: "grandma" }], VOICES, "iSFxP4Z6YNcx9OXl62Ic");
    expect(cast.get("Bà")?.voice_id).toBe("IovBBFnLZ6QzJhFLLroy");
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
  it("rollback trashes only tagged platform rows and audits it", () => {
    const rb = buildLibraryRollbackSql(["tich-chu"], "rollback");
    expect(rb).toContain("tags && ARRAY['kc-lib:tich-chu']::text[] AND is_platform_content");
    expect(rb).toContain("audit_write('story.trash'");
  });
});
