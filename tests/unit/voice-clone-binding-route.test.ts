import { beforeEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({
  user: vi.fn(),
  userRpc: vi.fn(),
  writer: vi.fn(),
  serviceRpc: vi.fn(),
  quota: vi.fn(),
  clone: vi.fn(),
  deletions: vi.fn(),
  order: [] as string[],
}));
vi.mock("@/lib/ai-metering", () => ({
  withAiContext: (_f: string, fn: unknown) => fn,
  meteredFetch: () => vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: m.user }, rpc: m.userRpc }),
}));
vi.mock("@/lib/voice-provider-claim", () => ({ voiceClaimWriter: m.writer }));
vi.mock("@/lib/elevenlabs", () => ({ cloneVoice: m.clone }));
vi.mock("@/lib/usage-guard", () => ({ guardUsage: m.quota }));
vi.mock("@/lib/voice-deletion", () => ({ runVoiceDeletionsWithin: m.deletions }));
vi.mock("@/lib/key-pool", () => ({
  voiceKeyPool: {
    configured: async () => true,
    run: async (_p: string, fn: (k: string) => unknown) => fn("test-only-key"),
  },
  keyPoolErrorResponse: () => Response.json({ error: "failed" }, { status: 500 }),
}));
import { POST } from "@/app/api/voice/clone/route";

const CONSENT = "8d1f8f4e-7d0e-4b8c-9a39-2a3c1c0f5b11";
const request = (extra: Record<string, string> = {}, consent: string | null = CONSENT) => {
  const f = new FormData();
  f.set("name", "Test");
  f.set("language", "vi");
  f.set("audio", new Blob(["audio"], { type: "audio/webm" }), "qa.webm");
  f.set("userId", "forged-actor");
  if (consent) f.set("consentId", consent);
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return new NextRequest("https://test.local/api/voice/clone", { method: "POST", body: f });
};
beforeEach(() => {
  vi.clearAllMocks();
  m.order.length = 0;
  m.user.mockResolvedValue({ data: { user: { id: "verified-actor" } } });
  m.writer.mockResolvedValue({ rpc: m.serviceRpc });
  m.userRpc.mockImplementation(async (fn: string) => {
    m.order.push(fn);
    return { data: { ok: true, consent_id: CONSENT, household_id: "house-1" }, error: null };
  });
  m.serviceRpc.mockImplementation(async (fn: string) => {
    m.order.push(fn);
    return { data: { ok: true, consent_id: CONSENT }, error: null };
  });
  m.quota.mockImplementation(async () => {
    m.order.push("quota");
    return null;
  });
  m.clone.mockImplementation(async () => {
    m.order.push("provider");
    return { voice_id: "provider-created", name: "Test" };
  });
  m.deletions.mockResolvedValue({ done: 1, pending: 0, errors: 0 });
});

it("T12: no consentId → 403 voice_consent_missing before quota / provider", async () => {
  const r = await POST(request({}, null));
  expect(r.status).toBe(403);
  expect((await r.json()).code).toBe("voice_consent_missing");
  expect(m.quota).not.toHaveBeenCalled();
  expect(m.clone).not.toHaveBeenCalled();
});
it("T12: a personal ElevenLabs key is refused (the voice must stay deletable)", async () => {
  const r = await POST(request({ apiKey: "sk_personal_key_value" }));
  expect(r.status).toBe(400);
  expect((await r.json()).code).toBe("byo_clone_disabled");
  expect(m.clone).not.toHaveBeenCalled();
});
it("missing identity writer/migration blocks before quota/provider", async () => {
  m.writer.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(503);
  expect(m.quota).not.toHaveBeenCalled();
  expect(m.clone).not.toHaveBeenCalled();
});
it("T12: a consent that is not ready (withdrawn / used / expired) blocks before quota and provider", async () => {
  m.userRpc.mockResolvedValue({ data: { ok: false, reason: "withdrawn" }, error: null });
  const r = await POST(request());
  expect(r.status).toBe(403);
  expect((await r.json()).code).toBe("voice_consent_withdrawn");
  expect(m.quota).not.toHaveBeenCalled();
  expect(m.clone).not.toHaveBeenCalled();
});
it("T12: consent check failing → 503, nothing cloned", async () => {
  m.userRpc.mockResolvedValue({ data: null, error: { message: "down" } });
  const r = await POST(request());
  expect(r.status).toBe(503);
  expect(m.clone).not.toHaveBeenCalled();
});
it("binds the provider-returned ID to the verified actor + consent (never the form actor), after ready → quota → provider", async () => {
  const r = await POST(request());
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ voice_id: "provider-created", name: "Test" });
  expect(m.userRpc).toHaveBeenCalledWith("voice_consent_ready", { p_consent: CONSENT });
  expect(m.serviceRpc).toHaveBeenCalledWith("voice_consent_bind", { p_user: "verified-actor", p_consent: CONSENT, p_voice: "provider-created" });
  expect(m.order).toEqual(["voice_consent_ready", "quota", "provider", "voice_consent_bind"]);
  expect(m.clone).toHaveBeenCalledTimes(1);
  expect(m.deletions).not.toHaveBeenCalled();
});
it("failed receipt after provider success returns pending and never regenerates automatically", async () => {
  m.serviceRpc.mockResolvedValue({ data: null, error: { message: "db down" } });
  const r = await POST(request());
  expect(r.status).toBe(503);
  expect((await r.json()).code).toBe("voice_binding_pending");
  expect(m.clone).toHaveBeenCalledTimes(1);
});
it("T12: consent withdrawn while cloning → 409, the new voice is deleted right away", async () => {
  m.serviceRpc.mockResolvedValue({ data: { ok: false, reason: "withdrawn", job_id: "job-1" }, error: null });
  const r = await POST(request());
  expect(r.status).toBe(409);
  expect((await r.json()).code).toBe("voice_consent_withdrawn");
  expect(m.deletions).toHaveBeenCalledWith(5_000, { householdId: "house-1" });
  expect(m.clone).toHaveBeenCalledTimes(1);
});
