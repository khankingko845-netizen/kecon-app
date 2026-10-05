import { expect, test } from "@playwright/test";

/** API routes that call a paid AI/TTS provider: all must reject anonymous callers before doing anything. */
const PAID_JSON_ENDPOINTS: Array<[string, Record<string, unknown>]> = [
  ["/api/story/generate", { provider: "openai", theme: "dongvat", age: "4-6" }],
  ["/api/story/illustrate", { prompt: "a cute squirrel" }],
  ["/api/story/illustrate-batch", { storyId: "00000000-0000-0000-0000-000000000000" }],
  ["/api/story/expert-review", { content: "Ngày xưa…" }],
  ["/api/story/from-drawing", { image: "data:image/png;base64,AAAA" }],
  ["/api/story/personalize", { storyId: "00000000-0000-0000-0000-000000000000" }],
  ["/api/story/scan", { image: "data:image/png;base64,AAAA" }],
  ["/api/story/translate", { storyId: "00000000-0000-0000-0000-000000000000", targetLanguage: "en" }],
  ["/api/story/vocabulary", { storyId: "00000000-0000-0000-0000-000000000000" }],
  ["/api/voice/tts", { voiceId: "v1", text: "Xin chào" }],
  ["/api/voice/ambient", { prompt: "forest" }],
];

test.describe("API trả phí khi chưa đăng nhập", () => {
  for (const [path, body] of PAID_JSON_ENDPOINTS) {
    test(`POST ${path} → 401`, async ({ request }) => {
      const res = await request.post(path, { data: body });
      expect(res.status()).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    });
  }

  test("POST /api/voice/clone (multipart) → 401", async ({ request }) => {
    const res = await request.post("/api/voice/clone", {
      multipart: {
        name: "Mẹ",
        audio: { name: "sample.webm", mimeType: "audio/webm", buffer: Buffer.from("fake-audio") },
      },
    });
    expect(res.status()).toBe(401);
  });

  test("POST /api/admin/test-provider → 401", async ({ request }) => {
    const res = await request.post("/api/admin/test-provider", {
      data: { provider: "openai", apiKey: "sk-x" },
    });
    expect(res.status()).toBe(401);
  });
});

/**
 * A well-formed but forged Supabase session cookie. Routes must validate it with
 * Supabase (`auth.getUser()`), which fails here because no Supabase is running.
 * If a route trusted the cookie (`getSession()`), it would proceed past auth.
 */
function forgedSessionCookie() {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    aud: "authenticated",
    role: "authenticated",
    email: "attacker@example.com",
    app_metadata: { provider: "email" },
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const b64url = (s: string) => Buffer.from(s).toString("base64url");
  const accessToken = [
    b64url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    b64url(JSON.stringify({ sub: user.id, role: "authenticated", aud: "authenticated", exp: now + 3600 })),
    "forged-signature",
  ].join(".");
  const session = {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: "forged-refresh-token",
    user,
  };
  // @supabase/ssr storage key: sb-<first label of the Supabase hostname>-auth-token
  return `sb-127-auth-token=base64-${b64url(JSON.stringify(session))}`;
}

test.describe("Cookie phiên Supabase giả mạo", () => {
  for (const [path, body] of PAID_JSON_ENDPOINTS.filter(([p]) => p === "/api/story/generate" || p === "/api/voice/tts")) {
    test(`POST ${path} với cookie giả → 401`, async ({ request }) => {
      const res = await request.post(path, { data: body, headers: { cookie: forgedSessionCookie() } });
      expect(res.status()).toBe(401);
    });
  }
});
