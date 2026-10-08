import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeVoiceLanguage } from "@/lib/voice-selection";
/** Validate actual scope before key selection/quota/provider work. Actor comes from JWT,
 * never the caller-supplied userId. Keep the old name for route compatibility. */
export async function guardDisabledVoice(
  supabase: SupabaseClient,
  _userId: string,
  voiceId: string,
  language = "vi",
): Promise<Response | null> {
  void _userId; // Compatibility argument is deliberately not an authorization input.
  const { data, error } = await supabase.rpc("authorize_tts_voice", {
    p_voice_id: voiceId,
    p_locale: normalizeVoiceLanguage(language) ?? language,
  });
  if (error || !["allowed", "disabled", "unavailable"].includes(data))
    return Response.json(
      { error: "Chưa kiểm tra được quyền giọng đọc." },
      { status: 503 },
    );
  if (data === "allowed") return null;
  return Response.json(
    {
      error:
        data === "disabled"
          ? "Giọng này đã tắt. Hãy chọn một giọng đang bật."
          : "Giọng không khả dụng cho tài khoản hoặc ngôn ngữ này.",
      code: data === "disabled" ? "voice_disabled" : "voice_unavailable",
    },
    { status: 403 },
  );
}
