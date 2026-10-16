/**
 * Admin › Sao lưu (migration 040, docs/admin-backup.md).
 *
 * - Chỉ backups.manage (super_admin, admin) + phiên quản trị TOTP xem / chạy / cấu hình;
 *   token GitHub cần thêm secrets.manage, nằm trong Vault, chỉ trả 4 ký tự cuối.
 * - Mọi thay đổi có lý do 10–500 ký tự và đúng một dòng nhật ký.
 * - Web không điều khiển máy chủ: chỉ ghi yêu cầu; worker (psql chủ bảng) đọc lịch,
 *   nhận yêu cầu, báo kết quả. Hàm worker không gọi được qua API.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asRole, asUser, createMigratedDb } from "./supabase-harness";

let db: PGlite;
const admin = randomUUID(),
  superAdmin = randomUUID(),
  editor = randomUUID(),
  ops = randomUUID(),
  fam = randomUUID();
const REASON = "Kiểm thử trang Sao lưu (040)";
const TOKEN = "github_pat_11TESTONLY0" + "a".repeat(60) + "Wxyz";
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const one = async <T = J>(uid: string, sql: string, args: unknown[] = []) =>
  (await asUser(db, uid, (tx) => tx.query<{ r: T }>(sql, args))).rows[0].r;
const status = (uid = admin) => one<J>(uid, "SELECT public.admin_backup_status() r");
const saveSettings = (version: number, time: string, d: number, w: number, m: number, reason = REASON, uid = admin) =>
  one<J>(uid, "SELECT public.admin_update_backup_settings($1,$2,$3,$4,$5,$6) r", [version, time, d, w, m, reason]);
const request = (reason = REASON, uid = admin) => one<J>(uid, "SELECT public.admin_request_backup($1) r", [reason]);
const setToken = (token: string, reason = REASON, uid = admin) => one<J>(uid, "SELECT public.admin_set_backup_token($1,$2) r", [token, reason]);
/** Worker calls run as the table owner (psql -U postgres on the server). */
const poll = async (state: J = {}) =>
  (
    await db.query<{ r: J }>("SELECT public.backup_worker_poll($1::jsonb) r", [
      JSON.stringify({ release: "abc1234", repo: "owner/kecon-backup", push_via: "file_token", passphrase_ok: true, snapshots: [], ...state }),
    ])
  ).rows[0].r;
const finish = (run: number, result: J) => db.query("SELECT public.backup_worker_finish($1,$2::jsonb)", [run, JSON.stringify(result)]);
const schedule = async (at: string) => (await db.query<{ r: J }>("SELECT public.backup_schedule($1::timestamptz) r", [at])).rows[0].r;
const audits = async (action: string) =>
  (await db.query<J>("SELECT actor_id, target_id, before, after, reason, source FROM public.admin_audit_log WHERE action=$1 ORDER BY id", [action])).rows;
const reset = () => db.exec("DELETE FROM public.backup_runs; DELETE FROM public.backup_requests;");

beforeAll(async () => {
  ({ db } = await createMigratedDb());
  await db.query(
    "INSERT INTO auth.users(id,email) VALUES($1,'bk-admin@bk.test'),($2,'bk-super@bk.test'),($3,'bk-editor@bk.test'),($4,'bk-ops@bk.test'),($5,'bk-fam@bk.test')",
    [admin, superAdmin, editor, ops, fam],
  );
  for (const [id, role] of [[admin, "admin"], [superAdmin, "super_admin"], [editor, "editor"], [ops, "ops"]])
    await db.query("UPDATE public.profiles SET role=$2 WHERE id=$1", [id, role]);
});
afterAll(async () => {
  await db?.close();
});

