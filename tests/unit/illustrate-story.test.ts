import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/illustration", () => ({
  IllustrationError: class extends Error {},
  generateIllustration: vi.fn(async () => ({ bytes: new Uint8Array([1]), mimeType: "image/webp" })),
  uploadIllustration: vi.fn(async (_sb: unknown, folder: string, story: string, n: number) => `https://cdn.example/${folder}/${story}/p${n}-new.webp`),
}));

type Call = { table: string; values: Record<string, unknown>; filters: string[] };
const calls: Call[] = [];
function fakeSupabase() {
  return {
    from(table: string) {
      const call: Call = { table, values: {}, filters: [] };
      const builder = {
        select: () => builder,
        eq: (col: string, v: unknown) => (call.filters.push(`${col}=${v}`), builder),
        is: (col: string, v: unknown) => (call.filters.push(`${col} is ${v}`), builder),
        order: () => builder,
        update: (values: Record<string, unknown>) => ((call.values = values), calls.push(call), builder),
        then: (resolve: (v: unknown) => void) => resolve({ data: table === "story_characters" ? [] : [{ id: "x" }], error: null }),
      };
      return builder;
    },
  };
}
const target = { provider: "custom" as const, apiKey: "k", model: "gpt-image-1-mini", quality: "low" as const, byo: false, baseUrl: "https://gw.example/v1" };
const OWNER = "owner-uuid";

beforeEach(() => {
  calls.length = 0;
});

describe("illustrateStoredPage cover handling", () => {
  const page = { id: "p1", page_number: 1, content: "x", scene_description: "y" };
  it("sets the cover from page 1 when the story has none", async () => {
    const { illustrateStoredPage } = await import("@/lib/illustrate-story");
    const { url } = await illustrateStoredPage(fakeSupabase() as never, target, OWNER, { id: "s1", title: "T", user_id: OWNER, cover_image_url: null }, { ...page, illustration_url: null });
    const cover = calls.find((c) => c.table === "stories");
    expect(cover?.values).toEqual({ cover_image_url: url });
    expect(cover?.filters).toContain("cover_image_url is null");
  });
  it("follows a page-1 redraw when the cover was the old page-1 picture", async () => {
    const { illustrateStoredPage } = await import("@/lib/illustrate-story");
    const old = "https://cdn.example/old-p1.webp";
    const { url } = await illustrateStoredPage(fakeSupabase() as never, target, OWNER, { id: "s1", title: "T", user_id: OWNER, cover_image_url: old }, { ...page, illustration_url: old }, { replace: true });
    const cover = calls.find((c) => c.table === "stories");
    expect(cover?.values).toEqual({ cover_image_url: url });
    expect(cover?.filters).toContain(`cover_image_url=${old}`);
  });
  it("keeps a custom cover and ignores other pages", async () => {
    const { illustrateStoredPage } = await import("@/lib/illustrate-story");
    const story = { id: "s1", title: "T", user_id: OWNER, cover_image_url: "https://cdn.example/custom-cover.webp" };
    await illustrateStoredPage(fakeSupabase() as never, target, OWNER, story, { ...page, illustration_url: "https://cdn.example/old-p1.webp" }, { replace: true });
    await illustrateStoredPage(fakeSupabase() as never, target, OWNER, { ...story, cover_image_url: null }, { ...page, id: "p3", page_number: 3, illustration_url: null });
    expect(calls.filter((c) => c.table === "stories")).toHaveLength(0);
  });
});
