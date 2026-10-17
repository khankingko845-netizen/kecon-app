import { expect, it, vi } from "vitest";
import { fishBillingUsage, fishSubmittedText } from "@/lib/tts-billing";
import { fishTextToSpeech } from "@/lib/fishaudio";

it.each(["Hello", "Bé Thỏ đi ngủ.", "Bé".normalize("NFD"), "🐻 🚗", " [whisper] Bé [cười] ơi! ", "水 và gió"])("counts exact submitted UTF-8 text, not JS characters or JSON bytes: %s", async (text) => {
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    expect(body.text).toBe(fishSubmittedText(text));
    expect(fishBillingUsage(text)).toEqual({ units: Buffer.byteLength(body.text, "utf8"), billingUnit: "utf8_bytes", usageVersion: 2 });
    expect(body.normalize).toBe(true);
    expect(body.mp3_bitrate).toBe(128);
    return new Response(new Uint8Array([1, 2, 3]));
  });
  await fishTextToSpeech("test-fake-key", "test-voice", text, { model: "s2.1-pro", fetchImpl });
  expect(fetchImpl).toHaveBeenCalledOnce();
});
it("does not silently normalize display spelling or remove supported future text", () => {
  expect(fishSubmittedText("Bé".normalize("NFD"))).toBe("Bé".normalize("NFD"));
  expect(fishBillingUsage("Bé").units).not.toBe(fishBillingUsage("Bé".normalize("NFD")).units);
  expect(fishSubmittedText("[not-a-control] Bé")).toBe("[not-a-control] Bé");
  expect(fishBillingUsage(" [whisper] ").units).toBe(0);
});
