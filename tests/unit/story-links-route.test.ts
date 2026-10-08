import { beforeEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn(), anon: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: m.user }, rpc: m.rpc }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (...a: unknown[]) => {
    m.anon(...a);
    return { rpc: m.rpc };
  },
}));
import { POST, GET, DELETE } from "@/app/api/share/links/route";
import { POST as resolve } from "@/app/api/share/resolve/route";
import { GET as legacy } from "@/app/api/share/[token]/route";
import { storyLinkUrl } from "@/lib/story-links";
const id = "00000000-0000-4000-8000-00000000a001",
  token = "a".repeat(64);
const issued = {
  id,
  story_id: id,
  share_token: token,
  expires_at: "2026-12-31T00:00:00+00:00",
  is_active: true,
  view_count: 0,
};
const request = (
  body: unknown = {},
  headers: Record<string, string> = {},
  method = "POST",
) =>
  new NextRequest("https://test.local/api/share/links?storyId=" + id, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ data: { user: { id: "verified" } } });
  m.rpc.mockResolvedValue({ data: issued, error: null });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon";
});
it("unauth issue/list/revoke stopped before RPC", async () => {
  m.user.mockResolvedValue({ data: { user: null } });
  for (const [fn, r] of [
    [POST, request({ storyId: id })],
    [DELETE, request({ id }, {}, "DELETE")],
    [GET, request({}, {}, "GET")],
  ] as const) {
    const res = await fn(r);
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toContain("no-store");
  }
  expect(m.rpc).not.toHaveBeenCalled();
});
it.each(["sec-fetch-site", "origin"])(
  "cross-site %s mutation rejected before auth/RPC",
  async (key) => {
    const headers: Record<string, string> = {
      [key]: key === "origin" ? "https://evil.test" : "cross-site",
    };
    expect((await POST(request({ storyId: id }, headers))).status).toBe(403);
    expect(m.user).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  },
);
it.each([
  { storyId: id, hours: 0 },
  { storyId: id, userId: "foreign" },
  { storyId: "bad" },
  { id, household_id: "foreign" },
])("bad or forged body fails before RPC", async (body) => {
  expect((await POST(request(body))).status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("issue uses only server actor RPC and returns exact schema/no-store", async () => {
  const r = await POST(request({ storyId: id, hours: 24 }));
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual(issued);
  expect(m.rpc).toHaveBeenCalledWith("issue_platform_story_link", {
    p_story: id,
    p_hours: 24,
  });
  expect(r.headers.get("referrer-policy")).toBe("no-referrer");
});
it.each([
  ["42501", 403],
  ["54000", 429],
  ["XX000", 503],
])("RPC %s is bounded %i without diagnostics", async (code, status) => {
  m.rpc.mockResolvedValue({
    data: null,
    error: { code, message: "sk-PRIVATE" },
  });
  const r = await POST(request({ storyId: id }));
  expect(r.status).toBe(status);
  expect(await r.text()).not.toContain("sk-PRIVATE");
});
it("malformed issue result fails closed", async () => {
  m.rpc.mockResolvedValue({
    data: { ...issued, secret: "private" },
    error: null,
  });
  const r = await POST(request({ storyId: id }));
  expect(r.status).toBe(503);
  expect(await r.text()).not.toContain("private");
});
it("foreign revoke has generic 404; owned revoke acknowledges only true", async () => {
  for (const [data, status] of [
    [false, 404],
    [true, 200],
    [null, 503],
  ]) {
    m.rpc.mockResolvedValue({ data, error: null });
    expect((await DELETE(request({ id }, {}, "DELETE"))).status).toBe(status);
  }
});
it("metadata cannot expose raw token or hash", async () => {
  m.rpc.mockResolvedValue({
    data: [
      {
        id,
        expires_at: issued.expires_at,
        is_active: true,
        view_count: 1,
        token_hash: "secret",
      },
    ],
    error: null,
  });
  const r = await GET(request({}, {}, "GET"));
  expect(r.status).toBe(503);
  expect(await r.text()).not.toContain("secret");
});
it("resolver uses anon empty cookies and a single bounded RPC, strips no extra private fields", async () => {
  m.rpc.mockResolvedValue({
    data: {
      story: { id, title: "Story", description: null },
      pages: [{ page_number: 1, content: "Text" }],
    },
    error: null,
  });
  const r = await resolve(request({ token }));
  expect(r.status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith("resolve_platform_story_link", {
    p_token: token,
  });
  expect(m.anon.mock.calls[0][1]).toBe("public-anon");
  expect(m.anon.mock.calls[0][2].cookies.getAll()).toEqual([]);
  expect(m.user).not.toHaveBeenCalled();
});
it("expired/unknown/revoked is same generic 404; legacy always 410 with no lookup", async () => {
  m.rpc.mockResolvedValue({ data: null, error: null });
  expect((await resolve(request({ token }))).status).toBe(404);
  vi.clearAllMocks();
  expect((await legacy()).status).toBe(410);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("raw token is fragment, not URL query/path; bad token cannot be rendered into a link", () => {
  expect(storyLinkUrl("https://test.local", token)).toBe(
    "https://test.local/share#" + token,
  );
  expect(() => storyLinkUrl("https://test.local", "../bad")).toThrow();
});
