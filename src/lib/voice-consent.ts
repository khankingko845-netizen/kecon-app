/**
 * T12 · Spoken voice consent (migration 043, docs/voice-consent.md). Shared by the
 * app and the API routes: limits, types, messages, audio sniffing and the small
 * client calls. A family voice is cloned only after the contributor read the
 * consent sentence aloud and the recording was stored (POST /api/voice/consent);
 * withdrawing stops the voice at once and deletes it within 24 hours.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Same limits as the database (voice_consents) and the private bucket. */
export const CONSENT_AUDIO_MAX_BYTES = 5 * 1024 * 1024;
/** The app asks for 3–30 s; the server accepts 2–60 s (clock / encoder slack). */
export const CONSENT_MIN_MS = 3_000;
export const CONSENT_MAX_MS = 30_000;
export const CONSENT_SERVER_MIN_MS = 2_000;
export const CONSENT_SERVER_MAX_MS = 60_000;
export const SPEAKER_NAME_MAX = 60;

export const CONSENT_MIME = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
} as const;
export type ConsentMime = keyof typeof CONSENT_MIME;

/** The container the bytes really are (magic numbers), whatever the browser called it. */
export function sniffConsentAudio(bytes: Uint8Array): ConsentMime | null {
  const at = (i: number, ...b: number[]) => b.every((x, k) => bytes[i + k] === x);
  if (bytes.length < 12) return null;
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return "audio/webm"; // EBML (WebM / Matroska)
  if (at(4, 0x66, 0x74, 0x79, 0x70)) return "audio/mp4"; // ....ftyp (Safari / iOS)
  if (at(0, 0x4f, 0x67, 0x67, 0x53)) return "audio/ogg"; // OggS (Firefox)
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x41, 0x56, 0x45)) return "audio/wav"; // RIFF....WAVE
  if (at(0, 0x49, 0x44, 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg"; // ID3 / frame sync
  return null;
}

/** Name as the server stores it: single spaces, no control / markup characters. */
export function normalizeSpeakerName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}
export function speakerNameValid(name: string): boolean {
  const n = normalizeSpeakerName(name);
  return n.length >= 1 && n.length <= SPEAKER_NAME_MAX && !/[\p{Cc}{}<>]/u.test(n);
}
/** The sentence the contributor reads aloud, with their name. */
export function consentSentence(spokenText: string, speakerName: string): string {
  const n = normalizeSpeakerName(speakerName);
  return spokenText.split("{ten}").join(n || "…");
}

export interface VoiceConsentDocument {
  id: string;
  version: number;
  locale: string;
  title: string;
  summary: string;
  body: string;
  spoken_text: string;
  body_sha256: string;
  published_at: string;
}

export type VoiceConsentState = "withdrawn" | "active" | "incomplete" | "expired" | "ready";
export type VoiceWithdrawReason = "withdrawn" | "voice_deleted" | "account_deleted" | "expired";

export interface VoiceConsentItem {
  id: string;
  speaker_name: string;
  spoken_text: string;
  version: number;
  locale: string;
  recorded_at: string;
  parent_method: "parent_pin" | "account_holder";
  duration_ms: number;
  audio_available: boolean;
  provider_voice_id: string | null;
  bound_at: string | null;
  withdrawn_at: string | null;
  withdraw_reason: VoiceWithdrawReason | null;
  audio_deleted_at: string | null;
  state: VoiceConsentState;
  profiles: { id: string; name: string; is_active: boolean }[];
  deletion_id: string | null;
}

export interface VoiceDeletionItem {
  id: string;
  consent_id: string | null;
  reason: "withdrawn" | "voice_deleted" | "account_deleted" | "clone_unbound" | "expired";
  status: "pending" | "running" | "done";
  voice: boolean;
  provider_result: "deleted" | "already_gone" | "not_found" | null;
  provider_done_at: string | null;
  files_left: number;
  files_removed: number;
  pages_cleared: number;
  created_at: string;
  deadline_at: string;
  done_at: string | null;
  overdue: boolean;
}

export interface VoiceConsentList {
  consents: VoiceConsentItem[];
  deletions: VoiceDeletionItem[];
}

export type VoiceConsentFailure =
  | "unauthenticated"
  | "policy_required"
  | "no_document"
  | "not_found"
  | "missing"
  | "stale"
  | "invalid_speaker"
  | "invalid_audio"
  | "too_large"
  | "parent_proof_required"
  | "rate_limited"
  | "withdrawn"
  | "used"
  | "no_audio"
  | "expired"
  | "claim_failed"
  | "unavailable";

