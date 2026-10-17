import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createMigratedDb } from "./supabase-harness";

let db: PGlite;
const owner = randomUUID();
const other = randomUUID();

beforeAll(async () => {
  ({ db } = await createMigratedDb());
  for (const id of [owner, other]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [id, `${id}@studio.test`]);
  }
});

afterAll(async () => {
  await db?.close();
});

async function newStory(fields: Record<string, unknown> = {}): Promise<string> {
  const cols = ["user_id", "title", ...Object.keys(fields)];
  const vals = [owner, "Truyện v2", ...Object.values(fields)];
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO public.stories(${cols.join(",")}) VALUES(${cols.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`,
    vals
  );
  return rows[0].id;
}

describe("033 · Story Studio v2 columns", () => {
  it("legacy rows keep NULL / false defaults", async () => {
    const id = await newStory();
    const { rows } = await db.query<Record<string, unknown>>(
      "SELECT generator_version, story_length, narration_pace, cast_voices, auto_ambience, illustration_style FROM public.stories WHERE id=$1",
      [id]
    );
    expect(rows[0]).toEqual({
      generator_version: null,
      story_length: null,
      narration_pace: null,
      cast_voices: false,
      auto_ambience: false,
      illustration_style: null,
    });
  });

  it("the owner can write a v2 story with its cast and page direction (RLS)", async () => {
    await asUser(db, owner, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO public.stories(user_id,title,generator_version,story_length,narration_pace,cast_voices,auto_ambience,illustration_style)
         VALUES($1,'Thỏ Bông và Rồng Xanh',2,'long','calm',true,true,'clay') RETURNING id`,
        [owner]
      );
      const storyId = rows[0].id;
      await tx.query(
        `INSERT INTO public.story_pages(story_id,page_number,content,scene_id,mood,illustration_prompt,ambient_sound)
         VALUES($1,1,'Ngày xửa ngày xưa…','forest-day','curious','A bunny in a sunny forest','forest')`,
        [storyId]
      );
      await tx.query(
        `INSERT INTO public.story_characters(story_id,name,role,voice_type,appearance,preset_id)
         VALUES($1,'Thỏ Bông','hero','girl','small white clay bunny with a pink scarf','bunny')`,
        [storyId]
      );
      const page = await tx.query<{ scene_id: string; mood: string }>(
        "SELECT scene_id, mood FROM public.story_pages WHERE story_id=$1",
        [storyId]
      );
      expect(page.rows[0]).toEqual({ scene_id: "forest-day", mood: "curious" });
    });
  });

  it("another family cannot read the v2 cast", async () => {
    const storyId = await newStory({ generator_version: 2 });
    await db.query(
      "INSERT INTO public.story_characters(story_id,name,role,voice_type) VALUES($1,'Bí mật','hero','boy')",
      [storyId]
    );
    const rows = await asUser(db, other, async (tx) =>
      (await tx.query("SELECT id FROM public.story_characters WHERE story_id=$1", [storyId])).rows
    );
    expect(rows).toHaveLength(0);
  });

  it.each([
    ["stories", "story_length", "'epic'"],
    ["stories", "narration_pace", "'fast'"],
    ["stories", "generator_version", "0"],
    ["stories", "illustration_style", "'Clay Style!'"],
  ])("rejects invalid %s.%s", async (_table, col, bad) => {
    await expect(
      db.query(`INSERT INTO public.stories(user_id,title,${col}) VALUES($1,'x',${bad})`, [owner])
    ).rejects.toThrow(/check constraint/i);
  });

  it("rejects invalid page and character direction", async () => {
    const storyId = await newStory({ generator_version: 2 });
    await expect(
      db.query("INSERT INTO public.story_pages(story_id,page_number,content,mood) VALUES($1,1,'a','angry')", [storyId])
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.query("INSERT INTO public.story_pages(story_id,page_number,content,scene_id) VALUES($1,2,'a','../etc')", [storyId])
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.query("INSERT INTO public.story_pages(story_id,page_number,content,illustration_prompt) VALUES($1,3,'a',repeat('x',1001))", [storyId])
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.query("INSERT INTO public.story_characters(story_id,name,role) VALUES($1,'A','villain')", [storyId])
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.query("INSERT INTO public.story_characters(story_id,name,voice_type) VALUES($1,'A','robot')", [storyId])
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.query("INSERT INTO public.story_characters(story_id,name,appearance) VALUES($1,'A',repeat('x',401))", [storyId])
    ).rejects.toThrow(/check constraint/i);
  });

  it("seeds non-secret illustration settings", async () => {
    const { rows } = await db.query<{ key: string; value: string; is_secret: boolean }>(
      "SELECT key, value, is_secret FROM public.app_settings WHERE key LIKE 'illustration_%' ORDER BY key"
    );
    expect(rows).toEqual([
      { key: "illustration_model", value: "", is_secret: false },
      { key: "illustration_provider", value: "auto", is_secret: false },
      { key: "illustration_quality", value: "low", is_secret: false },
    ]);
  });
});
