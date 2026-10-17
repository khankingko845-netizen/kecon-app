import { describe, expect, it, vi } from "vitest";
import { adminAccess, parseAdminAccess } from "@/lib/admin-session";
import { requirePermission } from "@/lib/admin-permissions";
describe("A05 server state contract", () => {
  it("invalid response fails closed", () => {
    for (const v of [
      null,
      true,
      {},
      { state: "ready", requires_mfa: true, expires_at: "invalid" },
      { state: "bypass", requires_mfa: false },
    ])
      expect(parseAdminAccess(v).state).toBe("unavailable");
  });
  it("only ready carries valid expiry", () => {
    expect(
      parseAdminAccess({
        state: "ready",
        requires_mfa: true,
        expires_at: "2099-01-01T00:00:00Z",
      }).state,
    ).toBe("ready");
    expect(
      parseAdminAccess({
        state: "mfa_required",
        requires_mfa: true,
        expires_at: "2099-01-01",
      }).expires_at,
    ).toBeNull();
  });
  it("RPC error / network failure never grants access", async () => {
    for (const rpc of [
      vi.fn(async () => ({ error: "down" })),
      vi.fn(async () => {
        throw Error();
      }),
    ])
      expect((await adminAccess({ rpc } as never)).state).toBe("unavailable");
  });
  it.each(["mfa_required", "session_required", "session_expired"])(
    "API blocks %s",
    async (state) => {
      const rpc = vi.fn(async (name: string) => ({
        data:
          name === "has_permission"
            ? false
            : { state, requires_mfa: true, expires_at: null },
        error: null,
      }));
      const r = await requirePermission(
        {
          auth: { getUser: async () => ({ data: { user: { id: "x" } } }) },
          rpc,
        } as never,
        "secrets.manage",
      );
      expect(r?.status).toBe(403);
      expect(await r?.json()).toMatchObject({
        code:
          state === "mfa_required"
            ? "admin_mfa_required"
            : "admin_session_expired",
      });
    },
  );
  it("MFA is never a replacement for role permission", async () => {
    const rpc = vi.fn(async (name: string) => ({
      data:
        name === "has_permission"
          ? false
          : { state: "ready", requires_mfa: true, expires_at: "2099-01-01" },
      error: null,
    }));
    expect(
      await (
        await requirePermission(
          {
            auth: { getUser: async () => ({ data: { user: { id: "x" } } }) },
            rpc,
          } as never,
          "secrets.manage",
        )
      )?.json(),
    ).toMatchObject({ code: "missing_permission" });
  });
});
