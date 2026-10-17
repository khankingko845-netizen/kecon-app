import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asRole, asUser, createMigratedDb, grantParentConsent } from "./supabase-harness";

// T12 (docs/voice-consent.md): a family voice is cloned only after the contributor read
// the consent sentence aloud and the recording was stored with the text version + hash;
// a provider voice needs a bound, active consent; withdrawal (or deleting the voice /
// the account) stops the voice at once for everyone and queues the deletion of the
// provider voice, the recordings and the narration rendered with it (within 24 hours).
let db: PGlite;
const mom = randomUUID(), // account holder, no PIN
  dad = randomUUID(), // own household, has a parent PIN
  other = randomUUID(), // another household
  fresh = randomUUID(), // never accepted the parent policy
  gone = randomUUID(); // account deleted later
const PIN = "2468";
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const AUDIO = "a".repeat(64);

const rpc = async <T = J>(uid: string, sql: string, args: unknown[] = []) =>
  (await asUser(db, uid, (tx) => tx.query<{ r: T }>(sql, args))).rows[0].r;
const svc = async <T = J>(sql: string, args: unknown[] = []) =>
  (await asRole(db, "service_role", null, (tx) => tx.query<{ r: T }>(sql, args))).rows[0].r;
const hh = async (uid: string) =>
  (await db.query<{ h: string }>("SELECT household_id h FROM public.profiles WHERE id=$1", [uid])).rows[0].h;
let doc: J;
const begin = (uid: string, o: Partial<{ doc: string; sha: string; name: string; audio: string; bytes: number; mime: string; ms: number; proof: string | null }> = {}) =>
  rpc(uid, "SELECT public.voice_consent_begin($1,$2,$3,$4,$5,$6,$7,$8,'QA browser') r", [
    o.doc ?? doc.id,
    o.sha ?? doc.body_sha256,
    o.name ?? "Bà Ngoại Lan",
    o.audio ?? AUDIO,
    o.bytes ?? 48_000,
    o.mime ?? "audio/webm",
    o.ms ?? 6_000,
    o.proof ?? null,
  ]);
const attach = (id: string, path: string) => svc<boolean>("SELECT public.voice_consent_attach_audio($1,$2) r", [id, path]);
/** A recorded consent with its audio stored (what POST /api/voice/consent leaves). */
const recorded = async (uid: string, name = "Bà Ngoại Lan") => {
  const b = await begin(uid, { name });
  expect(b.ok).toBe(true);
  expect(await attach(b.consent_id, b.audio_path)).toBe(true);
  return b as { consent_id: string; audio_path: string; household_id: string };
};
const bind = (uid: string, consent: string, voice: string) =>
  svc("SELECT public.voice_consent_bind($1,$2,$3) r", [uid, consent, voice]);
const addProfile = (uid: string, voice: string, sample: string | null = null) =>
  asUser(db, uid, (tx) =>
    tx.query<{ id: string }>("INSERT INTO public.voice_profiles(user_id,name,elevenlabs_voice_id,sample_audio_url) VALUES($1,'Giọng bà',$2,$3) RETURNING id", [uid, voice, sample]),
  ).then((r) => r.rows[0].id);
const authorize = (uid: string, voice: string) => rpc<string>(uid, "SELECT public.authorize_tts_voice($1,'vi') r", [voice]);
const job = async (voice: string) => (await db.query<J>("SELECT * FROM public.voice_deletion_jobs WHERE provider_voice_id=$1", [voice])).rows[0];
const consentRow = async (id: string) => (await db.query<J>("SELECT * FROM public.voice_consents WHERE id=$1", [id])).rows[0];
const asReplica = async (sql: string, args: unknown[] = []) => {
  await db.exec("SET session_replication_role = replica");
  try {
    await db.query(sql, args);
  } finally {
    await db.exec("SET session_replication_role = DEFAULT");
  }
};
/** What the worker's storage.remove() does to the objects table. */
const removeObjects = async (paths: { bucket: string; name: string }[]) => {
  for (const p of paths) await db.query("DELETE FROM storage.objects WHERE bucket_id=$1 AND name=$2", [p.bucket, p.name]);
};
const ttsUrl = (name: string) => `https://kecon.test/storage/v1/object/public/tts-cache/${name}`;

