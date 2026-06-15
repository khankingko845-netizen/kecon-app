import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { textToSpeech } from "@/lib/elevenlabs";
import { resolveApiKey, resolveElevenLabsModel } from "@/lib/server-settings";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { voiceId, text, modelId: userModelId, apiKey: userKey } = body;

  // Resolve API key: user BYO → admin DB → env variable
  const apiKey = await resolveApiKey("elevenlabs", userKey);
  if (!apiKey) {
    return Response.json(
      { error: "Chưa cấu hình ElevenLabs API key. Admin cần thêm key trong Cài Đặt Hệ Thống." },
      { status: 400 }
    );
  }

  if (!voiceId || !text) {
    return Response.json(
      { error: "Missing voiceId or text" },
      { status: 400 }
    );
  }

  // Resolve model: user preference → admin DB → default
  const modelId = await resolveElevenLabsModel(userModelId);

  try {
    const audioBlob = await textToSpeech(apiKey, voiceId, text, modelId);
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
