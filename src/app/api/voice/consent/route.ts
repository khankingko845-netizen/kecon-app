/**
 * T12 · Record a spoken voice consent (docs/voice-consent.md). The contributor read
 * the consent sentence aloud; this stores the recording (private bucket
 * voice-consents, SHA-256 computed here) with the text version + hash, the speaker
 * and the parent proof — before any clone. /api/voice/clone then needs its id.
 */
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/server-settings";
import {
  CONSENT_AUDIO_MAX_BYTES,
  CONSENT_SERVER_MAX_MS,
  CONSENT_SERVER_MIN_MS,
  SPEAKER_NAME_MAX,
  sniffConsentAudio,
  voiceConsentMessage,
} from "@/lib/voice-consent";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store" };
const STATUS: Record<string, number> = {
  unauthenticated: 401,
  policy_required: 403,
  parent_proof_required: 403,
  not_found: 404,
  stale: 409,
  rate_limited: 429,
};
const fail = (reason: string, status = STATUS[reason] ?? 400) =>
  Response.json({ error: voiceConsentMessage(reason), code: `voice_consent_${reason}` }, { status, headers: NO_STORE });

const Fields = z.object({
  documentId: z.uuid(),
  bodySha256: z.string().regex(/^[0-9a-f]{64}$/),
  speakerName: z.string().min(1).max(SPEAKER_NAME_MAX * 2),
  durationMs: z.coerce.number().int().min(CONSENT_SERVER_MIN_MS).max(CONSENT_SERVER_MAX_MS),
  proof: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "Forbidden" }, { status: 403 });
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("multipart/form-data")) return Response.json({ error: "Gửi bản ghi dạng multipart/form-data." }, { status: 415 });
  const service = getServiceClient();
  if (!service) return fail("unavailable", 503);

  // Bound the whole multipart stream before parsing, even without Content-Length.
  const limit = CONSENT_AUDIO_MAX_BYTES + 64 * 1024;
  const reader = request.body?.getReader();
  if (!reader) return fail("invalid_audio");
  const parts: Uint8Array[] = [];
  let size = 0;
  let form: FormData;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        // Stop reading (memory stays bounded); the server drops the rest of the upload.
        reader.releaseLock();
        return fail("too_large", 413);
      }
      parts.push(value);
    }
    form = await new Request("http://local/consent", { method: "POST", headers: { "content-type": type }, body: Buffer.concat(parts) }).formData();
  } catch {
    return fail("invalid_audio");
  }
  const parsed = Fields.safeParse({
    documentId: form.get("documentId"),
    bodySha256: form.get("bodySha256"),
    speakerName: form.get("speakerName"),
    durationMs: form.get("durationMs"),
    proof: form.get("proof") || null,
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return fail(field === "speakerName" ? "invalid_speaker" : field === "durationMs" ? "invalid_audio" : field === "proof" ? "parent_proof_required" : "stale");
  }
  const file = form.get("audio");
  if (!(file instanceof Blob) || file.size === 0) return fail("invalid_audio");
  if (file.size > CONSENT_AUDIO_MAX_BYTES) return fail("too_large", 413);
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = sniffConsentAudio(bytes);
  if (!mime) return fail("invalid_audio");
  const f = parsed.data;

  // 1) The record (as the parent: policy consent, current text + hash, parent proof).
  const begun = await supabase.rpc("voice_consent_begin", {
    p_document: f.documentId,
    p_body_sha256: f.bodySha256,
    p_speaker: f.speakerName,
    p_audio_sha256: createHash("sha256").update(bytes).digest("hex"),
    p_audio_bytes: bytes.length,
    p_audio_mime: mime,
    p_duration_ms: f.durationMs,
    p_proof: f.proof,
    p_user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
  });
  if (begun.error) {
    console.error("[voice-consent] begin", begun.error.code ?? "", begun.error.message);
    return fail("unavailable", 503);
  }
  const b = begun.data as { ok: boolean; reason?: string; consent_id?: string; audio_path?: string; recorded_at?: string; version?: number; spoken_text?: string };
  if (!b?.ok || !b.consent_id || !b.audio_path) return fail(b?.reason ?? "unavailable");

  // 2) The recording, then 3) attach it. Without its recording the record is discarded.
  const up = await service.storage.from("voice-consents").upload(b.audio_path, bytes, { contentType: mime, upsert: false });
  const attached = up.error ? null : await service.rpc("voice_consent_attach_audio", { p_consent: b.consent_id, p_path: b.audio_path });
  if (up.error || !attached || attached.error || attached.data !== true) {
    console.error("[voice-consent] store", up.error?.message ?? attached?.error?.message ?? "attach refused");
    if (!up.error) await service.storage.from("voice-consents").remove([b.audio_path]).catch(() => undefined);
    await Promise.resolve(service.rpc("voice_consent_discard", { p_consent: b.consent_id })).catch(() => undefined);
    return fail("unavailable", 503);
  }
  return Response.json(
    {
      ok: true,
      consentId: b.consent_id,
      speakerName: f.speakerName.replace(/\s+/g, " ").trim(),
      spokenText: b.spoken_text,
      recordedAt: b.recorded_at,
      version: b.version,
    },
    { status: 201, headers: NO_STORE },
  );
}
