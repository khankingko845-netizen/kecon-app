import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createMigratedDb } from "./supabase-harness";

/**
 * PR #62 — Lượt nghe: one play_sessions row per listen. The app adds the row
 * when the child leaves the full player (insert … returning id) and updates
 * that row while the story goes on in the MiniPlayer (update by id). These are
 * the statements src/lib/db.ts sends, run under the real policies/triggers.
 */
let db: PGlite;
const a = randomUUID(),
  b = randomUUID(),
  admin = randomUUID();
const pub = randomUUID(),
  own = randomUUID(),
  va = randomUUID(),
  vb = randomUUID();

beforeAll(async () => {
  ({ db } = await createMigratedDb());
  for (const id of [admin, a, b]) await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [id, id + "@ps62.test"]);
  await db.query("UPDATE public.profiles SET role='super_admin' WHERE id=$1", [admin]);
  const story = "INSERT INTO public.stories(id,user_id,title,is_platform_content,is_published,status) VALUES($1,$2,$3,$4,$5,$6)";
  await db.query(story, [pub, admin, "Sóc Nhỏ tìm hạt dẻ", true, true, "published"]);
  await db.query(story, [own, a, "Truyện nhà mình", false, false, "draft"]);
  for (const [id, user] of [
    [va, a],
    [vb, b],
  ])
    await db.query("INSERT INTO public.voice_profiles(id,user_id,name) VALUES($1,$2,'Giọng mẹ')", [id, user]);
});

afterAll(async () => {
  await db?.close();
});

const insert = (uid: string, storyId: string, voiceId: string | null) =>
  asUser(db, uid, (t) =>
    t.query<{ id: string }>(
      "INSERT INTO public.play_sessions(user_id,story_id,voice_id,ended_at,duration,pages_listened,completed) VALUES($1,$2,$3,now(),5,1,false) RETURNING id",
      [uid, storyId, voiceId],
    ),
  );

it("the family adds the row when leaving the full player and updates that same row later (no second row)", async () => {
  const added = await insert(a, pub, va);
  expect(added.rows).toHaveLength(1);
  const id = added.rows[0].id;
  const updated = await asUser(db, a, (t) =>
    t.query("UPDATE public.play_sessions SET ended_at=now(),duration=$2,pages_listened=$3,completed=$4 WHERE id=$1 AND user_id=$5", [id, 95, 2, true, a]),
  );
  expect(updated.affectedRows).toBe(1);
  const rows = await asUser(db, a, (t) => t.query<{ duration: number; pages_listened: number; completed: boolean }>("SELECT duration,pages_listened,completed FROM public.play_sessions WHERE story_id=$1", [pub]));
  expect(rows.rows).toEqual([{ duration: 95, pages_listened: 2, completed: true }]);
  // Its own household story works the same.
  expect((await insert(a, own, null)).rows).toHaveLength(1);
});

it("another family cannot see or change that row", async () => {
  const id = (await insert(a, pub, null)).rows[0].id;
  const seen = await asUser(db, b, (t) => t.query("SELECT id FROM public.play_sessions WHERE id=$1", [id]));
  expect(seen.rows).toEqual([]);
  const changed = await asUser(db, b, (t) => t.query("UPDATE public.play_sessions SET duration=9999 WHERE id=$1", [id]));
  expect(changed.affectedRows).toBe(0);
  const still = await db.query<{ duration: number }>("SELECT duration FROM public.play_sessions WHERE id=$1", [id]);
  expect(still.rows[0].duration).toBe(5);
});

it("only a voice of the family is accepted (the app sends the family voice narrating, else none)", async () => {
  await expect(insert(a, pub, vb)).rejects.toThrow(/Invalid content reference/);
  const id = (await insert(a, pub, va)).rows[0].id;
  await expect(asUser(db, a, (t) => t.query("UPDATE public.play_sessions SET voice_id=$2 WHERE id=$1", [id, vb]))).rejects.toThrow(/Invalid content reference/);
});
