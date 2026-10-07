import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/lib/elevenlabs", () => ({ elevenFetch: vi.fn() }));
import { elevenFetch } from "@/lib/elevenlabs";
import { catalogVoice, fetchVoiceCatalog, fetchVoiceById } from "@/lib/voice-catalog";
const fetcher = vi.mocked(elevenFetch);
beforeEach(() => {
  fetcher.mockReset();
});
describe("catalogue metadata and partial failure", () => {
  it("normalizes native + verified languages without guessing English", () => {
    expect(
      catalogVoice(
        {
          voice_id: "1",
          name: "Professional",
          category: "professional",
          labels: { language: "English" },
          verified_languages: [{ language: "Vietnamese", locale: "vi-VN" }],
        } as never,
        "own",
      ).languages,
    ).toEqual(["en", "vi"]);
    expect(
      catalogVoice({ voice_id: "2", name: "Unknown" }, "own").languages,
    ).toEqual([]);
    expect(
      catalogVoice({ voice_id: "3", name: "Library" }, "library")
        .languages,
    ).toEqual([]);
  });
  it("keeps account voices and reports library failure without credentials", async () => {
    fetcher.mockImplementation(async (path) => {
      if (path === "/voices")
        return Response.json({
          voices: [
            {
              voice_id: "1",
              name: "Voice",
              category: "generated",
              labels: { language: "vi" },
            },
          ],
        });
      throw Error("raw secret must stay private");
    });
    const result = await fetchVoiceCatalog("hidden-key", "vi");
    expect(result.voices).toHaveLength(1);
    expect(result.warnings[0]).toContain("vi");
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("deduplicates IDs and merges supported language metadata", async () => {
    fetcher.mockImplementation(async (path) =>
      Response.json({
        voices: [
          path === "/voices"
            ? { voice_id: "1", name: "Own", labels: { language: "vi" } }
            : { voice_id: "1", name: "Library", labels: { language: "en" } },
        ],
      }),
    );
    const result = await fetchVoiceCatalog("key", "en");
    expect(result.voices).toHaveLength(1);
    expect(result.voices[0]).toMatchObject({
      source: "own",
      name: "Own",
      languages: ["vi", "en"],
    });
  });
});

it("server search forwards name and page, but does not label unknown results as Vietnamese",async()=>{
 fetcher.mockImplementation(async path=>Response.json({voices:path==="/voices"?[]:[{voice_id:"u",name:"Unknown"}],has_more:path!=="/voices"}));
 const r=await fetchVoiceCatalog("key","vi","Some name",3);
 expect(fetcher.mock.calls[1][0]).toContain("search=Some+name");expect(fetcher.mock.calls[1][0]).toContain("page=3");expect(r.hasMore).toBe(true);expect(r.voices[0].languages).toEqual([]);
});
it("exact ID lookup is not limited to the first catalog page",async()=>{fetcher.mockResolvedValue(Response.json({voice_id:"exact",name:"Own",labels:{language:"vi"}}));const r=await fetchVoiceById("key","exact");expect(fetcher.mock.calls[0][0]).toBe("/voices/exact");expect(r.language).toBe("vi");});
