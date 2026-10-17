import { describe, expect, it, vi } from "vitest";
import {
  buildLlmHttpRequest,
  callLlm,
  callLlmJson,
  extractJsonObject,
  LlmError,
  normalizeImage,
  parseLlmResponse,
  type FetchLike,
  type LlmRequest,
} from "@/lib/llm";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Fake provider adapter: records the request and returns a canned reply. */
function fakeFetch(reply: Response | (() => Response)) {
  const calls: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
  const impl: FetchLike = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {}, body: JSON.parse(String(init?.body ?? "{}")) });
    return typeof reply === "function" ? reply() : reply;
  });
  return { impl, calls };
}

const base: Omit<LlmRequest, "provider"> = {
  apiKey: "secret-key",
  model: "m-1",
  system: "SYS",
  prompt: "Xin chào",
};

describe("buildLlmHttpRequest", () => {
  it("OpenAI: Bearer key, system + user, json mode, không follow redirect", () => {
    const { url, init } = buildLlmHttpRequest({ ...base, provider: "openai", json: true, temperature: 0.5 });
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
    expect(init.redirect).toBe("error");
    const body = JSON.parse(String(init.body));
    expect(body.messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "Xin chào" },
    ]);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.temperature).toBe(0.5);
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("custom: dùng baseUrl (bỏ '/' cuối); thiếu baseUrl → lỗi", () => {
    const { url } = buildLlmHttpRequest({ ...base, provider: "custom", baseUrl: "https://llm.example.com/v1//" });
    expect(url).toBe("https://llm.example.com/v1/chat/completions");
    expect(() => buildLlmHttpRequest({ ...base, provider: "custom" })).toThrow(LlmError);
  });

  it("Gemini: key nằm trong header x-goog-api-key, KHÔNG nằm trong URL", () => {
    const { url, init } = buildLlmHttpRequest({ ...base, provider: "gemini", model: "gemini-2.0-flash", json: true });
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent");
    expect(url).not.toContain("secret-key");
    expect(url).not.toContain("key=");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key");
    const body = JSON.parse(String(init.body));
    expect(body.system_instruction).toEqual({ parts: [{ text: "SYS" }] });
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("Gemini: model được encode, không chèn được path/query", () => {
    const { url } = buildLlmHttpRequest({ ...base, provider: "gemini", model: "x?key=evil/../y" });
    expect(url).toContain("models/x%3Fkey%3Devil%2F..%2Fy:generateContent");
  });

  it("Anthropic: x-api-key + version, mặc định max_tokens 4096, không có header browser-access", () => {
    const { url, init } = buildLlmHttpRequest({ ...base, provider: "anthropic" });
    const headers = init.headers as Record<string, string>;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(headers["x-api-key"]).toBe("secret-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers).not.toHaveProperty("anthropic-dangerous-direct-browser-access");
    const body = JSON.parse(String(init.body));
    expect(body.max_tokens).toBe(4096);
    expect(body.system).toBe("SYS");
  });

  it("ảnh: data URL được chuyển đúng định dạng của từng provider", () => {
    const images = [{ data: "data:image/jpeg;base64,QUJD" }];
    const openai = JSON.parse(String(buildLlmHttpRequest({ ...base, provider: "openai", images, imageDetail: "low" }).init.body));
    expect(openai.messages[1].content[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,QUJD", detail: "low" },
    });
    const gemini = JSON.parse(String(buildLlmHttpRequest({ ...base, provider: "gemini", images }).init.body));
    expect(gemini.contents[0].parts[1]).toEqual({ inline_data: { mime_type: "image/jpeg", data: "QUJD" } });
    const anthropic = JSON.parse(String(buildLlmHttpRequest({ ...base, provider: "anthropic", images }).init.body));
    expect(anthropic.messages[0].content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "QUJD" },
    });
  });
});

describe("normalizeImage", () => {
  it("raw base64 dùng mimeType truyền vào hoặc image/png", () => {
    expect(normalizeImage({ data: "QUJD" })).toEqual({ mimeType: "image/png", base64: "QUJD" });
    expect(normalizeImage({ data: "QUJD", mimeType: "image/jpeg" })).toEqual({ mimeType: "image/jpeg", base64: "QUJD" });
  });
});

describe("parseLlmResponse", () => {
  it("đọc text + usage của từng provider", () => {
    expect(
      parseLlmResponse("openai", { choices: [{ message: { content: "a" } }], usage: { prompt_tokens: 3, completion_tokens: 4 } })
    ).toEqual({ text: "a", usage: { inputTokens: 3, outputTokens: 4 } });
    expect(
      parseLlmResponse("gemini", {
        candidates: [{ content: { parts: [{ text: "b" }, { text: "c" }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 6 },
      })
    ).toEqual({ text: "bc", usage: { inputTokens: 5, outputTokens: 6 } });
    expect(
      parseLlmResponse("anthropic", { content: [{ type: "text", text: "d" }], usage: { input_tokens: 1, output_tokens: 2 } })
    ).toEqual({ text: "d", usage: { inputTokens: 1, outputTokens: 2 } });
  });

  it("response sai định dạng → LlmError thay vì TypeError", () => {
    expect(() => parseLlmResponse("gemini", { candidates: [] })).toThrow("định dạng không hợp lệ");
    expect(() => parseLlmResponse("anthropic", {})).toThrow(LlmError);
  });
});

describe("callLlm", () => {
  it("gọi đúng adapter và trả text/usage", async () => {
    const { impl, calls } = fakeFetch(jsonResponse({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 2 } }));
    const result = await callLlm({ ...base, provider: "openai" }, impl);
    expect(result).toEqual({ text: "ok", usage: { inputTokens: 1, outputTokens: 2 }, provider: "openai", model: "m-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("provider trả lỗi → LlmError mang status + message của provider", async () => {
    const { impl } = fakeFetch(jsonResponse({ error: { message: "Invalid API key" } }, 401));
    const err = await callLlm({ ...base, provider: "anthropic" }, impl).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.message).toBe("Invalid API key");
    expect(err.status).toBe(401);
  });

  it("lỗi mạng / timeout → thông báo thân thiện, không lộ key", async () => {
    const impl: FetchLike = async () => {
      throw Object.assign(new Error("boom secret-key"), { name: "TimeoutError" });
    };
    const err = await callLlm({ ...base, provider: "openai" }, impl).catch((e) => e);
    expect(err.message).toBe("AI phản hồi quá lâu, vui lòng thử lại");
    expect(err.message).not.toContain("secret-key");
  });

  it("callLlmJson: bật json mode và parse object", async () => {
    const { impl, calls } = fakeFetch(jsonResponse({ choices: [{ message: { content: '```json\n{"a":1}\n```' } }] }));
    const { data } = await callLlmJson({ ...base, provider: "openai" }, impl);
    expect(data).toEqual({ a: 1 });
    expect(calls[0].body.response_format).toEqual({ type: "json_object" });
  });
});

describe("extractJsonObject", () => {
  it("chịu được chữ thừa quanh JSON", () => {
    expect(extractJsonObject('Đây: {"x": {"y": 2}} hết')).toEqual({ x: { y: 2 } });
  });
  it("không có JSON / JSON hỏng → LlmError", () => {
    expect(() => extractJsonObject("không có gì")).toThrow("AI không trả về JSON hợp lệ");
    expect(() => extractJsonObject("{ hỏng }")).toThrow(LlmError);
  });
});
