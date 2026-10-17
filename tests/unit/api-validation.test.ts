import { describe, expect, it } from "vitest";
import { z } from "zod";
import { imageData, llmSelectionFields, modelId, optionalText, parseJsonBody, parseValue } from "@/lib/api-validation";

function req(body: string) {
  return new Request("http://localhost/api/x", { method: "POST", body, headers: { "Content-Type": "application/json" } });
}

const Schema = z.object({ ...llmSelectionFields, name: z.string().min(1) });

describe("parseJsonBody", () => {
  it("body hợp lệ → data đã chuẩn hoá ('' / null → undefined)", async () => {
    const r = await parseJsonBody(req(JSON.stringify({ name: "Bin", apiKey: "", baseUrl: null, model: " gpt-4o " })), Schema);
    expect(r.ok && r.data).toEqual({ name: "Bin", apiKey: undefined, baseUrl: undefined, model: "gpt-4o" });
  });

  it("JSON hỏng → 400 invalid_json", async () => {
    const r = await parseJsonBody(req("{not json"), Schema);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(400);
      expect((await r.response.json()).code).toBe("invalid_json");
    }
  });

  it("sai schema → 400 invalid_body kèm đường dẫn field", async () => {
    const r = await parseJsonBody(req(JSON.stringify({ name: "", provider: "evil" })), Schema);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const body = await r.response.json();
      expect(r.response.status).toBe(400);
      expect(body.code).toBe("invalid_body");
      expect(body.issues.map((i: { path: string }) => i.path).sort()).toEqual(["name", "provider"]);
    }
  });
});

describe("field schemas", () => {
  it("optionalText cắt khoảng trắng và giới hạn độ dài", () => {
    expect(optionalText(5).parse("  ab ")).toBe("ab");
    expect(optionalText(5).safeParse("123456").success).toBe(false);
  });

  it("modelId từ chối khoảng trắng / ký tự URL", () => {
    expect(modelId.parse("models/gemini-2.0-flash")).toBe("models/gemini-2.0-flash");
    expect(modelId.safeParse("gpt-4o?x=1").success).toBe(false);
    expect(modelId.safeParse("a b").success).toBe(false);
  });

  it("baseUrl phải là URL", () => {
    expect(parseValue({ name: "x", baseUrl: "not a url" }, Schema).ok).toBe(false);
    expect(parseValue({ name: "x", baseUrl: "https://llm.example.com/v1" }, Schema).ok).toBe(true);
  });

  it("imageData nhận data URL ảnh hoặc base64, từ chối URL http", () => {
    expect(imageData.safeParse("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg").success).toBe(true);
    expect(imageData.safeParse("iVBORw0KGgoAAAANSUhEUgAAAA").success).toBe(true);
    expect(imageData.safeParse("https://evil.example.com/a.png").success).toBe(false);
    expect(imageData.safeParse("data:text/html;base64,PHNjcmlwdD4=").success).toBe(false);
  });
});
