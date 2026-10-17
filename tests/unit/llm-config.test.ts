import { beforeEach, describe, expect, it, vi } from "vitest";

const settings: Record<string, string> = {};
const keys: Record<string, string> = {};

vi.mock("@/lib/server-settings", () => ({
  getSystemSetting: vi.fn(async (key: string) => settings[key] ?? ""),
  resolveApiKey: vi.fn(async (provider: string, userKey?: string) => userKey || keys[provider] || ""),
  resolveCustomBaseUrl: vi.fn(async (userUrl?: string, userKey?: string) =>
    userUrl && userKey ? (userUrl.includes("internal") ? "" : userUrl) : settings.custom_provider_url ?? ""
  ),
}));

const { resolveLlmTarget, defaultModelFor } = await import("@/lib/llm-config");

beforeEach(() => {
  for (const k of Object.keys(settings)) delete settings[k];
  for (const k of Object.keys(keys)) delete keys[k];
});

describe("resolveLlmTarget — key nền tảng", () => {
  it("bỏ qua provider client gửi, dùng provider mặc định của admin", async () => {
    settings.default_ai_provider = "gemini"; // Cài Đặt Hệ Thống → AI Provider
    settings.default_ai_model = "gemini-2.0-flash";
    keys.gemini = "platform-gemini";
    keys.openai = "platform-openai";

    const r = await resolveLlmTarget({ provider: "openai", model: "gpt-4o" });
    expect(r.ok && r.target).toEqual({ provider: "gemini", model: "gemini-2.0-flash", apiKey: "platform-gemini", baseUrl: undefined });
    expect(r.ok && r.byo).toBe(false);
  });

  it("chỉ cho chọn model trong danh mục của provider; model lạ → model mặc định", async () => {
    keys.openai = "platform";
    settings.default_ai_model = "gpt-4o-mini";

    const allowed = await resolveLlmTarget({ model: "gpt-4.1" });
    expect(allowed.ok && allowed.target.model).toBe("gpt-4.1");

    const expensive = await resolveLlmTarget({ model: "o1-pro" });
    expect(expensive.ok && expensive.target.model).toBe("gpt-4o-mini");
  });

  it("không dùng baseUrl của client khi không có key riêng", async () => {
    settings.default_ai_provider = "custom";
    settings.default_ai_model = "llama-3";
    settings.custom_provider_url = "https://admin-llm.example.com/v1";
    keys.custom = "platform-custom";

    const r = await resolveLlmTarget({ baseUrl: "https://attacker.example.com" });
    expect(r.ok && r.target.baseUrl).toBe("https://admin-llm.example.com/v1");
    expect(r.ok && r.target.model).toBe("llama-3");
  });

  it("đọc đúng cài đặt màn admin lưu (default_ai_provider); tên cũ default_story_provider chỉ là dự phòng", async () => {
    keys.custom = "platform-custom";
    keys.anthropic = "platform-claude";
    settings.custom_provider_url = "https://api.cometapi.com/v1";
    settings.default_ai_provider = "custom";
    settings.default_story_provider = "anthropic";
    const r = await resolveLlmTarget();
    expect(r.ok && r.target.provider).toBe("custom");
    expect(r.ok && r.target.baseUrl).toBe("https://api.cometapi.com/v1");

    delete settings.default_ai_provider;
    const legacy = await resolveLlmTarget();
    expect(legacy.ok && legacy.target.provider).toBe("anthropic");
  });

  it("chưa cấu hình key → 400", async () => {
    const r = await resolveLlmTarget();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(400);
  });

  it("provider admin không hợp lệ → về openai", async () => {
    settings.default_ai_provider = "nonsense";
    keys.openai = "k";
    const r = await resolveLlmTarget();
    expect(r.ok && r.target.provider).toBe("openai");
  });
});

describe("resolveLlmTarget — BYO key", () => {
  it("tôn trọng provider/model/baseUrl của client", async () => {
    const r = await resolveLlmTarget({
      apiKey: "user-key",
      provider: "custom",
      model: "my-model",
      baseUrl: "https://my-llm.example.com/v1",
    });
    expect(r.ok && r.target).toEqual({
      provider: "custom",
      model: "my-model",
      apiKey: "user-key",
      baseUrl: "https://my-llm.example.com/v1",
    });
    expect(r.ok && r.byo).toBe(true);
  });

  it("baseUrl nội bộ → 400", async () => {
    const r = await resolveLlmTarget({ apiKey: "k", provider: "custom", baseUrl: "https://internal.local" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(400);
  });

  it("provider lạ → 400", async () => {
    const r = await resolveLlmTarget({ apiKey: "k", provider: "evil" });
    expect(r.ok).toBe(false);
  });

  it("key toàn khoảng trắng coi như không có key", async () => {
    keys.openai = "platform";
    const r = await resolveLlmTarget({ apiKey: "   ", provider: "anthropic" });
    expect(r.ok && r.byo).toBe(false);
    expect(r.ok && r.target.provider).toBe("openai");
  });
});

describe("defaultModelFor", () => {
  it("dùng model admin nếu khớp provider, nếu không lấy model đầu danh mục", () => {
    expect(defaultModelFor("openai", "gpt-4o", "openai")).toBe("gpt-4o");
    expect(defaultModelFor("gemini", "gpt-4o", "openai")).toBe("gemini-2.0-flash");
    expect(defaultModelFor("anthropic", "", "openai")).toBe("claude-sonnet-4-20250514");
    expect(defaultModelFor("custom", "llama", "custom")).toBe("llama");
  });
});
