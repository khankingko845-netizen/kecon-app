import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({
  user: vi.fn(),
  rpc: vi.fn(),
  service: null as unknown,
  upload: vi.fn(),
  remove: vi.fn(),
  serviceRpc: vi.fn(),
  run: vi.fn(),
  runWithin: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: m.user }, rpc: m.rpc }) }));
vi.mock("@/lib/server-settings", () => ({ getServiceClient: () => m.service }));
vi.mock("@/lib/voice-deletion", () => ({ runVoiceDeletions: m.run, runVoiceDeletionsWithin: m.runWithin }));
import { POST as consentPOST } from "@/app/api/voice/consent/route";
import { POST as withdrawPOST } from "@/app/api/voice/consent/withdraw/route";
import { POST as internalPOST } from "@/app/api/internal/voice-deletions/route";
import {
  consentSentence,
  normalizeSpeakerName,
  RERECORD_REASONS,
  sniffConsentAudio,
  speakerNameValid,
  voiceConsentMessage,
} from "@/lib/voice-consent";

const DOC = "0f0e9a52-1d55-4c4f-8d2e-8b2f8e1d2a10";
const CONSENT = "6b8c1f0e-3f53-4d1c-9a2a-1b9c8d7e6f50";
const HASH = "a".repeat(64);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42]);

function consentRequest(fields: Record<string, string | Blob> = {}) {
  const f = new FormData();
  f.set("documentId", DOC);
  f.set("bodySha256", HASH);
  f.set("speakerName", "  Bà   Lan ");
  f.set("durationMs", "6200");
  f.set("audio", new Blob([WEBM], { type: "video/webm" }), "consent");
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return new NextRequest("https://test.local/api/voice/consent", { method: "POST", body: f, headers: { "user-agent": "UA-test" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ data: { user: { id: "parent-1" } } });
  m.upload.mockResolvedValue({ error: null });
  m.remove.mockResolvedValue({ error: null });
  m.serviceRpc.mockResolvedValue({ data: true, error: null });
  m.service = { storage: { from: () => ({ upload: m.upload, remove: m.remove }) }, rpc: m.serviceRpc };
  m.rpc.mockResolvedValue({
    data: { ok: true, consent_id: CONSENT, audio_path: `h1/${CONSENT}.webm`, recorded_at: "2026-10-17T05:00:00Z", version: 1, spoken_text: "Tôi là Bà Lan. …" },
    error: null,
  });
  m.runWithin.mockResolvedValue({ done: 1, pending: 0, errors: 0 });
});

