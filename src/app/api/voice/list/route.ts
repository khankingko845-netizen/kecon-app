import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listVoices } from "@/lib/elevenlabs";
import { resolveApiKey } from "@/lib/server-settings";
import { isAdminUser } from "@/lib/byo-key";

/**
 * Lists every voice in the ElevenLabs account — including other families'
 * cloned voices when the platform key is used — so it is admin-only (T05).
 */

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await isAdminUser(supabase, user.id))) {
    return Response.json({ error: "Admin only" }, { status: 403 });
  }

  const userKey = request.headers.get("x-elevenlabs-key")?.trim() || undefined;

  // Resolve API key: user BYO → admin DB → env variable
  const apiKey = await resolveApiKey("elevenlabs", userKey);
  if (!apiKey) {
    return Response.json(
      { error: "Chưa cấu hình ElevenLabs API key. Admin cần thêm key trong Cài Đặt Hệ Thống." },
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
