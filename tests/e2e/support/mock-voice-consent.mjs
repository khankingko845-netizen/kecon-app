/**
 * T12 · Spoken voice consent (migration 043) for the E2E mock Supabase: a stateful
 * stand-in for the voice-consent RPCs, the deletion jobs and the private bucket
 * "voice-consents". The real rules (RLS, grants, triggers, 24 h / 48 h expiry, the 2-hour
 * sweep) are covered by tests/db/voice-consent.test.ts; this only lets the UI run end to end.
 * The household is the account (my_household_context in the mock).
 *
 *   POST /__e2e/voice-consent-reset {sub} → the household's fixtures again
 *   GET  /__e2e/voice-consent-state?sub=  → { consents, jobs, files, pageAudio }
 */
import { createHash, randomUUID } from "node:crypto";

/** New family without a PIN: records a consent, then clones (voice-consent.spec.ts). */
export const MOCK_VC_USER_ID = "00000000-0000-4000-8000-00000000e2d1";
/** Same, with parent PIN 2468. */
export const MOCK_VC_PIN_USER_ID = "00000000-0000-4000-8000-00000000e2d2";
/** A consented voice (Ông Tư → "Ông của bé") and a voice cloned before consents ("Giọng cũ"). */
export const MOCK_VC_WITHDRAW_USER_ID = "00000000-0000-4000-8000-00000000e2d3";
/** mock-supabase.mjs: "Bà của bé" (familyGrandma) — bound to a consent here so it keeps speaking. */
const MOCK_VOICE_USER_ID = "00000000-0000-4000-8000-00000000e2e8";
const FRESH = new Set([MOCK_VC_USER_ID, MOCK_VC_PIN_USER_ID]);

const sha = (v) => createHash("sha256").update(v).digest("hex");
const iso = (t = Date.now()) => new Date(t).toISOString();
const EXT = { "audio/webm": "webm", "audio/mp4": "mp4", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/wav": "wav" };

// Same wording as migration 043 (shortened body).
const TITLE = "Đồng ý cho KểCon dùng giọng nói";
const SUMMARY = [
  "- Người góp giọng tự đọc to câu đồng ý. KểCon lưu bản ghi câu đó cùng thời điểm và phiên bản văn bản này trước khi tạo giọng.",
  "- Bản ghi âm mẫu được gửi tới ElevenLabs để tạo một giọng đọc nhân bản, chỉ dùng để kể truyện trong tài khoản của gia đình đã ghi âm.",
  "- Giọng không được chia sẻ cho gia đình khác, không đưa vào thư viện chung, không dùng để quảng cáo.",
  "- Rút đồng ý bất cứ lúc nào trong Bố mẹ › Quyền riêng tư & dữ liệu › Đồng ý giọng nói: giọng ngừng được dùng ngay; giọng ở ElevenLabs, các file ghi âm và audio truyện đọc bằng giọng đó bị xoá trong vòng 24 giờ.",
].join("\n");
const BODY = [
  "## 1. Văn bản này là gì",
  "Đây là bản 1 của lời đồng ý dùng giọng nói trong KểCon. Người góp giọng đọc to câu đồng ý ở cuối văn bản, trước khi ghi âm mẫu.",
  "",
  "## 4. Rút đồng ý",
  "- Khi rút: giọng ngừng được dùng ngay. Trong vòng 24 giờ KểCon xoá giọng ở ElevenLabs, xoá file ghi âm mẫu và ghi âm câu đồng ý, xoá audio truyện đã đọc bằng giọng đó trên máy chủ.",
  "",
  "## 5. Câu đồng ý cần đọc to",
  "Người góp giọng đọc nguyên văn câu dưới đây, với tên của mình. Nếu người góp giọng không đồng ý, đừng ghi âm.",
].join("\n");
const SPOKEN = "Tôi là {ten}. Tôi đồng ý để KểCon dùng giọng nói của tôi tạo giọng đọc truyện cho gia đình mình. Tôi biết mình có thể rút lại đồng ý bất cứ lúc nào.";
export const VOICE_DOC = {
  id: "00000000-0000-4000-8000-0000000d0c01",
  version: 1,
  locale: "vi",
  title: TITLE,
  summary: SUMMARY,
  body: BODY,
  spoken_text: SPOKEN,
  body_sha256: sha(`${TITLE}\n\n${SUMMARY}\n\n${BODY}\n\n${SPOKEN}`),
  published_at: "2026-10-17T00:00:00Z",
};
/** Fixture consent recordings: 1 s of 8 kHz silence as a real WAV, so the browser can play it. */
function silentWav(seconds = 1, rate = 8000) {
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n, 0x80);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write("data", 36);
  b.writeUInt32LE(n, 40);
  return b;
}
const FIXTURE_AUDIO = silentWav();
export const MIME_OF = Object.fromEntries(Object.entries(EXT).map(([mime, ext]) => [ext, mime]));

