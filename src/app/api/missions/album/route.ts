import { createClient } from "@/lib/supabase/server";
import { MissionsAlbumSchema, NO_STORE, missionsError } from "@/lib/missions-server";
/** G-05: characters met in finished library stories and total-story milestones. */
export async function GET() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const { data, error } = await db.rpc("missions_album");
  if (error) return missionsError(error);
  const parsed = MissionsAlbumSchema.safeParse(data);
  if (!parsed.success) return missionsError(null);
  return Response.json(parsed.data, { headers: NO_STORE });
}
