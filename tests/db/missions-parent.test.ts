import { randomUUID, createHash, randomBytes } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb, asUser, asAnon, asRole, grantParentConsent } from "./supabase-harness";

// G-06/G-07 (docs/missions-parent.md): habits are confirmed by a parent with a
// server-verified PIN proof, good deeds are thanked in words only, the family
// constellation needs 3 stories read together this week, and parent reminders
// are opt-in, at most one a day and only for devices registered as a parent.
let db: PGlite;
const admin = randomUUID(),
  a = randomUUID(),
  b = randomUUID(),
  c = randomUUID(), // never sets a PIN
  d = randomUUID(); // lockout / PIN change
const S = {
  dongHo: randomUUID(), // kc-lib:su-va-dong-ho-cat → habit lam-dung-gio
  xeTai: randomUUID(), // kc-lib:chiec-xe-tai-do → kindness chia-se
  loiNoi: randomUUID(), // kc-lib:bo-va-nhung-loi-noi-dep → habit loi-noi-dep
  plain: randomUUID(),
};
const PIN = "2468";
const reason = "Bật nhiệm vụ để kiểm thử G-06";
type J = Record<string, unknown>;
const rpc = async <T = J>(uid: string, sql: string, args: unknown[] = []) =>
  (await asUser(db, uid, (tx) => tx.query<{ r: T }>(sql, args))).rows[0].r;
const gate = (uid: string, pin: string) =>
  rpc<{ ok: boolean; reason?: string; gate_token?: string; gate_expires_at?: string }>(uid, "SELECT public.open_parent_gate($1) r", [pin]);
const proofOf = async (uid: string) => {
  const g = await gate(uid, PIN);
  expect(g.ok).toBe(true);
  return g.gate_token as string;
};
const confirm = (uid: string, proof: string | null, template: string) =>
  rpc<J>(uid, "SELECT public.missions_confirm($1,$2) r", [proof, template]);
const together = (uid: string, proof: string | null, session: string) =>
  rpc<J>(uid, "SELECT public.missions_mark_together($1,$2) r", [proof, session]);
const week = (uid: string) => rpc<J>(uid, "SELECT public.missions_parent_week() r");
const listen = async (uid: string, story: string) => {
  const s = await rpc<{ session_id: string }>(uid, "SELECT public.missions_start_listen($1) r", [story]);
  await db.query("UPDATE public.listen_sessions SET started_at=now()-interval '40 seconds' WHERE id=$1", [s.session_id]);
  expect((await rpc<J>(uid, "SELECT public.missions_complete_listen($1) r", [s.session_id])).counted).toBe(true);
  return s.session_id;
};
const ledger = async (uid: string) =>
  (await db.query<{ kind: string; n: number }>("SELECT kind, count(*)::int n FROM public.reward_ledger WHERE user_id=$1 GROUP BY kind ORDER BY kind", [uid])).rows;
const setFlag = (on: boolean) =>
  asUser(db, admin, (tx) => tx.query("SELECT public.set_feature_flag('missions',$1,$2,$3)", [on, !on, reason]));
// Today 19:05 in Vietnam (the reminder job's clock is passed in explicitly).
const at = async (hhmm: string, days = 0) =>
  (await db.query<{ t: string }>(
    "SELECT ((public.missions_local_date(now()) + $2::int + $1::time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::text t", [hhmm, days])).rows[0].t;
const claim = async (now: string) =>
  (await asRole(db, "service_role", null, (tx) => tx.query<{ r: J[] }>("SELECT public.parent_notify_claim($1::timestamptz, 50) r", [now]))).rows[0].r;
const keys = { p256dh: "B" + "x".repeat(86), auth: "a".repeat(22) };

