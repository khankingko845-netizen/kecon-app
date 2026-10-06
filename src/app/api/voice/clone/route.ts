import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cloneVoice } from "@/lib/elevenlabs";
import { resolveApiKey } from "@/lib/server-settings";
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

  // Resolve API key: user BYO → admin DB → env variable
  const apiKey = await resolveApiKey("elevenlabs", userKey || undefined);
  if (!apiKey) {
    return Response.json(
      { error: "Chưa cấu hình ElevenLabs API key. Admin cần thêm key trong Cài Đặt Hệ Thống." },
      { status: 400 }
    );
  }

  const usageBlocked = await guardUsage(supabase, "voice_clone", { byo: Boolean(userKey) });
  if (usageBlocked) return usageBlocked;

  try {
    const result = await cloneVoice(apiKey, name, audioFile, language);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Voice cloning failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
