/**
 * Admin v2 · A-03 — mọi route quản trị ghi nhật ký (test tự kiểm).
 *
 * 1. Quét mã: mọi handler trong src/app/api/admin/** và mọi handler kiểm tra
 *    quyền nhân sự (requirePermission / hasPermission) phải gọi auditAdmin(…)
 *    hoặc khai báo `audit: db-trigger <bảng>` cho bảng có trigger audit_<bảng>.
 * 2. auditAdmin: che key, lấy IP, lỗi ghi nhật ký → 503 (không làm thao tác).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { AUDIT_ACTIONS, auditActionLabel, auditAdmin, auditChanges, redactSecrets, REDACTED, requestIp } from "@/lib/admin-audit";

const ROOT = process.cwd();
const API_DIR = join(ROOT, "src", "app", "api");
const MIGRATIONS = readdirSync(join(ROOT, "supabase", "migrations"))
  .map((f) => readFileSync(join(ROOT, "supabase", "migrations", f), "utf8"))
  .join("\n");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

/** `export async function POST(…) { … }` → { method, body } (body = text up to the next top-level export). */
function handlers(source: string): { method: string; body: string }[] {
  const re = /^export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/gm;
  const starts = [...source.matchAll(re)];
  return starts.map((m, i) => ({
    method: m[1],
    body: source.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : source.length),
  }));
}

