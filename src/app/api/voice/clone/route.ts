import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cloneVoice } from "@/lib/elevenlabs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ElevenLabs API key not configured" },
      { status: 500 }
    );
  }

  const formData = await request.formData();
  const name = formData.get("name") as string;
  const audioFile = formData.get("audio") as File;

  if (!name || !audioFile) {
    return Response.json(
      { error: "Missing name or audio file" },
      { status: 400 }
    );
  }

  try {
    const result = await cloneVoice(apiKey, name, audioFile);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Voice cloning failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
