/**
 * PR #49 — which picture a story card shows (client-safe, no I/O).
 * Order: generated thumbnail (small WebP in the illustrations bucket) → chosen
 * scene thumbnail → full cover → none (caller shows the topic icon).
 */
import { isSceneId, type SceneId } from "@/lib/scene-library";

export const THUMB_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/thumb-[0-9a-f]{16}\.webp$/;

export const THUMB_SOURCES = ["cover", "page", "upload", "scene", "icon"] as const;
export type ThumbSource = (typeof THUMB_SOURCES)[number];

export interface ThumbFields {
  id?: string;
  cover_image_url?: string | null;
  thumbnail_path?: string | null;
  thumbnail_scene?: string | null;
  thumbnail_source?: string | null;
}

export function sceneThumbUrl(id: SceneId): string {
  return `/scenes/v1/thumbs/${id}.webp`;
}

export function isThumbPath(path: unknown, storyId?: string): path is string {
  if (typeof path !== "string") return false;
  const m = THUMB_PATH_RE.exec(path);
  return Boolean(m && (!storyId || m[1] === storyId));
}

export function publicIllustrationUrl(path: string, base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""): string | null {
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/illustrations/${path}`;
}

/** Safe http(s) cover URL or null (no data:/javascript: in an <img>). */
export function safeCoverUrl(url: string | null | undefined): string | null {
  if (!url || url.length > 2048) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

/** Pictures to try in order (an <img> moves to the next one when a file fails). */
export function storyThumbCandidates(story: ThumbFields, base?: string): string[] {
  const out: string[] = [];
  if (isThumbPath(story.thumbnail_path, story.id)) {
    const url = publicIllustrationUrl(story.thumbnail_path, base);
    if (url) out.push(url);
  }
  if (story.thumbnail_source === "icon") return out;
  if (isSceneId(story.thumbnail_scene)) out.push(sceneThumbUrl(story.thumbnail_scene));
  const cover = safeCoverUrl(story.cover_image_url);
  if (cover && !out.includes(cover)) out.push(cover);
  return out;
}

export function storyThumbUrl(story: ThumbFields, base?: string): string | null {
  return storyThumbCandidates(story, base)[0] ?? null;
}

const OWN_BUCKET_MARK = "/storage/v1/object/public/illustrations/";

/** Stories this device may ask the server to thumbnail (own, not generated yet). */
export function needsThumbnail(
  story: ThumbFields & { is_platform_content?: boolean; user_id?: string; deleted_at?: string | null },
  userId: string | null | undefined,
): boolean {
  return Boolean(
    userId &&
      story.id &&
      story.user_id === userId &&
      !story.is_platform_content &&
      !story.deleted_at &&
      story.thumbnail_source == null &&
      (!story.cover_image_url || story.cover_image_url.includes(OWN_BUCKET_MARK)),
  );
}

export type ThumbPatch = { id: string; thumbnail_source: ThumbSource; thumbnail_path: string | null; thumbnail_scene: string | null };

/** Ask the server to thumbnail up to 12 own stories; [] on any failure. */
export async function requestStoryThumbnails(ids: string[]): Promise<ThumbPatch[]> {
  if (!ids.length) return [];
  try {
    const res = await fetch("/api/story/thumbnails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ids.slice(0, 12) }),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { items?: ThumbPatch[] };
    return Array.isArray(body.items) ? body.items : [];
  } catch {
    return [];
  }
}