describe("quyền", () => {
  it("chỉ super_admin + admin có backups.manage; vai trò có quyền này luôn cần TOTP", async () => {
    const roles = (await db.query<{ role: string }>("SELECT role FROM public.admin_role_permissions WHERE permission='backups.manage' ORDER BY role")).rows;
    expect(roles.map((r) => r.role)).toEqual(["admin", "super_admin"]);
    const mfa = await db.transaction(async (tx) => {
      await tx.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: admin, role: "authenticated" })]);
      await tx.query("DELETE FROM public.admin_role_permissions WHERE role='admin' AND permission<>'backups.manage'");
      const r = (await tx.query<{ r: boolean }>("SELECT public.admin_requires_mfa() r")).rows[0].r;
      await tx.rollback();
      return r;
    });
    expect(mfa).toBe(true); // backups.manage alone is enough to require TOTP
    expect((await status(superAdmin)).settings.schedule_time).toBe("03:15");
  });

  it("gia đình, biên tập, vận hành, khách: không xem / chạy / đổi được gì", async () => {
    for (const uid of [fam, editor, ops]) {
      await expect(status(uid)).rejects.toThrow(/Permission denied/);
      await expect(request(REASON, uid)).rejects.toThrow(/Permission denied/);
      await expect(saveSettings(1, "04:00", 7, 4, 6, REASON, uid)).rejects.toThrow(/Permission denied/);
      await expect(setToken(TOKEN, REASON, uid)).rejects.toThrow(/Permission denied/);
    }
    await expect(asAnon(db, (tx) => tx.query("SELECT public.admin_backup_status()"))).rejects.toThrow(/permission denied/);
  });

  it("admin chưa qua TOTP (aal1) bị từ chối dù đúng vai trò", async () => {
    await status(admin); // creates the admin session row like a real sign-in
    await expect(
      asRole(db, "authenticated", admin, (tx) => tx.query("SELECT public.admin_backup_status()"), { session_id: admin, aal: "aal1" }),
    ).rejects.toThrow(/Permission denied/);
  });

  it("không ai đọc / ghi thẳng bảng; hàm worker không gọi được qua API (kể cả service role)", async () => {
    for (const table of ["backup_settings", "backup_requests", "backup_runs", "backup_worker"]) {
      await expect(asUser(db, admin, (tx) => tx.query(`SELECT * FROM public.${table}`))).rejects.toThrow(/permission denied/);
      await expect(asRole(db, "service_role", null, (tx) => tx.query(`SELECT * FROM public.${table}`))).rejects.toThrow(/permission denied/);
    }
    await expect(asUser(db, admin, (tx) => tx.query("UPDATE public.backup_settings SET keep_daily=3"))).rejects.toThrow(/permission denied/);
    for (const fn of [
      "public.backup_worker_poll('{}'::jsonb)",
      "public.backup_worker_token()",
      "public.backup_worker_finish(1,'{}'::jsonb)",
      "public.backup_worker_progress(1,'x')",
      "public.backup_worker_token_check('{}'::jsonb)",
      "public.backup_schedule(now())",
    ]) {
      await expect(asUser(db, admin, (tx) => tx.query(`SELECT ${fn}`))).rejects.toThrow(/permission denied/);
      await expect(asRole(db, "service_role", null, (tx) => tx.query(`SELECT ${fn}`))).rejects.toThrow(/permission denied/);
      await expect(asAnon(db, (tx) => tx.query(`SELECT ${fn}`))).rejects.toThrow(/permission denied/);
    }
  });
});

describe("lịch + số bản giữ lại", () => {
  it("mặc định 03:15 giờ VN, 7 ngày + 4 tuần + 6 tháng; chưa có token, máy chủ chưa báo về", async () => {
    const s = await status();
    expect(s.settings).toMatchObject({ schedule_time: "03:15", keep_daily: 7, keep_weekly: 4, keep_monthly: 6, version: 1 });
    expect(s.token).toMatchObject({ is_set: false, last4: null });
    expect(s.worker).toMatchObject({ heartbeat_at: null, repo: null, snapshots: [] });
    expect(s.runs).toEqual([]);
    expect(s.schedule.timezone).toBe("Asia/Ho_Chi_Minh");
    expect(s.limits).toMatchObject({ requests_per_hour: 3, keep_daily: [3, 30], keep_weekly: [0, 12], keep_monthly: [0, 24] });
  });

  it("lưu cần lý do + đúng phiên bản; một dòng nhật ký trước → sau; không đổi gì = không ghi", async () => {
    await expect(saveSettings(1, "04:30", 14, 4, 6, "ngắn")).rejects.toThrow(/Lý do/);
    expect(await saveSettings(1, "04:30", 14, 4, 6)).toEqual({ changed: true, version: 2 });
    await expect(saveSettings(1, "05:00", 14, 4, 6)).rejects.toMatchObject({ code: "40001" });
    expect(await saveSettings(2, "04:30", 14, 4, 6)).toEqual({ changed: false, version: 2 });
    const rows = await audits("backup.settings_update");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_id: admin,
      target_id: "settings",
      reason: REASON,
      source: "db",
      before: { schedule_time: "03:15", keep_daily: 7, keep_weekly: 4, keep_monthly: 6, version: 1 },
      after: { schedule_time: "04:30", keep_daily: 14, keep_weekly: 4, keep_monthly: 6, version: 2 },
    });
    const s = await status();
    expect(s.settings).toMatchObject({ schedule_time: "04:30", keep_daily: 14, version: 2, updated_by_email: "bk-admin@bk.test" });
  });

  it("giờ HH:MM 00:00–23:59; ngày 3–30, tuần 0–12, tháng 0–24 (không xoá sạch lịch sử được)", async () => {
    for (const t of ["24:00", "3:15", "03:15:30", "", "abc"]) await expect(saveSettings(2, t, 7, 4, 6)).rejects.toMatchObject({ code: "22023" });
    for (const [d, w, m] of [[2, 4, 6], [31, 4, 6], [7, -1, 6], [7, 13, 6], [7, 4, 25], [0, 0, 0]])
      await expect(saveSettings(2, "04:30", d, w, m)).rejects.toMatchObject({ code: "22023" });
    expect(await saveSettings(2, "03:15", 7, 4, 6)).toEqual({ changed: true, version: 3 });
  });
});

