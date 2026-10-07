import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/admin-permissions";
import { auditAdmin } from "@/lib/admin-audit";
import { voiceKeyPool, keyPoolErrorResponse } from "@/lib/key-pool";
import { fetchVoiceCatalog } from "@/lib/voice-catalog";
import { normalizeVoiceLanguage } from "@/lib/voice-selection";
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const denied = await requirePermission(supabase, "voices.manage");
  if (denied) return denied;
  const language = normalizeVoiceLanguage(
    request.nextUrl.searchParams.get("language"),
  );
  if (!language || !["vi", "en", "ja"].includes(language))
    return Response.json({ error: "Ngôn ngữ không hợp lệ." }, { status: 400 });
  const auditFailed = await auditAdmin(supabase, request, {
    action: "voice.catalog",
    targetType: "voice",
    targetId: language,
  });
  if (auditFailed) return auditFailed;
  try {
    return Response.json(
      await voiceKeyPool.run("elevenlabs", (key) =>
        fetchVoiceCatalog(key, language),
      ),
    );
  } catch (err) {
    return keyPoolErrorResponse(err, "Không tải được danh sách giọng.");
  }
}
