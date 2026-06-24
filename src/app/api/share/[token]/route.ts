import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Public share endpoint — no auth required.
 * GET /api/share/[token]
 *
 * Returns the shared story + pages so anyone with the link can read it.
 * Increments view_count on the share record.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!token || token.length < 8) {
    return Response.json({ error: "Invalid share token" }, { status: 400 });
  }

  // Use a lightweight anon client (no cookies needed for public reads)
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  );

  // 1. Look up the share record
  const { data: share, error: shareErr } = await supabase
    .from("story_shares")
    .select("id, story_id, is_active, expires_at, view_count")
    .eq("share_token", token)
    .single();

  if (shareErr || !share) {
    return Response.json({ error: "Link không tồn tại" }, { status: 404 });
  }

  if (!share.is_active) {
    return Response.json({ error: "Link đã bị vô hiệu hóa" }, { status: 410 });
  }

  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return Response.json({ error: "Link đã hết hạn" }, { status: 410 });
  }

  // 2. Fetch story
  const { data: story, error: storyErr } = await supabase
    .from("stories")
    .select(
      "id, title, description, category, theme, cover_url, target_age_min, target_age_max, avg_rating, rating_count, page_count, play_count, like_count"
    )
    .eq("id", share.story_id)
    .single();

  if (storyErr || !story) {
    return Response.json({ error: "Truyện không tồn tại" }, { status: 404 });
  }

  // 3. Fetch pages
  const { data: pages } = await supabase
    .from("story_pages")
    .select(
      "id, page_number, content, scene_description, illustration_url, audio_url"
    )
    .eq("story_id", share.story_id)
    .order("page_number");

  // 4. Increment view_count (fire-and-forget)
  supabase
    .from("story_shares")
    .update({ view_count: (share.view_count ?? 0) + 1 })
    .eq("id", share.id)
    .then(() => {});

  return Response.json({
    story,
    pages: pages ?? [],
    shared: true,
    shareToken: token,
  });
}