beforeAll(async () => {
  ({ db } = await createMigratedDb());
  for (const id of [admin, a, b, c, d]) await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [id, id + "@g06.test"]);
  // T11: reminders go only to families with a valid parent consent.
  for (const id of [admin, a, b, c, d]) await grantParentConsent(db, id);
  await db.query("UPDATE public.profiles SET role='super_admin' WHERE id=$1", [admin]);
  const story = "INSERT INTO public.stories(id,user_id,title,is_platform_content,is_published,status,category,tags) VALUES($1,$2,$3,true,true,'published',$4,$5)";
  await db.query(story, [S.dongHo, admin, "Su và chiếc đồng hồ cát", "bedtime", ["thoi-quen-tot", "bo-va-su", "kc-lib:su-va-dong-ho-cat"]]);
  await db.query(story, [S.xeTai, admin, "Chiếc xe tải đỏ", "bedtime", ["thoi-quen-tot", "bo-va-su", "kc-lib:chiec-xe-tai-do"]]);
  await db.query(story, [S.loiNoi, admin, "Bo và những lời nói đẹp", "bedtime", ["thoi-quen-tot", "bo-va-su", "kc-lib:bo-va-nhung-loi-noi-dep"]]);
  await db.query(story, [S.plain, admin, "Sự tích cây vú sữa", "fairy_tale", ["kc-lib:vu-sua"]]);
  for (const id of [a, b, d]) await rpc(id, "SELECT public.set_parent_pin($1, NULL) r", [PIN]);
  await setFlag(true);
});
afterAll(async () => {
  await db?.close();
});

