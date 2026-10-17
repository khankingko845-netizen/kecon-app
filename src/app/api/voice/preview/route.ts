import { withAiContext } from "@/lib/ai-metering";
import { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/lib/admin-permissions";
import { auditAdmin } from "@/lib/admin-audit";
import { parseJsonBody, requiredText } from "@/lib/api-validation";
import { guardDisabledVoice } from "@/lib/voice-availability";
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
 return withAiContext("voice.preview",async(request)=>{
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
  const denied = await guardDisabledVoice(supabase, user.id, voiceId, language);
  if (denied) return denied;
  if (await hasPermission(supabase, "voices.manage")) {
    const failed = await auditAdmin(supabase, request, { action: "voice.preview", targetType: "voice", targetId: voiceId, after: { language } });
    if (failed) return failed;
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
})(request);
}
