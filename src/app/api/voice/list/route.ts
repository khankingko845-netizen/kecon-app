import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listVoices } from "@/lib/elevenlabs";
import { keyPoolErrorResponse, voiceKeyPool } from "@/lib/key-pool";
import { scrubSecret } from "@/lib/system-secrets";
import { requirePermission } from "@/lib/admin-permissions";
import { auditAdmin } from "@/lib/admin-audit";
import { authorizedVoiceCatalog } from "@/lib/voice-catalog-access";

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

  const denied = await requirePermission(supabase, "voices.manage");
  if (denied) return denied;

  const failed = await auditAdmin(supabase, request, {action:"voice.catalog",targetType:"voice",targetId:"legacy-catalog"});
  if (failed) return failed;

  const userKey = request.headers.get("x-elevenlabs-key")?.trim() || undefined;

  try {

    // A-04b: one key of the pool (each ElevenLabs account has its own clones).
    const voices = userKey ? await listVoices(userKey) : await voiceKeyPool.run("elevenlabs", (key) => listVoices(key));
    const checked = await authorizedVoiceCatalog(supabase, voices);
    if ("response" in checked) return checked.response;
    return Response.json(checked, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    if (userKey) {
      return Response.json({ error: err instanceof Error ? scrubSecret(err.message, userKey) : "Failed to list voices" }, { status: 500 });
    }
    return keyPoolErrorResponse(err, "Failed to list voices");
  }
}
