import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Test doubles for the module's external boundaries ──────────────────────
// DNS (no real network), the per-request Supabase client (cookies/RLS) and the
// service-role Supabase client.
const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  createSessionClient: vi.fn(),
  createServiceClient: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
  lookup: mocks.lookup,
  default: { lookup: mocks.lookup },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createSessionClient }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createServiceClient }));

type Settings = Record<string, string>;

/** Minimal stand-in for `supabase.from("app_settings").select().eq().maybeSingle()`. */
function fakeSettingsClient(settings: Settings, error: { message: string } | null = null) {
  const from = vi.fn((table: string) => {
    if (table !== "app_settings") throw new Error(`unexpected table ${table}`);
    return {
      select: () => ({
        eq: (_column: string, key: string) => ({
          maybeSingle: async () =>
            error
              ? { data: null, error }
              : { data: key in settings ? { value: settings[key] } : null, error: null },
        }),
      }),
    };
  });
  return { from };
}

/**
 * DNS table used by the lookup mock. Unknown hosts resolve to a PUBLIC address
 * on purpose, so name-based rules (localhost, *.internal…) are tested on their
 * own instead of passing only because resolution failed.
 */
const DNS: Record<string, Array<{ address: string; family: number }>> = {
  "api.openai.com": [{ address: "104.18.33.45", family: 4 }],
  "llm.example.com": [
    { address: "93.184.215.14", family: 4 },
    { address: "2606:2800:21f:cb07:6820:80da:af6b:8b2c", family: 6 },
  ],
  "loopback.attacker.test": [{ address: "127.0.0.1", family: 4 }],
  "mapped-loopback.attacker.test": [{ address: "::ffff:127.0.0.1", family: 6 }],
  "metadata.attacker.test": [{ address: "169.254.169.254", family: 4 }],
  "mixed.attacker.test": [
    { address: "93.184.215.14", family: 4 },
    { address: "10.0.0.5", family: 4 },
  ],
  "empty.attacker.test": [],
};
const PUBLIC_DEFAULT = [{ address: "93.184.215.14", family: 4 }];
const NXDOMAIN = new Set(["does-not-exist.attacker.test"]);

async function loadModule() {
  vi.resetModules(); // fresh settings cache / service client per test
  return import("@/lib/server-settings");
}