const W = MOCK_VC_WITHDRAW_USER_ID;
const profileRow = (h, id, name, voice, relation, gender) => ({
  id, user_id: h, household_id: h, name, relation, gender, elevenlabs_voice_id: voice, sample_audio_url: null,
  quality_score: 90, is_active: true, created_at: "2026-10-01T08:00:00Z",
});
const FIXTURE_PROFILES = {
  [W]: [
    profileRow(W, "00000000-0000-4000-8000-00000000cd31", "Ông của bé", "familyGrandpa", "grandpa", "male"),
    profileRow(W, "00000000-0000-4000-8000-00000000cd32", "Giọng cũ", "legacyVoice", "parent", "female"),
  ],
};
const FIXTURE_CONSENTS = {
  [MOCK_VOICE_USER_ID]: [{ id: "00000000-0000-4000-8000-00000000cd81", speaker: "Bà Ngoại", voice: "familyGrandma", recordedAt: "2026-10-17T02:00:00Z" }],
  [W]: [{ id: "00000000-0000-4000-8000-00000000cd91", speaker: "Ông Tư", voice: "familyGrandpa", recordedAt: "2026-10-17T03:00:00Z" }],
};

/**
 * @param {{ tables: Record<string, any[]>, policyOk: (sub: string) => boolean, hasPin: (sub: string) => boolean, proofOk: (sub: string, proof: unknown) => boolean, rpcError: (status: number, code: string, message: string) => unknown }} deps
 */