describe("lịch chạy (giờ Việt Nam)", () => {
  // 03:15 VN = 20:15 UTC hôm trước. p_now cố định để kết quả không phụ thuộc giờ chạy test.
  const NOW = "2026-10-16T05:00:00Z"; // 12:00 VN → slot 2026-10-16 03:15 VN = 2026-10-15T20:15Z
  const SLOT = "2026-10-15T20:15:00+00:00";
  const run = (kind: string, status: string, started: string, finished: string | null) =>
    db.query("INSERT INTO public.backup_runs(kind,status,started_at,finished_at) VALUES($1,$2,$3,$4)", [kind, status, started, finished]);

  it("chưa chạy kể từ slot → đến hạn ngay; đã thành công (kể cả chạy tay) → lần tới là slot mai", async () => {
    await reset();
    await db.query("UPDATE public.backup_settings SET schedule_changed_at=NULL"); // set by the settings tests above
    expect(await schedule(NOW)).toMatchObject({ slot: SLOT, due: true, slot_done: false, tries: 0 });
    await run("manual", "ok", "2026-10-16T01:00:00Z", "2026-10-16T01:05:00Z");
    const s = await schedule(NOW);
    expect(s).toMatchObject({ due: false, slot_done: true });
    expect(new Date(s.next_run_at).toISOString()).toBe("2026-10-16T20:15:00.000Z");
  });

  it("lần theo lịch lỗi → thử lại sau 30 phút, tối đa 3 lần mỗi slot", async () => {
    await reset();
    await run("scheduled", "push_failed", "2026-10-16T04:40:00Z", "2026-10-16T04:45:00Z");
    let s = await schedule(NOW);
    expect(s).toMatchObject({ due: false, tries: 1 });
    expect(new Date(s.next_run_at).toISOString()).toBe("2026-10-16T05:15:00.000Z");
    expect(await schedule("2026-10-16T05:16:00Z")).toMatchObject({ due: true });
    await run("scheduled", "failed", "2026-10-16T03:00:00Z", "2026-10-16T03:01:00Z");
    await run("scheduled", "failed", "2026-10-16T02:00:00Z", "2026-10-16T02:01:00Z");
    s = await schedule("2026-10-16T06:00:00Z");
    expect(s).toMatchObject({ due: false, tries: 3 });
    expect(new Date(s.next_run_at).toISOString()).toBe("2026-10-16T20:15:00.000Z");
  });

  it("đổi giờ sau slot hôm nay: không chạy bù bất ngờ; đang chạy thì không đến hạn", async () => {
    await reset();
    await db.query("UPDATE public.backup_settings SET schedule_changed_at=$1", ["2026-10-16T04:00:00Z"]);
    expect(await schedule(NOW)).toMatchObject({ due: false });
    expect(await schedule("2026-10-16T20:16:00Z")).toMatchObject({ due: true });
    await db.query("UPDATE public.backup_settings SET schedule_changed_at=NULL");
    await run("scheduled", "running", "2026-10-16T04:59:00Z", null);
    expect(await schedule(NOW)).toMatchObject({ due: false, running: true, next_run_at: null });
    await reset();
  });
});

