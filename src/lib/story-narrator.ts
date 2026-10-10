import type { SupabaseClient } from "@supabase/supabase-js";
/** Validate a creation choice BEFORE consuming quota/LLM work; server owns the name. */
export async function validateStoryNarrator(
  supabase: SupabaseClient,
  userId: string,
  locale: string,
  familyId?: string,
  narratorId?: string,
) {
  if (familyId && narratorId)
    return { error: "Chỉ chọn một giọng kể cho truyện." };
  if (familyId) {
    const { data, error } = await supabase
      .from("voice_profiles")
      .select("id,name,elevenlabs_voice_id")
      .eq("id", familyId)
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    if (error) return { error: "Chưa xác minh được giọng gia đình." };
    if (!data?.elevenlabs_voice_id)
      return {
        error: "Giọng gia đình đã tắt, chưa clone hoặc không thuộc tài khoản.",
      };
    return {
      voiceId: data.id,
      narratorId: data.elevenlabs_voice_id as string,
      name: data.name as string,
    };
  }
  if (narratorId) {
    const { data, error } = await supabase
      .from("default_voices")
      .select("voice_id,name")
      .eq("voice_id", narratorId)
      .eq("language", locale)
      .eq("is_active", true)
      .maybeSingle();
    if (error) return { error: "Chưa xác minh được giọng mặc định." };
    if (!data)
      return { error: "Giọng đã tắt hoặc không thuộc ngôn ngữ truyện." };
    return {
      voiceId: null,
      narratorId: data.voice_id as string,
      name: data.name as string,
    };
  }
  return { voiceId: null, narratorId: null, name: null };
}