beforeAll(async () => {
  ({ db } = await createMigratedDb());
  for (const id of [mom, dad, other, fresh, gone]) await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [id, id + "@t12.test"]);
  for (const id of [mom, dad, other, gone]) await grantParentConsent(db, id);
  await rpc(dad, "SELECT public.set_parent_pin($1, NULL) r", [PIN]);
  await db.query("INSERT INTO storage.buckets(id,name,public) VALUES('recordings','recordings',false),('tts-cache','tts-cache',true) ON CONFLICT DO NOTHING");
  doc = (await rpc(mom, "SELECT public.voice_consent_document('vi') r")).document;
});
afterAll(async () => {
  await db?.close();
});

describe("voice-consent text", () => {
  it("version 1 (vi) ends with the sentence read aloud and is hashed with it", async () => {
    expect(doc).toMatchObject({ version: 1, locale: "vi", title: "Đồng ý cho KểCon dùng giọng nói" });
    expect(doc.spoken_text).toMatch(/^Tôi là \{ten\}\. Tôi đồng ý để KểCon dùng giọng nói của tôi/);
    expect(doc.body).toContain("ElevenLabs");
    expect(doc.body).toContain("24 giờ");
    expect(doc.body_sha256).toBe(sha(`${doc.title}\n\n${doc.summary}\n\n${doc.body}\n\n${doc.spoken_text}`));
    // The parent policy keeps its T11 hash and stays the policy of the consent gate.
    const policy = (await rpc(mom, "SELECT public.consent_status('vi', true) r")).document;
    expect(policy.title).toBe("Chính sách quyền riêng tư cho bố mẹ");
    expect(policy.body_sha256).toBe(sha(`${policy.title}\n\n${policy.summary}\n\n${policy.body}`));
  });
  it("a voice consent is spoken, never a click: the T11 accept cannot record it", async () => {
    await expect(rpc(mom, "SELECT public.consent_accept($1,$2,NULL) r", [doc.id, doc.body_sha256])).rejects.toThrow(/consents_parent_policy_only/);
    await expect(db.query("INSERT INTO public.consent_documents(kind,version,title,summary,body) VALUES('voice_clone',2,'abc',repeat('s',30),repeat('b',300))")).rejects.toThrow(/consent_documents_spoken/);
  });
});