export function createVoiceConsentMock({ tables, policyOk, hasPin, proofOk, rpcError }) {
  const state = new Map();
  const files = new Map(); // "voice-consents/<household>/<consent>.<ext>" → Buffer
  const of = (h) => {
    if (!state.has(h)) state.set(h, { consents: [], jobs: [], pageAudio: [] });
    return state.get(h);
  };
  const consents = () => [...state.values()].flatMap((s) => s.consents);
  const jobs = () => [...state.values()].flatMap((s) => s.jobs);
  const jobOfVoice = (voice) => (voice ? jobs().find((j) => j.provider_voice_id === voice) : undefined);
  const hasActiveConsent = (h, voice) => of(h).consents.some((c) => c.provider_voice_id === voice && !c.withdrawn_at);
  const profiles = () => tables.voice_profiles ?? [];

  function consentRow(h, { id = randomUUID(), speaker, voice = null, recordedAt = iso() }) {
    const name = `${h}/${id}.wav`;
    files.set(`voice-consents/${name}`, FIXTURE_AUDIO);
    return {
      id, household_id: h, recorded_by: h, document_id: VOICE_DOC.id, version: 1, locale: "vi", body_sha256: VOICE_DOC.body_sha256,
      speaker_name: speaker, spoken_text: SPOKEN.replace("{ten}", speaker), parent_method: "account_holder",
      audio_sha256: sha(FIXTURE_AUDIO), audio_bytes: FIXTURE_AUDIO.length, audio_mime: "audio/wav", duration_ms: 6200, audio_path: name,
      recorded_at: recordedAt, provider_voice_id: voice, bound_at: voice ? recordedAt : null, withdrawn_at: null, withdraw_reason: null, audio_deleted_at: null,
    };
  }
  function reset(h) {
    for (const k of [...files.keys()]) if (k.startsWith(`voice-consents/${h}/`)) files.delete(k);
    state.set(h, { consents: (FIXTURE_CONSENTS[h] ?? []).map((c) => consentRow(h, c)), jobs: [], pageAudio: [] });
    if (FIXTURE_PROFILES[h] || FRESH.has(h)) tables.voice_profiles = [...profiles().filter((v) => v.user_id !== h), ...(FIXTURE_PROFILES[h] ?? []).map((p) => ({ ...p }))];
  }
  for (const h of [...Object.keys(FIXTURE_CONSENTS), ...FRESH]) reset(h);

  /** _voice_deletion_enqueue: one job per provider voice (or per consent recording). */
  function enqueue(h, consentId, voice, paths, reason) {
    const s = of(h);
    let j = voice ? jobOfVoice(voice) : undefined;
    if (!j && consentId) j = s.jobs.find((x) => x.consent_id === consentId && (!voice || !x.provider_voice_id));
    const key = (p) => `${p.bucket}/${p.name}`;
    if (!j) {
      const t = Date.now();
      j = {
        id: randomUUID(), household_id: h, consent_id: consentId, provider_voice_id: voice, reason, status: "pending",
        storage_paths: [...new Map(paths.map((p) => [key(p), p])).values()], attempts: 0, provider_result: null, provider_done_at: null,
        provider_history_removed: 0, pages_cleared: 0, files_removed: 0, removed_cache: [], last_error: null,
        created_at: iso(t), updated_at: iso(t), due_at: iso(t), claimed_at: null, swept_at: null, deadline_at: iso(t + 24 * 3600e3), done_at: null,
      };
      s.jobs.push(j);
      return j;
    }
    const known = new Set(j.storage_paths.map(key));
    const more = (voice && !j.provider_voice_id) || paths.some((p) => !known.has(key(p)));
    j.consent_id ??= consentId;
    j.provider_voice_id ??= voice;
    j.storage_paths = [...j.storage_paths, ...paths.filter((p) => !known.has(key(p)))];
    if (more && j.status === "done") Object.assign(j, { status: "pending", done_at: null, deadline_at: iso(Date.now() + 24 * 3600e3) });
    if (more) j.due_at = iso(Math.min(Date.parse(j.due_at), Date.now()));
    j.updated_at = iso();
    return j;
  }
  const consentState = (c) =>
    c.withdrawn_at ? "withdrawn" : c.provider_voice_id ? "active" : !c.audio_path ? "incomplete" : Date.parse(c.recorded_at) < Date.now() - 24 * 3600e3 ? "expired" : "ready";
  const speakerOk = (n) => n.length >= 1 && n.length <= 60 && !/[\p{Cc}{}<>]/u.test(n);

  /** Signed-in RPCs (the caller's household). `undefined` = not a voice-consent function. */
  function userRpc(name, sub, body) {
    const h = sub;
    const s = of(h);
    switch (name) {
      case "voice_consent_document":
        return { ok: true, document: { ...VOICE_DOC } };
      case "voice_consent_begin": {
        if (!policyOk(sub)) return { ok: false, reason: "policy_required" };
        if (body?.p_document !== VOICE_DOC.id) return { ok: false, reason: "not_found" };
        if (body?.p_body_sha256 !== VOICE_DOC.body_sha256) return { ok: false, reason: "stale", current_version: 1 };
        const speaker = String(body?.p_speaker ?? "").replace(/\s+/g, " ").trim();
        if (!speakerOk(speaker)) return { ok: false, reason: "invalid_speaker" };
        const ext = EXT[body?.p_audio_mime];
        if (!ext || !/^[0-9a-f]{64}$/.test(String(body?.p_audio_sha256)) || !(body?.p_audio_bytes >= 1 && body.p_audio_bytes <= 5242880)
          || !(body?.p_duration_ms >= 2000 && body.p_duration_ms <= 60000)) return { ok: false, reason: "invalid_audio" };
        let method = "account_holder";
        if (hasPin(sub)) {
          if (!proofOk(sub, body?.p_proof)) return { ok: false, reason: "parent_proof_required" };
          method = "parent_pin";
        }
        if (s.consents.filter((c) => Date.parse(c.recorded_at) > Date.now() - 864e5).length >= 20) return { ok: false, reason: "rate_limited" };
        const c = {
          id: randomUUID(), household_id: h, recorded_by: sub, document_id: VOICE_DOC.id, version: 1, locale: "vi", body_sha256: VOICE_DOC.body_sha256,
          speaker_name: speaker, spoken_text: SPOKEN.replace("{ten}", speaker), parent_method: method, audio_sha256: body.p_audio_sha256,
          audio_bytes: body.p_audio_bytes, audio_mime: body.p_audio_mime, duration_ms: body.p_duration_ms, audio_path: null, recorded_at: iso(),
          provider_voice_id: null, bound_at: null, withdrawn_at: null, withdraw_reason: null, audio_deleted_at: null, user_agent: body?.p_user_agent ?? null,
        };
        s.consents.push(c);
        return { ok: true, consent_id: c.id, household_id: h, audio_path: `${h}/${c.id}.${ext}`, recorded_at: c.recorded_at, version: 1, spoken_text: c.spoken_text, parent_method: method };
      }
      case "voice_consent_ready": {
        if (!policyOk(sub)) return { ok: false, reason: "policy_required" };
        if (!body?.p_consent) return { ok: false, reason: "missing" };
        const c = s.consents.find((x) => x.id === body.p_consent);
        if (!c) return { ok: false, reason: "not_found" };
        if (c.withdrawn_at) return { ok: false, reason: "withdrawn" };
        if (c.provider_voice_id) return { ok: false, reason: "used" };
        if (!c.audio_path) return { ok: false, reason: "no_audio" };
        if (Date.parse(c.recorded_at) < Date.now() - 24 * 3600e3) return { ok: false, reason: "expired" };
        return { ok: true, consent_id: c.id, household_id: h, speaker_name: c.speaker_name, version: c.version, recorded_at: c.recorded_at };
      }
      case "voice_consent_withdraw": {
        if (!body?.p_consent && !body?.p_profile) return { ok: false, reason: "missing" };
        if (hasPin(sub) && !proofOk(sub, body?.p_proof)) return { ok: false, reason: "parent_proof_required" };
        let voice = null;
        let c;
        if (body.p_profile) {
          const p = profiles().find((v) => v.id === body.p_profile && v.household_id === h);
          if (!p) return { ok: false, reason: "not_found" };
          voice = p.elevenlabs_voice_id || null;
        }
        if (body.p_consent) {
          c = s.consents.find((x) => x.id === body.p_consent);
          if (!c || (voice && c.provider_voice_id !== voice)) return { ok: false, reason: "not_found" };
          voice ??= c.provider_voice_id;
        } else if (voice) c = s.consents.find((x) => x.provider_voice_id === voice);
        let wasOpen = false;
        if (c && !c.withdrawn_at) {
          wasOpen = true;
          Object.assign(c, { withdrawn_at: iso(), withdraw_reason: "withdrawn" });
        }
        const paths = c?.audio_path && !c.audio_deleted_at ? [{ bucket: "voice-consents", name: c.audio_path }] : [];
        if (voice || paths.length) enqueue(h, c?.id ?? null, voice, paths, "withdrawn");
        const before = profiles().length;
        tables.voice_profiles = profiles().filter((v) => !(v.household_id === h && ((voice && v.elevenlabs_voice_id === voice) || v.id === body.p_profile)));
        return { ok: true, withdrawn: wasOpen, profiles_deleted: before - tables.voice_profiles.length, household_id: h, deadline_at: iso(Date.now() + 24 * 3600e3) };
      }
      case "voice_consent_list": {
        const list = [...s.consents].sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at)).map((c) => {
          const job = s.jobs
            .filter((j) => j.consent_id === c.id || (c.provider_voice_id && j.provider_voice_id === c.provider_voice_id))
            .sort((a, b) => Number(Boolean(b.provider_voice_id)) - Number(Boolean(a.provider_voice_id)) || Date.parse(a.created_at) - Date.parse(b.created_at))[0];
          return {
            id: c.id, speaker_name: c.speaker_name, spoken_text: c.spoken_text, version: c.version, locale: c.locale, recorded_at: c.recorded_at,
            parent_method: c.parent_method, duration_ms: c.duration_ms, audio_available: Boolean(c.audio_path && !c.audio_deleted_at),
            provider_voice_id: c.provider_voice_id, bound_at: c.bound_at, withdrawn_at: c.withdrawn_at, withdraw_reason: c.withdraw_reason,
            audio_deleted_at: c.audio_deleted_at, state: consentState(c),
            profiles: c.provider_voice_id ? profiles().filter((v) => v.household_id === h && v.elevenlabs_voice_id === c.provider_voice_id).map((v) => ({ id: v.id, name: v.name, is_active: v.is_active !== false })) : [],
            deletion_id: job?.id ?? null,
          };
        });
        const deletions = [...s.jobs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map((j) => ({
          id: j.id, consent_id: j.consent_id, reason: j.reason, status: j.status, voice: Boolean(j.provider_voice_id), provider_result: j.provider_result,
          provider_done_at: j.provider_done_at, files_left: j.storage_paths.length, files_removed: j.files_removed, pages_cleared: j.pages_cleared,
          created_at: j.created_at, deadline_at: j.deadline_at, done_at: j.done_at, overdue: j.status !== "done" && Date.parse(j.deadline_at) < Date.now(),
        }));
        return { ok: true, consents: list, deletions };
      }
      case "voice_consent_audio_path": {
        const c = s.consents.find((x) => x.id === body?.p_consent);
        return c && !c.audio_deleted_at ? c.audio_path : null;
      }
      case "voice_revoked_audio":
        return [...new Set(s.jobs.flatMap((j) => j.removed_cache))];
      case "save_page_audio": {
        const ids = Array.isArray(body?.p_voice_ids) ? body.p_voice_ids : null;
        if (ids?.some((v) => jobOfVoice(v))) return rpcError(403, "42501", "Voice withdrawn");
        s.pageAudio.push({ page: body?.p_page, url: body?.p_url, key: body?.p_key ?? null, voice_ids: ids });
        return true;
      }
      default:
        return undefined;
    }
  }

  /** Service-role RPCs (the Next server). `undefined` = not a voice-consent function. */
  function serviceRpc(name, body) {
    const find = (id) => consents().find((c) => c.id === id);
    const job = (id) => jobs().find((j) => j.id === id);
    switch (name) {
      case "voice_consent_attach_audio": {
        const c = find(body?.p_consent);
        if (!c || c.audio_path || c.withdrawn_at || body?.p_path !== `${c.household_id}/${c.id}.${EXT[c.audio_mime]}`) return false;
        c.audio_path = body.p_path;
        return true;
      }
      case "voice_consent_discard": {
        const c = find(body?.p_consent);
        if (!c || c.audio_path || c.provider_voice_id) return false;
        const s = of(c.household_id);
        s.consents = s.consents.filter((x) => x !== c);
        return true;
      }
      case "voice_consent_bind": {
        const h = body?.p_user;
        const c = find(body?.p_consent);
        const voice = String(body?.p_voice ?? "");
        const held = consents().some((x) => x.provider_voice_id === voice);
        const reason = !c || c.household_id !== h ? "not_found" : c.withdrawn_at ? "withdrawn" : c.provider_voice_id ? "used" : !c.audio_path ? "no_audio" : null;
        if (reason) return { ok: false, reason, job_id: held ? null : enqueue(c?.household_id ?? h, null, voice, [], "clone_unbound").id };
        Object.assign(c, { provider_voice_id: voice, bound_at: iso() });
        return { ok: true, consent_id: c.id };
      }
      case "voice_consent_expire":
        return 0;
      case "voice_deletion_claim": {
        const now = Date.now();
        const due = jobs()
          .filter((j) => (j.status === "pending" && Date.parse(j.due_at) <= now) || (j.status === "running" && Date.parse(j.claimed_at) < now - 15 * 60e3))
          .filter((j) => !body?.p_household || j.household_id === body.p_household)
          .slice(0, Math.min(Math.max(body?.p_limit ?? 10, 1), 50));
        return due.map((j) => {
          Object.assign(j, { status: "running", claimed_at: iso(now), attempts: j.attempts + 1, updated_at: iso(now) });
          return { id: j.id, provider: "elevenlabs", provider_voice_id: j.provider_voice_id, provider_done: Boolean(j.provider_done_at), attempts: j.attempts, household_id: j.household_id };
        });
      }
      case "voice_deletion_prepare": {
        const j = job(body?.p_job);
        if (!j) return null;
        j.swept_at = iso();
        return { storage_paths: j.storage_paths, pages_cleared: 0 };
      }
      case "voice_deletion_finish": {
        const j = job(body?.p_job);
        if (!j) return null;
        const removed = new Set((Array.isArray(body?.p_removed) ? body.p_removed : []).map((p) => `${p.bucket}/${p.name}`));
        if (body?.p_provider_result && !j.provider_done_at && j.provider_voice_id) Object.assign(j, { provider_result: body.p_provider_result, provider_done_at: iso() });
        const gone = j.storage_paths.filter((p) => removed.has(`${p.bucket}/${p.name}`));
        for (const p of gone) {
          if (p.bucket === "tts-cache") j.removed_cache = [...new Set([...j.removed_cache, p.name])];
          if (p.bucket === "voice-consents") for (const c of consents()) if (c.audio_path === p.name && c.withdrawn_at) c.audio_deleted_at ??= iso();
        }
        j.storage_paths = j.storage_paths.filter((p) => !removed.has(`${p.bucket}/${p.name}`));
        j.files_removed += gone.length;
        j.provider_history_removed += Math.max(0, Number(body?.p_history_removed) || 0);
        j.last_error = body?.p_error ? String(body.p_error).slice(0, 500) : null;
        const swept = Boolean(j.swept_at && Date.parse(j.swept_at) >= Date.parse(j.created_at) + 2 * 3600e3);
        const done = !body?.p_error && !j.storage_paths.length && (!j.provider_voice_id || j.provider_done_at) && (!j.provider_voice_id || j.reason === "clone_unbound" || swept);
        const wait = body?.p_error || j.storage_paths.length || (j.provider_voice_id && !j.provider_done_at) ? Math.min(3600e3, 60e3 * 2 ** Math.min(j.attempts, 10)) : null;
        Object.assign(j, {
          status: done ? "done" : "pending", done_at: done ? iso() : null, claimed_at: null, updated_at: iso(),
          due_at: done ? j.due_at : iso(wait ? Date.now() + wait : Math.max(Date.now() + 60e3, Date.parse(j.created_at) + 2 * 3600e3 + 60e3)),
        });
        return { status: j.status, files_left: j.storage_paths.length, files_removed: gone.length, provider_result: j.provider_result, due_at: done ? null : j.due_at };
      }
      case "voice_deletion_overdue":
        return jobs().filter((j) => j.status !== "done" && Date.parse(j.deadline_at) < Date.now()).length;
      default:
        return undefined;
    }
  }

  return {
    SERVICE_RPCS: ["voice_consent_attach_audio", "voice_consent_discard", "voice_consent_bind", "voice_consent_expire", "voice_deletion_claim", "voice_deletion_prepare", "voice_deletion_finish", "voice_deletion_overdue"],
    userRpc,
    serviceRpc,
    reset,
    /** authorize_tts_voice: a voice with a deletion job never speaks; an own voice needs an active consent. */
    revoked: (voice) => Boolean(jobOfVoice(voice)),
    hasActiveConsent,
    /** Service-role storage for the private bucket (upload / download / remove). */
    files,
    snapshot: (h) => {
      const s = of(h);
      return { consents: s.consents, jobs: s.jobs, pageAudio: s.pageAudio, files: [...files.keys()].filter((k) => k.startsWith(`voice-consents/${h}/`)) };
    },
  };
}