const STAFF_CHECK = /\b(requirePermission|hasPermission)\(/;

describe("A-03 · mọi route quản trị ghi nhật ký (quét mã)", () => {
  const checked: string[] = [];
  for (const file of routeFiles(API_DIR)) {
    const rel = relative(ROOT, file);
    const isAdminRoute = rel.startsWith(join("src", "app", "api", "admin"));
    for (const h of handlers(readFileSync(file, "utf8"))) {
      // Public capability polling is not an admin operation: it reads only an
      // allowlisted boolean catalog and caller permissions (including visitors).
      // Exact route/method exception, independently verified in feature-flag-capabilities.test.ts.
      if (rel.replace(/\\/g, "/") === "src/app/api/features/route.ts" && h.method === "GET") continue;
      if (!isAdminRoute && !STAFF_CHECK.test(h.body)) continue;
      const name = `${rel.replace(/\\/g, "/")} ${h.method}`;
      checked.push(name);
      it(name, () => {
        const viaTrigger = [...h.body.matchAll(/audit: db-trigger (\w+)/g)].map((m) => m[1]);
        expect(h.body.includes("auditAdmin(") || viaTrigger.length > 0, `${name} không ghi nhật ký`).toBe(true);
        for (const table of viaTrigger) {
          expect(MIGRATIONS, `thiếu trigger audit_${table}`).toMatch(new RegExp(`CREATE TRIGGER audit_${table}\\b`));
        }
      });
    }
  }

  it("quét thấy đủ các route quản trị đã biết (không pass rỗng)", () => {
    expect(checked).toEqual(
      expect.arrayContaining([
        "src/app/api/admin/test-provider/route.ts GET",
        "src/app/api/admin/test-provider/route.ts POST",
        "src/app/api/push/send/route.ts POST",
        "src/app/api/voice/defaults/route.ts POST",
        "src/app/api/voice/defaults/route.ts DELETE",
        "src/app/api/story/illustrate-batch/route.ts POST",
      ])
    );
  });
});

describe("A-03 · auditAdmin", () => {
  const req = (headers: Record<string, string> = {}) => new Request("http://localhost/api/x", { headers });

  it("màn Nhật ký: nhãn tiếng Việt cho mọi hành động; hiển thị trước → sau", () => {
    expect(auditActionLabel("user.role_change")).toBe("Đổi vai trò");
    expect(auditActionLabel("unknown.thing")).toBe("unknown.thing");
    for (const key of Object.keys(AUDIT_ACTIONS)) expect(key).toMatch(/^[a-z_]+\.[a-z_]+$/);
    // Mọi hành động trigger DB có thể ghi đều có nhãn.
    for (const m of MIGRATIONS.matchAll(/'([a-z_]+\.[a-z_]+)'/g)) {
      if (/^(user|secret|setting|story|category|template|default_voice)\./.test(m[1]) && !m[1].includes("_at")) {
        expect(Object.keys(AUDIT_ACTIONS), m[1]).toContain(m[1]);
      }
    }
    // …và các hành động trigger ghép `<entity>.create|update|delete`.
    for (const entity of ["secret", "setting", "story", "category", "template", "default_voice"]) {
      for (const op of ["create", "update", "delete"]) expect(Object.keys(AUDIT_ACTIONS)).toContain(`${entity}.${op}`);
    }
    expect(auditChanges({ before: { role: "user" }, after: { role: "editor" } })).toEqual(["role: user → editor"]);
    expect(auditChanges({ before: null, after: { title: "Thỏ", pages: 3 } })).toEqual(["title: Thỏ", "pages: 3"]);
    expect(auditChanges({ before: { name: "x", note: null }, after: null })).toEqual(["name: x", "note: (trống)"]);
    expect(auditChanges({ before: null, after: null })).toEqual([]);
    expect(auditChanges({ before: { v: "a".repeat(200) }, after: { v: "b" } })[0].length).toBeLessThan(100);
  });

  it("redactSecrets che mọi trường giống khoá / mật khẩu (kể cả lồng nhau)", () => {
    expect(
      redactSecrets({ provider: "openai", apiKey: "sk-1", nested: { elevenlabs_api_key: "el", token: "t", empty_api_key: "" }, list: [{ password: "p" }] })
    ).toEqual({ provider: "openai", apiKey: REDACTED, nested: { elevenlabs_api_key: REDACTED, token: REDACTED, empty_api_key: "" }, list: [{ password: REDACTED }] });
  });

  it("requestIp ưu tiên cf-connecting-ip → x-real-ip → x-forwarded-for (IP đầu)", () => {
    expect(requestIp(new Headers({ "x-forwarded-for": "1.1.1.1, 10.0.0.1" }))).toBe("1.1.1.1");
    expect(requestIp(new Headers({ "x-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2" }))).toBe("2.2.2.2");
    expect(requestIp(new Headers({ "x-real-ip": "2.2.2.2", "cf-connecting-ip": "3.3.3.3" }))).toBe("3.3.3.3");
    expect(requestIp(new Headers())).toBeNull();
  });

  it("gọi log_admin_action với dữ liệu đã che, IP + trình duyệt", async () => {
    const rpc = vi.fn(async () => ({ data: 1, error: null }));
    const res = await auditAdmin({ rpc } as never, req({ "cf-connecting-ip": "203.0.113.5", "user-agent": "UA" }), {
      action: "provider.test",
      targetType: "provider",
      targetId: "openai",
      after: { apiKey: "sk-secret", host: null },
    });
    expect(res).toBeNull();
    expect(rpc).toHaveBeenCalledWith("log_admin_action", {
      p_action: "provider.test",
      p_target_type: "provider",
      p_target_id: "openai",
      p_before: null,
      p_after: { apiKey: REDACTED, host: null },
      p_reason: null,
      p_ip: "203.0.113.5",
      p_user_agent: "UA",
    });
  });

  it("không ghi được nhật ký (lỗi DB hoặc ngoại lệ) → 503, route phải dừng", async () => {
    for (const rpc of [vi.fn(async () => ({ data: null, error: { message: "down" } })), vi.fn(async () => Promise.reject(new Error("net")))]) {
      const res = await auditAdmin({ rpc } as never, req(), { action: "push.send" });
      expect(res?.status).toBe(503);
      expect(await res?.json()).toMatchObject({ code: "audit_failed" });
    }
  });
});

// ── Route-level: ghi nhật ký TRƯỚC khi làm, lỗi ghi → không làm ──
const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "00000000-0000-4000-8000-000000000001" } } }) },
    rpc,
    from,
  })),
}));
/** A-04: what the server would read from Vault / saved settings (never sent to the browser). */
const STORED: Record<string, string> = {};
vi.mock("@/lib/server-settings", () => ({
  getSystemSetting: vi.fn(async (key: string) => STORED[key] ?? ""),
  resolveApiKey: vi.fn(async (provider: string) => STORED[`${provider === "custom" ? "custom_provider_key" : `${provider}_api_key`}`] ?? ""),
  isSafePublicBaseUrl: vi.fn(async () => true),
}));

