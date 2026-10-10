import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { getParentPinStatus, pinErrorMessage, setParentPin, verifyParentPin } from "@/lib/parent-pin";

function fakeSupabase(data: unknown, error: unknown = null) {
  const rpc = vi.fn(async () => ({ data, error }));
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("parent-pin (T03)", () => {
  it("setParentPin: PIN sai định dạng bị chặn ở client, không gọi RPC", async () => {
    const { client, rpc } = fakeSupabase({ ok: true });
    expect(await setParentPin(client, "12")).toEqual({ ok: false, reason: "invalid_format" });
    expect(await setParentPin(client, "12ab")).toEqual({ ok: false, reason: "invalid_format" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("setParentPin: gửi PIN thô cho RPC (hash ở server), không tự mã hoá", async () => {
    const { client, rpc } = fakeSupabase({ ok: true });
    await setParentPin(client, "1234", "9876");
    expect(rpc).toHaveBeenCalledWith("set_parent_pin", { p_new_pin: "1234", p_current_pin: "9876" });
  });

  it("verifyParentPin: map kết quả khoá", async () => {
    const lockedUntil = "2030-01-01T00:15:00.000Z";
    const { client } = fakeSupabase({ ok: false, reason: "locked", locked_until: lockedUntil });
    expect(await verifyParentPin(client, "0000")).toEqual({
      ok: false,
      reason: "locked",
      attemptsLeft: undefined,
      lockedUntil: new Date(lockedUntil),
    });
  });

  it("lỗi RPC (vd. chưa chạy migration 017) → unavailable, không coi là đúng PIN", async () => {
    const { client } = fakeSupabase(null, { code: "PGRST202", message: "not found" });
    expect(await verifyParentPin(client, "1234")).toEqual({ ok: false, reason: "unavailable" });
    expect(await getParentPinStatus(client)).toBeNull();
  });

  it("getParentPinStatus: map trạng thái", async () => {
    const { client } = fakeSupabase({ ok: true, has_pin: true, reset_required: false, locked_until: null });
    expect(await getParentPinStatus(client)).toEqual({ hasPin: true, resetRequired: false, lockedUntil: null });
  });

  it("pinErrorMessage: thông báo tiếng Việt cho phụ huynh", () => {
    const now = new Date("2030-01-01T00:00:00Z");
    expect(pinErrorMessage({ ok: false, reason: "invalid", attemptsLeft: 2 })).toContain("Còn 2 lần thử");
    expect(pinErrorMessage({ ok: false, reason: "locked", lockedUntil: new Date("2030-01-01T00:14:10Z") }, now)).toContain(
      "15 phút"
    );
    expect(pinErrorMessage({ ok: false, reason: "invalid_format" })).toContain("4–6 chữ số");
    expect(pinErrorMessage({ ok: false, reason: "unavailable" })).toContain("thử lại");
  });
});
