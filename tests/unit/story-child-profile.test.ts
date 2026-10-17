/**
 * T10 · Hồ sơ bé: story routes take `childProfileId`, read the child with the caller's
 * session (RLS = household only) and write for that child — before any quota or provider
 * call, so an unknown/foreign id costs nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { buildStoryPrompt } from "@/lib/story-ai";

const CHILD_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const STORY_ID = "33333333-3333-4333-8333-333333333333";

const fetchMock = vi.fn<typeof fetch>();
const rpc = vi.fn();
const childLookups: string[] = [];
const inserts: { table: string; row: unknown }[] = [];
let childError: { message: string } | null = null;

const NA = { id: CHILD_ID, display_name: "Na", birth_year: new Date().getFullYear() - 7, interests: ["Khủng long", "Vũ trụ"], created_at: "2026-01-01" };

function table(name: string) {
  const filters: Record<string, unknown> = {};
  const chain = {
    select: () => chain,
    eq: (col: string, value: unknown) => {
      filters[col] = value;
      return chain;
    },
    order: async () => ({ data: name === "story_pages" ? [{ page_number: 1, content: "[narrator]Ngày xưa có chú thỏ.[/narrator]", scene_description: "rừng" }] : [], error: null }),
    maybeSingle: async () => {
      if (name !== "child_profiles") return { data: null, error: null };
      childLookups.push(String(filters.id));
      if (childError) return { data: null, error: childError };
      return { data: filters.id === CHILD_ID ? NA : null, error: null };
    },
    single: async () =>
      name === "stories" ? { data: { id: STORY_ID, title: "Thỏ con", tags: [], page_count: 1 }, error: null } : { data: null, error: null },
    insert: (row: unknown) => {
      inserts.push({ table: name, row });
      const done = { error: null, select: () => ({ single: async () => ({ data: { id: "44444444-4444-4444-8444-444444444444" }, error: null }) }) };
      return Object.assign(Promise.resolve({ error: null }), done);
    },
  };
  return chain;
}
const from = vi.fn((name: string) => table(name));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "00000000-0000-4000-8000-000000000001" } } }) },
    rpc,
    from,
  })),
}));

vi.mock("@/lib/server-settings", () => ({
  getServiceClient: () => ({
    from: () => {
      const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: null, error: null }), insert: async () => ({ error: null }), update: () => ({ eq: async () => ({ error: null }) }) };
      return c;
    },
  }),
  getSystemSetting: vi.fn(async (k: string) => (k === "default_ai_provider" ? "gemini" : k === "default_ai_model" ? "gemini-2.0-flash" : "")),
  resolveApiKey: vi.fn(async () => "platform-key"),
  resolveCustomBaseUrl: vi.fn(async () => ""),
  resolveElevenLabsModel: vi.fn(async () => "eleven_multilingual_v2"),
  isSafePublicBaseUrl: vi.fn(async () => true),
}));

function post(body: unknown): NextRequest {
  return new Request("http://localhost/api/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const gemini = (payload: unknown) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }), { status: 200 });

function promptOf(call: number): string {
  const init = fetchMock.mock.calls[call]?.[1];
  return JSON.stringify(JSON.parse(String(init?.body ?? "{}")));
}

const consumed = () => rpc.mock.calls.filter(([name]) => name === "consume_usage");

beforeEach(() => {
  fetchMock.mockReset();
  rpc.mockReset();
  rpc.mockImplementation(async (name: string) =>
    name === "public_feature_flags"
      ? { data: { story_drawing: true, book_scan: true, expert_review: true, vocabulary_quiz: true, multilingual: true, ai_illustrations: true, child_push: true, ai_ambience: true }, error: null }
      : { data: { allowed: true }, error: null },
  );
  from.mockClear();
  childLookups.length = 0;
  inserts.length = 0;
  childError = null;
  vi.stubGlobal("fetch", fetchMock);
});

describe("buildStoryPrompt: sở thích của bé", () => {
  it("thêm dòng sở thích (dữ liệu thuần, không dấu ngoặc) khi có", () => {
    const prompt = buildStoryPrompt({ theme: "dongvat", childName: "Na", age: "6-8", language: "vi", interests: ["Khủng long", 'Vũ "trụ"'] });
    expect(prompt).toContain("cho bé Na");
    expect(prompt).toContain("Bé thích: Khủng long, Vũ trụ");
  });
  it("không có sở thích → không có dòng", () => {
    expect(buildStoryPrompt({ theme: "dongvat", childName: "Na", age: "6-8", language: "vi" })).not.toContain("Bé thích");
  });
});

describe("story/generate + childProfileId", () => {
  it("dùng tên + sở thích trong hồ sơ (đọc bằng phiên người dùng), không dùng tên client gửi", async () => {
    fetchMock.mockImplementation(async () => gemini({ title: "T", summary: "S", pages: [{ text: "a", sceneDescription: "b" }] }));
    const { POST } = await import("@/app/api/story/generate/route");
    const res = await POST(post({ theme: "dongvat", age: "6-8", persist: false, childName: "Bin", childProfileId: CHILD_ID }));
    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text())).toMatchObject({ title: "T" });
    expect(childLookups).toEqual([CHILD_ID]);
    const prompt = promptOf(0);
    expect(prompt).toContain("cho bé Na");
    expect(prompt).toContain("Bé thích: Khủng long, Vũ trụ");
    expect(prompt).not.toContain("Bin");
  });

  it("hồ sơ không thuộc gia đình (RLS trả rỗng) → 404, không trừ hạn mức, không gọi AI", async () => {
    const { POST } = await import("@/app/api/story/generate/route");
    const res = await POST(post({ theme: "dongvat", age: "6-8", childProfileId: OTHER_ID }));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "child_profile_not_found" });
    expect(consumed()).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lỗi đọc hồ sơ → 503, không trừ hạn mức", async () => {
    childError = { message: "boom" };
    const { POST } = await import("@/app/api/story/generate/route");
    const res = await POST(post({ theme: "dongvat", age: "6-8", childProfileId: CHILD_ID }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "child_profile_unavailable" });
    expect(consumed()).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("childProfileId sai định dạng → 400 invalid_body", async () => {
    const { POST } = await import("@/app/api/story/generate/route");
    const res = await POST(post({ theme: "dongvat", age: "6-8", childProfileId: "bé-na" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_body");
    expect(from).not.toHaveBeenCalled();
  });

  it("không gửi childProfileId → hành vi cũ (tên client gửi), không đọc hồ sơ", async () => {
    fetchMock.mockImplementation(async () => gemini({ title: "T", summary: "S", pages: [{ text: "a", sceneDescription: "b" }] }));
    const { POST } = await import("@/app/api/story/generate/route");
    const res = await POST(post({ theme: "dongvat", age: "3-5", persist: false, childName: "Bin" }));
    expect(res.status).toBe(200);
    await res.text();
    expect(childLookups).toEqual([]);
    expect(promptOf(0)).toContain("cho bé Bin");
  });
});

describe("story/personalize + childProfileId", () => {
  it("chỉ gửi childProfileId → dùng tên/tuổi/sở thích trong hồ sơ; bản lưu không có cột metadata", async () => {
    fetchMock.mockImplementation(async () => gemini({ title: "Na và thỏ con", pages: [{ text: "[narrator]Na gặp thỏ.[/narrator]", sceneDescription: "rừng" }] }));
    const { POST } = await import("@/app/api/story/personalize/route");
    const res = await POST(post({ storyId: STORY_ID, childProfileId: CHILD_ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ title: "Na và thỏ con" });
    const prompt = promptOf(0);
    expect(prompt).toContain("Tên bé: Na");
    expect(prompt).toContain("Tuổi: 7");
    expect(prompt).toContain("Khủng long, Vũ trụ");
    const saved = inserts.find((i) => i.table === "stories")?.row as Record<string, unknown>;
    expect(saved).toBeTruthy();
    expect(saved).not.toHaveProperty("metadata");
    expect(saved.tags).toEqual(["personalized"]);
  });

  it("không có tên lẫn hồ sơ → 400", async () => {
    const { POST } = await import("@/app/api/story/personalize/route");
    const res = await POST(post({ storyId: STORY_ID }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_body");
  });

  it("hồ sơ không tìm thấy → 404 trước khi trừ hạn mức", async () => {
    const { POST } = await import("@/app/api/story/personalize/route");
    const res = await POST(post({ storyId: STORY_ID, childProfileId: OTHER_ID }));
    expect(res.status).toBe(404);
    expect(consumed()).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("story/from-drawing + childProfileId", () => {
  it("hồ sơ không tìm thấy → 404 trước khi trừ hạn mức", async () => {
    const { POST } = await import("@/app/api/story/from-drawing/route");
    const res = await POST(post({ imageData: "data:image/png;base64,iVBORw0KGgo=", childProfileId: OTHER_ID }));
    expect(res.status).toBe(404);
    expect(consumed()).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dùng tên + nhóm tuổi của hồ sơ; bản lưu không có cột metadata", async () => {
    fetchMock
      .mockImplementationOnce(async () => gemini({ elements: ["khủng long"], scene: "đồi cỏ", mood: "vui", story_seed: "khủng long đi chơi" }))
      .mockImplementation(async () => gemini({ title: "Khủng long của Na", summary: "S", pages: [{ text: "[narrator]a[/narrator]", sceneDescription: "đồi" }] }));
    const { POST } = await import("@/app/api/story/from-drawing/route");
    const res = await POST(post({ imageData: "data:image/png;base64,iVBORw0KGgo=", childProfileId: CHILD_ID }));
    expect(res.status).toBe(200);
    const storyPrompt = promptOf(1);
    expect(storyPrompt).toContain("cho bé Na, 6-8 tuổi");
    expect(storyPrompt).toContain("Bé thích: Khủng long, Vũ trụ");
    const saved = inserts.find((i) => i.table === "stories")?.row as Record<string, unknown>;
    expect(saved).not.toHaveProperty("metadata");
    expect(saved).toMatchObject({ target_age_min: 6, target_age_max: 8, tags: ["from-drawing"] });
  });
});
