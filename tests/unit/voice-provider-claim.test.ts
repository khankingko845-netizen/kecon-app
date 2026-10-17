import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ service: null as unknown }));
vi.mock("@/lib/server-settings", () => ({ getServiceClient: () => m.service }));
import {
  voiceClaimWriter,
  recordClonedVoice,
} from "@/lib/voice-provider-claim";
const db = (data: unknown, error: unknown = null) =>
  ({ rpc: vi.fn(async () => ({ data, error })) }) as unknown as SupabaseClient;
beforeEach(() => {
  m.service = db(true);
});
it("requires service writer and actor-bound household context before quota/provider work", async () => {
  const actor = db({
    household_id: "00000000-0000-4000-8000-000000000001",
    role: "owner",
  });
  expect(await voiceClaimWriter(actor)).toBe(m.service);
  expect(actor.rpc).toHaveBeenCalledWith("my_household_context");
  m.service = null;
  expect(await voiceClaimWriter(actor)).toBeNull();
  m.service = db(true);
  expect(await voiceClaimWriter(db(null, { message: "secret" }))).toBeNull();
  m.service = db(null, { message: "missing migration" });
  expect(await voiceClaimWriter(actor)).toBeNull();
});
it("registers only verified actor and provider-returned identity through service-only RPC", async () => {
  const service = db(true);
  expect(await recordClonedVoice(service, "verified", "created-id")).toBeNull();
  expect(service.rpc).toHaveBeenCalledWith("record_voice_provider_claim", {
    p_user: "verified",
    p_voice: "created-id",
  });
});
it("provider success with binding failure is pending, not a false ready success or automatic regenerate", async () => {
  const r = await recordClonedVoice(
    db(false, { message: "SECRET" }),
    "verified",
    "id",
  );
  expect(r?.status).toBe(503);
  const data = await r!.json();
  expect(data.code).toBe("voice_binding_pending");
  expect(data.error).not.toContain("SECRET");
});
