/**
 * AI page illustrations: provider resolution (GPT Image / Gemini, DALL·E is
 * retired), image decoding, Storage upload and the per-page route that the
 * player calls progressively.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const settings: Record<string, string> = {};
const keys: Record<string, string> = {};
vi.mock("@/lib/server-settings", () => ({
  getServiceClient: () => ({
    from: () => {
      const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: null, error: null }), insert: async () => ({ error: null }), update: () => ({ eq: async () => ({ error: null }) }) };
      return c;
    },
  }),
  getSystemSetting: vi.fn(async (k: string) => settings[k] ?? ""),
  resolveApiKey: vi.fn(async (p: string, user?: string) => user || keys[p] || ""),
}));

const fetchMock = vi.fn<typeof fetch>();
const rpc = vi.fn();
const uploads: { path: string; type?: string }[] = [];
const updates: { table: string; values: Record<string, unknown>; nullGuard: string | null }[] = [];
let storyRow: Record<string, unknown> | null = null;
let pageRow: Record<string, unknown> | null = null;

function table(name: string) {
  const state: { values?: Record<string, unknown>; nullGuard: string | null } = { nullGuard: null };
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    is: (col: string) => {
      state.nullGuard = col;
      return chain;
    },
    update: (values: Record<string, unknown>) => {
      state.values = values;
      updates.push({ table: name, values, get nullGuard() { return state.nullGuard; } } as never);
      return chain;
    },
    maybeSingle: async () => ({ data: name === "stories" ? storyRow : name === "story_pages" ? pageRow : null, error: null }),
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: name === "story_characters" ? [{ name: "Thỏ Bông", appearance: "white bunny with mint scarf", role: "hero", description: null }] : [{ id: "p1" }], error: null }),
  });
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "00000000-0000-4000-8000-0000000000aa" } } }) },
    rpc,
    from: (name: string) => table(name),
    storage: {
      from: () => ({
        upload: async (path: string, _bytes: unknown, opts: { contentType?: string }) => {
          uploads.push({ path, type: opts.contentType });
          return { error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example/${path}` } }),
      }),
    },
  })),
}));

const STORY = "00000000-0000-4000-8000-000000000123";
function post(body: unknown): NextRequest {
  return new Request("http://localhost/api/story/illustrate-page", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}
const png = Buffer.from("fake-image").toString("base64");

beforeEach(() => {
  for (const k of Object.keys(settings)) delete settings[k];
  for (const k of Object.keys(keys)) delete keys[k];
  fetchMock.mockReset();
  uploads.length = 0;
  updates.length = 0;
  vi.stubGlobal("fetch", fetchMock);
  rpc.mockReset();
  rpc.mockImplementation(async (name: string) => ({ data: name === "public_feature_flags" ? { ai_illustrations: true } : { allowed: true }, error: null }));
  storyRow = { id: STORY, title: "Thỏ đi chơi", user_id: "00000000-0000-4000-8000-0000000000aa", illustration_style: "clay", cover_image_url: null };
  pageRow = { id: "p1", page_number: 1, content: "[narrator]Thỏ Bông ra bờ suối.[/narrator]", scene_description: "Bờ suối", illustration_prompt: "Thỏ Bông by a stream at dawn", mood: "calm", illustration_url: null };
});

describe("resolveIllustrationTarget", () => {
  it("auto: OpenAI GPT Image with the illustration key, never DALL·E", async () => {
    const { resolveIllustrationTarget } = await import("@/lib/illustration");
    keys.dalle = "sk-img";
    settings.illustration_model = "dall-e-3";
    expect(await resolveIllustrationTarget()).toMatchObject({ provider: "openai", apiKey: "sk-img", model: "gpt-image-2", quality: "low" });
  });
  it("falls back to Gemini, honours off", async () => {
    const { resolveIllustrationTarget } = await import("@/lib/illustration");
    keys.gemini = "g-key";
    expect(await resolveIllustrationTarget()).toMatchObject({ provider: "gemini", model: "gemini-2.5-flash-image" });
    settings.illustration_provider = "off";
    expect(await resolveIllustrationTarget()).toBeNull();
  });
});

describe("generateIllustration", () => {
  it("OpenAI: 3:2 webp, base64 decoded", async () => {
    const { generateIllustration } = await import("@/lib/illustration");
    const f = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: png }] })));
    const out = await generateIllustration({ provider: "openai", apiKey: "k", model: "gpt-image-2", quality: "low", byo: false }, "p", f);
    expect(Buffer.from(out.bytes).toString()).toBe("fake-image");
    const body = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ model: "gpt-image-2", size: "1536x1024", output_format: "webp", quality: "low" });
  });
  it("Gemini: inline image part, key in header", async () => {
    const { generateIllustration } = await import("@/lib/illustration");
    const f = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }, { inlineData: { mimeType: "image/png", data: png } }] } }] })));
    const out = await generateIllustration({ provider: "gemini", apiKey: "g", model: "gemini-2.5-flash-image", quality: "low", byo: false }, "p", f);
    expect(out.mimeType).toBe("image/png");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("key=");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("g");
  });
  it("provider error surfaces the message", async () => {
    const { generateIllustration } = await import("@/lib/illustration");
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { message: "billing hard limit" } }), { status: 400 }));
    await expect(generateIllustration({ provider: "openai", apiKey: "k", model: "m", quality: "low", byo: false }, "p", f)).rejects.toThrow("billing hard limit");
  });
});

describe("POST /api/story/illustrate-page", () => {
  it("draws, uploads under the caller's folder, stores only if still empty, sets the cover", async () => {
    keys.openai = "sk-platform";
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: png }] })));
    const { POST } = await import("@/app/api/story/illustrate-page/route");
    const res = await POST(post({ storyId: STORY, pageNumber: 1 }));
    const json = await res.json();
    expect(json.error ?? null).toBeNull();
    expect(res.status).toBe(200);
    expect(json.url).toMatch(/^https:\/\/cdn\.example\/00000000-0000-4000-8000-0000000000aa\/00000000-0000-4000-8000-000000000123\/p1-[0-9a-f]{8}\.webp$/);
    expect(uploads[0].type).toBe("image/webp");
    const prompt = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).prompt as string;
    expect(prompt).toContain("Thỏ Bông: white bunny with mint scarf");
    expect(prompt).toContain("Thỏ Bông by a stream at dawn");
    expect(rpc).toHaveBeenCalledWith("consume_usage", { p_kind: "illustration", p_amount: 1, p_byo: false });
    const pageUpdate = updates.find((u) => u.table === "story_pages");
    expect(pageUpdate?.nullGuard).toBe("illustration_url");
    expect(updates.find((u) => u.table === "stories")?.values).toEqual({ cover_image_url: json.url });
  });

  it("existing picture is returned without spending; others' stories are refused", async () => {
    keys.openai = "sk-platform";
    pageRow = { ...pageRow, illustration_url: "https://cdn.example/old.webp" };
    const { POST } = await import("@/app/api/story/illustrate-page/route");
    expect(await (await POST(post({ storyId: STORY, pageNumber: 1 }))).json()).toMatchObject({ url: "https://cdn.example/old.webp", existing: true });
    expect(fetchMock).not.toHaveBeenCalled();
    storyRow = { ...storyRow, user_id: "00000000-0000-4000-8000-0000000000bb" };
    expect((await POST(post({ storyId: STORY, pageNumber: 1 }))).status).toBe(403);
  });

  it("no provider configured → 503 (player keeps scene art), flag off → blocked", async () => {
    const { POST } = await import("@/app/api/story/illustrate-page/route");
    expect((await POST(post({ storyId: STORY, pageNumber: 1 }))).status).toBe(503);
    rpc.mockImplementation(async (name: string) => ({ data: name === "public_feature_flags" ? { ai_illustrations: false } : { allowed: true }, error: null }));
    keys.openai = "sk-platform";
    const res = await POST(post({ storyId: STORY, pageNumber: 1 }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
