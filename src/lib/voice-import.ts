import { ProviderHttpError } from "@/lib/provider-keys";
import { elevenFetch } from "@/lib/elevenlabs";
import { fetchVoiceById } from "@/lib/voice-catalog";
import { voiceKeyPool } from "@/lib/key-pool";
export async function importLibraryVoice(
  id: string,
  owner: string,
  name: string,
) {
  return voiceKeyPool.run(
    "elevenlabs",
    async (key) => {
      try {
        return await fetchVoiceById(key, id);
      } catch (error) {
        if (!(error instanceof ProviderHttpError) || !(error.code === "voice_not_found" || error.status === 404)) throw error;
      }
      const r = await elevenFetch(
        `/voices/add/${encodeURIComponent(owner)}/${encodeURIComponent(id)}`,
        key,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ new_name: name }),
          signal: AbortSignal.timeout(15000),
        },
        "thêm giọng thư viện vào tài khoản",
      );
      const data = await r.json();
      return fetchVoiceById(key, data.voice_id);
    },
    { bindVoiceFrom: (v) => v.voice_id },
  );
}