describe("recording a consent", () => {
  it("needs the parent policy, the current text + hash, a speaker name and real audio", async () => {
    expect((await begin(fresh)).reason).toBe("policy_required");
    expect((await begin(mom, { sha: "0".repeat(64) })).reason).toBe("stale");
    expect((await begin(mom, { doc: randomUUID() })).reason).toBe("not_found");
    for (const name of ["", "   ", "<b>Bà</b>", "x".repeat(61)]) expect((await begin(mom, { name })).reason).toBe("invalid_speaker");
    expect((await begin(mom, { mime: "audio/flac" })).reason).toBe("invalid_audio");
    expect((await begin(mom, { ms: 1_000 })).reason).toBe("invalid_audio");
    expect((await begin(mom, { bytes: 6 * 1024 * 1024 })).reason).toBe("invalid_audio");
    expect((await begin(mom, { audio: "xyz" })).reason).toBe("invalid_audio");
    expect(await db.query("SELECT 1 FROM public.voice_consents")).toMatchObject({ rows: [] });
  });
  it("stores who spoke what, under which text and parent proof; PIN accounts prove the PIN", async () => {
    const b = await begin(mom, { name: "  Bà   Ngoại  Lan " });
    expect(b).toMatchObject({ ok: true, version: 1, parent_method: "account_holder", household_id: await hh(mom) });
    expect(b.spoken_text).toBe(doc.spoken_text.replace("{ten}", "Bà Ngoại Lan"));
    expect(b.audio_path).toBe(`${await hh(mom)}/${b.consent_id}.webm`);
    const row = await consentRow(b.consent_id);
    expect(row).toMatchObject({ recorded_by: mom, body_sha256: doc.body_sha256, speaker_name: "Bà Ngoại Lan", audio_sha256: AUDIO, method: "spoken_in_app", user_agent: "QA browser", audio_path: null });
    expect((await begin(dad)).reason).toBe("parent_proof_required");
    const gate = await rpc(dad, "SELECT public.open_parent_gate($1) r", [PIN]);
    const withPin = await begin(dad, { proof: gate.gate_token, mime: "audio/mp4" });
    expect(withPin).toMatchObject({ ok: true, parent_method: "parent_pin" });
    expect(withPin.audio_path).toMatch(/\.mp4$/);
  });
  it("the clone gate wants the stored recording, unused, of this household, from the last 24 hours", async () => {
    const b = await begin(mom);
    expect((await rpc(mom, "SELECT public.voice_consent_ready($1) r", [b.consent_id])).reason).toBe("no_audio");
    expect(await attach(b.consent_id, `${await hh(mom)}/${randomUUID()}.webm`)).toBe(false);
    expect(await attach(b.consent_id, b.audio_path)).toBe(true);
    expect(await attach(b.consent_id, b.audio_path)).toBe(false); // once
    expect(await rpc(mom, "SELECT public.voice_consent_ready($1) r", [b.consent_id])).toMatchObject({ ok: true, household_id: await hh(mom), speaker_name: "Bà Ngoại Lan" });
    expect((await rpc(other, "SELECT public.voice_consent_ready($1) r", [b.consent_id])).reason).toBe("not_found");
    expect((await rpc(mom, "SELECT public.voice_consent_ready(NULL) r")).reason).toBe("missing");
    await asReplica("UPDATE public.voice_consents SET recorded_at = now() - interval '25 hours' WHERE id=$1", [b.consent_id]);
    expect((await rpc(mom, "SELECT public.voice_consent_ready($1) r", [b.consent_id])).reason).toBe("expired");
  });
  it("a failed upload discards the record; at most 20 consents a day per household", async () => {
    const b = await begin(other);
    expect(await svc<boolean>("SELECT public.voice_consent_discard($1) r", [b.consent_id])).toBe(true);
    expect(await consentRow(b.consent_id)).toBeUndefined();
    for (let i = 0; i < 20; i++) expect((await begin(other)).ok).toBe(true);
    expect((await begin(other)).reason).toBe("rate_limited");
    await db.query("DELETE FROM public.voice_consents WHERE household_id=$1", [await hh(other)]);
  });
  it("evidence is append-only, visible only to the household, recordings in a private bucket", async () => {
    const b = await recorded(mom);
    await expect(asUser(db, mom, (tx) => tx.query("UPDATE public.voice_consents SET speaker_name='x' WHERE id=$1", [b.consent_id]))).rejects.toThrow(/permission denied/);
    await expect(db.query("UPDATE public.voice_consents SET speaker_name='x' WHERE id=$1", [b.consent_id])).rejects.toThrow(/append-only/);
    await expect(db.query("UPDATE public.voice_consents SET audio_path=NULL, audio_stored_at=NULL WHERE id=$1", [b.consent_id])).rejects.toThrow(/append-only/);
    const seen = (uid: string) => asUser(db, uid, (tx) => tx.query("SELECT id FROM public.voice_consents WHERE id=$1", [b.consent_id])).then((r) => r.rows.length);
    expect(await seen(mom)).toBe(1);
    expect(await seen(other)).toBe(0);
    expect((await asAnon(db, (tx) => tx.query("SELECT public.voice_consent_list() r")).catch((e: Error) => e.message))).toMatch(/permission denied/);
    expect((await rpc(other, "SELECT public.voice_consent_audio_path($1) r", [b.consent_id]))).toBeNull();
    expect(await rpc(mom, "SELECT public.voice_consent_audio_path($1) r", [b.consent_id])).toBe(b.audio_path);
    const bucket = (await db.query<J>("SELECT public, file_size_limit FROM storage.buckets WHERE id='voice-consents'")).rows[0];
    expect([bucket.public, Number(bucket.file_size_limit)]).toEqual([false, 5242880]);
  });
  it("clients cannot call the server steps", async () => {
    const b = await begin(mom);
    for (const sql of [
      "SELECT public.voice_consent_attach_audio($1, 'x')",
      "SELECT public.voice_consent_bind(auth.uid(), $1, 'v-forged')",
      "SELECT public.voice_consent_discard($1)",
    ])
      await expect(asUser(db, mom, (tx) => tx.query(sql, [b.consent_id]))).rejects.toThrow(/permission denied/);
    for (const sql of ["SELECT public.voice_deletion_claim()", "SELECT public.voice_consent_expire()", "SELECT public.voice_deletion_overdue()"])
      await expect(asUser(db, mom, (tx) => tx.query(sql))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, mom, (tx) => tx.query("SELECT * FROM public.voice_deletion_jobs"))).rejects.toThrow(/permission denied/);
  });
});

