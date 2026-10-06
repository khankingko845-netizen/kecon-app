/**
 * Route-level check (T04): every AI route rejects a malformed body with 400
 * before touching the database or any paid provider.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const fetchMock = vi.fn<typeof fetch>();
const rpc = vi.fn();
const from = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "00000000-0000-4000-8000-000000000001" } } }) },
    rpc,
    from,
  })),
}));

vi.mock("@/lib/server-settings", () => ({
  getSystemSetting: vi.fn(async () => ""),
  resolveApiKey: vi.fn(async () => "platform-key"),
  resolveCustomBaseUrl: vi.fn(async () => ""),
  resolveElevenLabsModel: vi.fn(async () => "eleven_multilingual_v2"),
  isSafePublicBaseUrl: vi.fn(async () => true),
}));

function post(body: unknown): NextRequest {
  return new Request("http://localhost/api/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  fetchMock.mockReset();
  rpc.mockReset();
  from.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

const cases: Array<{ name: string; load: () => Promise<{ POST: (r: NextRequest) => Promise<Response> }>; bad: unknown }> = [
  { name: "story/generate", load: () => import("@/app/api/story/generate/route"), bad: { theme: "", age: 5, extraPrompt: "x".repeat(5000) } },
  { name: "story/personalize", load: () => import("@/app/api/story/personalize/route"), bad: { storyId: "not-a-uuid", childName: "Bin" } },
  { name: "story/translate", load: () => import("@/app/api/story/translate/route"), bad: { storyId: "00000000-0000-4000-8000-000000000001", targetLanguage: "xx" } },
  { name: "story/vocabulary", load: () => import("@/app/api/story/vocabulary/route"), bad: {} },
  { name: "story/expert-review", load: () => import("@/app/api/story/expert-review/route"), bad: { storyContent: "x", experts: ["hacker"] } },
  { name: "story/from-drawing", load: () => import("@/app/api/story/from-drawing/route"), bad: { imageData: "https://evil.example.com/a.png" } },
  { name: "story/scan", load: () => import("@/app/api/story/scan/route"), bad: { images: [] } },
  { name: "story/illustrate", load: () => import("@/app/api/story/illustrate/route"), bad: { prompt: "x", size: "9999x9999" } },
  { name: "story/illustrate-batch", load: () => import("@/app/api/story/illustrate-batch/route"), bad: { storyId: "00000000-0000-4000-8000-000000000001", style: "evil" } },
  { name: "voice/tts", load: () => import("@/app/api/voice/tts/route"), bad: { voiceId: "abc", text: "x".repeat(10_001) } },
  { name: "voice/ambient", load: () => import("@/app/api/voice/ambient/route"), bad: { categoryId: "rain", duration: 600 } },
  { name: "push/subscribe", load: () => import("@/app/api/push/subscribe/route"), bad: { endpoint: "http://insecure.example.com" } },
];

describe("API routes: body sai schema → 400, không gọi provider/DB", () => {
  for (const c of cases) {
    it(c.name, async () => {
      const { POST } = await c.load();
      const res = await POST(post(c.bad));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_body");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
      expect(from).not.toHaveBeenCalled();
    });
  }

  it("JSON hỏng → 400 invalid_json", async () => {
    const { POST } = await import("@/app/api/story/generate/route");
    const res = await POST(post("{oops"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_json");
  });
});

describe("story/generate: body hợp lệ đi qua guard rồi gọi provider qua adapter chung", () => {
  it("Gemini key đi bằng header, không nằm trong URL", async () => {
    const settings = await import("@/lib/server-settings");
    vi.mocked(settings.getSystemSetting).mockImplementation(async (k: string) =>
      k === "default_story_provider" ? "gemini" : k === "default_ai_model" ? "gemini-2.0-flash" : ""
    );
    rpc.mockResolvedValue({ data: { allowed: true }, error: null });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ title: "T", summary: "S", pages: [{ text: "a", sceneDescription: "b" }] }) }] } }],
        }),
        { status: 200 }
      )
    );

    const { POST } = await import("@/app/api/story/generate/route");
    const res = await POST(post({ theme: "dongvat", age: "4-6", persist: false }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("consume_usage", { p_kind: "story", p_amount: 1, p_byo: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain("key=");
    expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("platform-key");
  });
});

describe("BYO key (T05)", () => {
  it("user thường gửi apiKey → 403 byo_key_disabled, không gọi provider/quota", async () => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: { role: "user" }, error: null })),
    };
    from.mockReturnValue(chain);

    const { POST } = await import("@/app/api/story/generate/route");
    const res = await POST(post({ theme: "dongvat", age: "4-6", apiKey: "sk-user", provider: "openai" }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("byo_key_disabled");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
