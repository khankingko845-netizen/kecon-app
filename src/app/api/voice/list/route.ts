import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listVoices } from "@/lib/elevenlabs";
import { keyPoolErrorResponse, voiceKeyPool } from "@/lib/key-pool";
import { scrubSecret } from "@/lib/system-secrets";
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

  try {
    if (userKey) return Response.json({ voices: await listVoices(userKey) });
    // A-04b: one key of the pool (each ElevenLabs account has its own clones).
    const voices = await voiceKeyPool.run("elevenlabs", (key) => listVoices(key));
    return Response.json({ voices });
  } catch (err) {
    if (userKey) {
      return Response.json({ error: err instanceof Error ? scrubSecret(err.message, userKey) : "Failed to list voices" }, { status: 500 });
    }
    return keyPoolErrorResponse(err, "Failed to list voices");
  }
}
