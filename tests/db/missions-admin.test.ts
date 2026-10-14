import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb, asUser, asAnon } from "./supabase-harness";

// G-08 (docs/g08-missions-admin.md): staff edit mission templates and pause
// character cards with a reason; every real change is exactly one audit row.
let db: PGlite;
const editor = randomUUID(),
  analyst = randomUUID(),
  fam = randomUUID(),
  kidA = randomUUID(),
  kidB = randomUUID();
const story = randomUUID(),
  privateStory = randomUUID();
const REASON = "Sửa câu chữ theo góp ý biên tập G-08";
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const one = async <T = J>(uid: string, sql: string, args: unknown[] = []) =>
  (await asUser(db, uid, (tx) => tx.query<{ r: T }>(sql, args))).rows[0].r;
const catalog = (uid = editor) => one<J>(uid, "SELECT public.admin_missions_catalog() r");
const edit = (id: string, version: number, patch: J, reason = REASON, uid = editor) =>
  one<J>(uid, "SELECT public.admin_update_mission_template($1,$2,$3::jsonb,$4) r", [id, version, JSON.stringify(patch), reason]);
const sticker = (enabled: boolean, expected: boolean, reason = REASON, id = story) =>
  one<boolean>(editor, "SELECT public.admin_set_mission_sticker($1,$2,$3,$4) r", [id, enabled, expected, reason]);
const version = async (id: string) =>
  (await db.query<{ version: number }>("SELECT version FROM public.mission_templates WHERE id=$1", [id])).rows[0].version;
const audits = async (action: string) =>
  (await db.query<J>("SELECT actor_id, target_id, before, after, reason, source FROM public.admin_audit_log WHERE action=$1 ORDER BY id", [action])).rows;
/** Listen to the library story far enough to be counted, as `uid`. */
async function listen(uid: string): Promise<J> {
  const { session_id } = await one<{ session_id: string }>(uid, "SELECT public.missions_start_listen($1) r", [story]);
  await db.query("UPDATE public.listen_sessions SET started_at=now()-interval '5 minutes' WHERE id=$1", [session_id]);
  return one<J>(uid, "SELECT public.missions_complete_listen($1) r", [session_id]);
}
const stickers = async (uid: string) =>
  Number((await db.query<{ n: string }>("SELECT count(*) n FROM public.reward_ledger WHERE user_id=$1 AND kind='sticker'", [uid])).rows[0].n);

beforeAll(async () => {
  ({ db } = await createMigratedDb());
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,'g08-editor@g08.test'),($2,'g08-analyst@g08.test'),($3,'g08-fam@g08.test'),($4,'g08-a@g08.test'),($5,'g08-b@g08.test')", [
    editor, analyst, fam, kidA, kidB,
  ]);
  await db.query("UPDATE public.profiles SET role='editor' WHERE id=$1", [editor]);
  await db.query("UPDATE public.profiles SET role='analyst' WHERE id=$1", [analyst]);
  await db.query(
    "INSERT INTO public.stories(id,user_id,title,is_platform_content,is_published,status,category,tags) VALUES($1,$3,'Đồ chơi muốn về nhà',true,true,'published','bedtime','{kc-lib:do-choi-muon-ve-nha,thoi-quen-tot}'),($2,$4,'Truyện riêng',false,false,'draft','bedtime','{kc-lib:fake}')",
    [story, privateStory, editor, fam],
  );
  await db.query("INSERT INTO public.story_pages(story_id,page_number,content) VALUES($1,1,repeat('a',700))", [story]); // 20 s minimum
  const superAdmin = randomUUID();
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,'g08-super@g08.test')", [superAdmin]);
  await db.query("UPDATE public.profiles SET role='super_admin' WHERE id=$1", [superAdmin]);
  await asUser(db, superAdmin, (tx) => tx.query("SELECT public.set_feature_flag('missions',true,false,'Bật nhiệm vụ để kiểm thử G-08')"));
});
afterAll(async () => {
  await db?.close();
});

