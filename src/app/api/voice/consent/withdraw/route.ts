/**
 * T12 · Withdraw a voice consent / delete a family voice (docs/voice-consent.md).
 * The database stops the voice at once (authorize_tts_voice), deletes the household's
 * profiles speaking with it and queues the deletion job; this route then starts the
 * worker for the household (ElevenLabs voice, recordings, narration cache) and
 * answers within a few seconds — the rest finishes in the background or on the
 * 15-minute timer, always within 24 hours.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { voiceConsentMessage } from "@/lib/voice-consent";
import { runVoiceDeletionsWithin } from "@/lib/voice-deletion";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store" };
const Body = z
  .object({
    consentId: z.uuid().nullable().optional(),
    profileId: z.uuid().nullable().optional(),
    proof: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional(),
  })
  .strict()
  .refine((b) => Boolean(b.consentId || b.profileId), "missing");
const STATUS: Record<string, number> = { unauthenticated: 401, parent_proof_required: 403, not_found: 404, missing: 400 };

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "Forbidden" }, { status: 403 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: voiceConsentMessage("not_found"), code: "voice_consent_missing" }, { status: 400, headers: NO_STORE });
  const { data, error } = await supabase.rpc("voice_consent_withdraw", {
    p_consent: parsed.data.consentId ?? null,
    p_profile: parsed.data.profileId ?? null,
    p_proof: parsed.data.proof ?? null,
  });
  if (error) {
    console.error("[voice-consent] withdraw", error.code ?? "", error.message);
    return Response.json({ error: voiceConsentMessage("unavailable"), code: "voice_consent_unavailable" }, { status: 503, headers: NO_STORE });
  }
  const r = data as { ok: boolean; reason?: string; withdrawn?: boolean; profiles_deleted?: number; household_id?: string; deadline_at?: string };
  if (!r?.ok) {
    const reason = r?.reason ?? "unavailable";
    return Response.json({ error: voiceConsentMessage(reason), code: `voice_consent_${reason}` }, { status: STATUS[reason] ?? 400, headers: NO_STORE });
  }
  // The voice is already unusable; deleting it at the provider + the files starts now.
  const run = await runVoiceDeletionsWithin(8_000, { householdId: r.household_id ?? null });
  return Response.json(
    {
      ok: true,
      withdrawn: Boolean(r.withdrawn),
      profilesDeleted: r.profiles_deleted ?? 0,
      deadlineAt: r.deadline_at,
      deletion: run === "running" ? "running" : run ? { done: run.done, pending: run.pending + run.errors } : "queued",
    },
    { headers: NO_STORE },
  );
}
