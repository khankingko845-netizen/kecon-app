/**
 * T12 · Run the signed-in household's due voice deletions now — called by the app
 * after "Xoá toàn bộ dữ liệu" / deleting a voice (best effort; the 15-minute timer
 * runs them anyway). Only due jobs run (the database backs off retries).
 */
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { HouseholdContextSchema } from "@/lib/household-types";
import { runVoiceDeletionsWithin } from "@/lib/voice-deletion";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "Forbidden" }, { status: 403 });
  const ctx = await supabase.rpc("my_household_context");
  const parsed = HouseholdContextSchema.safeParse(ctx.data);
  if (ctx.error || !parsed.success) return Response.json({ error: "Chưa xác định được gia đình." }, { status: 503 });
  const run = await runVoiceDeletionsWithin(8_000, { householdId: parsed.data.household_id });
  return Response.json(
    { ok: true, deletion: run === "running" ? "running" : run ? { done: run.done, pending: run.pending + run.errors } : "queued" },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
