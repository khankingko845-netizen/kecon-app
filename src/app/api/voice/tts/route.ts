import { withAiContext } from "@/lib/ai-metering";
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { VOICE_ID_PATTERN } from "@/lib/provider-keys";
import { rejectByoKeyUnlessAllowed } from "@/lib/byo-key";
import { guardDisabledVoice } from "@/lib/voice-availability";
import { z } from "zod";
import { languageCode, modelId, optionalText, parseJsonBody, requiredText } from "@/lib/api-validation";

const MAX_TTS_CHARS = 10_000;

const TtsBody = z.object({
  /** ElevenLabs voice id, or `fish:<reference_id>` for a Fish Audio voice (A-04b). */
  voiceId: requiredText(120).regex(VOICE_ID_PATTERN, "voiceId không hợp lệ"),
  text: requiredText(MAX_TTS_CHARS).max(MAX_TTS_CHARS, `Văn bản quá dài (tối đa ${MAX_TTS_CHARS.toLocaleString("vi-VN")} ký tự mỗi lần đọc)`),
  modelId,
  apiKey: optionalText(512),
  language: languageCode,
});

import { synthesizeSpeech } from "@/lib/voice-synthesis";

export async function POST(request: NextRequest) {
 return withAiContext("voice.tts",async(request)=>{
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJsonBody(request, TtsBody);
  if (!parsed.ok) return parsed.response;
  const byoBlocked = await rejectByoKeyUnlessAllowed(supabase, user.id, parsed.data.apiKey);
  if (byoBlocked) return byoBlocked;
  const { voiceId, language } = parsed.data;
  const disabled = await guardDisabledVoice(supabase, user.id, voiceId, language);
  if (disabled) return disabled;
  return synthesizeSpeech(supabase,parsed.data);
})(request);
}
