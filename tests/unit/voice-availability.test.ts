import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { guardDisabledVoice } from "@/lib/voice-availability";
const db = (data: unknown, error: unknown = null) =>
  ({ rpc: vi.fn(async () => ({ data, error })) }) as unknown as SupabaseClient;
it("allows only a confirmed owned/default/catalog authorization", async () => {
  expect(
    await guardDisabledVoice(db("allowed"), "spoofed-actor", "voice"),
  ).toBeNull();
});
it("disabled and unknown/foreign voices fail closed without a legacy fallback", async () => {
  for (const data of ["disabled", "unavailable"]) {
    const r = await guardDisabledVoice(db(data), "owner", "v");
    expect(r?.status).toBe(403);
    expect((await r!.json()).code).toBe(
      data === "disabled" ? "voice_disabled" : "voice_unavailable",
    );
  }
});
it("RPC failure or malformed result is sanitized and never permitted", async () => {
  for (const d of [
    db("allowed", { message: "sk-private" }),
    db(null),
    db({ allowed: true }),
    db("admin"),
  ]) {
    const r = await guardDisabledVoice(d, "owner", "v");
    expect(r?.status).toBe(503);
    expect(await r!.text()).not.toContain("sk-private");
  }
});
it("scope is taken from JWT RPC, not the userId argument; locale is normalized", async () => {
  const d = db("allowed");
  await guardDisabledVoice(d, "foreign-actor", "voice", "vi-VN");
  expect(d.rpc).toHaveBeenCalledWith("authorize_tts_voice", {
    p_voice_id: "voice",
    p_locale: "vi",
  });
});