describe("access", () => {
  it("needs templates.manage: families, analysts and visitors are refused; no direct writes", async () => {
    await expect(catalog(fam)).rejects.toThrow(/Permission denied/);
    await expect(catalog(analyst)).rejects.toThrow(/Permission denied/);
    await expect(edit("chia-se", 1, { active: false }, REASON, fam)).rejects.toThrow(/Permission denied/);
    await expect(asAnon(db, (tx) => tx.query("SELECT public.admin_missions_catalog()"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, editor, (tx) => tx.query("UPDATE public.mission_templates SET praise='x' WHERE id='chia-se'"))).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, editor, (tx) => tx.query("INSERT INTO public.mission_sticker_settings(story_id,enabled) VALUES($1,false)", [story])),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(db, fam, (tx) => tx.query("SELECT * FROM public.mission_sticker_settings"))).rejects.toThrow(/permission denied/);
  });

  it("lists every template and only library cards, with counts and no family data", async () => {
    const c = await catalog();
    const ids = c.templates.map((t: J) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["nghe-het-truyen", "co-tich", "tu-cat-do-choi", "chia-se", "ca-nha-doc-cung"]));
    expect(c.templates).toHaveLength(17);
    const habit = c.templates.find((t: J) => t.id === "tu-cat-do-choi");
    expect(habit).toMatchObject({ kind: "habit", active: true, version: 1, story_title: "Đồ chơi muốn về nhà", done_28d: 0 });
    expect(c.stickers.map((s: J) => s.story_id)).toEqual([story]); // not the private story
    expect(c.stickers[0]).toMatchObject({ enabled: true, awarded: 0, published: true });
    expect(JSON.stringify(c)).not.toMatch(/@g08\.test|user_id/);
  });
});

describe("edit a template", () => {
  it("requires a reason and the current version; only fields that fit the kind", async () => {
    await expect(edit("tu-cat-do-choi", 1, { praise: "Bé đã tự cất đồ chơi gọn gàng!" }, "ngắn")).rejects.toThrow(/Lý do/);
    await expect(edit("tu-cat-do-choi", 7, { praise: "Bé đã tự cất đồ chơi gọn gàng!" })).rejects.toThrow(/changed; reload/);
    await expect(edit("khong-co", 1, { active: false })).rejects.toThrow(/Unknown template/);
    await expect(edit("tu-cat-do-choi", 1, {})).rejects.toThrow(/Nothing to change/);
    await expect(edit("nghe-het-truyen", 1, { active: false })).rejects.toThrow(/not editable/); // base stays on
    await expect(edit("co-tich", 1, { title: "Cổ tích" })).rejects.toThrow(/not editable/); // in-app copy lives in the app
    await expect(edit("ca-nha-doc-cung", 1, { active: false })).rejects.toThrow(/not editable/); // family stays on
    await expect(edit("tu-cat-do-choi", 1, { story_tag: "kc-lib:x" })).rejects.toThrow(/not editable/);
    await expect(edit("tu-cat-do-choi", 1, { active: "false" })).rejects.toThrow(/Invalid value/);
    await expect(edit("ca-nha-doc-cung", 1, { target: 2.5 })).rejects.toThrow(/Invalid value/);
    expect(await audits("mission_template.update")).toHaveLength(0);
  });

  it("keeps process praise: no 'giỏi / thông minh / liên tục', sane lengths, kindness only thanks", async () => {
    await expect(edit("tu-cat-do-choi", 1, { praise: "Bé giỏi quá!" })).rejects.toThrow(/mission_templates_process_praise/);
    await expect(edit("tu-cat-do-choi", 1, { title: "Cất đồ chơi liên tục" })).rejects.toThrow(/mission_templates_process_praise/);
    await expect(edit("tu-cat-do-choi", 1, { title: "x" })).rejects.toThrow(/check constraint/);
    await expect(edit("ca-nha-doc-cung", 1, { target: 9 })).rejects.toThrow(/check constraint/);
    await expect(edit("chia-se", 1, { praise: "Bé chia sẻ với bạn, Đóm thấy vui!" })).rejects.toThrow(/must thank/);
    expect(await version("tu-cat-do-choi")).toBe(1);
    expect(await audits("mission_template.update")).toHaveLength(0);
  });

  it("a real change bumps the version and writes exactly one audit row with the reason", async () => {
    const r = await edit("tu-cat-do-choi", 1, { praise: "  Bé đã tự đưa đồ chơi về nhà. Đóm thấy bé cố gắng lắm!  ", prompt: null });
    expect(r).toEqual({ changed: true, version: 2 });
    const row = (await db.query<J>("SELECT praise, prompt, version FROM public.mission_templates WHERE id='tu-cat-do-choi'")).rows[0];
    expect(row).toEqual({ praise: "Bé đã tự đưa đồ chơi về nhà. Đóm thấy bé cố gắng lắm!", prompt: null, version: 2 });
    const log = await audits("mission_template.update");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actor_id: editor, target_id: "tu-cat-do-choi", reason: REASON, source: "db" });
    expect(log[0].before).toMatchObject({ version: 1, prompt: expect.stringContaining("Hỏi bé") });
    expect(log[0].after).toMatchObject({ version: 2, prompt: null, praise: row.praise });
    // Same values again: nothing changes, nothing is logged.
    expect(await edit("tu-cat-do-choi", 2, { praise: row.praise })).toEqual({ changed: false, version: 2 });
    expect(await audits("mission_template.update")).toHaveLength(1);
  });

  it("family target and kindness thanks can change; a paused themed mission leaves the rotation", async () => {
    expect(await edit("ca-nha-doc-cung", 1, { target: 2, parent_label: "Tuần này cả nhà đọc 2 truyện cùng nhau" })).toEqual({ changed: true, version: 2 });
    expect(await edit("chia-se", 1, { praise: "Cảm ơn bé đã chờ đến lượt cùng bạn." })).toEqual({ changed: true, version: 2 });
    const before = await db.query<{ ids: string[] }>("SELECT public.missions_assigned(DATE '2026-10-05' + g) ids FROM generate_series(0,6) g");
    expect(before.rows.some((r) => r.ids.includes("con-vat"))).toBe(true);
    expect(await edit("con-vat", 1, { active: false })).toEqual({ changed: true, version: 2 });
    const after = await db.query<{ ids: string[] }>("SELECT public.missions_assigned(DATE '2026-10-05' + g) ids FROM generate_series(0,6) g");
    expect(after.rows.every((r) => r.ids[0] === "nghe-het-truyen" && !r.ids.includes("con-vat"))).toBe(true);
    expect(await audits("mission_template.update")).toHaveLength(4);
  });
});

