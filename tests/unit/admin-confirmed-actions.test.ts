import { beforeEach, describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  user: true,
  allowed: true,
  access: "ready",
  payload: null as unknown,
  dbCode: null as string | null,
  headers: {} as Record<string, string>,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: state.user
            ? { id: "00000000-0000-4000-8000-000000000001" }
            : null,
        },
      }),
    },
    rpc: (name: string, payload: unknown) => {
      if (name === "has_permission")
        return { data: state.allowed, error: null };
      if (name === "admin_access_status")
        return {
          data: {
            state: state.access,
            requires_mfa: true,
            expires_at:
              state.access === "ready"
                ? new Date(Date.now() + 60000).toISOString()
                : null,
          },
          error: null,
        };
      state.payload = payload;
      const result = Promise.resolve({
        data: state.dbCode ? null : 1,
        error: state.dbCode ? { code: state.dbCode } : null,
      });
      return Object.assign(result, {
        setHeader: (name: string, value: string) => {
          state.headers[name] = value;
          return result;
        },
      });
    },
  }),
}));
import { POST } from "@/app/api/admin/confirmed-action/route";
const valid = {
  action: "category.delete",
  ids: ["qa-category"],
  reason: "Xoá cấu hình kiểm thử an toàn",
};
const request = (body: unknown) =>
  new Request("https://kecon.test/api/admin/confirmed-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  Object.assign(state, {
    user: true,
    allowed: true,
    access: "ready",
    payload: null,
    dbCode: null,
    headers: {},
  });
});
describe("confirmed-action public API seam", () => {
  it("requires auth before parsing", async () => {
    state.user = false;
    expect((await POST(request(valid))).status).toBe(401);
    expect(state.payload).toBeNull();
  });
  it("rejects missing/short reason, duplicate IDs and spoofed actor", async () => {
    for (const body of [
      { ...valid, reason: "" },
      { ...valid, ids: ["qa-category", "qa-category"] },
      { ...valid, actor_id: "fake" },
      { ...valid, action: "role.change", role: "root" },
    ]) {
      expect((await POST(request(body))).status).toBe(400);
      expect(state.payload).toBeNull();
    }
  });
  it("preserves missing permission denial", async () => {
    state.allowed = false;
    const r = await POST(request(valid));
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("missing_permission");
    expect(state.payload).toBeNull();
  });
  it("expired MFA lease cannot run the RPC", async () => {
    state.allowed = false;
    state.access = "session_expired";
    const r = await POST(request(valid));
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("admin_session_expired");
    expect(state.payload).toBeNull();
  });
  it("sends only confirmed targets/reason to caller-scoped RPC", async () => {
    const r = await POST(request(valid));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ changed: 1 });
    expect(state.payload).toEqual({
      p_action: "category.delete",
      p_ids: ["qa-category"],
      p_reason: "Xoá cấu hình kiểm thử an toàn",
      p_role: null,
    });
  });
  it("maps stale target conflict to 409 without internal error details", async () => {
    state.dbCode = "40001";
    const r = await POST(request(valid));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({
      error: "Đối tượng đã thay đổi hoặc không có quyền. Tải lại để thử lại.",
    });
  });
});

it("forwards edge IP/user agent into the same atomic audit transaction", async () => {
  await POST(
    new Request("https://kecon.test/api/admin/confirmed-action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "203.0.113.15",
        "user-agent": "QA audit browser",
      },
      body: JSON.stringify(valid),
    }),
  );
  expect(state.headers).toEqual({
    "x-forwarded-for": "203.0.113.15",
    "user-agent": "QA audit browser",
  });
});
