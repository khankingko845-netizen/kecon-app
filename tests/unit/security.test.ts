import { describe, expect, it } from "vitest";
import { readPersistedSettings, serializeSettings } from "@/lib/settings-storage";

const defaults = { language: "vi", storyApiKey: "", elevenLabsApiKey: "", storyProvider: "openai" };

describe("settings-storage (T05): API key không bao giờ nằm trong localStorage", () => {
  it("serializeSettings bỏ mọi key", () => {
    const json = serializeSettings({ ...defaults, storyApiKey: "sk-secret", elevenLabsApiKey: "el-secret" });
    expect(json).not.toContain("secret");
    expect(JSON.parse(json)).toEqual({ language: "vi", storyProvider: "openai" });
  });

  it("đọc dữ liệu cũ có key → bỏ key và báo hadSecrets để ghi đè storage", () => {
    const raw = JSON.stringify({ language: "en", storyApiKey: "sk-old", elevenLabsApiKey: "el-old" });
    const { settings, hadSecrets } = readPersistedSettings(raw, defaults);
    expect(hadSecrets).toBe(true);
    expect(settings).toEqual({ ...defaults, language: "en" });
  });

  it("dữ liệu hỏng / rỗng → mặc định", () => {
    expect(readPersistedSettings("{oops", defaults)).toEqual({ settings: defaults, hadSecrets: false });
    expect(readPersistedSettings(null, defaults)).toEqual({ settings: defaults, hadSecrets: false });
    expect(readPersistedSettings("[1,2]", defaults)).toEqual({ settings: defaults, hadSecrets: false });
  });
});

describe("security headers (T05)", () => {
  it("CSP chặn gọi provider trực tiếp từ trình duyệt và chặn nhúng iframe", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
    const { default: config } = await import("../../next.config");
    const rules = await config.headers!();
    const headers = Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]));
    const csp = headers["Content-Security-Policy"];

    const connect = csp.split("; ").find((d) => d.startsWith("connect-src"))!;
    expect(connect).toContain("'self'");
    expect(connect).toContain("https://abc.supabase.co");
    expect(connect).toContain("wss://abc.supabase.co");
    expect(connect).not.toContain("openai.com");
    expect(connect).not.toContain("elevenlabs");
    expect(connect).not.toMatch(/(^|\s)https:(\s|$)/);

    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Permissions-Policy"]).toContain("microphone=(self)");
  });
});