describe("POST /api/voice/consent", () => {
  it("stores the record as the parent, then the bytes (sniffed type, server SHA-256) privately, then attaches", async () => {
    const r = await consentPOST(consentRequest());
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body).toMatchObject({ ok: true, consentId: CONSENT, speakerName: "Bà Lan", version: 1 });
    const [fn, args] = m.rpc.mock.calls[0];
    expect(fn).toBe("voice_consent_begin");
    expect(args).toMatchObject({ p_document: DOC, p_body_sha256: HASH, p_audio_mime: "audio/webm", p_audio_bytes: WEBM.length, p_duration_ms: 6200, p_proof: null, p_user_agent: "UA-test" });
    expect(args.p_audio_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.upload).toHaveBeenCalledWith(`h1/${CONSENT}.webm`, expect.anything(), { contentType: "audio/webm", upsert: false });
    expect(m.serviceRpc).toHaveBeenCalledWith("voice_consent_attach_audio", { p_consent: CONSENT, p_path: `h1/${CONSENT}.webm` });
  });
  it("bytes that are not audio are refused before any record", async () => {
    const r = await consentPOST(consentRequest({ audio: new Blob(["<html>not audio</html>"], { type: "audio/webm" }) }));
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe("voice_consent_invalid_audio");
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("too short / too long durations and bad speaker names are refused", async () => {
    for (const [fields, code] of [
      [{ durationMs: "900" }, "voice_consent_invalid_audio"],
      [{ durationMs: "61000" }, "voice_consent_invalid_audio"],
      [{ speakerName: "" }, "voice_consent_invalid_speaker"],
    ] as const) {
      const r = await consentPOST(consentRequest(fields));
      expect((await r.json()).code).toBe(code);
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("more than 5 MB is refused while streaming (413)", async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 200 * 1024);
    big.set(WEBM);
    const r = await consentPOST(consentRequest({ audio: new Blob([big], { type: "audio/webm" }) }));
    expect(r.status).toBe(413);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("PIN families without a valid proof: 403 parent_proof_required, nothing uploaded", async () => {
    m.rpc.mockResolvedValue({ data: { ok: false, reason: "parent_proof_required" }, error: null });
    const r = await consentPOST(consentRequest());
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("voice_consent_parent_proof_required");
    expect(m.upload).not.toHaveBeenCalled();
  });
  it("upload or attach failure removes the file and discards the record (503)", async () => {
    m.serviceRpc.mockImplementation(async (fn: string) => ({ data: fn === "voice_consent_attach_audio" ? false : true, error: null }));
    const r = await consentPOST(consentRequest());
    expect(r.status).toBe(503);
    expect(m.remove).toHaveBeenCalledWith([`h1/${CONSENT}.webm`]);
    expect(m.serviceRpc).toHaveBeenCalledWith("voice_consent_discard", { p_consent: CONSENT });
  });
  it("signed out → 401; cross-site → 403", async () => {
    m.user.mockResolvedValueOnce({ data: { user: null } });
    expect((await consentPOST(consentRequest())).status).toBe(401);
    const req = consentRequest();
    req.headers.set("sec-fetch-site", "cross-site");
    expect((await consentPOST(req)).status).toBe(403);
  });
});

describe("POST /api/voice/consent/withdraw", () => {
  const withdraw = (body: unknown) =>
    new NextRequest("https://test.local/api/voice/consent/withdraw", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  it("withdraws through the RPC (caller's RLS), then starts the household's deletion right away", async () => {
    m.rpc.mockResolvedValue({ data: { ok: true, withdrawn: true, profiles_deleted: 1, household_id: "h1", deadline_at: "2026-10-18T05:00:00Z" }, error: null });
    const r = await withdrawPOST(withdraw({ consentId: CONSENT, proof: null }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, withdrawn: true, profilesDeleted: 1, deadlineAt: "2026-10-18T05:00:00Z", deletion: { done: 1, pending: 0 } });
    expect(m.rpc).toHaveBeenCalledWith("voice_consent_withdraw", { p_consent: CONSENT, p_profile: null, p_proof: null });
    expect(m.runWithin).toHaveBeenCalledWith(8_000, { householdId: "h1" });
  });
  it("PIN required → 403 with the reason; nothing runs", async () => {
    m.rpc.mockResolvedValue({ data: { ok: false, reason: "parent_proof_required" }, error: null });
    const r = await withdrawPOST(withdraw({ profileId: CONSENT }));
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("voice_consent_parent_proof_required");
    expect(m.runWithin).not.toHaveBeenCalled();
  });
  it("neither consent nor profile, or unknown fields → 400", async () => {
    expect((await withdrawPOST(withdraw({}))).status).toBe(400);
    expect((await withdrawPOST(withdraw({ consentId: CONSENT, userId: "x" }))).status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/internal/voice-deletions", () => {
  const KEY = "service-role-key-for-tests-0123456789";
  const call = (auth?: string) =>
    internalPOST(new NextRequest("https://test.local/api/internal/voice-deletions", { method: "POST", headers: auth ? { authorization: auth } : {} }));
  it("only the service-role bearer runs the worker", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", KEY);
    m.run.mockResolvedValue({ expired: 0, claimed: 1, done: 1, pending: 0, errors: 0, overdue: 0 });
    expect((await call()).status).toBe(401);
    expect((await call(`Bearer ${KEY}x`)).status).toBe(401);
    expect((await call("Bearer short")).status).toBe(401);
    expect(m.run).not.toHaveBeenCalled();
    const ok = await call(`Bearer ${KEY}`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, done: 1, overdue: 0 });
    expect(m.run).toHaveBeenCalledWith({ limit: 50 });
    vi.unstubAllEnvs();
  });
  it("no key configured → never authorized", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect((await call("Bearer ")).status).toBe(401);
    vi.unstubAllEnvs();
  });
});

describe("voice-consent helpers", () => {
  it("sniffs the real container from magic bytes", () => {
    expect(sniffConsentAudio(WEBM)).toBe("audio/webm");
    expect(sniffConsentAudio(new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]))).toBe("audio/mp4");
    expect(sniffConsentAudio(new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("audio/ogg");
    expect(sniffConsentAudio(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBe("audio/wav");
    expect(sniffConsentAudio(new TextEncoder().encode("<!doctype html><p>"))).toBeNull();
    expect(sniffConsentAudio(new Uint8Array([0x1a, 0x45]))).toBeNull();
  });
  it("speaker names: single spaces, 1–60 chars, no markup / control characters", () => {
    expect(normalizeSpeakerName("  Bà \n Lan ")).toBe("Bà Lan");
    expect(speakerNameValid("Bà Lan")).toBe(true);
    for (const bad of ["", "   ", "x".repeat(61), "Bà {ten}", "<b>", "a\u0007b"]) expect(speakerNameValid(bad)).toBe(false);
  });
  it("the sentence carries the speaker's name; reasons map to Vietnamese messages", () => {
    expect(consentSentence("Tôi là {ten}. Tôi đồng ý.", " Bà  Lan")).toBe("Tôi là Bà Lan. Tôi đồng ý.");
    expect(voiceConsentMessage("expired")).toMatch(/24 giờ/);
    expect(voiceConsentMessage("something-new")).toBe(voiceConsentMessage("unavailable"));
    expect(RERECORD_REASONS.has("used")).toBe(true);
    expect(RERECORD_REASONS.has("rate_limited")).toBe(false);
  });
});