describe("Sao lưu ngay + worker", () => {
  it("yêu cầu cần lý do, ghi nhật ký; chỉ một yêu cầu mở; worker nhận → chạy → báo kết quả", async () => {
    await reset();
    await expect(request("ngắn")).rejects.toThrow(/Lý do/);
    const r = await request();
    expect(r).toMatchObject({ status: "pending" });
    await expect(request()).rejects.toMatchObject({ code: "55006" });
    const a = await audits("backup.run_request");
    expect(a.at(-1)).toMatchObject({ actor_id: admin, target_id: String(r.id), reason: REASON, source: "db" });

    const p = await poll({ snapshots: [{ file: "db-20261016T102451Z.dump.gpg", taken: "20261016T102451Z", plain_bytes: 1234 }] });
    expect(p.run).toMatchObject({ kind: "manual" });
    expect(p.settings).toEqual({ schedule_time: "03:15", keep_daily: 7, keep_weekly: 4, keep_monthly: 6 });
    let s = await status();
    expect(s.request).toMatchObject({ id: r.id, status: "running", requested_by_email: "bk-admin@bk.test", reason: REASON });
    expect(s.runs[0]).toMatchObject({ kind: "manual", status: "running", phase: "start", reason: REASON, release: "abc1234" });
    expect(s.worker).toMatchObject({ repo: "owner/kecon-backup", push_via: "file_token", passphrase_ok: true, release: "abc1234" });
    expect(s.worker.snapshots).toHaveLength(1);
    await expect(request()).rejects.toMatchObject({ code: "55006" }); // running

    await db.query("SELECT public.backup_worker_progress($1,'restore_check')", [p.run.id]);
    expect((await status()).runs[0].phase).toBe("restore_check");
    await finish(p.run.id, { status: "ok", exit_code: 0, summary: { stories: 40, restore_check: { ok: true } }, snapshots: [] });
    s = await status();
    expect(s.request).toBeNull();
    expect(s.runs[0]).toMatchObject({ status: "ok", exit_code: 0, phase: null, summary: { stories: 40 } });
    expect(s.last_success).toMatchObject({ id: p.run.id, summary: { stories: 40 } });
    expect(s.worker.snapshots).toEqual([]);
    expect((await db.query<J>("SELECT status FROM public.backup_requests WHERE id=$1", [r.id])).rows[0].status).toBe("done");
  });

  it("tối đa 3 yêu cầu mỗi giờ", async () => {
    for (let i = 0; i < 2; i++) {
      await request();
      const p = await poll();
      await finish(p.run.id, { status: "failed", exit_code: 1, error: "x" });
    }
    await expect(request()).rejects.toMatchObject({ code: "54000" });
    expect((await status()).requests_last_hour).toBe(3);
    await reset();
  });

  it("lần chạy bị ngắt giữa chừng được đóng là lỗi ở lượt sau; yêu cầu quá 6 giờ hết hạn", async () => {
    await request();
    const p = await poll();
    expect(p.run.kind).toBe("manual");
    // Server rebooted: the next tick finds the run still "running".
    const next = await poll({ passphrase_ok: false });
    expect(next.run).toBeNull();
    const s = await status();
    expect(s.runs[0]).toMatchObject({ status: "failed", error: expect.stringContaining("gián đoạn") });
    expect(s.request).toBeNull();
    await db.query("INSERT INTO public.backup_requests(reason,requested_at) VALUES($1, now()-interval '7 hours')", [REASON]);
    await poll({ passphrase_ok: false });
    expect((await db.query<J>("SELECT status FROM public.backup_requests ORDER BY id DESC LIMIT 1")).rows[0].status).toBe("expired");
    await reset();
  });

  it("máy chủ thiếu mật khẩu mã hoá: không chạy, yêu cầu báo lỗi rõ ràng", async () => {
    await request();
    const p = await poll({ passphrase_ok: false });
    expect(p.run).toBeNull();
    const s = await status();
    expect(s.runs[0]).toMatchObject({ kind: "manual", status: "failed", error: expect.stringContaining("mật khẩu mã hoá") });
    expect(s.worker.passphrase_ok).toBe(false);
    await reset();
  });

  it("lượt đầu sau migration: giữ lần chạy cũ (last-run.json) làm lịch sử; file hỏng thì bỏ qua", async () => {
    await reset();
    await poll({ passphrase_ok: false, legacy: { started_at: "2026-10-16T10:24:51Z", finished_at: "x", status: "ok" } });
    expect((await status()).runs).toEqual([]);
    const legacy = { started_at: "2026-10-16T10:24:51Z", finished_at: "2026-10-16T10:25:40Z", status: "ok", exit_code: 0, summary: { stories: 40 } };
    await poll({ passphrase_ok: false, legacy });
    await poll({ passphrase_ok: false, legacy: { ...legacy, started_at: "2026-10-17T10:00:00Z" } }); // only once
    const s = await status();
    expect(s.runs).toHaveLength(1);
    expect(s.runs[0]).toMatchObject({ kind: "cli", status: "ok", summary: { stories: 40 } });
    await reset();
  });

  it("chạy tay trên máy chủ (mode cli) luôn được ghi một lần chạy", async () => {
    const p = await poll({ mode: "cli" });
    expect(p.run.kind).toBe("cli");
    await finish(p.run.id, { status: "restore_failed", exit_code: 4, summary: { restore_check: { ok: false } } });
    expect((await status()).runs[0]).toMatchObject({ kind: "cli", status: "restore_failed", exit_code: 4 });
    await reset();
  });

  it("chạy thử không đẩy (mode peek) chỉ đọc cài đặt: không nhận yêu cầu, không tính là lần sao lưu trong ngày", async () => {
    await request();
    const p = await poll({ mode: "peek" });
    expect(p.run).toBeNull();
    expect(p.settings).toMatchObject({ schedule_time: "03:15", keep_daily: 7 });
    const s = await status();
    expect(s.runs).toHaveLength(0);
    expect(s.request).toMatchObject({ status: "pending" });
    expect((await poll()).run.kind).toBe("manual");
    await reset();
  });
});

