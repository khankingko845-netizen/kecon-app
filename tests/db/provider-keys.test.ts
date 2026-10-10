/**
 * Admin v2 · A-04b — kho nhiều API key giọng nói, xoay vòng + bù key (migration 022).
 *
 * - Mỗi nhà cung cấp (ElevenLabs / Fish Audio) giữ nhiều key, giá trị mã hoá
 *   trong Vault; bảng chỉ có 4 ký tự cuối + băm (chặn trùng) + trạng thái.
 * - API chỉ-ghi cho admin (secrets.manage): list / add / update / delete —
 *   không hàm nào trả key; mọi thao tác vào nhật ký, không kèm key.
 * - Chỉ service role (server) lấy được kho kèm key, báo trạng thái (hết credit /
 *   key sai / hoạt động lại), cộng lượt dùng và nhớ giọng nhân bản thuộc key nào.
 * - Key ElevenLabs đơn của A-04 được chuyển vào kho, giọng nhân bản cũ gắn với nó.
 */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@/lib/admin-permissions";
import { applyMigrationFile, asAnon, asRole, asUser, createMigratedDb, listMigrations } from "./supabase-harness";

const POOL_MIGRATION = "022_provider_key_pool.sql";
const LEGACY_EL = "sk_legacy-ELEVEN-single-0042";
const FISH_A = "fish-key-AAAA-1111-aaaa-Fa01";
const FISH_B = "fish-key-BBBB-2222-bbbb-Fb02";
const EL_B = "sk_eleven-second-account-Eb22";
const CLONED_VOICE = "clonedVoiceAbc123";

type KeyRow = {
  id: string; provider: string; label: string; last4: string | null; enabled: boolean; status: string;
  cooldown_until: string | null; last_error: string | null; use_count: number; char_count: number;
  credit: Record<string, unknown> | null; created_by_email: string | null;
};
type PoolRow = { id: string; label: string; last4: string | null; secret: string; status: string; cooldown_until: string | null };

let db: PGlite;
const u = {} as Record<"superAdmin" | "admin" | "editor" | "ops" | "family", string>;

async function createUser(role: UserRole = "user"): Promise<string> {
  const id = randomUUID();
  await db.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [id, `${role}-${id.slice(0, 8)}@test.local`]);
  if (role !== "user") await db.query("UPDATE public.profiles SET role = $2 WHERE id = $1", [id, role]);
  return id;
}

const run = <T = Record<string, unknown>>(uid: string, sql: string, params: unknown[] = []) =>
  asUser(db, uid, async (tx) => (await tx.query<T>(sql, params)).rows);
const asService = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  asRole(db, "service_role", null, async (tx) => (await tx.query<T>(sql, params)).rows);
const pool = (provider: string) => asService<PoolRow>("SELECT * FROM public.get_provider_key_pool($1)", [provider]);
const list = (uid: string) => run<KeyRow>(uid, "SELECT * FROM public.list_provider_keys()");
const addKey = async (uid: string, provider: string, value: string, label: string | null = null) =>
  (await run<{ r: Record<string, unknown> }>(uid, "SELECT public.add_provider_key($1, $2, $3) AS r", [provider, value, label]))[0].r;

