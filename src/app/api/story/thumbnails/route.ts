import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { parseJsonBody, uuid } from "@/lib/api-validation";
import {
  applyFamilyThumbnail,
  buildThumbnail,
  loadFirstPages,
  mapLimit,
  planThumbnail,
  readThumbSettings,
  type ThumbResult,
} from "@/lib/story-thumbnails";

/**
 * PR #49 — lazily thumbnail the caller's own family stories that have none yet
 * (Library/Home call this once per session). Platform stories are handled by
 * staff (admin bulk action / cover drawer), never through a family session.
 */
const Body = z.strictObject({ ids: z.array(uuid).min(1).max(12) });
const recent = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_CALLS = 6;

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const calls = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (calls.length >= MAX_CALLS) return true;
  calls.push(now);
  recent.set(userId, calls);
  if (recent.size > 5000) recent.clear();
  return false;
}

export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = await parseJsonBody(request, Body);
  if (!parsed.ok) return parsed.response;
  if (rateLimited(user.id)) return Response.json({ error: "Thử lại sau ít phút" }, { status: 429 });
  const settings = await readThumbSettings();
  const noStore = { headers: { "Cache-Control": "private, no-store" } };
  if (!settings.auto) return Response.json({ ok: true, items: [], disabled: true }, noStore);

  const { data: rows, error } = await db
    .from("stories")
    .select("id, cover_image_url, theme, thumbnail_path, thumbnail_source")
    .in("id", [...new Set(parsed.data.ids)])
    .eq("user_id", user.id)
    .eq("is_platform_content", false)
    .is("deleted_at", null)
    .is("thumbnail_source", null);
  if (error) return Response.json({ error: "Không tải được truyện" }, { status: 503 });
  const stories = rows ?? [];
  const pages = await loadFirstPages(db, stories.map((s) => s.id));
  const settled = await mapLimit(stories, 3, async (story): Promise<ThumbResult | null> => {
    const plan = planThumbnail(story, pages.get(story.id) ?? null, settings);
    const result = await buildThumbnail(db, user.id, story.id, plan, settings);
    return (await applyFamilyThumbnail(db, result, story.thumbnail_path ?? null)) ? result : null;
  });
  const items = settled
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter((r): r is ThumbResult => Boolean(r))
    .map(({ id, thumbnail_source, thumbnail_path, thumbnail_scene }) => ({ id, thumbnail_source, thumbnail_path, thumbnail_scene }));
  return Response.json({ ok: true, items, failed: settled.length - items.length }, noStore);
}
