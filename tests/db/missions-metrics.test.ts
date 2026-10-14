import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb, asUser, asAnon } from "./supabase-harness";

// G-10 (docs/g10-missions-metrics.md): the team sees weekly aggregates of the
// missions loop and its guardrails — never a family, child, story or device.
let db: PGlite;
const admin = randomUUID(),
  tester = randomUUID(),
  fam = Array.from({ length: 6 }, () => randomUUID());
const story = randomUUID();
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = async <T = J>(uid: string, sql: string, args: unknown[] = []) =>
  (await asUser(db, uid, (tx) => tx.query<{ r: T }>(sql, args))).rows[0].r;
const start = (uid: string) => rpc<{ session_id: string }>(uid, "SELECT public.missions_start_listen($1) r", [story]);
const complete = (uid: string, session: string) => rpc<J>(uid, "SELECT public.missions_complete_listen($1) r", [session]);
const age = (session: string, seconds: number) =>
  db.query("UPDATE public.listen_sessions SET started_at=now()-make_interval(secs=>$2) WHERE id=$1", [session, seconds]);
const summary = (weeks = 2) => rpc<J>(admin, "SELECT public.missions_weekly_summary($1) r", [weeks]);
const today = async () =>
  (await db.query<{ d: string }>("SELECT public.missions_local_date(now())::text d")).rows[0].d;
const counters = async (day: string) =>
  (await db.query<J>("SELECT started, counted, expired, too_fast, backfilled FROM public.missions_listen_daily WHERE local_date=$1", [day])).rows[0];
/** A counted story last week: `day` 0 = Monday, at Vietnam time `hhmm`, lasting `minutes`. */
async function heardLastWeek(uid: string, day: number, hhmm: string, minutes = 10): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `WITH d AS (SELECT public.missions_week_start(public.missions_local_date(now())) - 7 + $2::int AS day)
     INSERT INTO public.listen_sessions(user_id, story_id, min_seconds, started_at, completed_at, counted, local_date)
     SELECT $1, $5, 15, ((d.day::text || ' ' || $3)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'),
      ((d.day::text || ' ' || $3)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') + make_interval(mins => $4), true, d.day FROM d RETURNING id`,
    [uid, day, hhmm, minutes, story],
  );
  return rows[0].id;
}

beforeAll(async () => {
  ({ db } = await createMigratedDb());
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2),($3,$4)", [admin, "g10-admin@g10.test", tester, "smoke-g10@kecon.test"]);
  for (const id of fam) await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [id, id + "@g10.test"]);
  await db.query("UPDATE public.profiles SET role='super_admin' WHERE id=$1", [admin]);
  await db.query(
    "INSERT INTO public.stories(id,user_id,title,is_platform_content,is_published,status,category,tags) VALUES($1,$2,'Truyện G-10',true,true,'published','bedtime','{kc-lib:g10}')",
    [story, admin],
  );
  await db.query("INSERT INTO public.story_pages(story_id,page_number,content) VALUES($1,1,repeat('a',3500))", [story]); // 100 s minimum
  await asUser(db, admin, (tx) => tx.query("SELECT public.set_feature_flag('missions',true,false,'Bật nhiệm vụ để kiểm thử G-10')"));
});
afterAll(async () => {
  await db?.close();
});

