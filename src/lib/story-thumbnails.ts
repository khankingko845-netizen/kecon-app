/**
 * PR #49 — server-side story thumbnails (sharp). Never fetches arbitrary URLs:
 * only objects of our own public `illustrations` bucket are read, by path.
 * Thumbnails are 3:2 WebP files at <uploader>/<story>/thumb-<16 hex>.webp.
 */
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient, getSystemSetting } from "@/lib/server-settings";
import { sceneForPage, type SceneId } from "@/lib/scene-library";
import { isThumbPath, type ThumbSource } from "@/lib/story-thumb";

export interface ThumbSettings {
  auto: boolean;
  fallback: "scene" | "icon";
  width: 360 | 480 | 640;
  quality: number;
}
export const THUMB_DEFAULTS: ThumbSettings = { auto: true, fallback: "scene", width: 480, quality: 72 };
export const THUMB_SETTING_KEYS = ["thumbnail_auto", "thumbnail_fallback", "thumbnail_width", "thumbnail_quality"] as const;
export const MAX_COVER_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const BUCKET = "illustrations";
const PUBLIC_MARK = `/storage/v1/object/public/${BUCKET}/`;

export function parseThumbSettings(raw: Partial<Record<(typeof THUMB_SETTING_KEYS)[number], string | null | undefined>>): ThumbSettings {
  const width = Number(raw.thumbnail_width);
  const quality = Number(raw.thumbnail_quality);
  return {
    auto: raw.thumbnail_auto == null || raw.thumbnail_auto === "" ? THUMB_DEFAULTS.auto : raw.thumbnail_auto === "true",
    fallback: raw.thumbnail_fallback === "icon" ? "icon" : "scene",
    width: width === 360 || width === 640 ? width : 480,
    quality: Number.isInteger(quality) && quality >= 60 && quality <= 90 ? quality : THUMB_DEFAULTS.quality,
  };
}

export async function readThumbSettings(): Promise<ThumbSettings> {
  const entries = await Promise.all(
    THUMB_SETTING_KEYS.map(async (k) => [k, await getSystemSetting(k).catch(() => "")] as const),
  );
  return parseThumbSettings(Object.fromEntries(entries));
}

/** Object path inside our illustrations bucket, or null for anything else. */
export function storagePathFromPublicUrl(url: string | null | undefined): string | null {
  if (!url || url.length > 2048) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const at = parsed.pathname.indexOf(PUBLIC_MARK);
  if (at < 0) return null;
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname.slice(at + PUBLIC_MARK.length));
  } catch {
    return null;
  }
  if (!path || path.length > 512 || path.startsWith("/") || path.split("/").some((s) => s === "" || s === "." || s === "..")) return null;
  return /^[A-Za-z0-9._\-/]+$/.test(path) ? path : null;
}

export interface ThumbStory {
  id: string;
  cover_image_url: string | null;
  theme?: string | null;
  thumbnail_path?: string | null;
  thumbnail_source?: string | null;
}
export interface ThumbPage {
  illustration_url?: string | null;
  scene_id?: string | null;
  scene_description?: string | null;
  content?: string | null;
}
export type ThumbPlan =
  | { kind: "image"; source: "cover" | "page"; storagePath: string }
  | { kind: "scene"; scene: SceneId }
  | { kind: "icon" };

/** cover → page-1 art → (setting) scene of page 1 or the topic icon. */
export function planThumbnail(story: ThumbStory, page1: ThumbPage | null, settings: Pick<ThumbSettings, "fallback">): ThumbPlan {
  const cover = storagePathFromPublicUrl(story.cover_image_url);
  if (cover) return { kind: "image", source: "cover", storagePath: cover };
  const page = storagePathFromPublicUrl(page1?.illustration_url);
  if (page) return { kind: "image", source: "page", storagePath: page };
  if (settings.fallback === "icon") return { kind: "icon" };
  return {
    kind: "scene",
    scene: sceneForPage({
      sceneId: page1?.scene_id,
      sceneDescription: page1?.scene_description,
      text: page1?.content,
      theme: story.theme,
    }),
  };
}

