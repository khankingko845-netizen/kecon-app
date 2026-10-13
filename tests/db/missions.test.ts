import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb, asUser, asAnon } from "./supabase-harness";

// G-03/G-04 MVP (docs/missions-mvp.md): rewards are server-recorded facts of
// what the family did — never bought, random or lost; clients cannot write them.
let db: PGlite;
const admin = randomUUID(),
  a = randomUUID(),
  b = randomUUID();
const lib = randomUUID(), // library story matching every theme
  libDraft = randomUUID(),
  own = randomUUID(),
  foreign = randomUUID(),
  longStory = randomUUID();
const reason = "Bật nhiệm vụ để kiểm thử G-03";
type J = Record<string, unknown>;
const rpc = async <T = J>(uid: string, sql: string, args: unknown[] = []) =>
  (await asUser(db, uid, (tx) => tx.query<{ r: T }>(sql, args))).rows[0].r;
const start = (uid: string, story: string) =>
  rpc<{ session_id: string; min_seconds: number }>(uid, "SELECT public.missions_start_listen($1) r", [story]);
const complete = (uid: string, session: string) =>
  rpc<J>(uid, "SELECT public.missions_complete_listen($1) r", [session]);
const age = (session: string, seconds: number) =>
  db.query("UPDATE public.listen_sessions SET started_at=now()-make_interval(secs=>$2) WHERE id=$1", [session, seconds]);
const setFlag = (on: boolean) =>
  asUser(db, admin, (tx) => tx.query("SELECT public.set_feature_flag('missions',$1,$2,$3)", [on, !on, reason]));
const ledger = async (uid: string) =>
  (await db.query<{ kind: string; n: number }>("SELECT kind, count(*)::int n FROM public.reward_ledger WHERE user_id=$1 GROUP BY kind ORDER BY kind", [uid])).rows;

beforeAll(async () => {
  ({ db } = await createMigratedDb());
  for (const id of [admin, a, b]) await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [id, id + "@g03.test"]);
  await db.query("UPDATE public.profiles SET role='super_admin' WHERE id=$1", [admin]);
  const story = "INSERT INTO public.stories(id,user_id,title,is_platform_content,is_published,status,category,tags) VALUES($1,$2,$3,$4,$5,$6,$7,$8)";
  await db.query(story, [lib, admin, "Sự tích cây vú sữa", true, true, "published", "fairy_tale", ["kc-lib:vu-sua", "thoi-quen-tot", "dong-vat"]]);
  await db.query(story, [libDraft, admin, "Bản nháp", true, false, "draft", "animal", ["kc-lib:nhap"]]);
  await db.query(story, [own, a, "Truyện nhà mình", false, false, "draft", "bedtime", []]);
  await db.query(story, [foreign, b, "Truyện nhà khác", false, false, "draft", "animal", []]);
  await db.query(story, [longStory, admin, "Truyện rất dài", true, true, "published", "bedtime", ["kc-lib:dai"]]);
  // ≈15.6 chars/s narration; 3,500 chars → 100 s at the 35 chars/s floor.
  await db.query("INSERT INTO public.story_pages(story_id,page_number,content) VALUES($1,1,repeat('a',1750)),($1,2,repeat('b',1750))", [lib]);
  await db.query("INSERT INTO public.story_pages(story_id,page_number,content) VALUES($1,1,repeat('c',40000))", [longStory]);
});
afterAll(async () => {
  await db?.close();
});