describe("access", () => {
  it("is staff-only (analytics.view), bounded to 1–12 weeks, and closed to anon", async () => {
    await expect(rpc(fam[0], "SELECT public.missions_weekly_summary(8) r")).rejects.toThrow(/Permission denied/);
    await expect(summary(0)).rejects.toThrow(/Invalid period/);
    await expect(summary(13)).rejects.toThrow(/Invalid period/);
    await expect(asAnon(db, (tx) => tx.query("SELECT public.missions_weekly_summary(8)"))).rejects.toThrow(/permission denied/);
    // The counters table and helpers are not readable by families.
    await expect(asUser(db, fam[0], (tx) => tx.query("SELECT * FROM public.missions_listen_daily"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, fam[0], (tx) => tx.query("SELECT public.missions_metrics_family($1)", [fam[0]]))).rejects.toThrow(/permission denied/);
    const s = await summary(8);
    expect(s.weeks).toHaveLength(8);
    expect(s.weeks[0]).toMatchObject({ partial: true });
    // Monday-start Vietnam weeks, newest first, 7 days apart.
    const monday = new Date(s.weeks[0].week_start + "T00:00:00Z");
    expect(monday.getUTCDay()).toBe(1);
    expect(s.weeks[1].week_start).toBe(new Date(monday.getTime() - 7 * 86400e3).toISOString().slice(0, 10));
    expect(s.weeks[0].week_end).toBe(new Date(monday.getTime() + 6 * 86400e3).toISOString().slice(0, 10));
    expect(s).toMatchObject({ timezone: "Asia/Ho_Chi_Minh", week_starts: "monday", min_families: 5, families_total: 6 });
  });
});

describe("listening funnel counters", () => {
  it("count starts, finishes, expiries and too-fast finishes once, for families only", async () => {
    const day = await today();
    const a = (await start(fam[0])).session_id;
    expect(await complete(fam[0], a)).toMatchObject({ counted: false, reason: "too_fast" });
    expect(await complete(fam[0], a)).toMatchObject({ counted: false, reason: "too_fast" }); // retry: still one
    await age(a, 120);
    expect(await complete(fam[0], a)).toMatchObject({ counted: true });
    const b = (await start(fam[1])).session_id;
    await age(b, 7 * 3600);
    expect(await complete(fam[1], b)).toMatchObject({ counted: false, reason: "expired" });
    await start(admin); // staff
    await start(tester); // internal test account
    expect(await counters(day)).toEqual({ started: 2, counted: 1, expired: 1, too_fast: 1, backfilled: false });
    const w = (await summary(1)).weeks[0];
    expect(w.listening).toEqual({ started: 2, finished: 1, expired: 1, too_fast: 1, finish_rate: 50, exact: true });
  });

  it("survive the 7-day pruning of unfinished sessions", async () => {
    const { rows } = await db.query<{ id: string; d: string }>(
      "INSERT INTO public.listen_sessions(user_id, story_id, min_seconds, started_at) VALUES($1,$2,15, now()-interval '9 days') RETURNING id, public.missions_local_date(started_at)::text d",
      [fam[3], story],
    );
    expect((await counters(rows[0].d)).started).toBe(1);
    await start(fam[3]); // prunes the stale session
    expect((await db.query("SELECT 1 FROM public.listen_sessions WHERE id=$1", [rows[0].id])).rows).toHaveLength(0);
    expect((await counters(rows[0].d)).started).toBe(1);
  });
});

describe("weekly loop + guardrails (last full week)", () => {
  it("hides the nights histogram under 5 families, shows it from 5", async () => {
    await heardLastWeek(fam[0], 0, "20:00");
    let w = (await summary(2)).weeks[1];
    expect(w).toMatchObject({ families_listening: 1, small_sample: true, nights_histogram: null, avg_nights: 1 });
    // fam0: 3 nights, fam1: 2 nights, fam2–4: 1 night.
    await heardLastWeek(fam[0], 1, "20:00");
    await heardLastWeek(fam[0], 2, "20:00");
    await heardLastWeek(fam[1], 0, "20:00");
    await heardLastWeek(fam[1], 3, "20:00");
    for (const f of fam.slice(2, 5)) await heardLastWeek(f, 4, "19:30");
    await heardLastWeek(tester, 4, "19:30"); // never counted
    w = (await summary(2)).weeks[1];
    expect(w).toMatchObject({ families_listening: 5, small_sample: false, avg_nights: 1.6, partial: false });
    expect(w.nights_histogram).toEqual({ "1": 3, "2": 1, "3": 1, "4": 0, "5": 0, "6": 0, "7": 0 });
  });

  it("counts bedtime sessions by each family's own window, long nights and minutes", async () => {
    await db.query("INSERT INTO public.parental_controls(user_id,is_enabled,bedtime_start,bedtime_end) VALUES($1,true,'21:00','06:00'),($2,true,'13:00','15:00'),($3,false,'19:00','20:00')", [fam[0], fam[1], fam[2]]);
    await heardLastWeek(fam[0], 5, "22:30"); // in 21:00–06:00
    await heardLastWeek(fam[0], 6, "05:30"); // in 21:00–06:00 (after midnight)
    await heardLastWeek(fam[1], 5, "14:00"); // in 13:00–15:00
    await heardLastWeek(fam[2], 5, "19:30"); // controls off → not a breach
    // fam3: three stories on one night, one of them left open for 3 hours (capped at 60 min).
    await heardLastWeek(fam[3], 6, "19:00", 10);
    await heardLastWeek(fam[3], 6, "19:15", 10);
    await heardLastWeek(fam[3], 6, "19:30", 180);
    const g = (await summary(2)).weeks[1].guardrails;
    expect(g.bedtime_sessions).toBe(3);
    expect(g.nights_3plus).toBe(1);
    // 13 family-nights last week: 12 one-story nights of 10 min + fam3's night (10 + 10 + 60, capped).
    expect(g.family_nights).toBe(13);
    expect(g.avg_minutes_per_night).toBe(Number(((12 * 10 + 80) / 13).toFixed(1)));
  });

  it("counts habits, thanks, family reads, constellations and reminders", async () => {
    const last = "(public.missions_week_start(public.missions_local_date(now())) - 7)";
    await db.query(`INSERT INTO public.child_missions(user_id, template_id, local_date) VALUES
      ($1,'tu-cat-do-choi',${last}),($1,'lam-dung-gio',${last}+1),($2,'tu-cat-do-choi',${last}),
      ($1,'chia-se',${last}+2),($3,'nghe-het-truyen',${last}),($4,'tu-cat-do-choi',${last})`, [fam[0], fam[1], fam[2], tester]);
    const reads = [await heardLastWeek(fam[4], 0, "20:00"), await heardLastWeek(fam[4], 1, "20:00"), await heardLastWeek(fam[4], 2, "20:00")];
    for (const id of reads)
      await db.query(`INSERT INTO public.family_reads(user_id, session_id, story_id, local_date, week_start) SELECT user_id, id, story_id, local_date, ${last} FROM public.listen_sessions WHERE id=$1`, [id]);
    await db.query(`INSERT INTO public.reward_ledger(user_id, kind, template_id, local_date, idempotency_key) SELECT $1::uuid, 'constellation', 'ca-nha-doc-cung', ${last}+2, 'constellation:'||$1||':'||(${last})`, [fam[4]]);
    await db.query(`INSERT INTO public.parent_notification_log(user_id, local_date, status, devices_sent) VALUES
      ($1,${last},'sent',1),($1,${last}+1,'sent',2),($2,${last},'failed',0),($3,${last},'skipped',0),($4,${last},'sent',1)`, [fam[0], fam[1], fam[2], tester]);
    await db.query(`INSERT INTO public.parent_notify_prefs(user_id, enabled, hour, updated_at) VALUES
      ($1,true,19,now()),($2,false,19,(${last}::timestamp + interval '12 hours') AT TIME ZONE 'Asia/Ho_Chi_Minh')`, [fam[0], fam[1]]);
    const s = await summary(2);
    const w = s.weeks[1];
    expect(w.missions_done).toBe(1);
    expect(w.habits).toEqual({ confirmed: 3, families: 2 });
    expect(w.kindness).toEqual({ thanked: 1, families: 1 });
    expect(w.family_reads).toEqual({ reads: 3, families: 1, reached_target: 1 });
    expect(w.reminders).toEqual({ sent: 2, failed: 1, skipped: 1, turned_off: 1 });
    expect(s.reminders_on).toBe(1);
    // Aggregates only: no family id, e-mail or story id anywhere in the result.
    const json = JSON.stringify(s);
    for (const id of [...fam, tester, admin, story]) expect(json).not.toContain(id);
    expect(json).not.toMatch(/g10\.test|kecon\.test/);
  });
});
