import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
const permission = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-permissions", () => ({ hasPermission: permission }));
import { guardDisabledVoice } from "@/lib/voice-availability";
const db = (family: unknown[], defaults: unknown[], error: unknown = null) =>
  ({
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({
            data: table === "voice_profiles" ? family : defaults,
            error,
          }).then(resolve),
      };
      return q;
    },
  }) as unknown as SupabaseClient;
beforeEach(() => permission.mockResolvedValue(false));
describe("new TTS honours activation", () => {
  it("rejects inactive remembered/character/default/family voice", async () => {
    for (const d of [
      db([{ is_active: false }], []),
      db([], [{ is_active: false }]),
    ]) {
      const r = await guardDisabledVoice(d, "owner", "v", "vi");
      expect(r?.status).toBe(403);
      expect((await r!.json()).code).toBe("voice_disabled");
    }
  });
  it("active owned clone or active default remains available", async () => {
    expect(
      await guardDisabledVoice(
        db([{ is_active: true }], [{ is_active: false }]),
        "owner",
        "v",
      ),
    ).toBeNull();
    expect(await guardDisabledVoice(db([], []), "owner", "legacy")).toBeNull();
  });
  it("admin can audition inactive voices, error fails closed", async () => {
    permission.mockResolvedValue(true);
    expect(
      await guardDisabledVoice(db([], [{ is_active: false }]), "owner", "v"),
    ).toBeNull();
    expect(
      (await guardDisabledVoice(db([], [], { message: "bad" }), "owner", "v"))
        ?.status,
    ).toBe(503);
  });
});
