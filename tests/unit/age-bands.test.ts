import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGE_BANDS, DEFAULT_AGE_BAND, getAgeBand, normalizeAgeBand } from "@/lib/age-bands";
import { generateStory } from "@/lib/story-ai";

describe("age bands (UI-13)", () => {
  it("3 nhóm tuổi liên tục 3–12, mặc định 3–5", () => {
    expect(AGE_BANDS.map((b) => b.id)).toEqual(["3-5", "6-8", "9-12"]);
    expect(DEFAULT_AGE_BAND).toBe("3-5");
    for (let i = 1; i < AGE_BANDS.length; i++) {
      expect(AGE_BANDS[i].min).toBe(AGE_BANDS[i - 1].max + 1);
    }
  });

  it.each([
    [undefined, "3-5"],
    [null, "3-5"],
    ["", "3-5"],
    ["abc", "3-5"],
    ["3-5", "3-5"],
    ["6-8", "6-8"],
    ["9-12", "9-12"],
    // giá trị cũ của bản trước
    ["2-3", "3-5"],
    ["4-6", "3-5"],
    ["7-9", "6-8"],
    ["10+", "9-12"],
    // tuổi đơn lẻ (profile.child_age)
    [4, "3-5"],
    ["6", "6-8"],
    [8, "6-8"],
    [11, "9-12"],
  ])("normalizeAgeBand(%j) → %s", (input, expected) => {
    expect(normalizeAgeBand(input as string | number | null | undefined)).toBe(expected);
  });

  it("getAgeBand trả về cấu hình đầy đủ", () => {
    const band = getAgeBand("7-9");
    expect(band.label).toBe("6–8 tuổi");
    expect(band.pages[0]).toBeLessThan(band.pages[1]);
  });
});

describe("prompt tạo truyện theo nhóm tuổi", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const story = {
    title: "T",
    summary: "S",
    characters: [],
    pages: [{ text: "[narrator]x[/narrator]", sceneDescription: "y" }],
  };

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(story) } }] }), {
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  async function promptFor(age: string): Promise<string> {
    await generateStory("openai", "k", "m", { theme: "dongvat", childName: "", age, language: "vi" });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    return body.messages.map((m: { content: string }) => m.content).join("\n");
  }

  it("3–5 tuổi: truyện ngắn 6–8 trang, câu ngắn", async () => {
    const prompt = await promptFor("3-5");
    expect(prompt).toContain("Phong cách theo độ tuổi (3–5 tuổi)");
    expect(prompt).toContain("(6-8 trang)");
  });

  it("9–12 tuổi: truyện dài hơn", async () => {
    const prompt = await promptFor("10+");
    expect(prompt).toContain("(9–12 tuổi)");
    expect(prompt).toContain("(10-12 trang)");
  });
});
