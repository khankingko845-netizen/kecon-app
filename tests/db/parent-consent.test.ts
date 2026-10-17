import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asRole, asUser, createMigratedDb } from "./supabase-harness";

// T11 (docs/parent-consent.md): the app and every paid / personal-data feature need
// the parent's consent to the CURRENT version of the parent policy, recorded on the
// server with the exact text hash; a new version asks again; withdrawal closes the
// app until the parent accepts again. PIN accounts prove the PIN (parent proof, 036).
let db: PGlite;
const fresh = randomUUID(), // never consented
  pinUser = randomUUID(), // has a parent PIN
  other = randomUUID(),
  staff = randomUUID(), // admin role, never consented
  gone = randomUUID(); // account deleted with its consents
const PIN = "1357";
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Doc = { id: string; version: number; locale: string; title: string; summary: string; body?: string; body_sha256: string };

const rpc = async <T = J>(uid: string, sql: string, args: unknown[] = []) =>
  (await asUser(db, uid, (tx) => tx.query<{ r: T }>(sql, args))).rows[0].r;
const status = (uid: string, locale = "vi", full = false) =>
  rpc(uid, "SELECT public.consent_status($1, $2) r", [locale, full]);
const accept = (uid: string, doc: Pick<Doc, "id" | "body_sha256">, proof: string | null = null) =>
  rpc(uid, "SELECT public.consent_accept($1, $2, $3) r", [doc.id, doc.body_sha256, proof]);
const withdraw = (uid: string, proof: string | null = null) =>
  rpc(uid, "SELECT public.consent_withdraw('parent_policy', $1) r", [proof]);
const check = (uid: string) => rpc<boolean>(uid, "SELECT public.consent_check() r");
const consume = (uid: string, kind = "story") => rpc(uid, "SELECT public.consume_usage($1, 1, false) r", [kind]);
const proofOf = async (uid: string) => {
  const g = await rpc(uid, "SELECT public.open_parent_gate($1) r", [PIN]);
  expect(g.ok).toBe(true);
  return g.gate_token as string;
};
const rows = async (uid: string) =>
  (await db.query<J>("SELECT * FROM public.consents WHERE user_id=$1 ORDER BY accepted_at, id", [uid])).rows;
const sha = (d: Pick<Doc, "title" | "summary" | "body">) =>
  createHash("sha256").update(`${d.title}\n\n${d.summary}\n\n${d.body}`, "utf8").digest("hex");
let v1: Doc;

beforeAll(async () => {
  ({ db } = await createMigratedDb());
  for (const id of [fresh, pinUser, other, staff, gone]) await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [id, id + "@t11.test"]);
  await db.query("UPDATE public.profiles SET role = 'editor' WHERE id = $1", [staff]);
  await rpc(pinUser, "SELECT public.set_parent_pin($1, NULL) r", [PIN]);
  v1 = (await status(fresh)).document;
});
afterAll(async () => {
  await db?.close();
});

describe("policy documents", () => {
  it("version 1 (vi) is seeded, public, honest about processors and hashed over title + summary + text", async () => {
    expect(v1).toMatchObject({ version: 1, locale: "vi", title: "Chính sách quyền riêng tư cho bố mẹ" });
    expect(v1.body).toContain("OpenAI");
    expect(v1.body).toContain("ElevenLabs");
    expect(v1.body).toContain("tối đa khoảng 6 tháng");
    expect(v1.body).toContain("không lưu địa chỉ IP");
    expect(v1.body_sha256).toBe(sha(v1 as Required<Doc>));
    const anon = await asAnon(db, (tx) => tx.query<J>("SELECT version, body_sha256 FROM public.consent_documents"));
    expect(anon.rows).toEqual([{ version: 1, body_sha256: v1.body_sha256 }]);
  });

  it("cannot be written by clients and stays immutable even for the owner", async () => {
    await expect(asUser(db, fresh, (tx) => tx.query("UPDATE public.consent_documents SET title='x' WHERE version=1"))).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, fresh, (tx) => tx.query("INSERT INTO public.consent_documents(kind,version,title,summary,body) VALUES('parent_policy',9,'abc',repeat('s',30),repeat('b',300))")),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query("UPDATE public.consent_documents SET body = body || ' ' WHERE version=1")).rejects.toThrow(/immutable/);
    await expect(db.query("DELETE FROM public.consent_documents WHERE version=1")).rejects.toThrow(/immutable/);
    // A supplied hash is ignored: the server computes it.
    const { rows: ins } = await db.query<J>(
      "INSERT INTO public.consent_documents(kind,version,locale,title,summary,body,body_sha256,published_at) VALUES('parent_policy',50,'ja','Draft',repeat('s',30),repeat('b',300),repeat('0',64), now() + interval '30 days') RETURNING body_sha256",
    );
    expect(ins[0].body_sha256).toBe(sha({ title: "Draft", summary: "s".repeat(30), body: "b".repeat(300) }));
    // Not yet published → invisible and not current.
    expect((await asAnon(db, (tx) => tx.query("SELECT 1 FROM public.consent_documents WHERE version=50"))).rows).toEqual([]);
    expect((await status(fresh, "ja")).document.version).toBe(1);
  });
});

