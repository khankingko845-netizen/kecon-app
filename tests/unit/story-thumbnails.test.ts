/**
 * PR #49 — story card thumbnails: which picture a card shows, what the server
 * may read (only our bucket, by path), sharp output, settings and route guards.
 */
import { existsSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import sharp from "sharp";

const setting = vi.fn<(key: string) => Promise<string>>(async () => "");
vi.mock("@/lib/server-settings", () => ({
  getServiceClient: () => null,
  getSystemSetting: (key: string) => setting(key),
}));
const from = vi.fn();
const rpc = vi.fn();
let currentUser: { id: string } | null = { id: "11111111-1111-4111-8111-111111111111" };
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) }, from, rpc })),
}));
vi.mock("@/lib/admin-permissions", () => ({ requirePermission: vi.fn(async () => null) }));

import { SCENE_IDS, sceneForPage } from "@/lib/scene-library";
import { THUMB_PATH_RE, isThumbPath, needsThumbnail, sceneThumbUrl, storyThumbCandidates, storyThumbUrl } from "@/lib/story-thumb";
import {
  MAX_COVER_BYTES,
  newObjectPath,
  normalizeCoverUpload,
  parseThumbSettings,
  planThumbnail,
  renderThumbnail,
  storagePathFromPublicUrl,
} from "@/lib/story-thumbnails";

const BASE = "https://kecon.example.com";
const USER = "11111111-1111-4111-8111-111111111111";
const STORY = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const thumbPath = `${USER}/${STORY}/thumb-0123456789abcdef.webp`;
const cover = `${BASE}/storage/v1/object/public/illustrations/${USER}/${STORY}/p1-abcd1234.webp`;
const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 120, g: 90, b: 200 } } }).png().toBuffer();

beforeEach(() => {
  setting.mockReset();
  setting.mockImplementation(async () => "");
  from.mockReset();
  rpc.mockReset();
  currentUser = { id: USER };
});

describe("which picture a story card shows", () => {
  it("prefers the generated thumbnail, then scene, then cover; icon means none", () => {
    const story = { id: STORY, thumbnail_path: thumbPath, thumbnail_source: "cover", cover_image_url: cover };
    expect(storyThumbCandidates(story, BASE)).toEqual([`${BASE}/storage/v1/object/public/illustrations/${thumbPath}`, cover]);
    expect(storyThumbUrl({ id: STORY, thumbnail_source: "scene", thumbnail_scene: "castle", cover_image_url: cover }, BASE)).toBe(
      "/scenes/v1/thumbs/castle.webp",
    );
    expect(storyThumbUrl({ id: STORY, cover_image_url: cover }, BASE)).toBe(cover);
    expect(storyThumbCandidates({ id: STORY, thumbnail_source: "icon", cover_image_url: cover }, BASE)).toEqual([]);
    expect(storyThumbUrl({ id: STORY }, BASE)).toBeNull();
  });

  it("ignores paths outside the story's folder and unsafe cover URLs", () => {
    expect(isThumbPath(thumbPath, STORY)).toBe(true);
    expect(isThumbPath(`${USER}/${OTHER}/thumb-0123456789abcdef.webp`, STORY)).toBe(false);
    expect(isThumbPath(`../${STORY}/thumb-0123456789abcdef.webp`)).toBe(false);
    expect(storyThumbUrl({ id: STORY, thumbnail_path: `${USER}/${OTHER}/thumb-0123456789abcdef.webp` }, BASE)).toBeNull();
    expect(storyThumbUrl({ id: STORY, cover_image_url: "javascript:alert(1)" }, BASE)).toBeNull();
    expect(storyThumbUrl({ id: STORY, thumbnail_scene: "evil" }, BASE)).toBeNull();
  });

  it("asks the server only for own, live, not-yet-thumbnailed family stories", () => {
    const own = { id: STORY, user_id: USER, is_platform_content: false, thumbnail_source: null, cover_image_url: null };
    expect(needsThumbnail(own, USER)).toBe(true);
    expect(needsThumbnail({ ...own, thumbnail_source: "scene" }, USER)).toBe(false);
    expect(needsThumbnail({ ...own, is_platform_content: true }, USER)).toBe(false);
    expect(needsThumbnail({ ...own, user_id: OTHER }, USER)).toBe(false);
    expect(needsThumbnail({ ...own, deleted_at: "2026-01-01" }, USER)).toBe(false);
    expect(needsThumbnail({ ...own, cover_image_url: "https://cdn.example.com/x.jpg" }, USER)).toBe(false);
    expect(needsThumbnail(own, null)).toBe(false);
  });

  it("ships a 480×320 WebP thumbnail for every built-in scene", async () => {
    for (const id of SCENE_IDS) {
      const file = `public${sceneThumbUrl(id)}`;
      expect(existsSync(file)).toBe(true);
      const meta = await sharp(file).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["webp", 480, 320]);
    }
  });
});