async function lastLogId(): Promise<number> {
  const { rows } = await db.query<{ id: number | null }>("SELECT max(id) AS id FROM public.admin_audit_log");
  return Number(rows[0].id ?? 0);
}
async function logsSince(afterId: number) {
  const { rows } = await db.query<{
    action: string; actor_id: string | null; target_type: string; target_id: string;
    before: Record<string, unknown> | null; after: Record<string, unknown> | null; reason: string | null; source: string;
  }>("SELECT * FROM public.admin_audit_log WHERE id > $1 ORDER BY id", [afterId]);
  return rows;
}
async function mentions(table: string, needle: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} t WHERE row_to_json(t)::text LIKE $1`, [
    `%${needle}%`,
  ]);
  return rows[0].n;
}

let legacyId: string;
let fishA: string;

beforeAll(async () => {
  // Before 022: one ElevenLabs key in Vault (A-04) + a family voice cloned with it.
  ({ db } = await createMigratedDb({ stopBefore: POOL_MIGRATION }));
  u.admin = await createUser("admin");
  await run(u.admin, "SELECT public.set_system_secret('elevenlabs_api_key', $1)", [LEGACY_EL]);
  u.family = await createUser();
  await db.query("INSERT INTO public.voice_profiles (user_id, name, elevenlabs_voice_id) VALUES ($1, 'Giọng mẹ', $2)", [u.family, CLONED_VOICE]);
  for (const file of listMigrations().filter((f) => f >= POOL_MIGRATION)) await applyMigrationFile(db, file);

  u.superAdmin = await createUser("super_admin");
  u.editor = await createUser("editor");
  u.ops = await createUser("ops");
});

afterAll(async () => {
  await db?.close();
});

describe("022 · chuyển key ElevenLabs đơn vào kho", () => {
  it("key cũ thành key đầu tiên của kho, server vẫn đọc được; ô key đơn và bản Vault cũ không còn", async () => {
    const rows = await pool("elevenlabs");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "Key chính (chuyển từ A-04)", last4: LEGACY_EL.slice(-4), secret: LEGACY_EL, status: "active" });
    legacyId = rows[0].id;

    expect((await db.query("SELECT 1 FROM public.app_settings WHERE key = 'elevenlabs_api_key'")).rows).toHaveLength(0);
    expect((await db.query("SELECT 1 FROM public.app_secrets WHERE key = 'elevenlabs_api_key'")).rows).toHaveLength(0);
    expect((await db.query("SELECT 1 FROM vault.secrets WHERE name = 'kecon/app_settings/elevenlabs_api_key'")).rows).toHaveLength(0);
    expect((await db.query("SELECT name FROM vault.secrets WHERE name LIKE 'kecon/provider_keys/%'")).rows).toHaveLength(1);
    const { rows: model } = await db.query<{ value: string; is_secret: boolean }>(
      "SELECT value, is_secret FROM public.app_settings WHERE key = 'fishaudio_model_id'"
    );
    expect(model).toEqual([{ value: "s2.1-pro", is_secret: false }]);
  });

  it("giọng nhân bản cũ được gắn với key đã tạo ra nó; nhật ký ghi việc chuyển (không kèm key)", async () => {
    const [{ k }] = await asService<{ k: string | null }>("SELECT public.get_provider_voice_key('elevenlabs', $1) AS k", [CLONED_VOICE]);
    expect(k).toBe(legacyId);
    const { rows } = await db.query<{ action: string; source: string; reason: string; after: Record<string, unknown> }>(
      "SELECT action, source, reason, after FROM public.admin_audit_log WHERE action = 'provider_key.add'"
    );
    expect(rows).toEqual([
      expect.objectContaining({
        source: "system",
        reason: "Migration 022: chuyển key ElevenLabs vào kho nhiều key",
        after: { provider: "elevenlabs", label: "Key chính (chuyển từ A-04)", last4: `…${LEGACY_EL.slice(-4)}`, enabled: true, status: "active" },
      }),
    ]);
    expect(await mentions("public.admin_audit_log", LEGACY_EL)).toBe(0);
  });
});

describe("022 · admin quản lý kho (chỉ-ghi)", () => {
  it("thêm key: cắt khoảng trắng hai đầu, chỉ trả trạng thái + 4 ký tự cuối, ghi nhật ký", async () => {
    const from = await lastLogId();
    const r = await addKey(u.admin, "fishaudio", `  ${FISH_A}\n`, "  Tài khoản Fish 1 ");
    expect(r).toMatchObject({ provider: "fishaudio", label: "Tài khoản Fish 1", last4: FISH_A.slice(-4), enabled: true, status: "active" });
    expect(JSON.stringify(r)).not.toContain(FISH_A);
    fishA = String(r.id);
    await addKey(u.superAdmin, "fishaudio", FISH_B);
    await addKey(u.superAdmin, "elevenlabs", EL_B, "Tài khoản 2");

    const logs = await logsSince(from);
    expect(logs.map((l) => [l.action, l.actor_id, l.target_type, l.source])).toEqual([
      ["provider_key.add", u.admin, "provider_key", "db"],
      ["provider_key.add", u.superAdmin, "provider_key", "db"],
      ["provider_key.add", u.superAdmin, "provider_key", "db"],
    ]);
    expect(logs[0].after).toEqual({ provider: "fishaudio", label: "Tài khoản Fish 1", last4: `…${FISH_A.slice(-4)}`, enabled: true, status: "active" });
    expect((await pool("fishaudio")).map((p) => p.secret)).toEqual([FISH_A, FISH_B]);
    expect((await pool("elevenlabs")).map((p) => p.secret)).toEqual([LEGACY_EL, EL_B]);
  });

  it("từ chối key trùng / quá ngắn / có khoảng trắng giữa / nhà cung cấp lạ", async () => {
    await expect(addKey(u.admin, "fishaudio", FISH_A)).rejects.toThrow(/Key này đã có trong kho Fish Audio \(…Fa01\)/);
    await expect(addKey(u.admin, "elevenlabs", "sk_short")).rejects.toThrow(/quá ngắn/);
    await expect(addKey(u.admin, "elevenlabs", "sk_abc def-123456789")).rejects.toThrow(/khoảng trắng/);
    await expect(addKey(u.admin, "elevenlabs", "")).rejects.toThrow(/Chưa nhập API key/);
    await expect(addKey(u.admin, "openai", "sk-proj-1234567890abcd")).rejects.toThrow(/Nhà cung cấp không hợp lệ/);
    // Same key in another provider is a different pool → allowed.
    await expect(addKey(u.admin, "elevenlabs", FISH_A)).resolves.toMatchObject({ provider: "elevenlabs" });
    const [{ id }] = await db.query<{ id: string }>(
      "SELECT id FROM public.provider_api_keys WHERE provider = 'elevenlabs' ORDER BY created_at DESC LIMIT 1"
    ).then((r) => r.rows);
    await run(u.admin, "SELECT public.delete_provider_key($1, 'Dọn key dùng thử trong test')", [id]);
  });

  it("chỉ secrets.manage: biên tập / vận hành / gia đình / khách không xem, không thêm được", async () => {
    for (const uid of [u.editor, u.ops, u.family]) {
      await expect(list(uid)).rejects.toThrow(/Chỉ Super admin \/ Admin xem được kho API key/);
      await expect(addKey(uid, "fishaudio", "fish-key-hijack-000000")).rejects.toThrow(/Chỉ Super admin \/ Admin thêm được/);
      await expect(run(uid, "SELECT public.delete_provider_key($1)", [fishA])).rejects.toThrow(/Chỉ Super admin \/ Admin xoá được/);
    }
    await expect(asAnon(db, (tx) => tx.query("SELECT * FROM public.list_provider_keys()"))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query("SELECT public.add_provider_key('fishaudio', 'fish-key-anon-0000000')"))).rejects.toThrow(
      /permission denied/
    );
  });

  it("danh sách: trạng thái, 4 ký tự cuối, người thêm — không có key, không có băm", async () => {
    const rows = await list(u.admin);
    expect(rows.map((r) => [r.provider, r.last4])).toEqual([
      ["elevenlabs", LEGACY_EL.slice(-4)],
      ["elevenlabs", EL_B.slice(-4)],
      ["fishaudio", FISH_A.slice(-4)],
      ["fishaudio", FISH_B.slice(-4)],
    ]);
    expect(rows[2]).toMatchObject({ label: "Tài khoản Fish 1", status: "active", enabled: true, created_by_email: expect.stringMatching(/^admin-/) });
    expect(Object.keys(rows[0]).sort()).toEqual(
      [
        "char_count", "cooldown_until", "created_at", "created_by_email", "credit", "credit_checked_at", "enabled", "id",
        "label", "last4", "last_error", "last_used_at", "provider", "status", "updated_at", "use_count",
      ].sort()
    );
    const text = JSON.stringify(rows);
    for (const key of [LEGACY_EL, FISH_A, FISH_B, EL_B]) expect(text).not.toContain(key);
  });

  it("không ai đọc thẳng bảng kho / bảng gắn giọng — kể cả super admin và service role", async () => {
    for (const table of ["public.provider_api_keys", "public.provider_voice_bindings"]) {
      await expect(run(u.superAdmin, `SELECT * FROM ${table}`)).rejects.toThrow(/permission denied/);
      await expect(asService(`SELECT * FROM ${table}`)).rejects.toThrow(/permission denied/);
    }
    await expect(run(u.superAdmin, "UPDATE public.provider_api_keys SET status = 'active'")).rejects.toThrow(/permission denied/);
  });
});

describe("022 · server (service role): lấy kho, báo trạng thái, lượt dùng", () => {
  it("chỉ service role lấy được kho / key; người dùng (kể cả super admin) bị từ chối", async () => {
    for (const sql of [
      "SELECT * FROM public.get_provider_key_pool('elevenlabs')",
      `SELECT public.get_provider_key_secret('${fishA}')`,
      `SELECT public.report_provider_key('${fishA}', 'invalid')`,
      `SELECT public.record_provider_key_usage('${fishA}', 1, 10)`,
      `SELECT public.bind_provider_voice('fishaudio', 'v', '${fishA}')`,
      "SELECT public.get_provider_voice_key('elevenlabs', 'v')",
    ]) {
      await expect(run(u.superAdmin, sql), sql).rejects.toThrow(/permission denied/);
      await expect(asAnon(db, (tx) => tx.query(sql)), sql).rejects.toThrow(/permission denied/);
    }
    const [{ s }] = await asService<{ s: string }>("SELECT public.get_provider_key_secret($1) AS s", [fishA]);
    expect(s).toBe(FISH_A);
  });

  it("hết credit → 'exhausted' + giờ thử lại; vẫn trong kho để thử lại sau; nhật ký 1 lần (nguồn hệ thống)", async () => {
    const from = await lastLogId();
    const retry = new Date(Date.now() + 3600_000).toISOString();
    await asService("SELECT public.report_provider_key($1, 'exhausted', $2, $3)", [fishA, "Fish Audio 402: hết credit", retry]);
    await asService("SELECT public.report_provider_key($1, 'exhausted', $2, $3)", [fishA, "Fish Audio 402: hết credit", retry]);
    const row = (await pool("fishaudio")).find((p) => p.id === fishA)!;
    expect(row.status).toBe("exhausted");
    expect(new Date(row.cooldown_until!).getTime()).toBe(Date.parse(retry));
    const logs = await logsSince(from);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: "provider_key.status", actor_id: null, source: "system", target_id: fishA,
      before: { status: "active" }, after: expect.objectContaining({ status: "exhausted", error: "Fish Audio 402: hết credit" }),
      reason: `Tự động: Fish Audio …${FISH_A.slice(-4)}`,
    });
  });

  it("key 'exhausted' chạy được lại → cộng lượt dùng và tự về 'active'", async () => {
    await asService("SELECT public.record_provider_key_usage($1, 3, 1200)", [fishA]);
    const row = (await list(u.admin)).find((r) => r.id === fishA)!;
    expect(row).toMatchObject({ status: "active", cooldown_until: null, last_error: null, use_count: 3, char_count: 1200 });
    const { rows } = await db.query<{ after: Record<string, unknown> }>(
      "SELECT after FROM public.admin_audit_log WHERE action = 'provider_key.status' ORDER BY id DESC LIMIT 1"
    );
    expect(rows[0].after).toMatchObject({ status: "active" });
  });

  it("key sai → 'invalid', rời kho cho tới khi admin bật lại; credit đọc được được lưu", async () => {
    await asService("SELECT public.report_provider_key($1, 'invalid', 'Fish Audio 401: Invalid Token')", [fishA]);
    expect((await pool("fishaudio")).map((p) => p.id)).not.toContain(fishA);
    await asService("SELECT public.report_provider_key($1, NULL, NULL, NULL, $2)", [fishA, JSON.stringify({ unit: "usd", balance: 3.5 })]);
    expect((await list(u.admin)).find((r) => r.id === fishA)).toMatchObject({
      status: "invalid", last_error: "Fish Audio 401: Invalid Token", credit: { unit: "usd", balance: 3.5 },
    });
    await expect(asService("SELECT public.report_provider_key($1, 'broken')", [fishA])).rejects.toThrow(/Trạng thái key không hợp lệ/);
    // Unknown id (key just deleted) → no-op.
    await expect(asService("SELECT public.report_provider_key($1, 'invalid')", [randomUUID()])).resolves.toEqual([{ report_provider_key: null }]);
  });

  it("admin tắt → rời kho; bật lại → 'active', xoá lỗi; nhật ký có trước / sau (không kèm key)", async () => {
    const from = await lastLogId();
    await run(u.admin, "SELECT public.update_provider_key($1, p_enabled => true)", [fishA]);
    expect((await pool("fishaudio")).find((p) => p.id === fishA)).toMatchObject({ status: "active" });
    await run(u.admin, "SELECT public.update_provider_key($1, p_label => 'Fish chính', p_enabled => false, p_reason => 'Tạm nghỉ')", [fishA]);
    expect((await pool("fishaudio")).map((p) => p.id)).not.toContain(fishA);
    const logs = await logsSince(from);
    expect(logs.map((l) => l.action)).toEqual(["provider_key.update", "provider_key.update"]);
    expect(logs[0].before).toMatchObject({ status: "invalid", enabled: true });
    expect(logs[0].after).toMatchObject({ status: "active", enabled: true });
    expect(logs[1]).toMatchObject({ reason: "Tạm nghỉ", after: expect.objectContaining({ label: "Fish chính", enabled: false }) });
    await run(u.admin, "SELECT public.update_provider_key($1, p_enabled => true)", [fishA]);
    await expect(run(u.admin, "SELECT public.update_provider_key($1, 'x')", [randomUUID()])).rejects.toThrow(/Không tìm thấy key/);
  });

  it("gắn giọng nhân bản với key; key khác nhà cung cấp bị bỏ qua", async () => {
    await asService("SELECT public.bind_provider_voice('fishaudio', 'fishModel01', $1)", [fishA]);
    await asService("SELECT public.bind_provider_voice('elevenlabs', 'wrongProvider', $1)", [fishA]);
    const keyOf = async (p: string, v: string) =>
      (await asService<{ k: string | null }>("SELECT public.get_provider_voice_key($1, $2) AS k", [p, v]))[0].k;
    expect(await keyOf("fishaudio", "fishModel01")).toBe(fishA);
    expect(await keyOf("elevenlabs", "wrongProvider")).toBeNull();
  });

  it("xoá key → xoá bản Vault, gỡ giọng đã gắn, nhật ký provider_key.delete", async () => {
    const { rows } = await db.query<{ v: string }>("SELECT vault_secret_id AS v FROM public.provider_api_keys WHERE id = $1", [fishA]);
    const from = await lastLogId();
    await run(u.superAdmin, "SELECT public.delete_provider_key($1, 'Hết hạn key thử nghiệm')", [fishA]);
    expect((await db.query("SELECT 1 FROM vault.secrets WHERE id = $1", [rows[0].v])).rows).toHaveLength(0);
    expect((await db.query("SELECT 1 FROM public.provider_voice_bindings WHERE key_id = $1", [fishA])).rows).toHaveLength(0);
    const logs = await logsSince(from);
    expect(logs).toEqual([expect.objectContaining({ action: "provider_key.delete", actor_id: u.superAdmin, reason: "Hết hạn key thử nghiệm", after: null })]);
    await expect(run(u.superAdmin, "SELECT public.delete_provider_key($1, 'Xoá key đã được dọn trước đó')", [fishA])).rejects.toThrow(/Không tìm thấy key/);
  });

  it("không bảng nào ngoài Vault chứa key", async () => {
    for (const key of [LEGACY_EL, FISH_A, FISH_B, EL_B]) {
      for (const table of ["public.admin_audit_log", "public.provider_api_keys", "public.app_settings", "public.app_secrets"]) {
        expect(await mentions(table, key), `${table} ∌ ${key}`).toBe(0);
      }
    }
  });
});