describe("family voices need a bound, active consent", () => {
  let c: { consent_id: string; audio_path: string };
  it("binding records the T08 receipt; only then may the profile use the voice", async () => {
    c = await recorded(mom);
    await expect(addProfile(mom, "v-mom")).rejects.toThrow(/Voice consent required/);
    expect(await bind(mom, c.consent_id, "v-mom")).toEqual({ ok: true, consent_id: c.consent_id });
    expect((await db.query("SELECT household_id FROM public.voice_provider_claims WHERE voice_id='v-mom'")).rows).toEqual([{ household_id: await hh(mom) }]);
    expect(await consentRow(c.consent_id)).toMatchObject({ provider: "elevenlabs", provider_voice_id: "v-mom" });
    expect((await rpc(mom, "SELECT public.voice_consent_ready($1) r", [c.consent_id])).reason).toBe("used");
    await addProfile(mom, "v-mom", `${mom}/sample-1.webm`);
    expect(await authorize(mom, "v-mom")).toBe("allowed");
    expect(await authorize(other, "v-mom")).toBe("unavailable");
    // Another household cannot bind a foreign consent, nor reuse a voice.
    const o = await recorded(other);
    await expect(asUser(db, other, (tx) => tx.query("INSERT INTO public.voice_profiles(user_id,name,elevenlabs_voice_id) VALUES($1,'x','v-mom')", [other]))).rejects.toThrow(/Voice consent required/);
    expect((await bind(other, c.consent_id, "v-x")).reason).toBe("not_found");
    expect((await job("v-x")).reason).toBe("clone_unbound");
    // A held voice ID is never queued for deletion from a failed bind.
    expect(await bind(other, o.consent_id, "v-mom")).toEqual({ ok: false, reason: "claim_failed", job_id: null });
    expect(await consentRow(o.consent_id)).toMatchObject({ provider_voice_id: null });
    expect(await bind(mom, c.consent_id, "v-mom")).toEqual({ ok: false, reason: "used", job_id: null }); // retried call
    expect(await job("v-mom")).toBeUndefined();
  });
  it("legacy clones (before T12) keep their rows but need a consent to speak", async () => {
    await asReplica("INSERT INTO public.voice_provider_claims(voice_id,user_id,household_id) VALUES('v-legacy',$1,$2)", [mom, await hh(mom)]);
    await asReplica("INSERT INTO public.voice_profiles(user_id,household_id,name,elevenlabs_voice_id) VALUES($1,$2,'Giọng cũ','v-legacy')", [mom, await hh(mom)]);
    expect(await authorize(mom, "v-legacy")).toBe("consent_required");
    // Renaming / switching off still works.
    await asUser(db, mom, (tx) => tx.query("UPDATE public.voice_profiles SET name='Giọng cũ (tắt)', is_active=false WHERE elevenlabs_voice_id='v-legacy'"));
    expect(await authorize(mom, "v-legacy")).toBe("disabled");
  });
  it("a consent withdrawn while the provider was cloning: the new voice is queued for deletion, not bound", async () => {
    const late = await recorded(mom);
    expect((await rpc(mom, "SELECT public.voice_consent_withdraw($1) r", [late.consent_id])).ok).toBe(true);
    const r = await bind(mom, late.consent_id, "v-late");
    expect(r).toMatchObject({ ok: false, reason: "withdrawn" });
    expect(await job("v-late")).toMatchObject({ id: r.job_id, reason: "clone_unbound", user_ids: [], status: "pending" });
    await expect(addProfile(mom, "v-late")).rejects.toThrow(/Voice consent required/);
  });
});

