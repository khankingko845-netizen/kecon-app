import { authorizedVoiceCatalog } from "@/lib/voice-catalog-access";
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/admin-permissions";
import { auditAdmin } from "@/lib/admin-audit";
import { voiceKeyPool, keyPoolErrorResponse } from "@/lib/key-pool";
import { fetchVoiceCatalog, fetchVoiceById } from "@/lib/voice-catalog";
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
  const search = (request.nextUrl.searchParams.get("search") ?? "").trim();
  const page = Number(request.nextUrl.searchParams.get("page") ?? 0);
  if (search.length > 120 || !Number.isInteger(page) || page < 0 || page > 100)
    return Response.json({ error: "Tìm kiếm không hợp lệ." }, { status: 400 });
  try {
    if (/^[A-Za-z0-9]{20}$/.test(search)) {
      try {
        const voice = await voiceKeyPool.run(
          "elevenlabs",
          (key) => fetchVoiceById(key, search),
          { voiceRef: search },
        );
        const checked = await authorizedVoiceCatalog(supabase, [voice]);
        if ("response" in checked) return checked.response;
        if (!checked.voices.length) return Response.json({error:"Giọng không khả dụng."},{status:404,headers:{"Cache-Control":"private, no-store"}});
        return Response.json({
          voices: checked.voices,
          warnings: [],
          hasMore: false,
          page: 0,
        });
      } catch {
        /* A library-only ID may still be found by the library search. */
      }
    }
    const catalog = await voiceKeyPool.run("elevenlabs", key => fetchVoiceCatalog(key, language, search, page));
    const checked = await authorizedVoiceCatalog(supabase, catalog.voices);
    if ("response" in checked) return checked.response;
    return Response.json({ ...catalog, voices: checked.voices }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return keyPoolErrorResponse(err, "Không tải được danh sách giọng.");
  }
}
