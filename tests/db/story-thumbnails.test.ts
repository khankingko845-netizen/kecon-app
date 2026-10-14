import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb, asUser } from "./supabase-harness";

// PR #49 (migration 035): card thumbnails are shape-checked to their own story
// folder, follow the cover, have validated settings, and platform writes go
// through one permission-checked, audited RPC (family stories stay private).
let db: PGlite;
const admin = randomUUID(),
  fam = randomUUID(),
  other = randomUUID();
const lib = randomUUID(),
  own = randomUUID(),
  foreign = randomUUID();
const hex = () => randomUUID().replace(/-/g, "").slice(0, 16);
const thumb = (uploader: string, story: string) => `${uploader}/${story}/thumb-${hex()}.webp`;
const reason = "Tạo thumbnail cho thư viện bé";
type Row = { thumbnail_source: string | null; thumbnail_path: string | null; thumbnail_scene: string | null; cover_image_url: string | null };
const row = async (id: string) =>
  (await db.query<Row>("SELECT thumbnail_source, thumbnail_path, thumbnail_scene, cover_image_url FROM public.stories WHERE id=$1", [id])).rows[0];
const setThumbs = (uid: string, items: unknown, why: string | null = null) =>
  asUser(db, uid, (tx) => tx.query<{ n: number }>("SELECT public.admin_set_story_thumbnails($1::jsonb,$2) n", [JSON.stringify(items), why]));

beforeAll(async () => {
  ({ db } = await createMigratedDb());
  for (const id of [admin, fam, other]) await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [id, id + "@thumbs.test"]);
  await db.query("UPDATE public.profiles SET role='super_admin' WHERE id=$1", [admin]);
  const story = "INSERT INTO public.stories(id,user_id,title,is_platform_content,is_published,status,category,cover_image_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8)";
  await db.query(story, [lib, admin, "Sự tích cây vú sữa", true, true, "published", "fairy_tale", "https://x.test/storage/v1/object/public/illustrations/a/b.webp"]);
  await db.query(story, [own, fam, "Truyện nhà mình", false, false, "draft", "bedtime", null]);
  await db.query(story, [foreign, other, "Truyện nhà khác", false, false, "draft", "animal", null]);
});
afterAll(async () => db?.close());

describe("columns are shape-checked", () => {
  it("accepts a thumbnail inside the story's own folder only", async () => {
    await db.query("UPDATE public.stories SET thumbnail_source='cover', thumbnail_path=$2 WHERE id=$1", [own, thumb(fam, own)]);
    for (const bad of [thumb(fam, foreign), `${fam}/${own}/thumb-xyz.webp`, `../${own}/thumb-${hex()}.webp`, `${fam}/${own}/p1-${hex()}.png`])
      await expect(db.query("UPDATE public.stories SET thumbnail_source='cover', thumbnail_path=$2 WHERE id=$1", [own, bad])).rejects.toThrow(
        /story_thumbnail_path_shape/,
      );
  });
  it("knows the 18 scenes and keeps source/path/scene consistent", async () => {
    await db.query("UPDATE public.stories SET thumbnail_source='scene', thumbnail_path=NULL, thumbnail_scene='castle' WHERE id=$1", [own]);
    await expect(db.query("UPDATE public.stories SET thumbnail_scene='mars' WHERE id=$1", [own])).rejects.toThrow(/story_thumbnail_scene_known/);
    await expect(db.query("UPDATE public.stories SET thumbnail_source='cover' WHERE id=$1", [own])).rejects.toThrow(/story_thumbnail_consistent/);
    await expect(db.query("UPDATE public.stories SET thumbnail_source='icon' WHERE id=$1", [own])).rejects.toThrow(/story_thumbnail_consistent/);
    await expect(db.query("UPDATE public.stories SET thumbnail_source='magic', thumbnail_scene=NULL WHERE id=$1", [own])).rejects.toThrow(
      /story_thumbnail_consistent/,
    );
  });
});

describe("the thumbnail follows the cover", () => {
  it("a cover change alone marks the thumbnail to regenerate; cover+thumbnail together is kept", async () => {
    await db.query("UPDATE public.stories SET thumbnail_source='scene', thumbnail_scene='forest', thumbnail_path=NULL, thumbnail_updated_at=now() WHERE id=$1", [own]);
    await db.query("UPDATE public.stories SET cover_image_url='https://x.test/storage/v1/object/public/illustrations/c.webp' WHERE id=$1", [own]);
    expect(await row(own)).toMatchObject({ thumbnail_source: null, thumbnail_scene: null, thumbnail_path: null });
    const p = thumb(fam, own);
    await db.query("UPDATE public.stories SET cover_image_url='https://x.test/d.webp', thumbnail_source='cover', thumbnail_path=$2, thumbnail_updated_at=now() WHERE id=$1", [own, p]);
    expect(await row(own)).toMatchObject({ thumbnail_source: "cover", thumbnail_path: p, cover_image_url: "https://x.test/d.webp" });
    await db.query("UPDATE public.stories SET title='Đổi tên' WHERE id=$1", [own]);
    expect((await row(own)).thumbnail_path).toBe(p);
  });
  it("owners set their own thumbnail; other families cannot touch it", async () => {
    const n = await asUser(db, fam, (tx) =>
      tx.query("UPDATE public.stories SET thumbnail_source='scene', thumbnail_scene='sky', thumbnail_path=NULL, thumbnail_updated_at=now() WHERE id=$1", [own]),
    );
    expect(n.affectedRows).toBe(1);
    const m = await asUser(db, other, (tx) =>
      tx.query("UPDATE public.stories SET thumbnail_source='icon', thumbnail_scene=NULL, thumbnail_updated_at=now() WHERE id=$1", [own]),
    );
    expect(m.affectedRows).toBe(0);
    expect((await row(own)).thumbnail_scene).toBe("sky");
  });
});

