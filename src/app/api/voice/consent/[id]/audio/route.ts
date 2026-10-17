/**
 * T12 · Play back a household's consent recording (Bố mẹ › Đồng ý giọng nói).
 * The bucket is private: the server checks the household (voice_consent_audio_path)
 * on every request and streams the file; nothing is cached.
 */
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/server-settings";
import { CONSENT_MIME } from "@/lib/voice-consent";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TYPES: Record<string, string> = Object.fromEntries(Object.entries(CONSENT_MIME).map(([mime, ext]) => [ext, mime]));

export async function GET(_request: NextRequest, context: Context) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const { data: path, error } = await supabase.rpc("voice_consent_audio_path", { p_consent: id });
  if (error) return Response.json({ error: "Chưa tải được bản ghi." }, { status: 503 });
  if (typeof path !== "string" || !path) return Response.json({ error: "Bản ghi không còn." }, { status: 404 });
  const service = getServiceClient();
  if (!service) return Response.json({ error: "Chưa tải được bản ghi." }, { status: 503 });
  const file = await service.storage.from("voice-consents").download(path);
  if (file.error || !file.data) return Response.json({ error: "Bản ghi không còn." }, { status: 404 });
  return new Response(file.data, {
    headers: {
      "Content-Type": TYPES[path.split(".").pop() ?? ""] ?? "application/octet-stream",
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