describe("before consent", () => {
  it("status says required and carries the full text; paid features and the API check refuse", async () => {
    const s = await status(fresh);
    expect(s).toMatchObject({ ok: true, kind: "parent_policy", required: true, has_pin: false, accepted: null, previous: null, withdrawn_at: null, history: null });
    expect(s.document.body.length).toBeGreaterThan(1000);
    expect(await check(fresh)).toBe(false);
    for (const kind of ["story", "ai", "tts", "voice_clone", "illustration"])
      expect(await consume(fresh, kind)).toEqual({ allowed: false, reason: "consent_required" });
    expect((await db.query("SELECT count(*)::int n FROM public.usage_tracking WHERE user_id=$1", [fresh])).rows[0]).toEqual({ n: 0 });
  });

  it("staff keep paid platform work in /admin (voice audition, catalogue) but family features still need consent", async () => {
    expect(await check(staff)).toBe(false);
    expect((await status(staff)).required).toBe(true);
    expect(await consume(staff, "tts")).toMatchObject({ allowed: true });
  });

  it("anon cannot call the consent API; unauthenticated calls are refused", async () => {
    for (const sql of ["SELECT public.consent_status()", "SELECT public.consent_check()", "SELECT public.consent_withdraw()"])
      await expect(asAnon(db, (tx) => tx.query(sql))).rejects.toThrow(/permission denied/);
    const r = await asRole(db, "authenticated", null, (tx) => tx.query<J>("SELECT public.consent_status() s, public.consent_accept($1,$2) a", [v1.id, v1.body_sha256]));
    expect(r.rows[0]).toEqual({ s: { ok: false, reason: "unauthenticated" }, a: { ok: false, reason: "unauthenticated" } });
    for (const fn of ["_consent_active($1,'parent_policy')", "_consume_usage_quota('story',1,false)", "parent_gate_check(NULL)"])
      await expect(asUser(db, fresh, (tx) => tx.query(`SELECT public.${fn}`, fn.includes("$1") ? [fresh] : []))).rejects.toThrow(/permission denied/);
  });
});

