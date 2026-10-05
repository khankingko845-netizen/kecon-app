import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { guardUsage } from "@/lib/usage-guard";

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };

function fakeSupabase(result: RpcResult) {
  const rpc = vi.fn(async () => result);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("USAGE_GUARD_FAIL_OPEN", "");
});

describe("guardUsage", () => {
  it("gọi RPC consume_usage với loại, số đơn vị và cờ BYO", async () => {
    const { client, rpc } = fakeSupabase({ data: { allowed: true }, error: null });

    await guardUsage(client, "tts", { byo: true, amount: 3 });
    await guardUsage(client, "story");

    expect(rpc).toHaveBeenNthCalledWith(1, "consume_usage", { p_kind: "tts", p_amount: 3, p_byo: true });
    expect(rpc).toHaveBeenNthCalledWith(2, "consume_usage", { p_kind: "story", p_amount: 1, p_byo: false });
  });

  it("trả về null khi được phép", async () => {
    const { client } = fakeSupabase({
      data: { allowed: true, plan: "free", used: 1, limit: 5 },
      error: null,
    });
    await expect(guardUsage(client, "story")).resolves.toBeNull();
  });

  it("rate_limited → 429 kèm Retry-After từ RPC", async () => {
    const { client } = fakeSupabase({
      data: { allowed: false, reason: "rate_limited", retry_after: 42 },
      error: null,
    });
    const res = await guardUsage(client, "tts");

    expect(res?.status).toBe(429);
    expect(res?.headers.get("Retry-After")).toBe("42");
    await expect(res?.json()).resolves.toMatchObject({ code: "rate_limited" });
  });

  it("rate_limited không có retry_after → Retry-After mặc định 60", async () => {
    const { client } = fakeSupabase({ data: { allowed: false, reason: "rate_limited" }, error: null });
    const res = await guardUsage(client, "illustration");
    expect(res?.status).toBe(429);
    expect(res?.headers.get("Retry-After")).toBe("60");
  });

  it("quota_exceeded → 402 kèm gói, số đã dùng và hạn mức", async () => {
    const { client } = fakeSupabase({
      data: { allowed: false, reason: "quota_exceeded", plan: "free", used: 5, limit: 5 },
      error: null,
    });
    const res = await guardUsage(client, "story");

    expect(res?.status).toBe(402);
    const body = await res?.json();
    expect(body).toMatchObject({ code: "quota_exceeded", plan: "free", used: 5, limit: 5 });
    expect(body.error).toContain("tạo truyện AI");
    expect(body.error).toContain("5/5");
  });

  it("unauthenticated → 401", async () => {
    const { client } = fakeSupabase({ data: { allowed: false, reason: "unauthenticated" }, error: null });
    const res = await guardUsage(client, "ai");
    expect(res?.status).toBe(401);
  });

  it("invalid_kind hoặc dữ liệu rỗng → 400 (fail-closed, không cho qua)", async () => {
    const invalid = fakeSupabase({ data: { allowed: false, reason: "invalid_kind" }, error: null });
    expect((await guardUsage(invalid.client, "ai"))?.status).toBe(400);

    const empty = fakeSupabase({ data: null, error: null });
    expect((await guardUsage(empty.client, "ai"))?.status).toBe(400);
  });

  it("lỗi RPC khác → 503 usage_check_failed, kể cả với BYO", async () => {
    const { client } = fakeSupabase({ data: null, error: { code: "57014", message: "statement timeout" } });

    for (const byo of [false, true]) {
      const res = await guardUsage(client, "story", { byo });
      expect(res?.status).toBe(503);
      await expect(res?.json()).resolves.toMatchObject({ code: "usage_check_failed" });
    }
  });

  describe("thiếu hàm consume_usage (chưa chạy migration 016)", () => {
    it.each(["PGRST202", "42883"])("%s + key nền tảng → 503 usage_guard_unavailable", async (code) => {
      const { client } = fakeSupabase({ data: null, error: { code, message: "function not found" } });
      const res = await guardUsage(client, "story");
      expect(res?.status).toBe(503);
      await expect(res?.json()).resolves.toMatchObject({ code: "usage_guard_unavailable" });
    });

    it.each(["PGRST202", "42883"])("%s + BYO key → cho qua", async (code) => {
      const { client } = fakeSupabase({ data: null, error: { code, message: "function not found" } });
      await expect(guardUsage(client, "story", { byo: true })).resolves.toBeNull();
    });

    it("USAGE_GUARD_FAIL_OPEN=1 → key nền tảng được cho qua", async () => {
      vi.stubEnv("USAGE_GUARD_FAIL_OPEN", "1");
      const { client } = fakeSupabase({ data: null, error: { code: "PGRST202", message: "function not found" } });
      await expect(guardUsage(client, "tts")).resolves.toBeNull();
    });

    it("USAGE_GUARD_FAIL_OPEN khác '1' (vd: 'true') → vẫn 503", async () => {
      vi.stubEnv("USAGE_GUARD_FAIL_OPEN", "true");
      const { client } = fakeSupabase({ data: null, error: { code: "PGRST202", message: "function not found" } });
      expect((await guardUsage(client, "tts"))?.status).toBe(503);
    });
  });
});
