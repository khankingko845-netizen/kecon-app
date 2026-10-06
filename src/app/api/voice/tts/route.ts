import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { textToSpeech } from "@/lib/elevenlabs";
import { resolveApiKey, resolveElevenLabsModel } from "@/lib/server-settings";
import { guardUsage } from "@/lib/usage-guard";
import { rejectByoKeyUnlessAllowed } from "@/lib/byo-key";
import { z } from "zod";
import { languageCode, modelId, optionalText, parseJsonBody, requiredText } from "@/lib/api-validation";

const MAX_TTS_CHARS = 10_000;

const TtsBody = z.object({
  voiceId: requiredText(120).regex(/^[\w-]+$/, "voiceId không hợp lệ"),
  text: requiredText(MAX_TTS_CHARS).max(MAX_TTS_CHARS, `Văn bản quá dài (tối đa ${MAX_TTS_CHARS.toLocaleString("vi-VN")} ký tự mỗi lần đọc)`),
  modelId,
  apiKey: optionalText(512),
  language: languageCode,
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
  const { voiceId, text, modelId: userModelId, apiKey: userKey, language } = parsed.data;

  // Resolve API key: user BYO → admin DB → env variable
  const apiKey = await resolveApiKey("elevenlabs", userKey);
  if (!apiKey) {
    return Response.json(
      { error: "Chưa cấu hình ElevenLabs API key. Admin cần thêm key trong Cài Đặt Hệ Thống." },
      { status: 400 }
    );
  }

  // 1 usage unit per 1,000 characters
  const usageBlocked = await guardUsage(supabase, "tts", {
    byo: Boolean(userKey),
    amount: Math.max(1, Math.ceil(text.length / 1000)),
  });
  if (usageBlocked) return usageBlocked;

  // Resolve model: user preference → admin DB → default
  const modelId = await resolveElevenLabsModel(userModelId);

  try {
    const audioBlob = await textToSpeech(apiKey, voiceId, text, modelId, language);
    const arrayBuffer = await audioBlob.arrayBuffer();

    return new Response(arrayBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "TTS failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
