import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateStory } from "@/lib/story-ai";

const params = { theme: "dongvat", childName: "Bin", age: "4-6", language: "vi" };
const story = {
  title: "Sóc Nhỏ tìm hạt dẻ",
  summary: "Sóc học cách chia sẻ.",
  characters: [{ name: "Sóc Nhỏ", description: "tinh nghịch", personality: "vui", emoji: "🐿️" }],
  pages: [{ text: "[narrator]Ngày xưa…[/narrator]", sceneDescription: "Khu rừng" }],
};

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const openAIReply = (content: string) => jsonResponse({ choices: [{ message: { content } }] });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("generateStory", () => {
  it("OpenAI: gọi chat/completions với Bearer key và trả truyện đã parse", async () => {
    fetchMock.mockResolvedValue(openAIReply(JSON.stringify(story)));

    await expect(generateStory("openai", "sk-test", "gpt-4o-mini", params)).resolves.toEqual(story);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(String(init?.body)).model).toBe("gpt-4o-mini");
  });

  it("chấp nhận JSON bọc trong markdown fence / có chữ thừa", async () => {
    fetchMock.mockResolvedValue(openAIReply("Đây là truyện:\n```json\n" + JSON.stringify(story) + "\n```"));
    await expect(generateStory("openai", "k", "m", params)).resolves.toMatchObject({ title: story.title });
  });

  it("custom: bắt buộc baseUrl", async () => {
    await expect(generateStory("custom", "k", "m", params)).rejects.toThrow("Thiếu Base URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("custom: bỏ '/' cuối baseUrl và không follow redirect (chống SSRF)", async () => {
    fetchMock.mockResolvedValue(openAIReply(JSON.stringify(story)));
    await generateStory("custom", "k", "llama", params, "https://llm.example.com/v1//");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://llm.example.com/v1/chat/completions");
    expect(init?.redirect).toBe("error");
  });

  it("Gemini và Anthropic: đọc nội dung từ đúng vị trí trong response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(story) }] } }] })
    );
    await expect(generateStory("gemini", "g-key", "gemini-2.0-flash", params)).resolves.toEqual(story);
    expect(String(fetchMock.mock.calls[0][0])).toContain("models/gemini-2.0-flash:generateContent");

    fetchMock.mockResolvedValueOnce(jsonResponse({ content: [{ text: JSON.stringify(story) }] }));
    await expect(generateStory("anthropic", "a-key", "claude", params)).resolves.toEqual(story);
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.anthropic.com/v1/messages");
  });

  it("provider lỗi → ném lỗi với message của provider", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: "Invalid API key" } }, 401));
    await expect(generateStory("openai", "bad", "m", params)).rejects.toThrow("Invalid API key");
  });

  it("response không có JSON → 'Invalid JSON response from AI'", async () => {
    fetchMock.mockResolvedValue(openAIReply("Xin lỗi, tôi không thể viết truyện này."));
    await expect(generateStory("openai", "k", "m", params)).rejects.toThrow("Invalid JSON response from AI");
  });

  it("JSON thiếu title/pages → 'Story format invalid'", async () => {
    fetchMock.mockResolvedValue(openAIReply(JSON.stringify({ title: "X", pages: "không phải mảng" })));
    await expect(generateStory("openai", "k", "m", params)).rejects.toThrow("Story format invalid");
  });

  it("content không phải chuỗi → lỗi định dạng provider", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [] }));
    await expect(generateStory("openai", "k", "m", params)).rejects.toThrow("định dạng không hợp lệ");
  });
});
