/**
 * Admin › Sao lưu — pure helpers (src/lib/admin-backup.ts): cảnh báo, quy tắc giữ bản
 * (phải khớp kecon_backup.retained() của máy chủ), kiểm tra token GitHub, thông báo lỗi.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  backupRpcError,
  backupWarnings,
  checkGithubToken,
  finishedSince,
  parseTokenExpiry,
  retainedStamps,
  retentionEstimate,
  runOutcome,
  snapshotsDropped,
  stampToIso,
  type BackupRun,
  type BackupStatus,
} from "@/lib/admin-backup";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const okRun = (id: number, minAgo: number, extra: Partial<BackupRun> = {}): BackupRun => ({
  id, kind: "scheduled", status: "ok", phase: null, started_at: iso(minAgo + 2), finished_at: iso(minAgo), exit_code: 0, release: "abc1234",
  error: null, summary: { stories: 40, restore_check: { ok: true } }, reason: null, requested_by_email: null, ...extra,
});
function status(over: Partial<BackupStatus> = {}, worker: Partial<BackupStatus["worker"]> = {}): BackupStatus {
  const runs = over.runs ?? [okRun(1, 60)];
  const ok = runs.find((r) => r.status === "ok");
  return {
    now: new Date(NOW).toISOString(),
    settings: { schedule_time: "03:15", keep_daily: 7, keep_weekly: 4, keep_monthly: 6, version: 1, updated_at: null, updated_by_email: null },
    schedule: { timezone: "Asia/Ho_Chi_Minh", slot: iso(500), slot_done: true, tries: 0, due: false, running: false, next_run_at: iso(-900) },
    token: { is_set: false, last4: null, kind: null, set_at: null, set_by_email: null },
    worker: {
      heartbeat_at: iso(1), release: "abc1234", repo: "owner/kecon-backup", push_via: "file_token", passphrase_ok: true, snapshots: [],
      token_check: { status: "ok", source: "file_token", kind: "fine_grained", last4: "Wxyz", expires_at: iso(-60 * 24 * 60), push: true, private: true, message: null, checked_at: iso(30) },
      ...worker,
    },
    runs,
    last_success: ok ? { id: ok.id, kind: ok.kind, started_at: ok.started_at, finished_at: ok.finished_at, summary: ok.summary } : null,
    request: null,
    requests_last_hour: 0,
    limits: { requests_per_hour: 3, keep_daily: [3, 30], keep_weekly: [0, 12], keep_monthly: [0, 24] },
    can_set_token: true,
    ...over,
  };
}
const codes = (s: BackupStatus) => backupWarnings(s, NOW).map((w) => `${w.level}:${w.code}`);

describe("cảnh báo (đỏ = không có bản sao lưu dùng được)", () => {
  it("bình thường: không cảnh báo", () => {
    expect(codes(status())).toEqual([]);
  });

  it("máy chủ chưa báo về / im lặng > 10 phút (trừ khi đang chạy) / thiếu mật khẩu mã hoá", () => {
    expect(codes(status({}, { heartbeat_at: null, push_via: null, token_check: null }))).toEqual(["error:worker_never"]);
    expect(codes(status({}, { heartbeat_at: iso(11) }))).toEqual(["error:worker_silent"]);
    const running = okRun(2, 0, { status: "running", finished_at: null, phase: "push" });
    expect(codes(status({ runs: [running, okRun(1, 60)] }, { heartbeat_at: iso(20) }))).toEqual([]);
    expect(codes(status({}, { passphrase_ok: false }))).toEqual(["error:no_passphrase"]);
  });

  it("lần gần nhất lỗi, chưa từng thành công, thành công đã quá 36 giờ", () => {
    const failed = okRun(2, 10, { status: "push_failed", error: "Đẩy lên GitHub lỗi — main: denied" });
    const w = backupWarnings(status({ runs: [failed, okRun(1, 60)] }), NOW);
    expect(w.map((x) => x.code)).toEqual(["last_failed"]);
    expect(w[0].text).toContain("Đẩy lên GitHub lỗi — main: denied");
    expect(codes(status({ runs: [] }))).toEqual(["error:never_ok"]);
    expect(codes(status({ runs: [okRun(1, 37 * 60)] }))).toEqual(["error:stale_ok"]);
  });

  it("token: thiếu / sai / chỉ đọc / repo công khai → đỏ; GitHub không trả lời → vàng", () => {
    expect(codes(status({}, { push_via: "none", token_check: { ...status().worker.token_check!, status: "missing", source: "none" } }))).toEqual(["error:token_bad"]);
    for (const bad of ["invalid", "not_found", "no_push", "public_repo", "expired"] as const) {
      expect(codes(status({}, { token_check: { ...status().worker.token_check!, status: bad, message: "x" } }))).toEqual(["error:token_bad"]);
    }
    expect(codes(status({}, { token_check: { ...status().worker.token_check!, status: "error", message: "Không kết nối được GitHub" } }))).toEqual([
      "warning:token_unchecked",
    ]);
    expect(codes(status({}, { push_via: "deploy_key", token_check: { ...status().worker.token_check!, status: "deploy_key", kind: null, expires_at: null } }))).toEqual([]);
  });

  it("token sắp hết hạn (≤ 14 ngày) → vàng; classic → vàng; không hạn → thông tin; token mới chờ máy chủ → thông tin", () => {
    const tc = status().worker.token_check!;
    const soon = backupWarnings(status({}, { token_check: { ...tc, expires_at: iso(-13 * 24 * 60) } }), NOW);
    expect(soon.map((w) => `${w.level}:${w.code}`)).toEqual(["warning:token_expiring"]);
    expect(soon[0].text).toContain("còn 13 ngày");
    expect(codes(status({}, { token_check: { ...tc, expires_at: iso(-15 * 24 * 60) } }))).toEqual([]);
    expect(codes(status({}, { token_check: { ...tc, kind: "classic" } }))).toEqual(["warning:token_classic"]);
    expect(codes(status({}, { token_check: { ...tc, expires_at: null } }))).toEqual(["info:token_no_expiry"]);
    const saved = { is_set: true, last4: "Q9zZ", kind: "fine_grained" as const, set_at: iso(1), set_by_email: "a@k.vn" };
    expect(codes(status({ token: saved }))).toEqual(["info:token_pending"]);
    expect(codes(status({ token: saved }, { push_via: "vault_token", token_check: { ...tc, source: "vault_token", last4: "Q9zZ", checked_at: iso(0) } }))).toEqual([]);
  });
});

describe("số bản giữ lại (giống hệt máy chủ)", () => {
  const stamps = Array.from({ length: 400 }, (_, i) => new Date(Date.UTC(2026, 9, 15, 20, 15) - i * 86_400_000 - (i % 5) * 3_600_000))
    .map((d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""));
  // Some days have 2 snapshots (a manual run in the afternoon, Vietnam time).
  const all = [...stamps, ...stamps.slice(0, 40).map((s) => s.replace(/T\d{2}/, "T08"))];

  it("retainedStamps khớp kecon_backup.retained() với nhiều cấu hình", () => {
    const configs = [
      { keep_daily: 7, keep_weekly: 4, keep_monthly: 6 },
      { keep_daily: 3, keep_weekly: 0, keep_monthly: 0 },
      { keep_daily: 30, keep_weekly: 12, keep_monthly: 24 },
      { keep_daily: 5, keep_weekly: 2, keep_monthly: 13 },
    ];
    const py = String.raw`
import importlib.util as u, json, sys
s = u.spec_from_file_location("kb", "deploy/prized/backup/kecon_backup.py")
kb = u.module_from_spec(s); s.loader.exec_module(kb)
d = json.load(sys.stdin)
out = []
for c in d["configs"]:
    kb.KEEP_DAILY, kb.KEEP_WEEKLY, kb.KEEP_MONTHLY = c["keep_daily"], c["keep_weekly"], c["keep_monthly"]
    out.append(sorted(n[3:19] for n in kb.retained([f"db-{x}.dump.gpg" for x in d["stamps"]])))
print(json.dumps(out))`;
    const expected = JSON.parse(
      execFileSync("python3", ["-c", py], { input: JSON.stringify({ configs, stamps: all }), encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } }),
    ) as string[][];
    configs.forEach((c, i) => expect([...retainedStamps(all, c)].sort(), JSON.stringify(c)).toEqual(expected[i]));
  });

  it("giảm số bản: biết trước bản nào sẽ bị xoá; ước tính số bản + dung lượng khi đủ lịch sử", () => {
    const daily = Array.from({ length: 20 }, (_, i) => new Date(Date.UTC(2026, 9, 15, 20, 15) - i * 86_400_000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""));
    const snaps = daily.map((t) => ({ file: `db-${t}.dump.gpg`, taken: t, plain_bytes: 10e6, encrypted_bytes: 2e6 }));
    expect(snapshotsDropped(snaps, { keep_daily: 7, keep_weekly: 4, keep_monthly: 6 }).length).toBeGreaterThan(0);
    const dropped = snapshotsDropped(snaps, { keep_daily: 3, keep_weekly: 0, keep_monthly: 0 });
    expect(dropped).toHaveLength(17);
    expect(dropped.map((d) => d.taken)).not.toContain(daily[0]);
    expect(snapshotsDropped(snaps, { keep_daily: 30, keep_weekly: 12, keep_monthly: 24 })).toEqual([]);
    const est = retentionEstimate({ keep_daily: 7, keep_weekly: 4, keep_monthly: 6 }, snaps);
    expect(est.count).toBeGreaterThanOrEqual(13);
    expect(est.count).toBeLessThanOrEqual(17);
    expect(est.bytes).toBe(est.count * 2e6);
    expect(retentionEstimate({ keep_daily: 3, keep_weekly: 0, keep_monthly: 0 }, []).bytes).toBeNull();
    expect(stampToIso("20261016T102451Z")).toBe("2026-10-16T10:24:51Z");
    expect(stampToIso("hỏng")).toBeNull();
  });
});

describe("token GitHub (route kiểm tra trước khi lưu)", () => {
  const TOKEN = "github_pat_11ROUTETEST0" + "y".repeat(58) + "Wxyz";
  // A reply is built per request (a Response body can only be read once).
  type Reply = () => Response;
  const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}): Reply => () =>
    new Response(status === 204 ? null : typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  const fake = (api: Reply | Error, refs: Reply | Error = reply(200, "", { "content-type": "application/x-git-receive-pack-advertisement" })) =>
    vi.fn(async (url: string | URL | Request) => {
      const r = String(url).startsWith("https://api.github.com/") ? api : refs;
      if (r instanceof Error) throw r;
      return r();
    }) as unknown as typeof fetch;
  const repoOk = (exp: string | null = "2026-11-04 11:57:04 UTC", priv = true) =>
    reply(200, { private: priv }, exp ? { "github-authentication-token-expiration": exp } : {});

  it("đạt: repo riêng tư, đẩy được; trả hạn dùng; gọi đúng 2 URL với token trong header", async () => {
    const f = fake(repoOk());
    const r = await checkGithubToken(TOKEN, "owner/kecon-backup", f, NOW);
    expect(r).toEqual({ ok: true, kind: "fine_grained", last4: "Wxyz", expiresAt: "2026-11-04T11:57:04.000Z", warnings: [] });
    const calls = (f as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((c) => String(c[0]))).toEqual([
      "https://api.github.com/repos/owner/kecon-backup",
      "https://github.com/owner/kecon-backup.git/info/refs?service=git-receive-pack",
    ]);
    expect((calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
    expect((calls[1][1] as RequestInit).headers).toMatchObject({ Authorization: `Basic ${btoa(`x-access-token:${TOKEN}`)}` });
  });

  it("mỗi lỗi một mã rõ ràng, không bao giờ lặp lại token", async () => {
    const cases: [Reply | Error, Reply | Error | undefined, string][] = [
      [reply(401), undefined, "token_invalid"],
      [reply(403), undefined, "token_invalid"],
      [reply(403, {}, { "x-ratelimit-remaining": "0" }), undefined, "github_unreachable"],
      [reply(404), undefined, "repo_not_found"],
      [reply(500), undefined, "github_unreachable"],
      [new TypeError("fetch failed"), undefined, "github_unreachable"],
      [repoOk(undefined, false), undefined, "repo_public"],
      [repoOk("2026-01-01 00:00:00 UTC"), undefined, "token_expired"],
      [repoOk(), reply(403), "token_no_push"],
      [repoOk(), reply(200, "<html>", { "content-type": "text/html" }), "token_no_push"],
      [repoOk(), reply(502), "github_unreachable"],
    ];
    for (const [api, refs, code] of cases) {
      const r = await checkGithubToken(TOKEN, "owner/kecon-backup", fake(api, refs), NOW);
      expect(r, code).toMatchObject({ ok: false, code });
      expect(JSON.stringify(r)).not.toContain(TOKEN.slice(11));
    }
  });

  it("cảnh báo kèm khi lưu: sắp hết hạn, không hạn, classic", async () => {
    const soon = await checkGithubToken(TOKEN, "o/r", fake(repoOk("2026-10-20 00:00:00 UTC")), NOW);
    expect(soon.ok && soon.warnings).toEqual([expect.stringContaining("còn 4 ngày")]);
    const none = await checkGithubToken(TOKEN, "o/r", fake(repoOk(null)), NOW);
    expect(none.ok && none.warnings).toEqual([expect.stringContaining("không đặt hạn")]);
    const classic = await checkGithubToken("ghp_" + "z".repeat(36), "o/r", fake(repoOk()), NOW);
    expect(classic).toMatchObject({ ok: true, kind: "classic", last4: "zzzz" });
    expect(classic.ok && classic.warnings).toEqual([expect.stringContaining("classic")]);
  });

  it("đọc header hạn dùng của GitHub", () => {
    expect(parseTokenExpiry("2026-11-04 11:57:04 UTC")).toBe("2026-11-04T11:57:04.000Z");
    expect(parseTokenExpiry("2026-11-04 18:57:04 +0700")).toBe("2026-11-04T11:57:04.000Z");
    expect(parseTokenExpiry("")).toBeNull();
    expect(parseTokenExpiry("never")).toBeNull();
  });
});

describe("thông báo cho nhân sự", () => {
  it("mã lỗi RPC → câu dễ hiểu, không lộ chữ của DB", () => {
    expect(backupRpcError({ code: "42501" })).toContain("phiên quản trị");
    expect(backupRpcError({ code: "40001" })).toContain("tải lại");
    expect(backupRpcError({ code: "55006" })).toContain("đang chạy");
    expect(backupRpcError({ code: "54000" })).toContain("3 lần");
    expect(backupRpcError({ code: "22023", message: "Lý do cần 10–500 ký tự" })).toContain("Lý do");
    expect(backupRpcError({ code: "22023", message: "Invalid token format" })).toContain("github_pat_");
    expect(backupRpcError({ code: "22023", message: "Invalid retention" })).toContain("3–30");
    expect(backupRpcError({ code: "XX000", message: "internal secret detail" })).not.toContain("secret");
  });

  it("báo khi một lần chạy vừa xong (kể cả yêu cầu bị từ chối ngay)", () => {
    const running = okRun(2, 0, { status: "running", finished_at: null, kind: "manual" });
    const before = status({ runs: [running, okRun(1, 60)], request: { id: 5, status: "running", requested_at: iso(3), reason: "Kiểm thử sao lưu", requested_by_email: null } });
    const done = okRun(2, 0, { kind: "manual" });
    expect(finishedSince(before, status({ runs: [done, okRun(1, 60)] })).map((r) => r.id)).toEqual([2]);
    const pending = status({ request: { id: 6, status: "pending", requested_at: iso(1), reason: "Kiểm thử sao lưu", requested_by_email: null } });
    const refused = okRun(3, 0, { kind: "manual", status: "failed", error: "Máy chủ chưa có mật khẩu mã hoá (passphrase) nên không sao lưu được" });
    expect(finishedSince(pending, status({ runs: [refused, okRun(1, 60)] })).map((r) => r.id)).toEqual([3]);
    expect(finishedSince(status(), status())).toEqual([]);
    expect(runOutcome(done)).toEqual({ ok: true, text: "Sao lưu xong: 40 truyện, khôi phục thử đạt, đã đẩy lên GitHub." });
    expect(runOutcome(refused).text).toContain("mật khẩu mã hoá");
  });
});