/** Columns for a brand-new story (scene of page 1), or {} when auto is off. */
export async function initialThumbnailFields(page1: ThumbPage, theme: string | null | undefined): Promise<Record<string, string>> {
  const settings = await readThumbSettings().catch(() => THUMB_DEFAULTS);
  if (!settings.auto) return {};
  const plan = planThumbnail({ id: "", cover_image_url: null, theme }, { ...page1, illustration_url: null }, settings);
  const now = new Date().toISOString();
  return plan.kind === "scene"
    ? { thumbnail_source: "scene", thumbnail_scene: plan.scene, thumbnail_updated_at: now }
    : { thumbnail_source: "icon", thumbnail_updated_at: now };
}

function rasterKind(bytes: Buffer): "jpeg" | "png" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "webp";
  return null;
}

export class ThumbnailError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** 3:2 crop (attention) → WebP at the configured width/quality. */
export async function renderThumbnail(bytes: Buffer, settings: Pick<ThumbSettings, "width" | "quality">): Promise<Buffer> {
  if (!rasterKind(bytes)) throw new ThumbnailError("Ảnh nguồn không phải JPG/PNG/WebP");
  const height = Math.round((settings.width * 2) / 3);
  try {
    return await sharp(bytes, { limitInputPixels: 40_000_000, animated: false })
      .rotate()
      .resize(settings.width, height, { fit: "cover", position: sharp.strategy.attention })
      .webp({ quality: settings.quality })
      .toBuffer();
  } catch {
    throw new ThumbnailError("Không đọc được ảnh nguồn");
  }
}

/** Admin cover upload: real JPG/PNG/WebP ≤ 5 MB → ≤ 1200×800 WebP, metadata stripped. */
export async function normalizeCoverUpload(bytes: Buffer): Promise<Buffer> {
  if (!bytes.length || bytes.length > MAX_COVER_BYTES) throw new ThumbnailError("Ảnh bìa cần nhỏ hơn hoặc bằng 5 MB.");
  if (!rasterKind(bytes)) throw new ThumbnailError("Chọn ảnh JPG, PNG hoặc WebP. Không nhận SVG hay tệp khác.");
  try {
    const image = sharp(bytes, { limitInputPixels: 40_000_000, animated: false });
    const meta = await image.metadata();
    if (!meta.width || !meta.height || (meta.pages ?? 1) > 1) throw new Error("invalid");
    return await image.rotate().resize(1200, 800, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  } catch {
    throw new ThumbnailError("Ảnh không đọc được hoặc độ phân giải quá lớn. Hãy chọn ảnh khác.");
  }
}

export function newObjectPath(uploaderId: string, storyId: string, kind: "thumb" | "cover"): string {
  return `${uploaderId}/${storyId}/${kind}-${randomBytes(8).toString("hex")}.webp`;
}

export async function uploadWebp(db: SupabaseClient, path: string, bytes: Buffer): Promise<void> {
  const { error } = await db.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: "image/webp", upsert: false, cacheControl: "31536000" });
  if (error) throw new ThumbnailError(`Không lưu được ảnh: ${error.message}`, 502);
}