describe("missions flag gate", () => {
  it("is off by default: RPCs refuse, anon cannot execute, internals stay private", async () => {
    expect((await db.query<{ v: string }>("SELECT value v FROM public.app_settings WHERE key='feature.missions'")).rows[0].v).toBe("false");
    await expect(rpc(a, "SELECT public.missions_today() r")).rejects.toThrow(/Action unavailable/);
    await expect(start(a, lib)).rejects.toThrow(/Action unavailable/);
    await expect(asAnon(db, (tx) => tx.query("SELECT public.missions_today()"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, a, (tx) => tx.query("SELECT public.missions_summary_for($1, now())", [a]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, a, (tx) => tx.query("SELECT public.missions_assigned(current_date)"))).rejects.toThrow(/permission denied/);
    expect((await asUser(db, a, (tx) => tx.query("SELECT * FROM public.mission_templates"))).rows).toHaveLength(0);
  });
  it("can be enabled only through the audited flag RPC", async () => {
    await setFlag(true);
    const flags = (await asAnon(db, (tx) => tx.query<{ f: J }>("SELECT public.public_feature_flags() f"))).rows[0].f;
    expect(flags.missions).toBe(true);
    expect((await asUser(db, a, (tx) => tx.query("SELECT id FROM public.mission_templates"))).rows.length).toBe(5);
  });
});

describe("Vietnam calendar and rotation", () => {
  it("uses Asia/Ho_Chi_Minh days, Monday weeks and a 2-mission daily rotation", async () => {
    const q = async (sql: string) => (await db.query<{ r: unknown }>(sql)).rows[0].r;
    expect(await q("SELECT public.missions_local_date('2026-03-04 17:30+00')::text r")).toBe("2026-03-05");
    expect(await q("SELECT public.missions_week_start('2026-03-08')::text r")).toBe("2026-03-02");
    expect(await q("SELECT public.missions_week_start('2026-03-02')::text r")).toBe("2026-03-02");
    expect(await q("SELECT public.missions_assigned('2026-01-05') r")).toEqual(["nghe-het-truyen", "co-tich"]);
    expect(await q("SELECT public.missions_assigned('2026-01-06') r")).toEqual(["nghe-het-truyen", "thoi-quen-tot"]);
    expect(await q("SELECT public.missions_assigned('2026-01-07') r")).toEqual(["nghe-het-truyen", "con-vat"]);
    expect(await q("SELECT public.missions_assigned('2026-01-08') r")).toEqual(["nghe-het-truyen", "truyen-moi"]);
    expect(await q("SELECT public.missions_assigned('2026-01-09') r")).toEqual(["nghe-het-truyen", "co-tich"]);
    expect(await q("SELECT public.missions_assigned('2026-01-04') r")).toEqual(["nghe-het-truyen", "truyen-moi"]);
  });
});

describe("listening sessions", () => {
  it("only readable stories start a session; min time follows story length", async () => {
    for (const s of [foreign, libDraft, randomUUID()]) await expect(start(a, s)).rejects.toThrow(/Story unavailable/);
    expect((await start(a, lib)).min_seconds).toBe(100);
    expect((await start(a, own)).min_seconds).toBe(15);
    expect((await start(a, longStory)).min_seconds).toBe(900);
  });
  it("skipping through earns nothing; another family cannot complete the session", async () => {
    const s = await start(a, lib);
    expect(await complete(a, s.session_id)).toEqual({ counted: false, reason: "too_fast" });
    await expect(complete(b, s.session_id)).rejects.toThrow(/Session unavailable/);
    expect(await ledger(a)).toEqual([]);
  });
  it("a finished story records stars, a library sticker and the first milestone once", async () => {
    const s = await start(a, lib);
    await age(s.session_id, 120);
    const r = await complete(a, s.session_id);
    const today = (await db.query<{ r: string[] }>("SELECT public.missions_assigned(public.missions_local_date(now())) r")).rows[0].r;
    expect(r.counted).toBe(true);
    expect(r.completed).toEqual(today);
    expect(r.sticker).toMatchObject({ story_id: lib, title: "Sự tích cây vú sữa" });
    expect(r.milestone).toBe(1);
    const t = r.today as { missions: { id: string; done: boolean }[]; week: { nights: number; goal: number; days: J[] }; totals: J };
    expect(t.missions).toEqual(today.map((id) => ({ id, done: true })));
    expect(t.week.nights).toBe(1);
    expect(t.week.goal).toBe(4);
    expect(t.week.days).toHaveLength(7);
    expect(t.totals).toEqual({ stories: 1, stars: 2, stickers: 1 });
    expect(await complete(a, s.session_id)).toEqual({ counted: false, reason: "already_completed" });
    // Same story again the same night: counted as listening, but no duplicate rewards.
    const again = await start(a, lib);
    await age(again.session_id, 120);
    const r2 = await complete(a, again.session_id);
    expect(r2).toMatchObject({ counted: true, completed: [], sticker: null, milestone: null });
    expect((r2.today as { totals: J }).totals).toEqual({ stories: 2, stars: 2, stickers: 1 });
    expect(await ledger(a)).toEqual([
      { kind: "milestone", n: 1 },
      { kind: "star", n: 2 },
      { kind: "sticker", n: 1 },
    ]);
    const album = await rpc<{ stickers: J[]; milestones: number[] }>(a, "SELECT public.missions_album() r");
    expect(album.stickers).toEqual([expect.objectContaining({ story_id: lib, title: "Sự tích cây vú sữa" })]);
    expect(album.milestones).toEqual([1]);
  });
  it("own stories count toward the base mission but never give a library sticker", async () => {
    const d = randomUUID(),
      mine = randomUUID();
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'own@g03.test')", [d]);
    await db.query("INSERT INTO public.stories(id,user_id,title,is_platform_content,is_published,status,category) VALUES($1,$2,'Truyện của bé',false,false,'draft','bedtime')", [mine, d]);
    const s = await start(d, mine);
    await age(s.session_id, 60);
    const r = await complete(d, s.session_id);
    expect(r).toMatchObject({ counted: true, sticker: null, milestone: 1 });
    expect((r.completed as string[])[0]).toBe("nghe-het-truyen");
  });
  it("stale sessions expire and are purged; daily start cap blocks floods", async () => {
    const s = await start(b, lib);
    await age(s.session_id, 7 * 3600);
    expect(await complete(b, s.session_id)).toEqual({ counted: false, reason: "expired" });
    expect(await complete(b, s.session_id)).toEqual({ counted: false, reason: "already_completed" });
    const old = await start(b, lib);
    await age(old.session_id, 8 * 86400);
    await start(b, lib);
    expect((await db.query("SELECT 1 FROM public.listen_sessions WHERE id=$1", [old.session_id])).rows).toHaveLength(0);
    await db.query("INSERT INTO public.listen_sessions(user_id,story_id,min_seconds) SELECT $1,$2,15 FROM generate_series(1,60)", [b, lib]);
    await expect(start(b, lib)).rejects.toThrow(/Too many listening sessions/);
    expect(await ledger(b)).toEqual([]);
  });
});

describe("ledger integrity and privacy", () => {
  it("families read only their own rows and cannot write rewards or sessions", async () => {
    expect((await asUser(db, b, (tx) => tx.query("SELECT * FROM public.reward_ledger"))).rows).toHaveLength(0);
    expect((await asUser(db, a, (tx) => tx.query("SELECT * FROM public.reward_ledger"))).rows.length).toBeGreaterThan(0);
    expect((await asUser(db, b, (tx) => tx.query("SELECT * FROM public.child_missions WHERE user_id=$1", [a]))).rows).toHaveLength(0);
    for (const sql of [
      "INSERT INTO public.reward_ledger(user_id,kind,template_id,local_date,idempotency_key) VALUES(auth.uid(),'star','nghe-het-truyen',current_date,'star:forged:1')",
      "UPDATE public.reward_ledger SET local_date=current_date",
      "DELETE FROM public.reward_ledger",
      "INSERT INTO public.listen_sessions(user_id,min_seconds,started_at) VALUES(auth.uid(),15,now()-interval '1 hour')",
      "UPDATE public.listen_sessions SET started_at=now()-interval '1 hour'",
      "INSERT INTO public.child_missions(user_id,template_id,local_date) VALUES(auth.uid(),'nghe-het-truyen',current_date)",
      "UPDATE public.mission_templates SET active=false",
    ])
      await expect(asUser(db, a, (tx) => tx.query(sql))).rejects.toThrow(/permission denied/);
  });
  it("rewards are append-only even for the database owner", async () => {
    await expect(db.query("UPDATE public.reward_ledger SET local_date=local_date WHERE user_id=$1", [a])).rejects.toThrow(/append-only/);
    await expect(db.query("DELETE FROM public.reward_ledger WHERE user_id=$1", [a])).rejects.toThrow(/append-only/);
    await expect(db.query("TRUNCATE public.reward_ledger")).rejects.toThrow(/append-only/);
  });
  it("turning the flag off hides but keeps rewards; turning it on shows them again", async () => {
    await setFlag(false);
    expect((await asUser(db, a, (tx) => tx.query("SELECT * FROM public.reward_ledger"))).rows).toHaveLength(0);
    await expect(rpc(a, "SELECT public.missions_album() r")).rejects.toThrow(/Action unavailable/);
    await setFlag(true);
    expect((await rpc<{ milestones: number[] }>(a, "SELECT public.missions_album() r")).milestones).toEqual([1]);
  });
  it("deleting the account removes its sessions, missions and rewards", async () => {
    await db.query("DELETE FROM auth.users WHERE id=$1", [a]);
    for (const t of ["listen_sessions", "child_missions", "reward_ledger"])
      expect((await db.query(`SELECT 1 FROM public.${t} WHERE user_id=$1`, [a])).rows).toHaveLength(0);
  });
});

describe("weekly sky summary", () => {
  it("counts distinct Vietnam nights Monday–Sunday and stars per night", async () => {
    const u = randomUUID();
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'sky@g03.test')", [u]);
    await db.query(
      `INSERT INTO public.listen_sessions(user_id,story_id,min_seconds,started_at,completed_at,counted,local_date) VALUES
       ($1,$2,15,'2026-03-02 13:00+00','2026-03-02 13:10+00',true,'2026-03-02'),
       ($1,$2,15,'2026-03-02 14:00+00','2026-03-02 14:10+00',true,'2026-03-02'),
       ($1,$2,15,'2026-03-04 13:00+00','2026-03-04 13:10+00',true,'2026-03-04'),
       ($1,$2,15,'2026-03-01 13:00+00','2026-03-01 13:10+00',true,'2026-03-01')`,
      [u, lib],
    );
    await db.query(
      "INSERT INTO public.reward_ledger(user_id,kind,template_id,local_date,idempotency_key) VALUES($1,'star','nghe-het-truyen','2026-03-02','star:sky:1'),($1,'star','co-tich','2026-03-02','star:sky:2')",
      [u],
    );
    const s = (await db.query<{ r: { date: string; week: { start: string; nights: number; days: { date: string; stars: number; listened: boolean }[] }; totals: J } }>(
      "SELECT public.missions_summary_for($1, '2026-03-04 17:30+00') r",
      [u],
    )).rows[0].r;
    expect(s.date).toBe("2026-03-05");
    expect(s.week.start).toBe("2026-03-02");
    expect(s.week.nights).toBe(2);
    expect(s.week.days.map((d) => [d.date, d.stars, d.listened])).toEqual([
      ["2026-03-02", 2, true],
      ["2026-03-03", 0, false],
      ["2026-03-04", 0, true],
      ["2026-03-05", 0, false],
      ["2026-03-06", 0, false],
      ["2026-03-07", 0, false],
      ["2026-03-08", 0, false],
    ]);
    expect(s.totals).toEqual({ stories: 4, stars: 2, stickers: 0 });
  });
});