describe("token GitHub (chỉ-ghi, Vault)", () => {
  it("cần secrets.manage: vai trò chỉ có backups.manage xem / chạy được nhưng không đặt token", async () => {
    await db.query("INSERT INTO public.admin_role_permissions(role,permission) VALUES('ops','backups.manage')");
    try {
      expect((await status(ops)).can_set_token).toBe(false);
      await expect(setToken(TOKEN, REASON, ops)).rejects.toThrow(/Permission denied/);
    } finally {
      await db.query("DELETE FROM public.admin_role_permissions WHERE role='ops' AND permission='backups.manage'");
    }
  });

  it("chỉ nhận fine-grained (github_pat_) hoặc classic (ghp_), không khoảng trắng", async () => {
    for (const t of ["", "abc", "gho_" + "a".repeat(36), "ghp_short", `${TOKEN} x`, "github_pat_" + "a".repeat(10)])
      await expect(setToken(t)).rejects.toMatchObject({ code: "22023" });
  });

  it("lưu vào Vault (mã hoá), trạng thái + nhật ký chỉ có 4 ký tự cuối; worker đọc được bằng quyền chủ bảng", async () => {
    expect(await setToken(`  ${TOKEN}\n`)).toMatchObject({ last4: "Wxyz", kind: "fine_grained" });
    const s = await status();
    expect(s.token).toMatchObject({ is_set: true, last4: "Wxyz", kind: "fine_grained", set_by_email: "bk-admin@bk.test" });
    expect(s.can_set_token).toBe(true);
    expect(JSON.stringify(s)).not.toContain(TOKEN.slice(11, 40));
    const vault = (await db.query<J>("SELECT name, secret FROM vault.secrets WHERE name='kecon/backup/github_token'")).rows;
    expect(vault).toHaveLength(1);
    expect(vault[0].secret).not.toContain(TOKEN.slice(11, 40));
    expect((await db.query<J>("SELECT public.backup_worker_token() t")).rows[0].t).toBe(TOKEN);
    const audit = await audits("backup.token_set");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ target_id: "github_token", reason: REASON, before: { is_set: false }, after: { is_set: true, last4: "…Wxyz", kind: "fine_grained" } });
    expect(JSON.stringify(audit)).not.toContain(TOKEN.slice(11, 40));
    // Rotate: same Vault row, new value.
    const classic = "ghp_" + "b".repeat(32) + "Q123";
    expect(await setToken(classic)).toMatchObject({ last4: "Q123", kind: "classic" });
    expect((await db.query<J>("SELECT count(*)::int n FROM vault.secrets WHERE name='kecon/backup/github_token'")).rows[0].n).toBe(1);
    expect((await db.query<J>("SELECT public.backup_worker_token() t")).rows[0].t).toBe(classic);
    expect((await poll()).token).toMatchObject({ in_vault: true, last4: "Q123" });
  });

  it("kết quả kiểm tra token của máy chủ chỉ giữ các trường đã biết (không lọt token vào bảng)", async () => {
    await db.query("SELECT public.backup_worker_token_check($1::jsonb)", [
      JSON.stringify({ status: "ok", source: "vault_token", kind: "fine_grained", last4: "Q123", push: true, private: true, expires_at: "2026-11-04T11:57:04+00:00", token: TOKEN, message: "ok" }),
    ]);
    const c = (await status()).worker.token_check;
    expect(c).toMatchObject({ status: "ok", source: "vault_token", last4: "Q123", push: true, private: true, expires_at: "2026-11-04T11:57:04+00:00" });
    expect(c.checked_at).toBeTruthy();
    expect(Object.keys(c).sort()).toEqual(["checked_at", "expires_at", "kind", "last4", "message", "private", "push", "source", "status"]);
    expect((await poll()).token_check).toMatchObject({ status: "ok", last4: "Q123" });
  });
});