describe("server side: sources, settings, sharp", () => {
  it("reads only objects of our illustrations bucket, by path", () => {
    expect(storagePathFromPublicUrl(cover)).toBe(`${USER}/${STORY}/p1-abcd1234.webp`);
    expect(storagePathFromPublicUrl("https://evil.example.com/storage/v1/object/public/illustrations/a/b.webp")).toBe("a/b.webp");
    for (const bad of [
      null,
      "",
      "not a url",
      "file:///etc/passwd",
      `${BASE}/storage/v1/object/public/tts/a.mp3`,
      `${BASE}/storage/v1/object/public/illustrations/../secrets.webp`,
      `${BASE}/storage/v1/object/public/illustrations/a//b.webp`,
    ])
      expect(storagePathFromPublicUrl(bad)).toBeNull();
    // URL normalisation resolves dot segments first: the result stays inside the bucket.
    expect(storagePathFromPublicUrl(`${BASE}/storage/v1/object/public/illustrations/a/%2e%2e/b.webp`)).toBe("b.webp");
    expect(storagePathFromPublicUrl(`${BASE}/storage/v1/object/public/illustrations/a/%2E%2E%2Fb.webp`)).toBeNull();
  });

  it("plans cover → page 1 art → scene (or icon by setting)", () => {
    const story = { id: STORY, cover_image_url: cover, theme: "cotich" };
    const page = { illustration_url: cover.replace("p1-", "p9-"), scene_id: "castle", content: "Một ngày nọ." };
    expect(planThumbnail(story, page, { fallback: "scene" })).toEqual({ kind: "image", source: "cover", storagePath: `${USER}/${STORY}/p1-abcd1234.webp` });
    expect(planThumbnail({ ...story, cover_image_url: null }, page, { fallback: "scene" })).toMatchObject({ kind: "image", source: "page" });
    const noArt = { ...page, illustration_url: null };
    expect(planThumbnail({ ...story, cover_image_url: null }, noArt, { fallback: "scene" })).toEqual({ kind: "scene", scene: "castle" });
    expect(planThumbnail({ ...story, cover_image_url: null }, { content: "Một ngày nọ." }, { fallback: "scene" })).toEqual({
      kind: "scene",
      scene: sceneForPage({ text: "Một ngày nọ.", theme: "cotich" }),
    });
    expect(planThumbnail({ ...story, cover_image_url: null }, noArt, { fallback: "icon" })).toEqual({ kind: "icon" });
  });

  it("parses settings with safe defaults", () => {
    expect(parseThumbSettings({})).toEqual({ auto: true, fallback: "scene", width: 480, quality: 72 });
    expect(parseThumbSettings({ thumbnail_auto: "false", thumbnail_fallback: "icon", thumbnail_width: "640", thumbnail_quality: "85" })).toEqual({
      auto: false,
      fallback: "icon",
      width: 640,
      quality: 85,
    });
    expect(parseThumbSettings({ thumbnail_width: "4096", thumbnail_quality: "5", thumbnail_fallback: "evil" })).toEqual({
      auto: true,
      fallback: "scene",
      width: 480,
      quality: 72,
    });
  });

  it("renders a 3:2 WebP at the configured width and refuses non-raster input", async () => {
    const out = await renderThumbnail(await png(1200, 800), { width: 480, quality: 72 });
    const meta = await sharp(out).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 480, 320]);
    const tall = await sharp(await renderThumbnail(await png(600, 1400), { width: 360, quality: 60 })).metadata();
    expect([tall.width, tall.height]).toEqual([360, 240]);
    await expect(renderThumbnail(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), { width: 480, quality: 72 })).rejects.toThrow(
      /JPG\/PNG\/WebP/,
    );
  });

  it("normalizes an admin cover upload to ≤ 1200×800 WebP and enforces 5 MB", async () => {
    const meta = await sharp(await normalizeCoverUpload(await png(3000, 1000))).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBeLessThanOrEqual(1200);
    expect(meta.height).toBeLessThanOrEqual(800);
    await expect(normalizeCoverUpload(Buffer.alloc(MAX_COVER_BYTES + 1, 1))).rejects.toThrow(/5 MB/);
    await expect(normalizeCoverUpload(Buffer.from("GIF89a"))).rejects.toThrow(/JPG, PNG hoặc WebP/);
  });

  it("names thumbnails inside the story folder with random 16-hex ids", () => {
    const a = newObjectPath(USER, STORY, "thumb");
    const b = newObjectPath(USER, STORY, "thumb");
    expect(a).toMatch(THUMB_PATH_RE);
    expect(isThumbPath(a, STORY)).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("routes refuse before doing work", () => {
  const json = (url: string, body: unknown) =>
    new Request(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("family warm-up: auth, ≤ 12 uuids, off switch", async () => {
    const { POST } = await import("@/app/api/story/thumbnails/route");
    currentUser = null;
    expect((await POST(json("/api/story/thumbnails", { ids: [STORY] }))).status).toBe(401);
    currentUser = { id: USER };
    expect((await POST(json("/api/story/thumbnails", { ids: Array(13).fill(STORY) }))).status).toBe(400);
    expect((await POST(json("/api/story/thumbnails", { ids: ["../x"] }))).status).toBe(400);
    setting.mockImplementation(async (k: string) => (k === "thumbnail_auto" ? "false" : ""));
    const off = await POST(json("/api/story/thumbnails", { ids: [STORY] }));
    expect(await off.json()).toMatchObject({ ok: true, items: [], disabled: true });
    expect(from).not.toHaveBeenCalled();
  });

  it("admin bulk regenerate-all needs a reason; cross-site is refused", async () => {
    const { POST } = await import("@/app/api/admin/thumbnails/route");
    expect((await POST(json("/api/admin/thumbnails", { mode: "all" }))).status).toBe(400);
    const cross = new Request("http://localhost/api/admin/thumbnails", { method: "POST", headers: { "sec-fetch-site": "cross-site" }, body: "{}" });
    expect((await POST(cross)).status).toBe(403);
  });

  it("admin cover: family stories stay private (403), unknown scene is 400", async () => {
    const { POST } = await import("@/app/api/admin/story-cover/route");
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: { id: STORY, is_platform_content: false, deleted_at: null, cover_image_url: null }, error: null }),
    };
    from.mockReturnValue(chain);
    expect((await POST(json("/api/admin/story-cover", { storyId: STORY, choice: { type: "auto" } }))).status).toBe(403);
    expect((await POST(json("/api/admin/story-cover", { storyId: STORY, choice: { type: "scene", scene: "evil" } }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
