import type { SupabaseClient } from "@supabase/supabase-js";
import { CHILD_PROFILE_COLUMNS, type ChildProfile } from "@/lib/child-profiles";

export type StoryChild = { child: ChildProfile | null } | { response: Response };

/**
 * T10 · Hồ sơ bé: the child a story is written for. Read with the caller's own session,
 * so RLS limits it to their household (another family's id looks like "not found").
 * Routes call this before quota/provider calls: a bad id costs nothing.
 */
export async function loadStoryChild(supabase: SupabaseClient, id: string | undefined): Promise<StoryChild> {
  if (!id) return { child: null };
  const { data, error } = await supabase.from("child_profiles").select(CHILD_PROFILE_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    return {
      response: Response.json({ error: "Chưa đọc được hồ sơ bé. Thử lại sau nhé.", code: "child_profile_unavailable" }, { status: 503 }),
    };
  }
  if (!data) {
    return { response: Response.json({ error: "Không tìm thấy hồ sơ bé.", code: "child_profile_not_found" }, { status: 404 }) };
  }
  const row = data as ChildProfile;
  return { child: { ...row, interests: Array.isArray(row.interests) ? row.interests : [] } };
}
