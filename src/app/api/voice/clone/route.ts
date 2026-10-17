import { voiceClaimWriter } from "@/lib/voice-provider-claim";
import { withAiContext, meteredFetch } from "@/lib/ai-metering";
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cloneVoice } from "@/lib/elevenlabs";
import { keyPoolErrorResponse, voiceKeyPool } from "@/lib/key-pool";
import { guardUsage } from "@/lib/usage-guard";
import { voiceConsentMessage } from "@/lib/voice-consent";
import { runVoiceDeletionsWithin } from "@/lib/voice-deletion";
import { z } from "zod";
import { languageCode, optionalText, parseValue, requiredText } from "@/lib/api-validation";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // ElevenLabs IVC limit per file
const NO_STORE = { "Cache-Control": "private, no-store" };

const CloneFields = z.object({
  name: requiredText(100),
  apiKey: optionalText(512),
  language: languageCode,
  // T12: the spoken consent recorded for this voice (POST /api/voice/consent).
  consentId: z.uuid({ message: "Cần ghi lời đồng ý của người góp giọng trước khi tạo giọng" }),
  audio: z
    .instanceof(Blob, { message: "Thiếu file ghi âm" })
    .refine((f) => f.size > 0 && f.size <= MAX_AUDIO_BYTES, "File ghi âm phải từ 1 byte đến 10 MB")
    .refine((f) => !f.type || f.type.startsWith("audio/") || f.type === "video/webm", "File phải là âm thanh"),
});

const consentDenied = (reason: string, status = 403) =>
  Response.json({ error: voiceConsentMessage(reason), code: `voice_consent_${reason}` }, { status, headers: NO_STORE });

export async function POST(request: NextRequest) {
 return withAiContext("voice.clone",async(request)=>{
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Body phải là multipart/form-data", code: "invalid_body" }, { status: 400 });
  }
  if (!formData.get("consentId")) return consentDenied("missing");
  const fields = parseValue(
    {
      name: formData.get("name"),
      apiKey: formData.get("apiKey"),
      language: formData.get("language"),
      consentId: formData.get("consentId"),
      audio: formData.get("audio"),
    },
    CloneFields
  );
  if (!fields.ok) return fields.response;
  // T12: a family voice lives only in KểCon's provider accounts, where withdrawing the
  // consent can delete it. A personal key's account is out of reach → no BYO clones.
  if (fields.data.apiKey)
    return Response.json(
      { error: "Tạo giọng gia đình chỉ dùng tài khoản ElevenLabs của KểCon (để có thể xoá giọng khi rút đồng ý).", code: "byo_clone_disabled" },
      { status: 400, headers: NO_STORE },
    );
  const { name, audio: audioFile, consentId } = fields.data;
  const language = fields.data.language || "vi";

  // A-04b: the platform pool (many ElevenLabs keys, rotated).
  if (!(await voiceKeyPool.configured("elevenlabs"))) {
    return Response.json(
      { error: "Chưa cấu hình ElevenLabs API key. Admin cần thêm key trong Cài Đặt Hệ Thống." },
      { status: 400 }
    );
  }

  const claimWriter = await voiceClaimWriter(supabase);
  if (!claimWriter) return Response.json({error:"Chưa sẵn sàng xác minh quyền giọng đọc."},{status:503});

  // T12: a recorded, unused spoken consent of this household — before quota and provider.
  const ready = await supabase.rpc("voice_consent_ready", { p_consent: consentId });
  if (ready.error || typeof ready.data !== "object" || ready.data === null)
    return Response.json({ error: voiceConsentMessage("unavailable"), code: "voice_consent_unavailable" }, { status: 503, headers: NO_STORE });
  const gate = ready.data as { ok: boolean; reason?: string };
  if (!gate.ok) return consentDenied(gate.reason ?? "missing", gate.reason === "unauthenticated" ? 401 : 403);

  const usageBlocked = await guardUsage(supabase, "voice_clone", { byo: false });
  if (usageBlocked) return usageBlocked;

  let result: Awaited<ReturnType<typeof cloneVoice>>;
  try {
    // The clone only exists in the account of the key that made it → remember that key for TTS.
    result = await voiceKeyPool.run("elevenlabs", (key) => cloneVoice(key, name, audioFile, language, meteredFetch({provider:"elevenlabs",model:"ivc",kind:"clone",units:1})), {
      bindVoiceFrom: (r) => r.voice_id,
    });
  } catch (err) {
    return keyPoolErrorResponse(err, "Voice cloning failed");
  }

  // T08 identity receipt + T12 consent binding, atomically. Withdrawn meanwhile (or not
  // usable any more) → the new voice is queued for deletion right away.
  const bound = await claimWriter.rpc("voice_consent_bind", { p_user: user.id, p_consent: consentId, p_voice: result.voice_id });
  if (bound.error || typeof bound.data !== "object" || bound.data === null)
    return Response.json(
      {
        error:
          "Giọng đã được tạo tại nhà cung cấp nhưng chưa gắn được vào tài khoản. Chưa lưu giọng; cần kiểm tra lại, không tự tạo thêm bản nữa.",
        code: "voice_binding_pending",
      },
      { status: 503, headers: NO_STORE },
    );
  const b = bound.data as { ok: boolean; reason?: string };
  if (!b.ok) {
    const household = (ready.data as { household_id?: string }).household_id ?? null;
    await runVoiceDeletionsWithin(5_000, { householdId: household });
    return consentDenied(b.reason ?? "withdrawn", 409);
  }
  return Response.json(result, { headers: NO_STORE });
})(request);
}