describe("withdrawal", () => {
  const story = randomUUID(),
    platform = randomUUID(),
    pages = { mine: randomUUID(), other: randomUUID(), unknown: randomUUID(), plat: randomUUID() };
  let consent: string, audioPath: string;
  beforeAll(async () => {
    const row = (await db.query<J>("SELECT * FROM public.voice_consents WHERE provider_voice_id='v-mom'")).rows[0];
    consent = row.id;
    audioPath = row.audio_path;
    await db.query("INSERT INTO public.stories(id,user_id,title,status,narrator_voice_id,last_voice_id) VALUES($1,$2,'Truyện của bà','draft','v-mom','v-mom')", [story, mom]);
    await db.query("INSERT INTO public.story_characters(story_id,name,voice_id,voice_name) VALUES($1,'Sóc','v-mom','Giọng bà')", [story]);
    await db.query("INSERT INTO public.stories(id,user_id,title,status,is_platform_content) VALUES($1,$2,'Platform','draft',true)", [platform, mom]);
    for (const [k, id] of Object.entries(pages))
      await db.query("INSERT INTO public.story_pages(id,story_id,page_number,content) VALUES($1,$2,$3,'x')", [id, k === "plat" ? platform : story, Object.keys(pages).indexOf(k) + 1]);
    expect(await rpc<boolean>(mom, "SELECT public.save_page_audio($1,$2,12,NULL,ARRAY['v-mom','v-mom']) r", [pages.mine, ttsUrl("mine.mp3")])).toBe(true);
    expect(await rpc<boolean>(mom, "SELECT public.save_page_audio($1,$2,12,NULL,ARRAY['default-1']) r", [pages.other, ttsUrl("other.mp3")])).toBe(true);
    await asUser(db, mom, (tx) => tx.query("UPDATE public.story_pages SET audio_url=$2, audio_voice_ids=ARRAY['default-1'] WHERE id=$1", [pages.unknown, ttsUrl("unknown.mp3")]));
    await db.query("UPDATE public.story_pages SET audio_url=$2 WHERE id=$1", [pages.plat, ttsUrl("platform.mp3")]);
    const objects: [string, string, string][] = [
      ["tts-cache", "mine.mp3", "3 hours"],
      ["tts-cache", "other.mp3", "3 hours"],
      ["tts-cache", "unknown.mp3", "3 hours"],
      ["tts-cache", "platform.mp3", "3 hours"],
      ["tts-cache", "orphan-old.mp3", "3 hours"],
      ["tts-cache", "orphan-new.mp3", "1 minute"],
      ["recordings", `${mom}/sample-1.webm`, "3 hours"],
      ["recordings", `${mom}/failed-clone.webm`, "3 hours"],
      ["voice-consents", audioPath, "3 hours"],
    ];
    for (const [bucket, name, age] of objects)
      await db.query(`INSERT INTO storage.objects(bucket_id,name,owner,created_at) VALUES($1,$2,$3, now() - interval '${age}')`, [bucket, name, mom]);
  });
  it("save_page_audio is the only way to say which voices rendered a page", async () => {
    const ids = await db.query<J>("SELECT id, audio_voice_ids FROM public.story_pages WHERE story_id=$1 ORDER BY page_number", [story]);
    expect(ids.rows.map((r) => r.audio_voice_ids)).toEqual([["v-mom"], ["default-1"], null]);
    expect(await rpc<boolean>(other, "SELECT public.save_page_audio($1,'https://evil.test/x.mp3',1,NULL,NULL) r", [pages.mine])).toBe(false);
  });
  it("stops the voice at once — for every role — deletes the household's profiles and queues the deletion", async () => {
    const r = await rpc(mom, "SELECT public.voice_consent_withdraw($1) r", [consent]);
    expect(r).toMatchObject({ ok: true, withdrawn: true, profiles_deleted: 1, household_id: await hh(mom) });
    expect(await consentRow(consent)).toMatchObject({ withdraw_reason: "withdrawn", withdrawn_by: mom });
    expect((await db.query("SELECT 1 FROM public.voice_profiles WHERE elevenlabs_voice_id='v-mom'")).rows).toEqual([]);
    const j = await job("v-mom");
    expect(j).toMatchObject({ reason: "withdrawn", consent_id: consent, status: "pending", household_id: await hh(mom) });
    expect(j.storage_paths).toEqual(expect.arrayContaining([{ bucket: "recordings", name: `${mom}/sample-1.webm` }, { bucket: "voice-consents", name: audioPath }]));
    expect(new Date(j.deadline_at).getTime() - new Date(j.created_at).getTime()).toBe(24 * 3600_000);
    expect(await authorize(mom, "v-mom")).toBe("unavailable");
    await db.query("UPDATE public.profiles SET role='admin' WHERE id=$1", [mom]);
    expect(await authorize(mom, "v-mom")).toBe("unavailable"); // staff included
    await db.query("UPDATE public.profiles SET role='user' WHERE id=$1", [mom]);
    await expect(addProfile(mom, "v-mom")).rejects.toThrow(/Voice consent required/);
    await expect(db.query("INSERT INTO public.default_voices(voice_id,name,language) VALUES('v-mom','x','vi')")).rejects.toThrow(/Invalid content reference/);
    await expect(rpc(mom, "SELECT public.save_page_audio($1,'https://x.test/y.mp3',1,NULL,ARRAY['v-mom']) r", [pages.other])).rejects.toThrow(/Voice withdrawn/);
    expect((await rpc(mom, "SELECT public.voice_consent_withdraw($1) r", [consent])).withdrawn).toBe(false); // idempotent
    const list = await rpc(mom, "SELECT public.voice_consent_list() r");
    expect(list.consents.find((x: J) => x.id === consent)).toMatchObject({ state: "withdrawn", deletion_id: j.id, audio_available: true });
    expect(list.deletions.find((x: J) => x.id === j.id)).toMatchObject({ status: "pending", voice: true, overdue: false });
  });
  it("the worker clears narration with the voice (+ unknown narration of the household), casts and old orphans", async () => {
    const claimed = await svc<J[]>("SELECT public.voice_deletion_claim($1, 10) r", [await hh(mom)]);
    const mine = claimed.find((x) => x.provider_voice_id === "v-mom")!;
    expect(mine).toMatchObject({ provider_done: false, attempts: 1 });
    const prep = await svc("SELECT public.voice_deletion_prepare($1) r", [mine.id]);
    expect(prep.pages_cleared).toBe(2);
    const names = prep.storage_paths.map((p: J) => `${p.bucket}:${p.name}`).sort();
    expect(names).toEqual(
      [`recordings:${mom}/failed-clone.webm`, `recordings:${mom}/sample-1.webm`, `voice-consents:${audioPath}`, "tts-cache:mine.mp3", "tts-cache:orphan-old.mp3", "tts-cache:unknown.mp3"].sort(),
    );
    const left = await db.query<J>("SELECT id, audio_url FROM public.story_pages WHERE audio_url IS NOT NULL ORDER BY page_number");
    expect(left.rows.map((r) => r.id).sort()).toEqual([pages.other, pages.plat].sort());
    expect((await db.query<J>("SELECT narrator_voice_id, last_voice_id FROM public.stories WHERE id=$1", [story])).rows[0]).toEqual({ narrator_voice_id: null, last_voice_id: null });
    expect((await db.query<J>("SELECT voice_id FROM public.story_characters WHERE story_id=$1", [story])).rows[0].voice_id).toBeNull();
    // Provider deleted + every file removed, but the 2-hour sweep is still ahead.
    await removeObjects(prep.storage_paths);
    const fin = await svc("SELECT public.voice_deletion_finish($1,'deleted',$2::jsonb,NULL,3) r", [mine.id, JSON.stringify(prep.storage_paths)]);
    expect(fin).toMatchObject({ status: "pending", files_left: 0, files_removed: 6, provider_result: "deleted" });
    const j = await job("v-mom");
    expect(j).toMatchObject({ provider_result: "deleted", provider_history_removed: 3, files_removed: 6 });
    expect(new Date(j.due_at).getTime()).toBeGreaterThanOrEqual(new Date(j.created_at).getTime() + 2 * 3600_000);
    expect((await consentRow(consent)).audio_deleted_at).not.toBeNull();
    expect((await rpc(mom, "SELECT public.voice_consent_audio_path($1) r", [consent]))).toBeNull();
    expect((await rpc<string[]>(mom, "SELECT public.voice_revoked_audio() r")).sort()).toEqual(["mine.mp3", "orphan-old.mp3", "unknown.mp3"]);
    expect(await rpc<string[]>(other, "SELECT public.voice_revoked_audio() r")).toEqual([]);
  });
  it("finishes after the late sweep; errors back off and keep the job open", async () => {
    await db.query("UPDATE public.voice_deletion_jobs SET created_at = now() - interval '3 hours', due_at = now() WHERE provider_voice_id='v-mom'");
    const [again] = await svc<J[]>("SELECT public.voice_deletion_claim($1, 10) r", [await hh(mom)]).then((r) => r.filter((x) => x.provider_voice_id === "v-mom"));
    expect(again.provider_done).toBe(true);
    await svc("SELECT public.voice_deletion_prepare($1) r", [again.id]);
    const err = await svc("SELECT public.voice_deletion_finish($1,NULL,'[]'::jsonb,'storage: boom') r", [again.id]);
    expect(err.status).toBe("pending");
    expect((await job("v-mom")).last_error).toBe("storage: boom");
    await db.query("UPDATE public.voice_deletion_jobs SET due_at = now() WHERE provider_voice_id='v-mom'");
    const [last] = await svc<J[]>("SELECT public.voice_deletion_claim($1, 10) r", [await hh(mom)]).then((r) => r.filter((x) => x.provider_voice_id === "v-mom"));
    const prep = await svc("SELECT public.voice_deletion_prepare($1) r", [last.id]);
    expect(prep.storage_paths).toEqual([]);
    expect((await svc("SELECT public.voice_deletion_finish($1,NULL,'[]'::jsonb,NULL) r", [last.id])).status).toBe("done");
    expect(await job("v-mom")).toMatchObject({ status: "done", last_error: null });
    expect(await svc<number>("SELECT public.voice_deletion_overdue() r")).toBe(0);
  });
});

