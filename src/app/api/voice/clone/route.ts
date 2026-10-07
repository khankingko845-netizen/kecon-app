import { withAiContext, meteredFetch } from "@/lib/ai-metering";
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cloneVoice } from "@/lib/elevenlabs";
import { keyPoolErrorResponse, voiceKeyPool } from "@/lib/key-pool";
import { scrubSecret } from "@/lib/system-secrets";
import { guardUsage } from "@/lib/usage-guard";
import { rejectByoKeyUnlessAllowed } from "@/lib/byo-key";
import { z } from "zod";
import { languageCode, optionalText, parseValue, requiredText } from "@/lib/api-validation";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // ElevenLabs IVC limit per file

const CloneFields = z.object({
  name: requiredText(100),
  apiKey: optionalText(512),
  language: languageCode,
  audio: z
    .instanceof(Blob, { message: "Thiếu file ghi âm" })
    .refine((f) => f.size > 0 && f.size <= MAX_AUDIO_BYTES, "File ghi âm phải từ 1 byte đến 10 MB")
    .refine((f) => !f.type || f.type.startsWith("audio/") || f.type === "video/webm", "File phải là âm thanh"),
});

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
  const fields = parseValue(
    {
      name: formData.get("name"),
      apiKey: formData.get("apiKey"),
      language: formData.get("language"),
      audio: formData.get("audio"),
    },
    CloneFields
  );
  if (!fields.ok) return fields.response;
  const byoBlocked = await rejectByoKeyUnlessAllowed(supabase, user.id, fields.data.apiKey);
  if (byoBlocked) return byoBlocked;
  const { name, apiKey: userKey, audio: audioFile } = fields.data;
  const language = fields.data.language || "vi";

  // A-04b: user BYO key, else the platform pool (many ElevenLabs keys, rotated).
  if (!userKey && !(await voiceKeyPool.configured("elevenlabs"))) {
    return Response.json(
      { error: "Chưa cấu hình ElevenLabs API key. Admin cần thêm key trong Cài Đặt Hệ Thống." },
      { status: 400 }
    );
  }

  const usageBlocked = await guardUsage(supabase, "voice_clone", { byo: Boolean(userKey) });
  if (usageBlocked) return usageBlocked;

  if (userKey) {
    try {
      return Response.json(await cloneVoice(userKey, name, audioFile, language, meteredFetch({provider:"elevenlabs",model:"ivc",kind:"clone",units:1})));
    } catch (err) {
      const message = err instanceof Error ? scrubSecret(err.message, userKey) : "Voice cloning failed";
      return Response.json({ error: message }, { status: 500 });
    }
  }

  try {
    // The clone only exists in the account of the key that made it → remember that key for TTS.
    const result = await voiceKeyPool.run("elevenlabs", (key) => cloneVoice(key, name, audioFile, language, meteredFetch({provider:"elevenlabs",model:"ivc",kind:"clone",units:1})), {
      bindVoiceFrom: (r) => r.voice_id,
    });
    return Response.json(result);
  } catch (err) {
    return keyPoolErrorResponse(err, "Voice cloning failed");
  }
})(request);
}
