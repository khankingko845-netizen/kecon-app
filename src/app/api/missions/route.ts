import { createClient } from "@/lib/supabase/server";
import { MissionsTodaySchema, NO_STORE, missionsError } from "@/lib/missions-server";
/** G-03/G-04: today's missions and this week's sky (server-awarded, flag `missions`). */
export async function GET() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const { data, error } = await db.rpc("missions_today");
  if (error) return missionsError(error);
  const parsed = MissionsTodaySchema.safeParse(data);
  if (!parsed.success) return missionsError(null);
  return Response.json(parsed.data, { headers: NO_STORE });
}