const MESSAGES: Record<VoiceConsentFailure, string> = {
  unauthenticated: "Vui lòng đăng nhập lại.",
  policy_required: "Bố mẹ cần đồng ý chính sách quyền riêng tư của KểCon trước.",
  no_document: "Chưa tải được văn bản đồng ý giọng nói. Vui lòng thử lại.",
  not_found: "Không tìm thấy lời đồng ý giọng nói này.",
  missing: "Cần ghi lời đồng ý của người góp giọng trước khi tạo giọng.",
  stale: "Văn bản đồng ý vừa được cập nhật. Đọc bản mới rồi ghi lại nhé.",
  invalid_speaker: `Nhập tên người góp giọng (tối đa ${SPEAKER_NAME_MAX} ký tự, không dùng { } < >).`,
  invalid_audio: "Bản ghi lời đồng ý phải là âm thanh dài 3–30 giây.",
  too_large: "Bản ghi lời đồng ý tối đa 5 MB.",
  parent_proof_required: "Bố mẹ nhập mã PIN để xác nhận.",
  rate_limited: "Hôm nay gia đình đã ghi nhiều lời đồng ý quá. Thử lại vào ngày mai nhé.",
  withdrawn: "Lời đồng ý này đã được rút. Hãy ghi lời đồng ý mới.",
  used: "Lời đồng ý này đã dùng cho một giọng. Mỗi giọng cần một lời đồng ý riêng.",
  no_audio: "Bản ghi lời đồng ý chưa được lưu. Hãy ghi lại.",
  expired: "Lời đồng ý đã quá 24 giờ chưa dùng. Hãy ghi lời đồng ý mới.",
  claim_failed: "Chưa gắn được giọng vào gia đình; giọng vừa tạo sẽ bị xoá. Vui lòng thử lại.",
  unavailable: "Chưa xử lý được lời đồng ý giọng nói. Vui lòng thử lại.",
};
export function voiceConsentMessage(reason: string | null | undefined): string {
  return MESSAGES[(reason ?? "unavailable") as VoiceConsentFailure] ?? MESSAGES.unavailable;
}
/** Clone / consent failures that need a new spoken consent (the old one cannot be used). */
export const RERECORD_REASONS: ReadonlySet<string> = new Set(["missing", "not_found", "withdrawn", "used", "no_audio", "stale", "expired"]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseVoiceConsentDocument(raw: unknown): VoiceConsentDocument | null {
  if (!isObj(raw) || raw.ok !== true || !isObj(raw.document)) return null;
  const d = raw.document;
  if (typeof d.id !== "string" || typeof d.spoken_text !== "string" || typeof d.body_sha256 !== "string") return null;
  return d as unknown as VoiceConsentDocument;
}
export function parseVoiceConsentList(raw: unknown): VoiceConsentList | null {
  if (!isObj(raw) || raw.ok !== true || !Array.isArray(raw.consents) || !Array.isArray(raw.deletions)) return null;
  return { consents: raw.consents as VoiceConsentItem[], deletions: raw.deletions as VoiceDeletionItem[] };
}

// ── Client calls ────────────────────────────────────────────────────────────

export async function fetchVoiceConsentDocument(supabase: SupabaseClient, locale = "vi"): Promise<VoiceConsentDocument> {
  const { data, error } = await supabase.rpc("voice_consent_document", { p_locale: locale });
  const doc = error ? null : parseVoiceConsentDocument(data);
  if (!doc) throw new Error(voiceConsentMessage("no_document"));
  return doc;
}
export async function fetchVoiceConsentList(supabase: SupabaseClient): Promise<VoiceConsentList> {
  const { data, error } = await supabase.rpc("voice_consent_list");
  const list = error ? null : parseVoiceConsentList(data);
  if (!list) throw new Error(voiceConsentMessage("unavailable"));
  return list;
}

export type ApiFailure = { ok: false; reason: string; message: string };
async function readFailure(res: Response): Promise<ApiFailure> {
  const body = (await res.json().catch(() => null)) as { code?: string; error?: string } | null;
  const reason = (body?.code ?? "unavailable").replace(/^voice_consent_/, "");
  return { ok: false, reason, message: body?.error || voiceConsentMessage(reason) };
}

export interface SavedVoiceConsent {
  ok: true;
  consentId: string;
  speakerName: string;
  spokenText: string;
  recordedAt: string;
  version: number;
}
export async function submitVoiceConsent(input: {
  document: Pick<VoiceConsentDocument, "id" | "body_sha256">;
  speakerName: string;
  audio: Blob;
  durationMs: number;
  proof: string | null;
}): Promise<SavedVoiceConsent | ApiFailure> {
  const form = new FormData();
  form.set("documentId", input.document.id);
  form.set("bodySha256", input.document.body_sha256);
  form.set("speakerName", normalizeSpeakerName(input.speakerName));
  form.set("durationMs", String(Math.round(input.durationMs)));
  if (input.proof) form.set("proof", input.proof);
  form.set("audio", input.audio, "consent");
  let res: Response;
  try {
    res = await fetch("/api/voice/consent", { method: "POST", body: form });
  } catch {
    return { ok: false, reason: "unavailable", message: voiceConsentMessage("unavailable") };
  }
  if (!res.ok) return readFailure(res);
  return (await res.json()) as SavedVoiceConsent;
}

export interface WithdrawnVoice {
  ok: true;
  withdrawn: boolean;
  profilesDeleted: number;
  deadlineAt: string;
}
export async function withdrawVoiceConsent(input: {
  consentId?: string | null;
  profileId?: string | null;
  proof: string | null;
}): Promise<WithdrawnVoice | ApiFailure> {
  let res: Response;
  try {
    res = await fetch("/api/voice/consent/withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consentId: input.consentId ?? null, profileId: input.profileId ?? null, proof: input.proof }),
    });
  } catch {
    return { ok: false, reason: "unavailable", message: voiceConsentMessage("unavailable") };
  }
  if (!res.ok) return readFailure(res);
  return (await res.json()) as WithdrawnVoice;
}