describe("settings are seeded and validated", () => {
  it("seeds safe defaults (non-secret, category image)", async () => {
    const { rows } = await db.query<{ key: string; value: string; category: string; is_secret: boolean }>(
      "SELECT key,value,category,is_secret FROM public.app_settings WHERE key LIKE 'thumbnail\\_%' ORDER BY key",
    );
    expect(rows).toEqual([
      { key: "thumbnail_auto", value: "true", category: "image", is_secret: false },
      { key: "thumbnail_fallback", value: "scene", category: "image", is_secret: false },
      { key: "thumbnail_quality", value: "72", category: "image", is_secret: false },
      { key: "thumbnail_width", value: "480", category: "image", is_secret: false },
    ]);
  });
  it("staff can change them within bounds; bad values are refused", async () => {
    const set = (key: string, value: string) =>
      asUser(db, admin, (tx) => tx.query("UPDATE public.app_settings SET value=$2 WHERE key=$1", [key, value]));
    expect((await set("thumbnail_width", "640")).affectedRows).toBe(1);
    expect((await set("thumbnail_quality", "60")).affectedRows).toBe(1);
    for (const [k, v] of [["thumbnail_width", "4096"], ["thumbnail_quality", "95"], ["thumbnail_quality", "7x"], ["thumbnail_auto", "yes"], ["thumbnail_fallback", "cover"]])
      await expect(set(k, v)).rejects.toThrow(/valid_thumbnail_setting/);
    const fam1 = await asUser(db, fam, (tx) => tx.query("UPDATE public.app_settings SET value='360' WHERE key='thumbnail_width'"));
    expect(fam1.affectedRows).toBe(0);
    await set("thumbnail_width", "480");
    await set("thumbnail_quality", "72");
  });
});

describe("admin_set_story_thumbnails", () => {
  it("staff set platform thumbnails + cover atomically, audited with the reason", async () => {
    const p = thumb(admin, lib);
    const cover = "https://x.test/storage/v1/object/public/illustrations/new-cover.webp";
    const r = await setThumbs(admin, [{ id: lib, source: "upload", path: p, scene: null, expect_path: null, cover }], reason);
    expect(r.rows[0].n).toBe(1);
    expect(await row(lib)).toMatchObject({ thumbnail_source: "upload", thumbnail_path: p, cover_image_url: cover });
    const { rows } = await db.query<{ reason: string; after: unknown }>(
      "SELECT reason, after FROM public.admin_audit_log WHERE target_id=$1 AND actor_id=$2 ORDER BY id DESC LIMIT 1",
      [lib, admin],
    );
    expect(rows[0].reason).toBe(reason);
    expect(JSON.stringify(rows[0].after)).toContain("thumbnail_path");
    // compare-and-set on the previous path: a stale writer gets 40001, nothing changes
    await expect(setThumbs(admin, [{ id: lib, source: "scene", path: null, scene: "castle", expect_path: null }])).rejects.toThrow(/đã thay đổi/);
    const ok = await setThumbs(admin, [{ id: lib, source: "scene", path: null, scene: "castle", expect_path: p }]);
    expect(ok.rows[0].n).toBe(1);
    expect(await row(lib)).toMatchObject({ thumbnail_source: "scene", thumbnail_scene: "castle", cover_image_url: cover });
  });
  it("refuses family users, family stories, bad input and short reasons", async () => {
    const item = { id: lib, source: "icon", path: null, scene: null, expect_path: null };
    await expect(setThumbs(fam, [item])).rejects.toThrow(/Không có quyền/);
    await expect(setThumbs(admin, [{ ...item, id: own, expect_path: null }])).rejects.toThrow(/không phải truyện nền tảng/);
    await expect(setThumbs(admin, [])).rejects.toThrow(/1–200/);
    await expect(setThumbs(admin, Array(201).fill(item))).rejects.toThrow(/1–200/);
    await expect(setThumbs(admin, [{ id: lib, source: "icon" }])).rejects.toThrow(/không hợp lệ/);
    await expect(setThumbs(admin, [{ ...item, cover: "javascript:alert(1)" }])).rejects.toThrow(/Ảnh bìa không hợp lệ/);
    await expect(setThumbs(admin, [item], "ngắn")).rejects.toThrow(/10–500/);
    // one bad item rolls back the whole batch
    const before = await row(lib);
    await expect(
      setThumbs(admin, [{ id: lib, source: "icon", path: null, scene: null, expect_path: null }, { ...item, id: own }]),
    ).rejects.toThrow();
    expect(await row(lib)).toEqual(before);
  });
  it("stats: platform per source, family totals only; staff only", async () => {
    const r = await asUser(db, admin, (tx) => tx.query<{ s: { platform: Record<string, number>; family: Record<string, number> } }>("SELECT public.admin_thumbnail_stats() s"));
    expect(r.rows[0].s.platform).toMatchObject({ total: 1, with_cover: 1, missing: 0, scene: 1 });
    expect(Object.keys(r.rows[0].s.family).sort()).toEqual(["missing", "total"]);
    expect(r.rows[0].s.family.total).toBe(2);
    await expect(asUser(db, fam, (tx) => tx.query("SELECT public.admin_thumbnail_stats()"))).rejects.toThrow(/Không có quyền/);
  });
});