describe("accepting", () => {
  it("needs the exact current document and hash", async () => {
    expect(await accept(fresh, { id: randomUUID(), body_sha256: v1.body_sha256 })).toEqual({ ok: false, reason: "not_found" });
    expect(await accept(fresh, { id: v1.id, body_sha256: "0".repeat(64) })).toEqual({ ok: false, reason: "stale", current_version: 1 });
    expect(await rows(fresh)).toEqual([]);
  });

  it("records the account holder without a PIN, idempotently, and opens paid features", async () => {
    const a = await accept(fresh, v1);
    expect(a).toMatchObject({ ok: true, already: false, version: 1, method: "account_holder" });
    expect(await accept(fresh, v1)).toMatchObject({ ok: true, already: true, version: 1, accepted_at: a.accepted_at });
    const [row] = await rows(fresh);
    expect(row).toMatchObject({ kind: "parent_policy", version: 1, body_sha256: v1.body_sha256, method: "account_holder", withdrawn_at: null, document_id: v1.id });
    expect(row.household_id).toBeTruthy(); // the account's household (030)
    expect(await rows(fresh)).toHaveLength(1);
    const s = await status(fresh);
    expect(s).toMatchObject({ required: false, accepted: { version: 1, method: "account_holder" } });
    expect(s.document.body).toBeUndefined(); // the text only travels when needed
    expect((await status(fresh, "vi", true)).document.body).toBe(v1.body);
    expect(await check(fresh)).toBe(true);
    expect(await consume(fresh)).toMatchObject({ allowed: true, plan: "free", used: 1 });
  });

  it("with a parent PIN, only a valid parent proof of the same account is accepted", async () => {
    expect((await status(pinUser)).has_pin).toBe(true);
    expect(await accept(pinUser, v1)).toEqual({ ok: false, reason: "parent_proof_required" });
    expect(await accept(pinUser, v1, "f".repeat(64))).toEqual({ ok: false, reason: "parent_proof_required" });
    const otherProof = await rpc(other, "SELECT public.open_parent_gate($1) r", ["1357"]);
    expect(otherProof).toEqual({ ok: false, reason: "no_pin" });
    expect(await rows(pinUser)).toEqual([]);
    expect(await accept(pinUser, v1, await proofOf(pinUser))).toMatchObject({ ok: true, method: "parent_pin" });
    expect(await check(pinUser)).toBe(true);
  });

  it("records are private to their family and cannot be forged or edited by clients", async () => {
    const seen = await asUser(db, other, (tx) => tx.query("SELECT * FROM public.consents"));
    expect(seen.rows).toEqual([]);
    const own = await asUser(db, fresh, (tx) => tx.query<J>("SELECT user_id FROM public.consents"));
    expect(own.rows).toEqual([{ user_id: fresh }]);
    await expect(
      asUser(db, other, (tx) =>
        tx.query("INSERT INTO public.consents(user_id,document_id,kind,version,body_sha256,method) VALUES($1,$2,'parent_policy',1,$3,'parent_pin')", [other, v1.id, v1.body_sha256]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(db, fresh, (tx) => tx.query("UPDATE public.consents SET withdrawn_at=NULL WHERE user_id=$1", [fresh]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, fresh, (tx) => tx.query("DELETE FROM public.consents WHERE user_id=$1", [fresh]))).rejects.toThrow(/permission denied/);
    // Even the table owner cannot rewrite the evidence.
    await expect(db.query("UPDATE public.consents SET method='parent_pin' WHERE user_id=$1", [fresh])).rejects.toThrow(/append-only/);
    await expect(db.query("UPDATE public.consents SET accepted_at=accepted_at - interval '1 day' WHERE user_id=$1", [fresh])).rejects.toThrow(/append-only/);
  });
});

describe("withdrawing", () => {
  it("a PIN account must prove the PIN; then the app closes and paid features stop", async () => {
    expect(await withdraw(pinUser)).toEqual({ ok: false, reason: "parent_proof_required" });
    expect(await check(pinUser)).toBe(true);
    expect(await withdraw(pinUser, await proofOf(pinUser))).toEqual({ ok: true, withdrawn: 1 });
    expect(await check(pinUser)).toBe(false);
    expect(await consume(pinUser, "tts")).toEqual({ allowed: false, reason: "consent_required" });
    const s = await status(pinUser);
    expect(s).toMatchObject({ required: true, accepted: null, previous: null });
    expect(s.withdrawn_at).toBeTruthy();
    expect((await rows(pinUser))[0]).toMatchObject({ withdraw_method: "parent_pin" });
    // A withdrawn record is final: it cannot be re-opened, a new acceptance is a new row.
    await expect(db.query("UPDATE public.consents SET withdrawn_at=NULL, withdraw_method=NULL WHERE user_id=$1", [pinUser])).rejects.toThrow(/append-only/);
    expect(await accept(pinUser, v1, await proofOf(pinUser))).toMatchObject({ ok: true, already: false });
    const history = (await status(pinUser, "vi", true)).history;
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ version: 1, withdrawn_at: null });
    expect(history[1].withdrawn_at).toBeTruthy();
  });

  it("without a PIN the account holder withdraws; withdrawing twice is harmless", async () => {
    await accept(other, v1);
    expect(await withdraw(other)).toEqual({ ok: true, withdrawn: 1 });
    expect(await withdraw(other)).toEqual({ ok: true, withdrawn: 0 });
    expect((await rows(other))[0]).toMatchObject({ withdraw_method: "account_holder" });
    expect(await rpc(other, "SELECT public.consent_withdraw('voice', NULL) r")).toEqual({ ok: false, reason: "invalid_kind" });
  });
});

describe("parent reminders", () => {
  it("are claimed only for families with a valid consent", async () => {
    const admin = randomUUID(), keep = randomUUID(), left = randomUUID();
    for (const id of [admin, keep, left]) await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [id, id + "@t11.test"]);
    await db.query("UPDATE public.profiles SET role='super_admin' WHERE id=$1", [admin]);
    await accept(admin, v1);
    await asUser(db, admin, (tx) => tx.query("SELECT public.set_feature_flag('missions', true, false, $1)", ["Bật nhiệm vụ để kiểm thử T11"]));
    const keys = { p256dh: "B" + "x".repeat(86), auth: "a".repeat(22) };
    for (const [i, uid] of [keep, left].entries()) {
      await rpc(uid, "SELECT public.set_parent_pin($1, NULL) r", [PIN]);
      const proof = await proofOf(uid);
      await accept(uid, v1, proof);
      await rpc(uid, "SELECT public.parent_notify_set($1, true, 19) r", [proof]);
      await rpc(uid, "SELECT public.parent_device_register($1,$2,$3,$4) r", [proof, `https://push.example/t11-${i}`, keys.p256dh, keys.auth]);
    }
    expect(await withdraw(left, await proofOf(left))).toEqual({ ok: true, withdrawn: 1 });
    const at = (await db.query<{ t: string }>("SELECT ((public.missions_local_date(now()) + time '19:05') AT TIME ZONE 'Asia/Ho_Chi_Minh')::text t")).rows[0].t;
    const out = (await asRole(db, "service_role", null, (tx) => tx.query<{ r: J[] }>("SELECT public.parent_notify_claim($1::timestamptz, 50) r", [at]))).rows[0].r;
    expect(out.map((x) => x.user_id)).toEqual([keep]); // `left` withdrew → no reminder, not even queued
    expect((await db.query("SELECT user_id FROM public.parent_notification_log WHERE user_id=$1", [left])).rows).toEqual([]);
  });
});

