import { meteredFetch } from "@/lib/ai-metering";
import { modelForLanguage } from "@/lib/tts-models";
import type { SupabaseClient } from "@supabase/supabase-js";
import { textToSpeech, stripEmotionTags } from "@/lib/elevenlabs";
import { fishTextToSpeech } from "@/lib/fishaudio";
import {
  resolveElevenLabsModel,
  resolveFishAudioModel,
} from "@/lib/server-settings";
import { keyPoolErrorResponse, voiceKeyPool } from "@/lib/key-pool";
import {
  providerVoiceRef,
  voiceProviderOf,
  VOICE_PROVIDER_INFO,
} from "@/lib/provider-keys";
import { scrubSecret } from "@/lib/system-secrets";
import { guardUsage } from "@/lib/usage-guard";
const audioResponse = (audio: ArrayBuffer, model?: string) =>
  new Response(audio, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, no-store",
      ...(model ? { "X-TTS-Model": model } : {}),
    },
  });

/** Server-only common path: authenticated routes authorize voice/input before calling. */
export async function synthesizeSpeech(
  supabase: SupabaseClient,
  input: {
    voiceId: string;
    text: string;
    language?: string;
    modelId?: string;
    apiKey?: string;
  },
) {
  const { voiceId, text, language, modelId: userModelId } = input;
  const provider = voiceProviderOf(voiceId);
  const voiceRef = providerVoiceRef(voiceId);
  // A BYO key is an ElevenLabs key (Cài đặt → key riêng); Fish Audio voices always use the platform pool.
  const userKey = provider === "elevenlabs" ? input.apiKey : undefined;

  // A-04b: the platform pool (many keys, rotated) → env variable.
  if (!userKey && !(await voiceKeyPool.configured(provider))) {
    return Response.json(
      {
        error: `Chưa cấu hình ${VOICE_PROVIDER_INFO[provider].label} API key. Admin cần thêm key trong Cài Đặt Hệ Thống.`,
      },
      { status: 400 },
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
        async (key) =>
          (
            await fishTextToSpeech(key, voiceRef, text, {
              model,
              fetchImpl: meteredFetch({
                provider: "fishaudio",
                payer: "platform",
                model,
                kind: "tts",
                units: [...stripEmotionTags(text)].length,
              }),
            })
          ).arrayBuffer(),
        { voiceRef, chars: text.length },
      );
      return audioResponse(audio, model);
    }

    // Resolve model: user preference → admin DB → default
    const modelId = modelForLanguage(
      await resolveElevenLabsModel(userKey ? userModelId : undefined),
      language,
    );
    const speak = async (key: string) =>
      (
        await textToSpeech(
          key,
          voiceRef,
          text,
          modelId,
          language,
          undefined,
          meteredFetch({
            provider: "elevenlabs",
            model: modelId,
            kind: "tts",
            units: [...stripEmotionTags(text)].length,
          }),
        )
      ).arrayBuffer();
    if (userKey) {
      try {
        return audioResponse(await speak(userKey), modelId);
      } catch (err) {
        return Response.json(
          {
            error: scrubSecret(
              err instanceof Error ? err.message : "TTS failed",
              userKey,
            ),
          },
          { status: 500 },
        );
      }
    }
    return audioResponse(
      await voiceKeyPool.run("elevenlabs", speak, {
        voiceRef,
        chars: text.length,
      }),
      modelId,
    );
  } catch (err) {
    return keyPoolErrorResponse(err, "TTS failed");
  }
}