describe("other ways a voice goes", () => {
  it("deleting the voice in Giọng đọc withdraws its consent; listening history keeps the listen", async () => {
    const c = await recorded(mom, "Ông Nội");
    await bind(mom, c.consent_id, "v-grandpa");
    const profile = await addProfile(mom, "v-grandpa");
    const story = randomUUID();
    await db.query("INSERT INTO public.stories(id,user_id,title,status) VALUES($1,$2,'Nghe','draft')", [story, mom]);
    await db.query("INSERT INTO public.play_sessions(user_id,story_id,voice_id) VALUES($1,$2,$3)", [mom, story, profile]);
    await asUser(db, mom, (tx) => tx.query("DELETE FROM public.voice_profiles WHERE id=$1", [profile]));
    expect(await consentRow(c.consent_id)).toMatchObject({ withdraw_reason: "voice_deleted", withdrawn_by: mom });
    expect(await job("v-grandpa")).toMatchObject({ reason: "voice_deleted", consent_id: c.consent_id });
    expect((await db.query("SELECT voice_id FROM public.play_sessions WHERE story_id=$1", [story])).rows).toEqual([{ voice_id: null }]);
  });
  it("a legacy voice is deleted by profile id the same way (no consent to withdraw)", async () => {
    const id = (await db.query<J>("SELECT id FROM public.voice_profiles WHERE elevenlabs_voice_id='v-legacy'")).rows[0].id;
    const r = await rpc(mom, "SELECT public.voice_consent_withdraw(NULL, $1) r", [id]);
    expect(r).toMatchObject({ ok: true, withdrawn: false, profiles_deleted: 1 });
    expect(await job("v-legacy")).toMatchObject({ reason: "withdrawn", consent_id: null });
    expect((await rpc(other, "SELECT public.voice_consent_withdraw(NULL, $1) r", [id])).reason).toBe("not_found");
  });
  it("a PIN account proves the PIN to withdraw", async () => {
    const gate = await rpc(dad, "SELECT public.open_parent_gate($1) r", [PIN]);
    const b = await begin(dad, { proof: gate.gate_token });
    expect((await rpc(dad, "SELECT public.voice_consent_withdraw($1) r", [b.consent_id])).reason).toBe("parent_proof_required");
    const gate2 = await rpc(dad, "SELECT public.open_parent_gate($1) r", [PIN]);
    expect((await rpc(dad, "SELECT public.voice_consent_withdraw($1, NULL, $2) r", [b.consent_id, gate2.gate_token])).ok).toBe(true);
  });
  it("deleting the account queues its voices and consent recordings (jobs outlive the account)", async () => {
    const c = await recorded(gone, "Cô Út");
    await bind(gone, c.consent_id, "v-gone");
    await addProfile(gone, "v-gone", `${gone}/s.webm`);
    const h = await hh(gone);
    await db.query("DELETE FROM auth.users WHERE id=$1", [gone]);
    expect(await consentRow(c.consent_id)).toBeUndefined();
    const j = await job("v-gone");
    expect(j).toMatchObject({ household_id: h, status: "pending" });
    expect(["account_deleted", "voice_deleted"]).toContain(j.reason);
    expect(j.storage_paths).toEqual(expect.arrayContaining([{ bucket: "voice-consents", name: c.audio_path }, { bucket: "recordings", name: `${gone}/s.webm` }]));
    expect(await svc<J[]>("SELECT public.voice_deletion_claim($1, 10) r", [h])).toHaveLength(1);
  });
  it("unused consents expire: no clone after 24 hours, recording deleted after 48 hours", async () => {
    const c = await recorded(other, "Chú Tư");
    await asReplica("UPDATE public.voice_consents SET recorded_at = now() - interval '49 hours' WHERE id=$1", [c.consent_id]);
    expect(await svc<number>("SELECT public.voice_consent_expire() r")).toBeGreaterThanOrEqual(1);
    expect(await consentRow(c.consent_id)).toMatchObject({ withdraw_reason: "expired" });
    const j = (await db.query<J>("SELECT * FROM public.voice_deletion_jobs WHERE consent_id=$1", [c.consent_id])).rows[0];
    expect(j).toMatchObject({ reason: "expired", provider_voice_id: null, storage_paths: [{ bucket: "voice-consents", name: c.audio_path }] });
    expect((await rpc(other, "SELECT public.voice_consent_ready($1) r", [c.consent_id])).reason).toBe("withdrawn");
    // Files only: done as soon as they are removed (no provider voice, no late sweep).
    await db.query("UPDATE public.voice_deletion_jobs SET due_at = now() WHERE id=$1", [j.id]);
    await svc("SELECT public.voice_deletion_claim($1, 10) r", [await hh(other)]);
    await svc("SELECT public.voice_deletion_prepare($1) r", [j.id]);
    const fin = await svc("SELECT public.voice_deletion_finish($1,NULL,$2::jsonb,NULL) r", [j.id, JSON.stringify(j.storage_paths)]);
    expect(fin.status).toBe("done");
  });
});