/** After "Xoá toàn bộ dữ liệu": run the household's queued voice deletions now (best effort). */
export function kickVoiceDeletions(): void {
  try {
    void fetch("/api/voice/deletions", { method: "POST" }).catch(() => undefined);
  } catch {
    /* offline: kecon-voice-deletion.timer runs them within 15 minutes */
  }
}

export const consentAudioPath = (consentId: string) => `/api/voice/consent/${encodeURIComponent(consentId)}/audio`;

/**
 * Narration files the server removed for this household (withdrawn / deleted voices):
 * drop the offline copies too — "Tải về" (kecon-audio-v1 + kecon_offline_* story copies)
 * and the service-worker cache. Once per app session.
 */
let purgedFor: string | null = null;
export async function purgeRevokedAudio(supabase: SupabaseClient, uid: string): Promise<number> {
  if (typeof window === "undefined" || purgedFor === uid) return 0;
  purgedFor = uid;
  const { data, error } = await supabase.rpc("voice_revoked_audio");
  if (error || !Array.isArray(data) || data.length === 0) return 0;
  const names = new Set((data as unknown[]).filter((n): n is string => typeof n === "string" && n.length > 0));
  const revoked = (url: string | null | undefined) => {
    if (!url) return false;
    const m = /\/tts-cache\/([^?#/]+)/.exec(url);
    return Boolean(m && names.has(decodeURIComponent(m[1])));
  };
  let removed = 0;
  try {
    if ("caches" in window) {
      for (const name of await caches.keys()) {
        if (!name.startsWith("kecon-audio-") && !name.startsWith("kecon-shell-")) continue;
        const cache = await caches.open(name);
        for (const req of await cache.keys()) {
          if (revoked(req.url) && (await cache.delete(req))) removed++;
        }
      }
    }
  } catch {
    /* private mode / quota: nothing cached */
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key?.startsWith("kecon_offline_")) continue;
      const raw = localStorage.getItem(key);
      if (!raw || !raw.includes("/tts-cache/")) continue;
      const copy = JSON.parse(raw) as { pages?: { audio_url?: string | null; audio_key?: string | null }[] };
      let changed = false;
      for (const page of copy.pages ?? []) {
        if (revoked(page.audio_url)) {
          page.audio_url = null;
          page.audio_key = null;
          changed = true;
          removed++;
        }
      }
      if (changed) localStorage.setItem(key, JSON.stringify(copy));
    }
  } catch {
    /* unreadable copy: Downloads re-fetches it */
  }
  return removed;
}
/** Test helper. */
export function resetRevokedAudioPurge(): void {
  purgedFor = null;
}
