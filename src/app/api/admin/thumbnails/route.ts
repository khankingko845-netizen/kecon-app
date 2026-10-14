import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/admin-permissions";
import { auditAdmin } from "@/lib/admin-audit";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api-validation";
import {
  applyPlatformThumbnails,
  buildThumbnail,
  loadFirstPages,
  mapLimit,
  planThumbnail,
  readThumbSettings,
  type ThumbResult,
} from "@/lib/story-thumbnails";

/** PR #49 — thumbnail coverage (GET) and bulk (re)generation for platform stories (POST). */
const noStore = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const db = await createClient();
  const denied = await requirePermission(db, "stories.read");
  if (denied) return denied;
  const auditFailed = await auditAdmin(db, request, { action: "thumbnail.view", targetType: "story" });
  if (auditFailed) return auditFailed;
  // aggregate counts only (family stories: totals, never titles or ids)
  const { data, error } = await db.rpc("admin_thumbnail_stats");
  if (error) return Response.json({ error: "Không tải được thống kê thumbnail" }, { status: 503 });
  return Response.json({ ok: true, stats: data }, { headers: noStore });
}

const Body = z
  .strictObject({
    mode: z.enum(["missing", "all"]),
    reason: z.string().trim().min(10).max(500).optional(),
  })
  .refine((b) => b.mode === "missing" || Boolean(b.reason), { message: "Tạo lại tất cả cần lý do (10–500 ký tự)", path: ["reason"] });

export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const db = await createClient();
  const denied = await requirePermission(db, "stories.write");
  if (denied) return denied;
  // audit: db-trigger stories (admin_set_story_thumbnails: before/after + optional reason, atomically)
  const parsed = await parseJsonBody(request, Body);
  if (!parsed.ok) return parsed.response;
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let query = db
    .from("stories")
    .select("id, cover_image_url, theme, thumbnail_path, thumbnail_source")
    .eq("is_platform_content", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(200);
  query = parsed.data.mode === "missing" ? query.is("thumbnail_source", null) : query.or("thumbnail_source.is.null,thumbnail_source.neq.upload");
  const { data: rows, error } = await query;
  if (error) return Response.json({ error: "Không tải được danh sách truyện" }, { status: 503 });
  const stories = rows ?? [];
  if (!stories.length) return Response.json({ ok: true, updated: 0, failed: 0, total: 0 }, { headers: noStore });

  const settings = await readThumbSettings();
  const pages = await loadFirstPages(db, stories.map((s) => s.id));
  const settled = await mapLimit(stories, 4, (story) =>
    buildThumbnail(db, user.id, story.id, planThumbnail(story, pages.get(story.id) ?? null, settings), settings),
  );
  const built: { result: ThumbResult; expectPath: string | null }[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") built.push({ result: r.value, expectPath: stories[i].thumbnail_path ?? null });
  });
  const failed = settled.length - built.length;
  const saved = await applyPlatformThumbnails(db, built, parsed.data.reason);
  if (!saved.ok) return Response.json({ error: saved.error }, { status: saved.status, headers: noStore });
  return Response.json({ ok: true, updated: saved.count, failed, total: stories.length }, { headers: noStore });
}
