import { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/lib/admin-permissions";
import { auditAdmin } from "@/lib/admin-audit";
import { parseJsonBody, requiredText } from "@/lib/api-validation";
import { VOICE_ID_PATTERN } from "@/lib/provider-keys";
import { VOICE_PREVIEW_TEXT } from "@/lib/voice-preview";
import { synthesizeSpeech } from "@/lib/voice-synthesis";

const Body = z
  .object({
    voiceId: requiredText(120).regex(VOICE_ID_PATTERN),
    language: z.enum(["vi", "en", "ja"]),
  })
  .strict();
export async function POST(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json(
      { error: "Không cho phép yêu cầu khác nguồn." },
      { status: 403 },
    );
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = await parseJsonBody(request, Body);
  if (!parsed.ok) return parsed.response;
  const { voiceId, language } = parsed.data;
  const manager = await hasPermission(supabase, "voices.manage");
  if (manager) {
    const failed = await auditAdmin(supabase, request, {
      action: "voice.preview",
      targetType: "voice",
      targetId: voiceId,
      after: { language },
    });
    if (failed) return failed;
  } else {
    const [family, defaults] = await Promise.all([
      supabase
        .from("voice_profiles")
        .select("id")
        .eq("user_id", user.id)
        .eq("elevenlabs_voice_id", voiceId)
        .limit(1),
      supabase
        .from("default_voices")
        .select("id")
        .eq("voice_id", voiceId)
        .eq("language", language)
        .eq("is_active", true)
        .limit(1),
    ]);
    if (family.error || defaults.error)
      return Response.json(
        { error: "Chưa kiểm tra được quyền nghe thử." },
        { status: 503 },
      );
    if (!family.data?.length && !defaults.data?.length)
      return Response.json(
        { error: "Giọng không khả dụng cho tài khoản hoặc ngôn ngữ này." },
        { status: 403 },
      );
  }
  // Reuse provider pool, BYO restrictions, rate/quota guard and secret scrubbing.
  // No URLs or keys are accepted from the caller. Each uncached preview uses one TTS unit.
  const response = await synthesizeSpeech(supabase, {
    voiceId,
    language,
    text: VOICE_PREVIEW_TEXT[language],
  });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