describe("a new policy version", () => {
  it("asks everyone again, refuses the old version and keeps translations on the same version", async () => {
    await db.query(
      "INSERT INTO public.consent_documents(kind,version,locale,title,summary,body) VALUES('parent_policy',2,'vi','Chính sách quyền riêng tư cho bố mẹ',$1,$2)",
      ["- Bản 2: thêm mục mới về hồ sơ của bé.", v1.body + "\n\n## 11. Hồ sơ của bé\nBản thử nghiệm."],
    );
    const s = await status(fresh);
    expect(s).toMatchObject({ required: true, previous: { version: 1 }, withdrawn_at: null, document: { version: 2 } });
    expect(await check(fresh)).toBe(false);
    expect(await consume(fresh)).toEqual({ allowed: false, reason: "consent_required" });
    expect(await accept(fresh, v1)).toEqual({ ok: false, reason: "stale", current_version: 2 });
    expect(await accept(fresh, s.document)).toMatchObject({ ok: true, version: 2 });
    expect(await check(fresh)).toBe(true);
    // English text of version 2: shown to en users, and a vi acceptance of v2 still counts.
    await db.query(
      "INSERT INTO public.consent_documents(kind,version,locale,title,summary,body) VALUES('parent_policy',2,'en','Privacy policy for parents',$1,$2)",
      ["- Version 2 summary for parents.", "x".repeat(400)],
    );
    expect(await status(fresh, "en")).toMatchObject({ required: false, document: { version: 2, locale: "en" } });
    expect((await status(other, "ja")).document).toMatchObject({ version: 2, locale: "vi" }); // no ja text → vi
  });
});

describe("account deletion", () => {
  it("removes the account's consent records with it", async () => {
    await accept(gone, (await status(gone)).document);
    expect(await rows(gone)).toHaveLength(1);
    await db.query("DELETE FROM auth.users WHERE id=$1", [gone]);
    expect(await rows(gone)).toEqual([]);
  });
});
