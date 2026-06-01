import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listVoices } from "@/lib/elevenlabs";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey =
    request.headers.get("x-elevenlabs-key") || process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Chưa cấu hình ElevenLabs API key" },
      { status: 400 }
    );
  }

  try {
    const voices = await listVoices(apiKey);
    return Response.json({ voices });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list voices";
    return Response.json({ error: message }, { status: 500 });
  }
}
