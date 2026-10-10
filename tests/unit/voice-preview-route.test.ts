import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  permission: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  speech: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.user },
    from: mocks.from,
    rpc: mocks.rpc,
  }),
}));
vi.mock("@/lib/admin-permissions", () => ({ hasPermission: mocks.permission }));
vi.mock("@/lib/admin-audit", () => ({ auditAdmin: async () => null }));
vi.mock("@/lib/voice-synthesis", () => ({ synthesizeSpeech: mocks.speech }));
import { POST } from "@/app/api/voice/preview/route";
import { VOICE_PREVIEW_TEXT } from "@/lib/voice-preview";
const req = (body: unknown, headers = {}) =>
  new NextRequest("https://local/api/voice/preview", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
function rows(
  family: unknown[] = [],
  defaults: unknown[] = [],
  error: unknown = null,
) {
  const chain = (data: unknown[]) => {
    const q = {
      select: () => q,
      eq: vi.fn(() => q),
      limit: async () => ({ data, error }),
    };
    return q;
  };
  mocks.from.mockImplementation((table: string) =>
    chain(table === "voice_profiles" ? family : defaults),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: "owner" } } });
  mocks.permission.mockResolvedValue(false);
  mocks.speech.mockImplementation(
    async () =>
      new Response("audio", { headers: { "content-type": "audio/mpeg" } }),
  );
  rows();
  mocks.rpc.mockImplementation(async(name: string)=>({data:name==="authorize_tts_voice"?"unavailable":{multilingual:true},error:null}));
});
describe("voice preview boundary", () => {
  it("requires a session and rejects cross-site requests before synthesis", async () => {
    mocks.user.mockResolvedValue({ data: { user: null } });
    expect((await POST(req({ voiceId: "v", language: "vi" }))).status).toBe(
      401,
    );
    expect(
      (await POST(req({}, { "sec-fetch-site": "cross-site" }))).status,
    ).toBe(403);
    expect(mocks.speech).not.toHaveBeenCalled();
  });
  it("cannot supply arbitrary text, URL, model/key, unsupported language or malformed voice ID", async () => {
    for (const body of [
      { voiceId: "v", language: "vi", text: "personal data" },
      { voiceId: "v", language: "vi", apiKey: "secret" },
      { voiceId: "v", language: "vi", url: "http://127.0.0.1/" },
      { voiceId: "../bad", language: "vi" },
      { voiceId: "v", language: "de" },
    ])
      expect((await POST(req(body))).status).toBe(400);
    expect(mocks.speech).not.toHaveBeenCalled();
  });
  it("blocks uncurated/other-family voices for ordinary users", async () => {
    expect(
      (await POST(req({ voiceId: "privateOther", language: "vi" }))).status,
    ).toBe(403);
    expect(mocks.speech).not.toHaveBeenCalled();
  });
  it("permits an authorized active family sample or active curated choice, no cache", async () => {
    mocks.rpc.mockImplementation(async(name: string)=>({data:name==="authorize_tts_voice"?"allowed":{multilingual:true},error:null}));
    rows([{ id: "owned" }]);
    const r = await POST(req({ voiceId: "clone", language: "ja" }));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.speech.mock.calls[0][1]).toEqual({
      voiceId: "clone",
      language: "ja",
      text: VOICE_PREVIEW_TEXT.ja,
    });
    rows([], [{ id: "default" }]);
    expect(
      (await POST(req({ voiceId: "default", language: "en" }))).status,
    ).toBe(200);
  });
  it("admin may audition catalogue/manual/inactive voices; provider and quota errors propagate", async () => {
    mocks.permission.mockResolvedValue(true);
    mocks.rpc.mockImplementation(async(name: string)=>({data:name==="authorize_tts_voice"?"allowed":{multilingual:true},error:null}));
    mocks.speech.mockResolvedValue(
      Response.json({ error: "Hết hạn mức" }, { status: 402 }),
    );
    expect(
      (await POST(req({ voiceId: "fish:abc", language: "vi" }))).status,
    ).toBe(402);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("fails closed on authorization database errors", async () => {
    mocks.rpc.mockImplementation(async(name: string)=>name==="authorize_tts_voice"?{data:null,error:{message:"unavailable"}}:{data:{multilingual:true},error:null});
    expect((await POST(req({ voiceId: "v", language: "vi" }))).status).toBe(
      503,
    );
    expect(mocks.speech).not.toHaveBeenCalled();
  });
});
