import type { SupabaseClient } from "@supabase/supabase-js";
import { hasPermission } from "@/lib/admin-permissions";
import { normalizeVoiceLanguage } from "@/lib/voice-selection";

/** Deactivation blocks new synthesis, including stale story/character selections. */
export async function guardDisabledVoice(
  supabase: SupabaseClient,
  userId: string,
  voiceId: string,
  language = "vi",
): Promise<Response | null> {
  const [family, defaults] = await Promise.all([
    supabase
      .from("voice_profiles")
      .select("is_active")
      .eq("user_id", userId)
      .eq("elevenlabs_voice_id", voiceId),
    supabase
      .from("default_voices")
      .select("is_active")
      .eq("voice_id", voiceId)
      .eq("language", normalizeVoiceLanguage(language) ?? language),
  ]);
  if (family.error || defaults.error)
    return Response.json(
      { error: "Chưa kiểm tra được trạng thái giọng đọc." },
      { status: 503 },
    );
  const rows = [...(family.data ?? []), ...(defaults.data ?? [])];
  if (
    rows.length &&
    !rows.some((row) => row.is_active !== false) &&
    !(await hasPermission(supabase, "voices.manage"))
  )
    return Response.json(
      {
        error: "Giọng này đã tắt. Hãy chọn một giọng đang bật.",
        code: "voice_disabled",
      },
      { status: 403 },
    );
  return null;
}
