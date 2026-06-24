import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cloneVoice } from "@/lib/elevenlabs";
import { resolveApiKey } from "@/lib/server-settings";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const name = formData.get("name") as string;
  const audioFile = formData.get("audio") as File;
  const userKey = formData.get("apiKey") as string | null;
  const language = (formData.get("language") as string) || "vi";

  // Resolve API key: user BYO → admin DB → env variable
  const apiKey = await resolveApiKey("elevenlabs", userKey || undefined);
  if (!apiKey) {
    return Response.json(
      { error: "Chưa cấu hình ElevenLabs API key. Admin cần thêm key trong Cài Đặt Hệ Thống." },
      { status: 400 }
    );
  }

  if (!name || !audioFile) {
    return Response.json(
      { error: "Missing name or audio file" },
      { status: 400 }
    );
  }

  try {
    const result = await cloneVoice(apiKey, name, audioFile, language);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Voice cloning failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
