import { createClient } from "@/lib/supabase/server";
import {
  CompleteResultSchema,
  ListenBodySchema,
  NO_STORE,
  StartResultSchema,
  missionsError,
} from "@/lib/missions-server";
/**
 * G-03: server-timed listening session. `start` when a story opens,
 * `complete` when its last page ends; the database decides whether enough
 * time passed and which rewards (if any) were earned.
 */
export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const body = ListenBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });
  if (body.data.action === "start") {
    const { data, error } = await db.rpc("missions_start_listen", { p_story: body.data.storyId });
    if (error) return missionsError(error);
    const parsed = StartResultSchema.safeParse(data);
    return parsed.success ? Response.json(parsed.data, { headers: NO_STORE }) : missionsError(null);
  }
  const { data, error } = await db.rpc("missions_complete_listen", { p_session: body.data.sessionId });
  if (error) return missionsError(error);
  const parsed = CompleteResultSchema.safeParse(data);
  return parsed.success ? Response.json(parsed.data, { headers: NO_STORE }) : missionsError(null);
}
