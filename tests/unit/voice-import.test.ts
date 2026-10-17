import { vi, beforeEach, it, expect } from "vitest";
const m = vi.hoisted(() => ({ run: vi.fn(), lookup: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/key-pool", () => ({ voiceKeyPool: { run: m.run } }));
vi.mock("@/lib/voice-catalog", () => ({ fetchVoiceById: m.lookup }));
vi.mock("@/lib/elevenlabs", () => ({ elevenFetch: m.fetch }));
import { ProviderHttpError } from "@/lib/provider-keys";
import { importLibraryVoice } from "@/lib/voice-import";
beforeEach(() => {
  vi.clearAllMocks();
  m.run.mockImplementation(async (_p, op) => op("hidden"));
});
it("does not add again when voice is already available", async () => {
  m.lookup.mockResolvedValue({ voice_id: "original", name: "Vi" });
  await importLibraryVoice("original", "owner", "Vi");
  expect(m.fetch).not.toHaveBeenCalled();
});
it("imports on chosen account and binds RETURNED id, not original library id", async () => {
  m.lookup
    .mockRejectedValueOnce(new ProviderHttpError("elevenlabs",400,"voice_not_found","missing"))
    .mockResolvedValueOnce({ voice_id: "returnedNew", name: "Vi" });
  m.fetch.mockResolvedValue(Response.json({ voice_id: "returnedNew" }));
  const result = await importLibraryVoice("original", "owner", "Vi");
  expect(result.voice_id).toBe("returnedNew");
  expect(m.fetch.mock.calls[0][0]).toBe("/voices/add/owner/original");
  expect(m.run.mock.calls[0][2].bindVoiceFrom(result)).toBe("returnedNew");
});

it("does not import on transient or permission lookup errors",async()=>{m.lookup.mockRejectedValueOnce(new ProviderHttpError("elevenlabs",503,"server_error","busy"));await expect(importLibraryVoice("original","owner","Vi")).rejects.toThrow("busy");expect(m.fetch).not.toHaveBeenCalled();});
