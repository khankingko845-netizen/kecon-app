/**
 * POST /api/admin/backup/token — Admin › Sao lưu. Token kiểm tra với GitHub (repo do máy
 * chủ báo về) rồi mới vào Vault; cần backups.manage + secrets.manage; ghi nhật ký trước khi
 * gọi GitHub; không bao giờ trả / ghi token.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "github_pat_11ROUTE0000" + "k".repeat(58) + "Wxyz";
const state = vi.hoisted(() => ({
  user: true,
  perms: ["backups.manage", "secrets.manage"] as string[],
  repo: "owner/kecon-backup" as string | null,
  saveError: null as null | { code: string; message: string },
  auditFails: false,
  calls: [] as { name: string; body: unknown }[],
  audits: [] as unknown[],
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user ? { id: "staff-1" } : null } }) },
    rpc: async (name: string, body: { p_permission?: string } | undefined) => {
      state.calls.push({ name, body });
      if (name === "has_permission") return { data: state.perms.includes(body?.p_permission ?? ""), error: null };
      if (name === "admin_access_status") return { data: { state: "ready" }, error: null };
      if (name === "admin_backup_status") return { data: { worker: { repo: state.repo } }, error: null };
      if (name === "admin_set_backup_token")
        return state.saveError ? { data: null, error: state.saveError } : { data: { last4: "Wxyz", kind: "fine_grained", set_at: "2026-10-16T12:00:00Z" }, error: null };
      return { data: null, error: { code: "42883", message: "unknown" } };
    },
  }),
}));
vi.mock("@/lib/admin-audit", () => ({
  auditAdmin: async (_s: unknown, _r: unknown, entry: unknown) => {
    state.audits.push(entry);
    return state.auditFails ? Response.json({ error: "Không ghi được nhật ký" }, { status: 503 }) : null;
  },
}));
import { POST } from "@/app/api/admin/backup/token/route";

const github = vi.fn();
const ADV = { "content-type": "application/x-git-receive-pack-advertisement" };
function githubSays(api: number, opts: { private?: boolean; refs?: number; refsType?: string } = {}) {
  github.mockImplementation(async (url: string) => {
    if (url.startsWith("https://api.github.com/"))
      return new Response(JSON.stringify({ private: opts.private ?? true }), { status: api, headers: { "github-authentication-token-expiration": "2099-01-01 00:00:00 UTC" } });
    return new Response("", { status: opts.refs ?? 200, headers: { "content-type": opts.refsType ?? ADV["content-type"] } });
  });
}
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://kecon.test/api/admin/backup/token", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as never;
const REASON = "Thay token sắp hết hạn";
const names = () => state.calls.map((c) => c.name).filter((n) => n !== "has_permission" && n !== "admin_access_status");

beforeEach(() => {
  Object.assign(state, { user: true, perms: ["backups.manage", "secrets.manage"], repo: "owner/kecon-backup", saveError: null, auditFails: false, calls: [], audits: [] });
  github.mockReset();
  githubSays(200);
  vi.stubGlobal("fetch", github);
});
afterEach(() => vi.unstubAllGlobals());

describe("POST /api/admin/backup/token", () => {
  it("cross-site / chưa đăng nhập / thiếu quyền: từ chối, không đụng GitHub hay Vault", async () => {
    expect((await POST(req({ token: TOKEN, reason: REASON }, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    state.user = false;
    expect((await POST(req({ token: TOKEN, reason: REASON }))).status).toBe(401);
    state.user = true;
    state.perms = ["secrets.manage"];
    const noBackup = await POST(req({ token: TOKEN, reason: REASON }));
    expect(noBackup.status).toBe(403);
    expect(await noBackup.json()).toMatchObject({ permission: "backups.manage" });
    state.perms = ["backups.manage"];
    const noSecrets = await POST(req({ token: TOKEN, reason: REASON }));
    expect(noSecrets.status).toBe(403);
    expect(await noSecrets.json()).toMatchObject({ permission: "secrets.manage" });
    expect(github).not.toHaveBeenCalled();
    expect(names()).toEqual([]);
  });

  it("dữ liệu sai: 400 và không lặp lại token", async () => {
    for (const body of [
      { token: "abc", reason: REASON },
      { token: "github_pat_ có khoảng trắng " + "x".repeat(30), reason: REASON },
      { token: "gho_" + "x".repeat(36), reason: REASON },
      { token: TOKEN, reason: "ngắn" },
      { token: TOKEN, reason: REASON, repo: "attacker/repo" },
      "không phải json",
    ]) {
      const res = await POST(req(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.text()).not.toContain(TOKEN.slice(11));
    }
    expect(github).not.toHaveBeenCalled();
    expect(names()).toEqual([]);
  });

  it("máy chủ chưa báo repo → 409, chưa ghi nhật ký, chưa gọi GitHub", async () => {
    state.repo = null;
    const res = await POST(req({ token: TOKEN, reason: REASON }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "worker_unknown" });
    expect(state.audits).toEqual([]);
    expect(github).not.toHaveBeenCalled();
  });

  it("GitHub từ chối: 422 với mã rõ ràng; token không vào Vault; nhật ký chỉ có 4 ký tự cuối", async () => {
    const cases: [number, Parameters<typeof githubSays>[1], string][] = [
      [401, {}, "token_invalid"],
      [404, {}, "repo_not_found"],
      [200, { private: false }, "repo_public"],
      [200, { refs: 403 }, "token_no_push"],
      [200, { refsType: "text/html" }, "token_no_push"],
      [503, {}, "github_unreachable"],
    ];
    for (const [api, opts, code] of cases) {
      githubSays(api, opts);
      const res = await POST(req({ token: `  ${TOKEN}\n`, reason: REASON }));
      expect(res.status, code).toBe(422);
      const text = await res.text();
      expect(JSON.parse(text), code).toMatchObject({ code });
      expect(text).not.toContain(TOKEN.slice(11));
    }
    expect(names().filter((n) => n === "admin_set_backup_token")).toEqual([]);
    expect(state.audits).toHaveLength(cases.length);
    expect(state.audits[0]).toEqual({ action: "backup.token_check", targetType: "backup", targetId: "owner/kecon-backup", after: { kind: "fine_grained", last4: "…Wxyz" }, reason: REASON });
    expect(JSON.stringify(state.audits)).not.toContain(TOKEN.slice(11));
  });

  it("không ghi được nhật ký → 503, không gọi GitHub, không lưu", async () => {
    state.auditFails = true;
    expect((await POST(req({ token: TOKEN, reason: REASON }))).status).toBe(503);
    expect(github).not.toHaveBeenCalled();
    expect(names()).toEqual(["admin_backup_status"]);
  });

  it("đạt: kiểm tra đúng repo của máy chủ rồi lưu (đã trim) vào Vault; trả 4 ký tự cuối + hạn dùng", async () => {
    const res = await POST(req({ token: `  ${TOKEN}\n`, reason: `  ${REASON}  ` }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, last4: "Wxyz", kind: "fine_grained", set_at: "2026-10-16T12:00:00Z", expires_at: "2099-01-01T00:00:00.000Z", warnings: [] });
    expect(text).not.toContain(TOKEN.slice(11));
    expect(github.mock.calls.map((c) => c[0])).toEqual([
      "https://api.github.com/repos/owner/kecon-backup",
      "https://github.com/owner/kecon-backup.git/info/refs?service=git-receive-pack",
    ]);
    expect(names()).toEqual(["admin_backup_status", "admin_set_backup_token"]);
    expect(state.calls.find((c) => c.name === "admin_set_backup_token")?.body).toEqual({ p_token: TOKEN, p_reason: REASON });
  });

  it("DB từ chối khi lưu (vd. phiên hết hạn giữa chừng) → báo lỗi dễ hiểu", async () => {
    state.saveError = { code: "42501", message: "Permission denied" };
    const res = await POST(req({ token: TOKEN, reason: REASON }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("phiên quản trị");
  });
});