function post(body: unknown): NextRequest {
  return new Request("http://localhost/api/x", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.1" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("A-03 · route ghi nhật ký trước khi thao tác", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  const rpcWith = (logResult: { error: unknown }) =>
    rpc.mockImplementation(async (name: string) => (name === "public_feature_flags" ? {data:{child_push:true},error:null} : name === "has_permission" ? { data: true, error: null } : { data: 1, ...logResult }));

  it("push/send: không ghi được nhật ký → 503, không đọc danh sách người nhận", async () => {
    rpcWith({ error: { message: "audit down" } });
    const { POST } = await import("@/app/api/push/send/route");
    const res = await POST(post({ title: "Bảo trì", body: "Tối nay 22h" }));
    expect(res.status).toBe(503);
    expect(from).not.toHaveBeenCalled();
  });

  it("push/send: ghi nhật ký rồi mới gửi", async () => {
    rpcWith({ error: null });
    from.mockReturnValue({ select: () => Promise.resolve({ data: [] }) });
    const { POST } = await import("@/app/api/push/send/route");
    const res = await POST(post({ title: "Bảo trì", body: "Tối nay 22h" }));
    expect(res.status).toBe(200);
    const logCall = rpc.mock.calls.find(([name]) => name === "log_admin_action");
    expect(logCall?.[1]).toMatchObject({ p_action: "push.send", p_after: { title: "Bảo trì", recipients: "all" }, p_ip: "198.51.100.1" });
    expect(rpc.mock.invocationCallOrder[rpc.mock.calls.indexOf(logCall!)]).toBeLessThan(from.mock.invocationCallOrder[0]);
  });

  it("admin/test-provider POST: key đem thử không bao giờ vào nhật ký; lỗi ghi → không gọi provider", async () => {
    rpcWith({ error: null });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "gpt-4o" }] }), { status: 200 }));
    const { POST } = await import("@/app/api/admin/test-provider/route");
    const res = await POST(post({ provider: "openai", apiKey: "sk-test-NEVER-LOG" }));
    expect(res.status).toBe(200);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("sk-test-NEVER-LOG");
    expect(rpc).toHaveBeenCalledWith("log_admin_action", expect.objectContaining({ p_action: "provider.test", p_target_id: "openai" }));

    rpc.mockReset();
    fetchMock.mockReset();
    rpcWith({ error: { message: "audit down" } });
    const blocked = await POST(post({ provider: "openai", apiKey: "sk-test-NEVER-LOG" }));
    expect(blocked.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("A-04 · admin/test-provider POST không gửi key: thử key đã lưu ở server, không trả key về trình duyệt", async () => {
    const stored = "sk-proj-STORED-IN-VAULT-1234";
    Object.assign(STORED, { openai_api_key: stored, custom_provider_key: stored, custom_provider_url: "https://saved-llm.example.com/v1" });
    try {
      rpcWith({ error: null });
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "gpt-4o" }] }), { status: 200 }));
      const { POST } = await import("@/app/api/admin/test-provider/route");
      const ok = await POST(post({ provider: "openai" }));
      const okText = await ok.text();
      expect(JSON.parse(okText)).toEqual({ ok: true, models: ["gpt-4o"] });
      expect(okText).not.toContain(stored);
      expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: `Bearer ${stored}` });
      expect(rpc).toHaveBeenCalledWith("log_admin_action", expect.objectContaining({ p_after: { host: null, key_source: "stored" } }));
      expect(JSON.stringify(rpc.mock.calls)).not.toContain(stored);

      // Custom: the stored key only goes to the SAVED base URL, never to one sent by the browser.
      fetchMock.mockClear();
      await POST(post({ provider: "custom", baseUrl: "https://attacker.example.com/v1" }));
      expect(String(fetchMock.mock.calls[0][0])).toBe("https://saved-llm.example.com/v1/models");

      // Provider errors that echo the key are scrubbed.
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${stored}.` } }), { status: 401 })
      );
      const bad = await POST(post({ provider: "openai" }));
      const badText = await bad.text();
      expect(JSON.parse(badText)).toEqual({ ok: false, error: "Incorrect API key provided: [đã ẩn]." });

      // Nothing stored → clear message, no provider call.
      for (const k of Object.keys(STORED)) delete STORED[k];
      fetchMock.mockClear();
      const none = await POST(post({ provider: "gemini" }));
      expect(await none.json()).toEqual({ ok: false, error: "Chưa đặt API key Gemini" });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      for (const k of Object.keys(STORED)) delete STORED[k];
    }
  });
});
