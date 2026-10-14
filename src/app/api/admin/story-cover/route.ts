import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/admin-permissions";
import { z } from "zod";
import { parseValue, uuid } from "@/lib/api-validation";
import { SCENE_IDS } from "@/lib/scene-library";
import {
  MAX_COVER_BYTES,
  ThumbnailError,
  applyPlatformThumbnails,
  buildThumbnail,
  loadFirstPages,
  newObjectPath,
  normalizeCoverUpload,
  planThumbnail,
  publicObjectUrl,
  readThumbSettings,
  removeObjects,
  storagePathFromPublicUrl,
  uploadWebp,
  type ThumbResult,
} from "@/lib/story-thumbnails";

/**
 * PR #49 — choose the cover/thumbnail of a platform story: a page picture, a
 * built-in scene, the topic icon, "auto", or an uploaded image (multipart).
 * Writes go through admin_set_story_thumbnails (permission + audit + reason).
 */
const reason = z.string().trim().min(10).max(500).optional();
const Choice = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("auto") }),
  z.strictObject({ type: z.literal("icon") }),
  z.strictObject({ type: z.literal("scene"), scene: z.enum(SCENE_IDS) }),
  z.strictObject({ type: z.literal("page"), page: z.number().int().min(1).max(200) }),
]);
const JsonBody = z.strictObject({ storyId: uuid, choice: Choice, reason });
const UploadFields = z.strictObject({ storyId: uuid, reason });

export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const db = await createClient();
  const denied = await requirePermission(db, "stories.write");
  if (denied) return denied;
  // audit: db-trigger stories (admin_set_story_thumbnails: before/after + optional reason, atomically)
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const multipart = (request.headers.get("content-type") ?? "").startsWith("multipart/form-data");
  let storyId: string;
  let why: string | undefined;
  let choice: z.output<typeof Choice> | { type: "upload"; bytes: Buffer };
  if (multipart) {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_COVER_BYTES + 64 * 1024)
      return Response.json({ error: "Ảnh bìa cần nhỏ hơn hoặc bằng 5 MB." }, { status: 413 });
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    const fields = parseValue(
      { storyId: form?.get("storyId") ?? undefined, reason: (form?.get("reason") as string | null) || undefined },
      UploadFields,
    );
    if (!fields.ok) return fields.response;
    if (!(file instanceof Blob) || file.size === 0) return Response.json({ error: "Chưa chọn ảnh" }, { status: 400 });
    if (file.size > MAX_COVER_BYTES) return Response.json({ error: "Ảnh bìa cần nhỏ hơn hoặc bằng 5 MB." }, { status: 413 });
    storyId = fields.data.storyId;
    why = fields.data.reason;
    choice = { type: "upload", bytes: Buffer.from(await file.arrayBuffer()) };
  } else {
    const raw = await request.json().catch(() => null);
    const body = parseValue(raw, JsonBody);
    if (!body.ok) return body.response;
    storyId = body.data.storyId;
    why = body.data.reason;
    choice = body.data.choice;
  }

  const { data: story } = await db
    .from("stories")
    .select("id, cover_image_url, theme, thumbnail_path, thumbnail_source, is_platform_content, deleted_at")
    .eq("id", storyId)
    .maybeSingle();
  if (!story || story.deleted_at) return Response.json({ error: "Không tìm thấy truyện" }, { status: 404 });
  if (!story.is_platform_content)
    return Response.json({ error: "Chỉ đổi ảnh bìa của truyện nền tảng; truyện gia đình là riêng tư." }, { status: 403 });

  const settings = await readThumbSettings();
  const uploads: string[] = [];
  try {
    let result: ThumbResult;
    let cover: string | null | undefined;
    if (choice.type === "upload") {
      const normalized = await normalizeCoverUpload(choice.bytes);
      const coverPath = newObjectPath(user.id, story.id, "cover");
      await uploadWebp(db, coverPath, normalized);
      uploads.push(coverPath);
      cover = publicObjectUrl(db, coverPath);
      result = await buildThumbnail(db, user.id, story.id, { kind: "bytes", source: "upload", bytes: normalized }, settings);
    } else if (choice.type === "page") {
      const { data: page } = await db
        .from("story_pages")
        .select("illustration_url")
        .eq("story_id", story.id)
        .eq("page_number", choice.page)
        .maybeSingle();
      const path = storagePathFromPublicUrl(page?.illustration_url);
      if (!page?.illustration_url || !path) return Response.json({ error: "Trang này chưa có tranh trong kho ảnh" }, { status: 400 });
      cover = page.illustration_url;
      result = await buildThumbnail(db, user.id, story.id, { kind: "image", source: "page", storagePath: path }, settings);
    } else if (choice.type === "scene") {
      result = await buildThumbnail(db, user.id, story.id, { kind: "scene", scene: choice.scene }, settings);
    } else if (choice.type === "icon") {
      result = await buildThumbnail(db, user.id, story.id, { kind: "icon" }, settings);
    } else {
      const pages = await loadFirstPages(db, [story.id]);
      result = await buildThumbnail(db, user.id, story.id, planThumbnail(story, pages.get(story.id) ?? null, settings), settings);
    }
    const saved = await applyPlatformThumbnails(
      db,
      [{ result, expectPath: story.thumbnail_path ?? null, cover, extraUploads: uploads }],
      why,
    );
    if (!saved.ok) return Response.json({ error: saved.error }, { status: saved.status });
    return Response.json(
      {
        ok: true,
        story: {
          id: story.id,
          cover_image_url: cover === undefined ? story.cover_image_url : cover,
          thumbnail_source: result.thumbnail_source,
          thumbnail_path: result.thumbnail_path,
          thumbnail_scene: result.thumbnail_scene,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    await removeObjects(uploads);
    const status = e instanceof ThumbnailError ? e.status : 500;
    return Response.json({ error: e instanceof ThumbnailError ? e.message : "Không đổi được ảnh bìa" }, { status });
  }
}