beforeEach(() => {
  mocks.lookup.mockReset();
  mocks.lookup.mockImplementation(async (host: string) => {
    if (NXDOMAIN.has(host)) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
    return DNS[host] ?? PUBLIC_DEFAULT;
  });
  mocks.createSessionClient.mockReset();
  mocks.createServiceClient.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  for (const name of [
    "SUPABASE_SERVICE_ROLE_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "ANTHROPIC_API_KEY",
    "ELEVENLABS_API_KEY",
  ]) {
    vi.stubEnv(name, "");
  }
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isSafePublicBaseUrl", () => {
  it.each([
    "https://api.openai.com/v1",
    "https://llm.example.com/v1/",
    "http://8.8.8.8/v1",
    "https://1.1.1.1:8443/v1",
    "https://[2606:4700:4700::1111]/v1",
  ])("cho phép URL công khai %s", async (url) => {
    const { isSafePublicBaseUrl } = await loadModule();
    await expect(isSafePublicBaseUrl(url)).resolves.toBe(true);
  });

  it.each([
    // loopback / localhost names
    ["localhost", "http://localhost:11434/v1"],
    ["localhost. (trailing dot)", "http://localhost./v1"],
    ["LOCALHOST viết hoa", "http://LOCALHOST/v1"],
    ["*.localhost", "http://api.localhost/v1"],
    ["127.0.0.1", "http://127.0.0.1:8080/v1"],
    ["127.1 (dạng rút gọn)", "http://127.1/v1"],
    ["2130706433 (IPv4 thập phân)", "http://2130706433/v1"],
    ["0x7f.1 (IPv4 hex)", "http://0x7f.1/v1"],
    // IPv6 literals
    ["[::]", "http://[::]/v1"],
    ["[::1]", "http://[::1]/v1"],
    ["[::ffff:127.0.0.1] (IPv4-mapped)", "http://[::ffff:127.0.0.1]/v1"],
    ["[64:ff9b::a9fe:a9fe] (NAT64 → 169.254.169.254)", "http://[64:ff9b::a9fe:a9fe]/v1"],
    ["[fd00::1] (ULA)", "http://[fd00::1]/v1"],
    ["[fe80::1] (link-local)", "http://[fe80::1]/v1"],
    // private / reserved IPv4 ranges
    ["10/8", "http://10.1.2.3/v1"],
    ["172.16/12", "http://172.20.0.1/v1"],
    ["192.168/16", "http://192.168.1.10/v1"],
    ["100.64/10 (CGNAT)", "http://100.64.0.1/v1"],
    ["169.254.169.254 (cloud metadata)", "http://169.254.169.254/latest/meta-data/"],
    ["198.18/15 (đầu)", "http://198.18.0.1/v1"],
    ["198.18/15 (cuối)", "http://198.19.255.254/v1"],
    ["0.1.2.3 (0/8)", "http://0.1.2.3/v1"],
    ["0.0.0.0", "http://0.0.0.0/v1"],
    ["224/4 multicast", "http://224.0.0.1/v1"],
    // internal suffixes
    ["*.internal", "https://metadata.google.internal/computeMetadata/v1"],
    ["*.internal. (trailing dot)", "https://foo.internal./v1"],
    ["*.local", "http://printer.local/v1"],
    ["*.home.arpa", "http://router.home.arpa/v1"],
    ["*.lan", "http://nas.lan/v1"],
    // credentials / scheme / garbage
    ["user:pass@ trong URL", "https://user:pass@api.openai.com/v1"],
    ["user@ trong URL", "https://user@api.openai.com/v1"],
    ["file://", "file:///etc/passwd"],
    ["ftp://", "ftp://api.openai.com/v1"],
    ["gopher://", "gopher://8.8.8.8:70/_x"],
    ["chuỗi không phải URL", "not a url"],
    ["chuỗi rỗng", ""],
  ])("chặn %s", async (_label, url) => {
    const { isSafePublicBaseUrl } = await loadModule();
    await expect(isSafePublicBaseUrl(url)).resolves.toBe(false);
  });

  it.each([
    ["trỏ về 127.0.0.1", "https://loopback.attacker.test/v1"],
    ["trỏ về ::ffff:127.0.0.1", "https://mapped-loopback.attacker.test/v1"],
    ["trỏ về 169.254.169.254", "https://metadata.attacker.test/v1"],
    ["có một bản ghi nội bộ (10.0.0.5)", "https://mixed.attacker.test/v1"],
    ["không có bản ghi DNS", "https://empty.attacker.test/v1"],
    ["DNS lỗi (ENOTFOUND)", "https://does-not-exist.attacker.test/v1"],
  ])("chặn hostname %s", async (_label, url) => {
    const { isSafePublicBaseUrl } = await loadModule();
    await expect(isSafePublicBaseUrl(url)).resolves.toBe(false);
  });

  it("phân giải hostname bằng DNS (all + verbatim) trước khi quyết định", async () => {
    const { isSafePublicBaseUrl } = await loadModule();
    await isSafePublicBaseUrl("https://loopback.attacker.test/v1");
    expect(mocks.lookup).toHaveBeenCalledWith("loopback.attacker.test", { all: true, verbatim: true });
  });

  // BUG (mức độ thấp, defense-in-depth): địa chỉ IPv4-compatible `::a.b.c.d`
  // (::/96, đã deprecated) được WHATWG URL chuẩn hoá thành `[::7f00:1]`, không
  // khớp nhánh nào trong isPrivateIPv6 nên bị coi là công khai. Trên Linux kết
  // nối tới ::7f00:1 thường không tới loopback, nhưng blocklist nên chặn cả ::/96.
  it("chặn [::127.0.0.1] (IPv4-compatible, ::/96)", async () => {
    const { isSafePublicBaseUrl } = await loadModule();
    await expect(isSafePublicBaseUrl("http://[::127.0.0.1]/v1")).resolves.toBe(false);
  });
});

