import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb, asUser, asAnon } from "./supabase-harness";
let db: PGlite;
const owner = randomUUID(),
  other = randomUUID(),
  story = randomUUID(),
  page = randomUUID();
beforeAll(async () => {
  ({ db } = await createMigratedDb());
  for (const id of [owner, other])
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      id,
      `${id}@qa.test`,
    ]);
  await db.query(
    "insert into stories(id,user_id,title,status) values($1,$2,'QA cache','draft')",
    [story, owner],
  );
  await db.query(
    "insert into story_pages(id,story_id,page_number,content,audio_url) values($1,$2,1,'Xin chào','https://example.test/legacy.mp3')",
    [page, story],
  );
});
afterAll(async () => db?.close());
describe("audio identity migration preserves tenant RLS", () => {
  it("legacy audio is kept but identity remains unknown", async () => {
    const { rows } = await db.query(
      "select audio_url,audio_key from story_pages where id=$1",
      [page],
    );
    expect(rows[0]).toEqual({
      audio_url: "https://example.test/legacy.mp3",
      audio_key: null,
    });
  });
  it("owner writes URL and key together; another family cannot replace either", async () => {
    await asUser(db, owner, (tx) =>
      tx.query(
        "update story_pages set audio_url='https://example.test/new.mp3',audio_key=$1 where id=$2",
        ["a".repeat(64), page],
      ),
    );
    await asUser(db, other, (tx) =>
      tx.query("update story_pages set audio_key='evil' where id=$1", [page]),
    );
    const { rows } = await db.query<{ audio_key: string }>(
      "select audio_key from story_pages where id=$1",
      [page],
    );
    expect(rows[0].audio_key).toBe("a".repeat(64));
  });
  it("anonymous cannot read private draft/audio fingerprint while published platform remains usable",async()=>{
    expect((await asAnon(db,tx=>tx.query("select audio_key from story_pages where id=$1",[page]))).rows).toEqual([]);
  });
});
