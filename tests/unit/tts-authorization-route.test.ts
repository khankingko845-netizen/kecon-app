import { beforeEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn(), speech: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: m.user }, rpc: m.rpc }),
}));
vi.mock("@/lib/ai-metering", () => ({
  withAiContext: (_feature: string, fn: unknown) => fn,
}));
vi.mock("@/lib/byo-key", () => ({
  rejectByoKeyUnlessAllowed: async () => null,
}));
vi.mock("@/lib/voice-synthesis", () => ({ synthesizeSpeech: m.speech }));
import { POST } from "@/app/api/voice/tts/route";
const req = (extra = {}) =>
  new NextRequest("https://test.local/api/voice/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      voiceId: "privateOther",
      text: "Xin chào",
      language: "vi",
      ...extra,
    }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ data: { user: { id: "verified-actor" } } });
  m.rpc.mockResolvedValue({ data: "allowed", error: null });
  m.speech.mockResolvedValue(new Response("audio"));
});
it("unauthenticated requests cannot reach authorization/key/quota/provider", async () => {
  m.user.mockResolvedValue({ data: { user: null } });
  expect((await POST(req())).status).toBe(401);
  expect(m.rpc).not.toHaveBeenCalled();
  expect(m.speech).not.toHaveBeenCalled();
});
it.each(["unavailable", "disabled"])(
  "%s voice cannot reach synthesis (quota/key/provider)",
  async (state) => {
    m.rpc.mockResolvedValue({ data: state, error: null });
    expect((await POST(req())).status).toBe(403);
    expect(m.speech).not.toHaveBeenCalled();
  },
);
it("RPC timeout/malformed result is fail-closed with sanitized detail", async () => {
  for (const result of [
    { data: "allowed", error: { message: "sk-PRIVATE" } },
    { data: null, error: null },
  ]) {
    m.rpc.mockResolvedValue(result);
    const r = await POST(req());
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain("sk-PRIVATE");
    expect(m.speech).not.toHaveBeenCalled();
  }
});
it("client household/user fields cannot influence authorization actor; allowed identity reaches shared synthesis only once", async () => {
  expect(
    (await POST(req({ userId: "other", household_id: "foreign" }))).status,
  ).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith("authorize_tts_voice", {
    p_voice_id: "privateOther",
    p_locale: "vi",
  });
  expect(m.speech).toHaveBeenCalledTimes(1);
  expect(m.speech.mock.calls[0][1]).not.toHaveProperty("household_id");
});
it("bad input is rejected before authorization", async () => {
  expect((await POST(req({ voiceId: "../bad" }))).status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
  expect(m.speech).not.toHaveBeenCalled();
});