describe("resolveCustomBaseUrl", () => {
  it("dùng URL của client khi client gửi kèm API key riêng (BYO) và URL an toàn", async () => {
    const { resolveCustomBaseUrl } = await loadModule();
    await expect(resolveCustomBaseUrl("https://llm.example.com/v1", "sk-user")).resolves.toBe(
      "https://llm.example.com/v1"
    );
  });

  it("trả về chuỗi rỗng khi URL BYO trỏ tới địa chỉ nội bộ", async () => {
    const { resolveCustomBaseUrl } = await loadModule();
    await expect(resolveCustomBaseUrl("http://169.254.169.254/latest", "sk-user")).resolves.toBe("");
    await expect(resolveCustomBaseUrl("https://loopback.attacker.test/v1", "sk-user")).resolves.toBe("");
  });

  it("bỏ qua URL của client khi không có userKey → dùng URL admin cấu hình", async () => {
    const session = fakeSettingsClient({ custom_provider_url: "https://admin-llm.example.com/v1" });
    mocks.createSessionClient.mockResolvedValue(session);
    const { resolveCustomBaseUrl } = await loadModule();

    await expect(resolveCustomBaseUrl("https://attacker.example.com/v1")).resolves.toBe(
      "https://admin-llm.example.com/v1"
    );
    await expect(resolveCustomBaseUrl("https://attacker.example.com/v1", "")).resolves.toBe(
      "https://admin-llm.example.com/v1"
    );
    // Không bao giờ phân giải (hay dùng) host do client gửi khi key nền tảng được dùng.
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it("không có URL client → dùng URL admin (rỗng nếu admin chưa cấu hình)", async () => {
    mocks.createSessionClient.mockResolvedValue(fakeSettingsClient({}));
    const { resolveCustomBaseUrl } = await loadModule();
    await expect(resolveCustomBaseUrl(undefined, "sk-user")).resolves.toBe("");
  });
});

describe("resolveApiKey", () => {
  it("ưu tiên key BYO của người dùng, không đọc DB", async () => {
    const session = fakeSettingsClient({ openai_api_key: "sk-db" });
    mocks.createSessionClient.mockResolvedValue(session);
    vi.stubEnv("OPENAI_API_KEY", "sk-env");
    const { resolveApiKey } = await loadModule();

    await expect(resolveApiKey("openai", "sk-user")).resolves.toBe("sk-user");
    expect(session.from).not.toHaveBeenCalled();
  });

  it("không có BYO → dùng key admin trong DB trước biến môi trường", async () => {
    mocks.createSessionClient.mockResolvedValue(
      fakeSettingsClient({ openai_api_key: "sk-db", elevenlabs_api_key: "el-db" })
    );
    vi.stubEnv("OPENAI_API_KEY", "sk-env");
    vi.stubEnv("ELEVENLABS_API_KEY", "el-env");
    const { resolveApiKey } = await loadModule();

    await expect(resolveApiKey("openai")).resolves.toBe("sk-db");
    await expect(resolveApiKey("elevenlabs", "")).resolves.toBe("el-db");
  });

  it("DB không có key → fallback biến môi trường", async () => {
    mocks.createSessionClient.mockResolvedValue(fakeSettingsClient({}));
    vi.stubEnv("GEMINI_API_KEY", "gm-env");
    vi.stubEnv("ANTHROPIC_API_KEY", "an-env");
    vi.stubEnv("OPENAI_API_KEY", "sk-env");
    const { resolveApiKey } = await loadModule();

    await expect(resolveApiKey("gemini")).resolves.toBe("gm-env");
    await expect(resolveApiKey("anthropic")).resolves.toBe("an-env");
    await expect(resolveApiKey("dalle")).resolves.toBe("sk-env"); // DALL·E dùng key OpenAI
  });

  it("lỗi khi đọc DB (vd: RLS/ mạng) → fallback biến môi trường, không ném lỗi", async () => {
    mocks.createSessionClient.mockResolvedValue(fakeSettingsClient({}, { message: "permission denied" }));
    vi.stubEnv("OPENAI_API_KEY", "sk-env");
    const { resolveApiKey } = await loadModule();

    await expect(resolveApiKey("openai")).resolves.toBe("sk-env");
  });

  it("provider custom/không xác định không có fallback env → chuỗi rỗng", async () => {
    mocks.createSessionClient.mockResolvedValue(fakeSettingsClient({}));
    vi.stubEnv("OPENAI_API_KEY", "sk-env");
    const { resolveApiKey } = await loadModule();

    await expect(resolveApiKey("custom")).resolves.toBe("");
    await expect(resolveApiKey("unknown-provider")).resolves.toBe("");
  });

  it("có SUPABASE_SERVICE_ROLE_KEY → đọc key admin bằng service client", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    mocks.createServiceClient.mockReturnValue(fakeSettingsClient({ openai_api_key: "sk-db-service" }));
    const { resolveApiKey } = await loadModule();

    await expect(resolveApiKey("openai")).resolves.toBe("sk-db-service");
    expect(mocks.createServiceClient).toHaveBeenCalledWith(
      "http://127.0.0.1:54321",
      "service-role-secret",
      expect.anything()
    );
    expect(mocks.createSessionClient).not.toHaveBeenCalled();
  });

  it("không có service role → không cache kết quả giữa các người dùng khác nhau", async () => {
    // Lần 1: admin (RLS cho đọc key). Lần 2: user thường (RLS ẩn key).
    mocks.createSessionClient
      .mockResolvedValueOnce(fakeSettingsClient({ openai_api_key: "sk-db" }))
      .mockResolvedValueOnce(fakeSettingsClient({}));
    vi.stubEnv("OPENAI_API_KEY", "sk-env");
    const { resolveApiKey } = await loadModule();

    await expect(resolveApiKey("openai")).resolves.toBe("sk-db");
    await expect(resolveApiKey("openai")).resolves.toBe("sk-env");
  });
});
