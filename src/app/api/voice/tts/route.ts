import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { textToSpeech } from "@/lib/elevenlabs";
import { fishTextToSpeech } from "@/lib/fishaudio";
import { resolveElevenLabsModel, resolveFishAudioModel } from "@/lib/server-settings";
import { keyPoolErrorResponse, voiceKeyPool } from "@/lib/key-pool";
import { providerVoiceRef, voiceProviderOf, VOICE_ID_PATTERN, VOICE_PROVIDER_INFO } from "@/lib/provider-keys";
import { scrubSecret } from "@/lib/system-secrets";
import { guardUsage } from "@/lib/usage-guard";
import { rejectByoKeyUnlessAllowed } from "@/lib/byo-key";
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

const audioResponse = (audio: ArrayBuffer) =>
  new Response(audio, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });

export async function POST(request: NextRequest) {
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
  const { voiceId, text, modelId: userModelId, language } = parsed.data;
  const provider = voiceProviderOf(voiceId);
  const voiceRef = providerVoiceRef(voiceId);
  // A BYO key is an ElevenLabs key (Cài đặt → key riêng); Fish Audio voices always use the platform pool.
  const userKey = provider === "elevenlabs" ? parsed.data.apiKey : undefined;

  // A-04b: the platform pool (many keys, rotated) → env variable.
  if (!userKey && !(await voiceKeyPool.configured(provider))) {
    return Response.json(
      { error: `Chưa cấu hình ${VOICE_PROVIDER_INFO[provider].label} API key. Admin cần thêm key trong Cài Đặt Hệ Thống.` },
      { status: 400 }
    );
  }

  // 1 usage unit per 1,000 characters
  const usageBlocked = await guardUsage(supabase, "tts", {
    byo: Boolean(userKey),
    amount: Math.max(1, Math.ceil(text.length / 1000)),
  });
  if (usageBlocked) return usageBlocked;

  try {
    if (provider === "fishaudio") {
      const model = await resolveFishAudioModel();
      const audio = await voiceKeyPool.run(
        "fishaudio",
        async (key) => (await fishTextToSpeech(key, voiceRef, text, { model })).arrayBuffer(),
        { voiceRef, chars: text.length }
      );
      return audioResponse(audio);
    }

    // Resolve model: user preference → admin DB → default
    const modelId = await resolveElevenLabsModel(userModelId);
    const speak = async (key: string) => (await textToSpeech(key, voiceRef, text, modelId, language)).arrayBuffer();
    if (userKey) {
      try {
        return audioResponse(await speak(userKey));
      } catch (err) {
        return Response.json({ error: scrubSecret(err instanceof Error ? err.message : "TTS failed", userKey) }, { status: 500 });
      }
    }
    return audioResponse(await voiceKeyPool.run("elevenlabs", speak, { voiceRef, chars: text.length }));
  } catch (err) {
    return keyPoolErrorResponse(err, "TTS failed");
  }
}
