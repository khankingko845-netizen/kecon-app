/**
 * T12 · kecon-voice-deletion.timer (every 15 minutes, scripts/voice-deletion-tick.sh):
 * expire unused consents and run every due voice deletion job. Server-to-server
 * only: `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`.
 */
import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { runVoiceDeletions } from "@/lib/voice-deletion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (expected.length < 20 || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const summary = await runVoiceDeletions({ limit: 50 });
    if (!summary) return Response.json({ error: "Service role not configured" }, { status: 503 });
    console.log(JSON.stringify({ job: "voice-deletion", ...summary }));
    return Response.json({ ok: true, ...summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error(JSON.stringify({ job: "voice-deletion", error: String(err instanceof Error ? err.message : err).slice(0, 200) }));
    return Response.json({ error: "Voice deletion run failed" }, { status: 500 });
  }
}
