import { createClient } from "@/lib/supabase/server";
import { readFeatureFlags } from "@/lib/feature-flags-server";
import { hasPermission } from "@/lib/admin-permissions";
import { CLOSED_FEATURE_FLAGS } from "@/lib/feature-flags";
export async function GET() {
  const db = await createClient();
  try {
    const flags = await readFeatureFlags(db);
    const {
      data: { user },
    } = await db.auth.getUser();
    return Response.json(
      {
        flags,
        canAuthor: !!user && (await hasPermission(db, "stories.write")),
        canManage: !!user && (await hasPermission(db, "settings.write")),
      },
      { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
    );
  } catch {
    return Response.json(
      {
        flags: CLOSED_FEATURE_FLAGS,
        canAuthor: false,
        canManage: false,
        error: "Feature flags unavailable",
      },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