describe("parent proof", () => {
  it("is minted only by the right PIN and only its SHA-256 is stored", async () => {
    expect(await gate(c, PIN)).toEqual({ ok: false, reason: "no_pin" });
    const wrong = await gate(a, "1357");
    expect(wrong).toMatchObject({ ok: false, reason: "invalid", attempts_left: 4 });
    expect(wrong.gate_token).toBeUndefined();
    const g = await gate(a, PIN);
    expect(g.ok).toBe(true);
    expect(g.gate_token).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(g.gate_expires_at as string) - Date.now()).toBeGreaterThan(14 * 60_000);
    const rows = (await db.query<{ token_hash: string }>("SELECT token_hash FROM public.parent_gate_sessions WHERE user_id=$1", [a])).rows;
    expect(rows.map((r) => r.token_hash)).toContain(createHash("sha256").update(g.gate_token as string).digest("hex"));
    expect(rows.map((r) => r.token_hash)).not.toContain(g.gate_token);
    // The right PIN resets the shared attempt counter.
    expect((await db.query<{ n: number }>("SELECT failed_attempts n FROM public.parental_pins WHERE user_id=$1", [a])).rows[0].n).toBe(0);
  });
  it("shares the PIN lockout: five wrong tries lock even the right PIN", async () => {
    for (let i = 0; i < 5; i++) await gate(d, "0000");
    const locked = await gate(d, PIN);
    expect(locked).toMatchObject({ ok: false, reason: "locked" });
    expect(locked.gate_token).toBeUndefined();
    await db.query("UPDATE public.parental_pins SET locked_until=NULL, failed_attempts=0 WHERE user_id=$1", [d]);
  });
  it("is private: anon cannot open a gate, nobody reads the sessions or calls internals", async () => {
    await expect(asAnon(db, (tx) => tx.query("SELECT public.open_parent_gate('2468')"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, a, (tx) => tx.query("SELECT * FROM public.parent_gate_sessions"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, a, (tx) => tx.query("SELECT public.parent_gate_check(repeat('a',64))"))).rejects.toThrow(/permission denied/);
    for (const t of ["family_reads", "parent_notify_prefs", "parent_devices", "parent_notification_log"])
      await expect(asUser(db, a, (tx) => tx.query(`SELECT * FROM public.${t}`))).rejects.toThrow(/permission denied/);
  });
  it("slides by 15 minutes but ends 60 minutes after the PIN; closing revokes it", async () => {
    const t = await proofOf(b);
    const h = createHash("sha256").update(t).digest("hex");
    await db.query("UPDATE public.parent_gate_sessions SET created_at=now()-interval '55 minutes', expires_at=now()+interval '1 minute' WHERE token_hash=$1", [h]);
    await expect(confirm(b, t, "giup-do")).resolves.toMatchObject({ confirmed: true, kind: "kindness" });
    const exp = (await db.query<{ s: number }>("SELECT extract(epoch FROM expires_at - created_at)::int s FROM public.parent_gate_sessions WHERE token_hash=$1", [h])).rows[0].s;
    expect(exp).toBe(3600);
    await db.query("UPDATE public.parent_gate_sessions SET created_at=now()-interval '61 minutes', expires_at=now()-interval '1 minute' WHERE token_hash=$1", [h]);
    await expect(rpc(b, "SELECT public.parent_notify_set($1,true,19) r", [t])).rejects.toThrow(/Parent proof required/);
    const t2 = await proofOf(b);
    await rpc(b, "SELECT public.close_parent_gate($1) r", [t2]);
    await expect(rpc(b, "SELECT public.parent_notify_set($1,true,19) r", [t2])).rejects.toThrow(/Parent proof required/);
  });
  it("keeps at most 5 live proofs and a new PIN ends every old one", async () => {
    const tokens: string[] = [];
    for (let i = 0; i < 6; i++) tokens.push(await proofOf(d));
    const live = (await db.query<{ n: number }>("SELECT count(*)::int n FROM public.parent_gate_sessions WHERE user_id=$1 AND revoked_at IS NULL", [d])).rows[0].n;
    expect(live).toBe(5);
    await expect(rpc(d, "SELECT public.parent_notify_set($1,false,19) r", [tokens[0]])).rejects.toThrow(/Parent proof required/);
    await expect(rpc(d, "SELECT public.parent_notify_set($1,false,19) r", [tokens[5]])).resolves.toMatchObject({ enabled: false });
    expect((await rpc<J>(d, "SELECT public.set_parent_pin('9753', $1) r", [PIN])).ok).toBe(true);
    await expect(rpc(d, "SELECT public.parent_notify_set($1,false,19) r", [tokens[5]])).rejects.toThrow(/Parent proof required/);
  });
});

describe("habits and good deeds", () => {
  it("only show once their Bo & Su story was heard (good deeds without a story always show)", async () => {
    const w = await week(a);
    const ids = (w.habits as { id: string }[]).map((h) => h.id);
    expect(ids).toEqual(["giup-do"]);
    expect(w.notify).toEqual({ enabled: false, hour: 19, devices: 0 });
    expect(w.family).toMatchObject({ id: "ca-nha-doc-cung", target: 3, progress: 0, done: false, label: "Tuần này cả nhà đọc 3 truyện cùng nhau" });
    await listen(a, S.dongHo);
    await listen(a, S.xeTai);
    const after = ((await week(a)).habits as { id: string; kind: string; today: boolean; week: number; prompt: string }[]);
    expect(after.map((h) => [h.id, h.kind, h.today, h.week])).toEqual([
      ["lam-dung-gio", "habit", false, 0],
      ["chia-se", "kindness", false, 0],
      ["giup-do", "kindness", false, 0],
    ]);
    expect(after[0].prompt).toMatch(/^Hỏi bé:/);
  });
  it("refuse without a valid proof of this account", async () => {
    const own = await proofOf(a);
    const other = await proofOf(b);
    for (const p of [null, "", "abc", randomBytes(32).toString("hex"), other, own.toUpperCase()])
      await expect(confirm(a, p, "lam-dung-gio")).rejects.toThrow(/Parent proof required/);
    const h = createHash("sha256").update(own).digest("hex");
    await db.query("UPDATE public.parent_gate_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [h]);
    await expect(confirm(a, own, "lam-dung-gio")).rejects.toThrow(/Parent proof required/);
    expect(await ledger(a)).not.toContainEqual(expect.objectContaining({ kind: "star", n: 3 }));
  });
  it("a habit earns one star per day; locked or non-habit templates are refused", async () => {
    const p = await proofOf(a);
    const before = (await ledger(a)).find((r) => r.kind === "star")?.n ?? 0;
    await expect(confirm(a, p, "tu-cat-do-choi")).rejects.toThrow(/Mission not unlocked/);
    await expect(confirm(a, p, "nghe-het-truyen")).rejects.toThrow(/Mission unavailable/);
    await expect(confirm(a, p, "ca-nha-doc-cung")).rejects.toThrow(/Mission unavailable/);
    const r = await confirm(a, p, "lam-dung-gio");
    expect(r).toMatchObject({ confirmed: true, kind: "habit", star: true });
    expect(r.line).toMatch(/đồng hồ cát/);
    expect(await confirm(a, p, "lam-dung-gio")).toEqual({ confirmed: false, reason: "already_confirmed", kind: "habit" });
    expect((await ledger(a)).find((x) => x.kind === "star")?.n).toBe(before + 1);
    const cm = (await db.query<{ parent_session_id: string | null }>("SELECT parent_session_id FROM public.child_missions WHERE user_id=$1 AND template_id='lam-dung-gio'", [a])).rows;
    expect(cm).toHaveLength(1);
    expect(cm[0].parent_session_id).not.toBeNull();
  });
  it("a good deed is thanked in words only: no star, sticker or any ledger row", async () => {
    const p = await proofOf(a);
    const before = await ledger(a);
    const r = await confirm(a, p, "chia-se");
    expect(r).toMatchObject({ confirmed: true, kind: "kindness", star: false, line: "Cảm ơn bé đã chia sẻ với bạn." });
    expect(await ledger(a)).toEqual(before);
    const today = await rpc<{ habits: J[] }>(a, "SELECT public.missions_today() r");
    expect(today.habits.map((h) => [h.id, h.kind])).toEqual([["lam-dung-gio", "habit"], ["chia-se", "kindness"]]);
    // Even the database owner cannot reward a good deed or misuse a constellation.
    await expect(db.query("INSERT INTO public.reward_ledger(user_id,kind,template_id,local_date,idempotency_key) VALUES($1,'star','chia-se',current_date,'star:test:chia-se')", [a])).rejects.toThrow(/thanked, not rewarded/);
    await expect(db.query("INSERT INTO public.reward_ledger(user_id,kind,template_id,local_date,idempotency_key) VALUES($1,'constellation','lam-dung-gio',current_date,'constellation:test:x')", [a])).rejects.toThrow(/Constellations belong/);
  });
  it("templates keep process praise only", async () => {
    await expect(db.query("UPDATE public.mission_templates SET praise='Bé giỏi quá!' WHERE id='lam-dung-gio'")).rejects.toThrow(/process_praise/);
    await expect(db.query("UPDATE public.mission_templates SET prompt='Con đã đọc 3 ngày liên tục' WHERE id='lam-dung-gio'")).rejects.toThrow(/process_praise/);
  });
});

describe("family constellation", () => {
  it("needs this week's finished stories of this family, marked by a parent", async () => {
    const p = await proofOf(a);
    const foreign = await listen(b, S.plain);
    await expect(together(a, p, foreign)).rejects.toThrow(/Session unavailable/);
    const unfinished = (await rpc<{ session_id: string }>(a, "SELECT public.missions_start_listen($1) r", [S.plain])).session_id;
    await expect(together(a, p, unfinished)).rejects.toThrow(/Session unavailable/);
    const old = await listen(a, S.plain);
    await db.query("UPDATE public.listen_sessions SET local_date=public.missions_week_start(local_date)-1, completed_at=completed_at-interval '8 days' WHERE id=$1", [old]);
    await expect(together(a, p, old)).rejects.toThrow(/Session unavailable/);
    await expect(together(a, null, old)).rejects.toThrow(/Parent proof required/);
  });
  it("3 different stories read together light one constellation per week", async () => {
    const p = await proofOf(a);
    const sessions = (((await week(a)).stories) as { session_id: string; story_id: string; together: boolean }[]);
    const byStory = new Map(sessions.map((s) => [s.story_id, s.session_id]));
    const first = await together(a, p, byStory.get(S.dongHo) as string);
    expect(first).toMatchObject({ marked: true, progress: 1, target: 3, done: false, constellation: false });
    // The same story again on the same night does not count twice.
    const again = await listen(a, S.dongHo);
    expect(await together(a, p, again)).toMatchObject({ progress: 1 });
    expect(await together(a, p, byStory.get(S.dongHo) as string)).toMatchObject({ progress: 1 });
    expect(await together(a, p, byStory.get(S.xeTai) as string)).toMatchObject({ progress: 2, constellation: false });
    const third = await listen(a, S.loiNoi);
    const done = await together(a, p, third);
    expect(done).toMatchObject({ progress: 3, done: true, constellation: true });
    expect(done.line).toMatch(/Chòm sao/);
    const fourth = await listen(a, S.plain);
    expect(await together(a, p, fourth)).toMatchObject({ progress: 3, done: true, constellation: false });
    expect((await ledger(a)).find((x) => x.kind === "constellation")?.n).toBe(1);
    const album = await rpc<{ constellations: J[] }>(a, "SELECT public.missions_album() r");
    expect(album.constellations).toHaveLength(1);
    const w = await week(a);
    expect(w.family).toMatchObject({ progress: 3, done: true });
    expect((w.stories as { together: boolean }[]).map((s) => s.together)).toEqual([true, true, true, true, true]);
    expect(((w.stories as { prompt: string | null; story_id: string }[]).find((s) => s.story_id === S.dongHo))?.prompt).toMatch(/^Hỏi bé:/);
  });
});

describe("parent reminders", () => {
  it("are off by default and change only with a proof and a daytime hour", async () => {
    const p = await proofOf(a);
    await expect(rpc(a, "SELECT public.parent_notify_set(NULL,true,19) r")).rejects.toThrow(/Parent proof required/);
    for (const h of [5, 22]) await expect(rpc(a, "SELECT public.parent_notify_set($1,true,$2) r", [p, h])).rejects.toThrow(/Invalid reminder/);
    expect(await rpc(a, "SELECT public.parent_notify_set($1,true,19) r", [p])).toEqual({ enabled: true, hour: 19, devices: 0 });
  });
  it("register parent devices only behind the PIN, never a child-push device", async () => {
    const p = await proofOf(a);
    const reg = (endpoint: string, proof: string | null = p) =>
      rpc<J>(a, "SELECT public.parent_device_register($1,$2,$3,$4) r", [proof, endpoint, keys.p256dh, keys.auth]);
    await db.query("INSERT INTO public.push_subscriptions(user_id,endpoint) VALUES($1,'https://push.example/child')", [a]);
    await expect(reg("https://push.example/parent-1", null)).rejects.toThrow(/Parent proof required/);
    await expect(reg("https://push.example/child")).rejects.toThrow(/Child device/);
    await expect(reg("http://push.example/insecure")).rejects.toThrow(/check constraint/);
    expect(await reg("https://push.example/parent-1")).toEqual({ devices: 1 });
    expect(await reg("https://push.example/parent-2")).toEqual({ devices: 2 });
    // Removing a device never needs the PIN.
    expect(await rpc(a, "SELECT public.parent_device_remove('https://push.example/parent-2') r")).toEqual({ devices: 1 });
    // c turned reminders on and later the same browser subscribed to child push.
    await db.query("INSERT INTO public.parent_notify_prefs(user_id,enabled,hour) VALUES($1,true,19)", [c]);
    await db.query("INSERT INTO public.parent_devices(user_id,endpoint,p256dh,auth) VALUES($1,'https://push.example/c-shared',$2,$3)", [c, keys.p256dh, keys.auth]);
    await db.query("INSERT INTO public.push_subscriptions(user_id,endpoint) VALUES($1,'https://push.example/c-shared')", [c]);
  });
  it("the job sends at most one a day, at the chosen hour, to parent devices only", async () => {
    await expect(asUser(db, a, (tx) => tx.query("SELECT public.parent_notify_claim(now(), 10)"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, a, (tx) => tx.query("SELECT public.parent_notify_finish($1, current_date, 'sent', 1, NULL)", [a]))).rejects.toThrow(/permission denied/);
    expect(await claim(await at("18:05"))).toEqual([]);
    const out = await claim(await at("19:05"));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ user_id: a, title: "Tuần của bé" });
    expect(out[0].body).toMatch(/Tuần này bé đã nghe truyện 1 tối/);
    expect(out[0].devices).toEqual([{ endpoint: "https://push.example/parent-1", ...keys }]);
    expect(await claim(await at("19:35"))).toEqual([]);
    await asRole(db, "service_role", null, (tx) =>
      tx.query("SELECT public.parent_notify_finish($1, $2::date, 'sent', 1, ARRAY['https://push.example/parent-1'])", [a, out[0].date]));
    const log = (await db.query<{ status: string; devices_sent: number }>("SELECT status, devices_sent FROM public.parent_notification_log WHERE user_id=$1", [a])).rows;
    expect(log).toEqual([{ status: "sent", devices_sent: 1 }]);
    expect((await week(a)).notify).toEqual({ enabled: true, hour: 19, devices: 0 });
    // Next day it may send again — but the gone endpoint was removed, so nothing to send.
    expect(await claim(await at("19:05", 1))).toEqual([]);
  });
});

describe("flag off", () => {
  it("every family action stops and the job sends nothing", async () => {
    const p = await proofOf(a);
    await rpc(a, "SELECT public.parent_device_register($1,'https://push.example/parent-3',$2,$3) r", [p, keys.p256dh, keys.auth]);
    await setFlag(false);
    await expect(confirm(a, p, "giup-do")).rejects.toThrow(/Action unavailable/);
    await expect(week(a)).rejects.toThrow(/Action unavailable/);
    await expect(rpc(a, "SELECT public.parent_notify_set($1,false,19) r", [p])).rejects.toThrow(/Action unavailable/);
    expect(await claim(await at("19:05", 2))).toEqual([]);
    await setFlag(true);
    expect(await claim(await at("19:05", 2))).toHaveLength(1);
  });
});
