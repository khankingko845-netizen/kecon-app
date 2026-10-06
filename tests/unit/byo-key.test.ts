import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rejectByoKeyUnlessAllowed } from "@/lib/byo-key";

function fakeSupabase(role: string | null) {
  const maybeSingle = vi.fn(async () => ({ data: role ? { role } : null, error: null }));
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), maybeSingle };
  return { client: { from: vi.fn(() => chain) } as unknown as SupabaseClient, maybeSingle };
}

beforeEach(() => {
  vi.stubEnv("ALLOW_BYO_KEYS", "");
});

describe("rejectByoKeyUnlessAllowed (T05)", () => {
  it("không gửi key → cho qua, không cần tra DB", async () => {
    const { client, maybeSingle } = fakeSupabase("user");
    expect(await rejectByoKeyUnlessAllowed(client, "u1", undefined)).toBeNull();
    expect(await rejectByoKeyUnlessAllowed(client, "u1", "   ")).toBeNull();
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("user thường gửi key → 403 byo_key_disabled", async () => {
    const res = await rejectByoKeyUnlessAllowed(fakeSupabase("user").client, "u1", "sk-x");
    expect(res?.status).toBe(403);
    expect((await res!.json()).code).toBe("byo_key_disabled");
  });

  it("admin / super_admin được dùng key riêng", async () => {
    expect(await rejectByoKeyUnlessAllowed(fakeSupabase("admin").client, "u1", "sk-x")).toBeNull();
    expect(await rejectByoKeyUnlessAllowed(fakeSupabase("super_admin").client, "u1", "sk-x")).toBeNull();
  });

  it("ALLOW_BYO_KEYS=1 mở cho mọi người (self-host/dev)", async () => {
    vi.stubEnv("ALLOW_BYO_KEYS", "1");
    expect(await rejectByoKeyUnlessAllowed(fakeSupabase("user").client, "u1", "sk-x")).toBeNull();
  });
});