describe("character cards", () => {
  it("pausing stops new cards only; cards already earned stay; resuming gives cards again", async () => {
    const first = await listen(kidA);
    expect(first.sticker).toMatchObject({ story_id: story });
    expect(await stickers(kidA)).toBe(1);

    await expect(sticker(false, true, "ngắn")).rejects.toThrow(/Lý do/);
    await expect(sticker(false, false)).rejects.toThrow(/changed; reload/);
    await expect(sticker(false, true, REASON, privateStory)).rejects.toThrow(/Unknown story/);
    expect(await sticker(false, true)).toBe(true);
    expect(await sticker(false, false)).toBe(false); // already paused: no-op, no audit

    const paused = await listen(kidB);
    expect(paused.counted).toBe(true);
    expect(paused.sticker).toBeNull();
    expect(paused.completed).toContain("nghe-het-truyen"); // stars still work
    expect(await stickers(kidB)).toBe(0);
    expect(await stickers(kidA)).toBe(1); // nothing is taken away

    const c = await catalog();
    expect(c.stickers[0]).toMatchObject({ enabled: false, awarded: 1 });
    expect(c.templates.find((t: J) => t.id === "nghe-het-truyen").done_28d).toBe(2);

    expect(await sticker(true, false)).toBe(true);
    await listen(kidB);
    expect(await stickers(kidB)).toBe(1);

    const log = await audits("mission_sticker.update");
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ actor_id: editor, target_id: story, reason: REASON, before: { sticker_enabled: true }, after: { sticker_enabled: false } });
    expect(log[1]).toMatchObject({ before: { sticker_enabled: false }, after: { sticker_enabled: true } });
  });
});
