import { beforeEach, it, expect, vi } from "vitest";
import { CLOSED_FEATURE_FLAGS } from "@/lib/feature-flags";
const { rpc, getUser } = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc, auth: { getUser } })),
}));
import { GET } from "@/app/api/features/route";
beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset();
  vi.stubGlobal("fetch", vi.fn());
  getUser.mockResolvedValue({ data: { user: null } });
});
it("public capability read returns allowlisted booleans only, no provider/config/PII", async () => {
  rpc.mockResolvedValue({
    data: {
      ...CLOSED_FEATURE_FLAGS,
      gamification: true,
      apiKey: "not-public",
      childName: "not-public",
    },
    error: null,
  });
  const r = await GET();
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toContain("no-store");
  expect(await r.json()).toEqual({
    flags: { ...CLOSED_FEATURE_FLAGS, gamification: true },
    canAuthor: false,
    canManage: false,
  });
  expect(rpc.mock.calls.map((c) => c[0])).toEqual(["public_feature_flags"]);
  expect(fetch).not.toHaveBeenCalled();
});
it("signed-in family gets no authoring/manage capability and only read-only RPCs", async () => {
  getUser.mockResolvedValue({ data: { user: { id: "family" } } });
  rpc.mockImplementation(async (name: string) => ({
    data: name === "public_feature_flags" ? CLOSED_FEATURE_FLAGS : false,
    error: null,
  }));
  const body = await (await GET()).json();
  expect(body.canAuthor).toBe(false);
  expect(body.canManage).toBe(false);
  expect(rpc.mock.calls.map((c) => c[0])).toEqual([
    "public_feature_flags",
    "has_permission",
    "has_permission",
  ]);
  expect(fetch).not.toHaveBeenCalled();
});
it("authorized staff polling still performs no writes, audit spam or provider calls", async () => {
  getUser.mockResolvedValue({ data: { user: { id: "staff" } } });
  rpc.mockImplementation(async (name: string) => ({
    data: name === "public_feature_flags" ? CLOSED_FEATURE_FLAGS : true,
    error: null,
  }));
  const b = await (await GET()).json();
  expect(b.canAuthor).toBe(true);
  expect(b.canManage).toBe(true);
  expect(rpc.mock.calls.map((c) => c[0])).toEqual([
    "public_feature_flags",
    "has_permission",
    "has_permission",
  ]);
  expect(fetch).not.toHaveBeenCalled();
});
it("unavailable catalog fails closed and never exposes DB error text", async () => {
  rpc.mockResolvedValue({
    data: null,
    error: { message: "private-config-error" },
  });
  const r = await GET();
  expect(r.status).toBe(503);
  expect(await r.json()).toEqual({
    flags: CLOSED_FEATURE_FLAGS,
    canAuthor: false,
    canManage: false,
    error: "Feature flags unavailable",
  });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});
