import { beforeEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({
  user: vi.fn(),
  writer: vi.fn(),
  record: vi.fn(),
  quota: vi.fn(),
  clone: vi.fn(),
}));
vi.mock("@/lib/ai-metering", () => ({
  withAiContext: (_f: string, fn: unknown) => fn,
  meteredFetch: () => vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: m.user } }),
}));
vi.mock("@/lib/voice-provider-claim", () => ({
  voiceClaimWriter: m.writer,
  recordClonedVoice: m.record,
}));
vi.mock("@/lib/elevenlabs", () => ({ cloneVoice: m.clone }));
vi.mock("@/lib/usage-guard", () => ({ guardUsage: m.quota }));
vi.mock("@/lib/byo-key", () => ({
  rejectByoKeyUnlessAllowed: async () => null,
}));
vi.mock("@/lib/key-pool", () => ({
  voiceKeyPool: {
    configured: async () => true,
    run: async (_p: string, fn: (k: string) => unknown) => fn("test-only-key"),
  },
  keyPoolErrorResponse: () =>
    Response.json({ error: "failed" }, { status: 500 }),
}));
import { POST } from "@/app/api/voice/clone/route";
const request = () => {
  const f = new FormData();
  f.set("name", "Test");
  f.set("language", "vi");
  f.set("audio", new Blob(["audio"], { type: "audio/webm" }), "qa.webm");
  f.set("userId", "forged-actor");
  return new NextRequest("https://test.local/api/voice/clone", {
    method: "POST",
    body: f,
  });
};
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ data: { user: { id: "verified-actor" } } });
  m.writer.mockResolvedValue({ rpc: "service" });
  m.quota.mockResolvedValue(null);
  m.clone.mockResolvedValue({ voice_id: "provider-created" });
  m.record.mockResolvedValue(null);
});
it("missing identity writer/migration blocks before quota/provider", async () => {
  m.writer.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(503);
  expect(m.quota).not.toHaveBeenCalled();
  expect(m.clone).not.toHaveBeenCalled();
});
it("binds provider-returned ID to verified actor, never form actor, before reporting ready", async () => {
  const r = await POST(request());
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ voice_id: "provider-created" });
  expect(m.record).toHaveBeenCalledWith(
    { rpc: "service" },
    "verified-actor",
    "provider-created",
  );
  expect(m.clone).toHaveBeenCalledTimes(1);
});
it("failed receipt after provider success returns pending and never regenerates automatically", async () => {
  m.record.mockResolvedValue(
    Response.json({ code: "voice_binding_pending" }, { status: 503 }),
  );
  const r = await POST(request());
  expect(r.status).toBe(503);
  expect((await r.json()).code).toBe("voice_binding_pending");
  expect(m.clone).toHaveBeenCalledTimes(1);
});
