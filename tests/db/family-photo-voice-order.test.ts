import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb, asUser, asAnon } from "./supabase-harness";
let db: PGlite;
const family = randomUUID(),
  other = randomUUID(),
  admin = randomUUID(),
  ids = [randomUUID(), randomUUID(), randomUUID()];
beforeAll(async () => {
  ({ db } = await createMigratedDb());
  for (const id of [family, other, admin])
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [
      id,
      `${id}@test.local`,
    ]);
  await db.query("UPDATE profiles SET role='super_admin' WHERE id=$1", [admin]);
  await db.query(
    "GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated",
  );
  for (const [i, id] of ids.entries())
    await db.query(
      "INSERT INTO default_voices(id,voice_id,name,language,sort_order) VALUES($1,$2,$3,$4,$5)",
      [id, `voice${i}`, `voice${i}`, i === 2 ? "en" : "vi", i],
    );
});
afterAll(async () => {
  await db?.close();
});
const order = (user: string, lang: string, list: string[]) =>
  asUser(db, user, (tx) =>
    tx.query("SELECT reorder_default_voices($1,$2::uuid[])", [lang, list]),
  );
describe("private photos and atomic voice order", () => {
  it("bucket is private, limited to WebP", async () => {
    expect(
      (
        await db.query(
          "SELECT public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id='family-avatars'",
        )
      ).rows[0],
    ).toMatchObject({
      public: false,
      file_size_limit: 1048576,
      allowed_mime_types: ["image/webp"],
    });
  });
  it("a family cannot read/write/delete another family's photos", async () => {
    const path = `${family}/${randomUUID()}.webp`;
    await asUser(db, family, (tx) =>
      tx.query(
        "INSERT INTO storage.objects(bucket_id,name) VALUES('family-avatars',$1)",
        [path],
      ),
    );
    expect(
      (
        await asUser(db, family, (tx) =>
          tx.query("SELECT * FROM storage.objects"),
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await asUser(db, other, (tx) =>
          tx.query("SELECT * FROM storage.objects"),
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await asUser(db, other, (tx) =>
          tx.query("DELETE FROM storage.objects WHERE name=$1 RETURNING id", [
            path,
          ]),
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      asUser(db, other, (tx) =>
        tx.query(
          "INSERT INTO storage.objects(bucket_id,name) VALUES('family-avatars',$1)",
          [path],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asAnon(db, (tx) => tx.query("SELECT * FROM storage.objects")),
    ).rejects.toThrow(/permission denied/);
  });
  it("normal family cannot reorder", async () => {
    await expect(order(family, "vi", [ids[1], ids[0]])).rejects.toThrow(
      /Không có quyền/,
    );
  });
  it("reorders only the requested locale and produces immutable audit rows", async () => {
    const before = Number(
      (
        await db.query<{ n: number }>(
          "SELECT max(id) AS n FROM admin_audit_log",
        )
      ).rows[0].n ?? 0,
    );
    await order(admin, "vi", [ids[1], ids[0]]);
    const voices = (
      await db.query<{ id: string; sort_order: number }>(
        "SELECT id,sort_order FROM default_voices ORDER BY sort_order,id",
      )
    ).rows;
    expect(voices.find((v) => v.id === ids[1])?.sort_order).toBe(0);
    expect(voices.find((v) => v.id === ids[0])?.sort_order).toBe(1);
    expect(voices.find((v) => v.id === ids[2])?.sort_order).toBe(2);
    const logs = (
      await db.query<{ actor_id: string }>(
        "SELECT actor_id FROM admin_audit_log WHERE id>$1",
        [before],
      )
    ).rows;
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.actor_id === admin)).toBe(true);
  });
  it("rejects duplicates, missing, cross-language and stale lists without partial changes", async () => {
    const snapshot = (
      await db.query("SELECT id,sort_order FROM default_voices ORDER BY id")
    ).rows;
    for (const list of [
      [ids[0], ids[0]],
      [ids[0]],
      [ids[0], ids[2]],
      [ids[0], randomUUID()],
    ])
      await expect(order(admin, "vi", list)).rejects.toThrow(/Danh sách/);
    expect(
      (await db.query("SELECT id,sort_order FROM default_voices ORDER BY id"))
        .rows,
    ).toEqual(snapshot);
  });
});