export function publicObjectUrl(db: SupabaseClient, path: string): string {
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function downloadIllustration(db: SupabaseClient, path: string): Promise<Buffer> {
  const { data, error } = await (getServiceClient() ?? db).storage.from(BUCKET).download(path);
  if (error || !data) throw new ThumbnailError("Không tải được ảnh nguồn", 502);
  if (data.size > MAX_SOURCE_BYTES) throw new ThumbnailError("Ảnh nguồn quá lớn");
  return Buffer.from(await data.arrayBuffer());
}

/** Best-effort cleanup (service role only; users have no delete policy). */
export async function removeObjects(paths: (string | null | undefined)[]): Promise<void> {
  const list = [...new Set(paths.filter((p): p is string => typeof p === "string" && p.length > 0))];
  const service = getServiceClient();
  if (!service || !list.length) return;
  await service.storage.from(BUCKET).remove(list).catch(() => undefined);
}

export interface ThumbResult {
  id: string;
  thumbnail_source: ThumbSource;
  thumbnail_path: string | null;
  thumbnail_scene: SceneId | null;
  /** New object written by this run (delete it if the row update fails). */
  uploaded: string | null;
}

/** Build (and upload) the thumbnail for a plan or for already-loaded bytes. */
export async function buildThumbnail(
  db: SupabaseClient,
  uploaderId: string,
  storyId: string,
  plan: ThumbPlan | { kind: "bytes"; source: "page" | "upload" | "cover"; bytes: Buffer },
  settings: ThumbSettings,
): Promise<ThumbResult> {
  if (plan.kind === "scene") return { id: storyId, thumbnail_source: "scene", thumbnail_path: null, thumbnail_scene: plan.scene, uploaded: null };
  if (plan.kind === "icon") return { id: storyId, thumbnail_source: "icon", thumbnail_path: null, thumbnail_scene: null, uploaded: null };
  const source = plan.kind === "bytes" ? plan.bytes : await downloadIllustration(db, plan.storagePath);
  const webp = await renderThumbnail(source, settings);
  const path = newObjectPath(uploaderId, storyId, "thumb");
  if (!isThumbPath(path, storyId)) throw new ThumbnailError("Mã truyện không hợp lệ", 400);
  await uploadWebp(db, path, webp);
  return { id: storyId, thumbnail_source: plan.source, thumbnail_path: path, thumbnail_scene: null, uploaded: path };
}

export function thumbColumns(r: ThumbResult) {
  return {
    thumbnail_source: r.thumbnail_source,
    thumbnail_path: r.thumbnail_path,
    thumbnail_scene: r.thumbnail_scene,
    thumbnail_updated_at: new Date().toISOString(),
  };
}

export async function loadFirstPages(db: SupabaseClient, ids: string[]): Promise<Map<string, ThumbPage>> {
  const map = new Map<string, ThumbPage>();
  if (!ids.length) return map;
  const { data } = await db
    .from("story_pages")
    .select("story_id, illustration_url, scene_id, scene_description, content")
    .in("story_id", ids)
    .eq("page_number", 1);
  for (const row of (data ?? []) as (ThumbPage & { story_id: string })[]) map.set(row.story_id, row);
  return map;
}

/** Run `fn` over items with a small concurrency limit, keeping order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Platform rows: one atomic, audited RPC; uploads are rolled back on failure. */
export async function applyPlatformThumbnails(
  db: SupabaseClient,
  rows: { result: ThumbResult; expectPath: string | null; cover?: string | null; extraUploads?: string[] }[],
  reason?: string,
): Promise<{ ok: true; count: number } | { ok: false; status: number; error: string }> {
  if (!rows.length) return { ok: true, count: 0 };
  const items = rows.map(({ result, expectPath, cover }) => ({
    id: result.id,
    source: result.thumbnail_source,
    path: result.thumbnail_path,
    scene: result.thumbnail_scene,
    expect_path: expectPath,
    ...(cover !== undefined ? { cover } : {}),
  }));
  const { data, error } = await db.rpc("admin_set_story_thumbnails", { p_items: items, p_reason: reason ?? null });
  if (error) {
    await removeObjects(rows.flatMap((r) => [r.result.uploaded, ...(r.extraUploads ?? [])]));
    const status = error.code === "40001" ? 409 : error.code === "42501" ? 403 : error.code === "22023" ? 400 : 503;
    return { ok: false, status, error: error.message || "Không lưu được thumbnail" };
  }
  await removeObjects(rows.map((r) => (r.expectPath && r.expectPath !== r.result.thumbnail_path ? r.expectPath : null)));
  return { ok: true, count: typeof data === "number" ? data : rows.length };
}

/** Own family rows (RLS): compare-and-set on the previous thumbnail path. */
export async function applyFamilyThumbnail(db: SupabaseClient, result: ThumbResult, expectPath: string | null): Promise<boolean> {
  let query = db.from("stories").update(thumbColumns(result)).eq("id", result.id).eq("is_platform_content", false);
  query = expectPath ? query.eq("thumbnail_path", expectPath) : query.is("thumbnail_path", null);
  const { data, error } = await query.select("id");
  const stored = !error && Boolean(data?.length);
  await removeObjects(stored ? [expectPath && expectPath !== result.thumbnail_path ? expectPath : null] : [result.uploaded]);
  return stored;
}

/** Thumbnail for a picture that is about to become the cover (bytes already in memory). */
export async function thumbnailForNewCover(
  db: SupabaseClient,
  uploaderId: string,
  storyId: string,
  bytes: Uint8Array,
): Promise<ThumbResult | null> {
  const settings = await readThumbSettings().catch(() => THUMB_DEFAULTS);
  if (!settings.auto) return null;
  return buildThumbnail(db, uploaderId, storyId, { kind: "bytes", source: "cover", bytes: Buffer.from(bytes) }, settings).catch(() => null);
}
