/**
 * Admin v2 · A-04 — API key hệ thống vào Supabase Vault (migration 021).
 *
 * - Key nằm (mã hoá) trong Vault; app_settings không bao giờ chứa key thật.
 * - API chỉ-ghi: set_system_secret (secrets.manage) đặt / đổi / xoá và ghi
 *   nhật ký không kèm key; list_system_secrets chỉ trả "đã đặt" + 4 ký tự cuối.
 * - Chỉ service role (server) đọc được key qua get_system_secret.
 * - Key chữ thường cũ được chuyển vào Vault; xoá tài khoản từng lưu cài đặt
 *   không còn lỗi FK.
 */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@/lib/admin-permissions";
import { applyMigrationFile, asAnon, asRole, asUser, createMigratedDb, listMigrations } from "./supabase-harness";

const VAULT_MIGRATION = "021_admin_secrets_vault.sql";
const LEGACY_KEY = "sk-legacy-PLAINTEXT-0001";
const LEGACY_SHORT = "short";
const NEW_KEY = "sk-proj-NEW-VAULT-KEY-9f3a";
const ROTATED_KEY = "sk-proj-ROTATED-KEY-77b2";

type Status = { key: string; is_set: boolean; last4: string | null; updated_at: string | null };

let db: PGlite;
const u = {} as Record<"legacySaver" | "superAdmin" | "admin" | "editor" | "ops" | "support" | "family", string>;

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
const setSecret = async (uid: string, key: string, value: string, reason: string | null = null) =>
  (await run<{ r: Status }>(uid, "SELECT public.set_system_secret($1, $2, $3) AS r", [key, value, reason]))[0].r;
const serverRead = async (key: string) =>
  (await asService<{ v: string | null }>("SELECT public.get_system_secret($1) AS v", [key]))[0].v;

async function lastLogId(): Promise<number> {
  const { rows } = await db.query<{ id: number | null }>("SELECT max(id) AS id FROM public.admin_audit_log");
  return Number(rows[0].id ?? 0);
}
async function logsSince(afterId: number) {
  const { rows } = await db.query<{
    action: string; actor_id: string | null; target_id: string; before: Record<string, unknown>; after: Record<string, unknown>;
    reason: string | null; source: string;
  }>("SELECT * FROM public.admin_audit_log WHERE id > $1 ORDER BY id", [afterId]);
  return rows;
}
/** How many rows of `table` mention `needle` anywhere (any column, as text). */
async function mentions(table: string, needle: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} t WHERE row_to_json(t)::text LIKE $1`, [
    `%${needle}%`,
  ]);
  return rows[0].n;
}

beforeAll(async () => {
  // Before 021: keys saved in plain text by an admin (updated_by = that admin).
  ({ db } = await createMigratedDb({ stopBefore: VAULT_MIGRATION }));
  u.legacySaver = await createUser("admin");
  await db.query("UPDATE public.app_settings SET value = $1, updated_by = $2 WHERE key = 'openai_api_key'", [`  ${LEGACY_KEY} `, u.legacySaver]);
  await db.query("UPDATE public.app_settings SET value = $1, updated_by = $2 WHERE key = 'gemini_api_key'", [LEGACY_SHORT, u.legacySaver]);
  for (const file of listMigrations().filter((f) => f >= VAULT_MIGRATION)) await applyMigrationFile(db, file);

  u.superAdmin = await createUser("super_admin");
  u.admin = await createUser("admin");
  u.editor = await createUser("editor");
  u.ops = await createUser("ops");
  u.support = await createUser("support");
  u.family = await createUser();
});

afterAll(async () => {
  await db?.close();
});

describe("021 · chuyển key cũ vào Vault", () => {
  it("app_settings không còn key chữ thường; Vault giữ bản mã hoá; server đọc lại đúng key (đã cắt khoảng trắng)", async () => {
    const { rows } = await db.query<{ key: string; value: string }>("SELECT key, value FROM public.app_settings WHERE is_secret ORDER BY key");
    expect(rows.length).toBeGreaterThanOrEqual(5) // 6 ô key của 007, trừ elevenlabs_api_key (022 chuyển vào kho nhiều key);
    expect(rows.every((r) => r.value === "")).toBe(true);
    expect(await mentions("public.app_settings", LEGACY_KEY)).toBe(0);
    expect(await mentions("vault.secrets", LEGACY_KEY)).toBe(0);
    expect(await serverRead("openai_api_key")).toBe(LEGACY_KEY);
    expect(await serverRead("gemini_api_key")).toBe(LEGACY_SHORT);
    expect(await serverRead("anthropic_api_key")).toBeNull();
  });

  it("4 ký tự cuối chỉ lưu khi key đủ dài; người lưu cũ giữ nguyên; có nhật ký 'system' không kèm key", async () => {
    const { rows } = await db.query<{ key: string; last4: string | null; updated_by: string }>(
      "SELECT key, last4, updated_by FROM public.app_secrets ORDER BY key"
    );
    expect(rows).toEqual([
      { key: "gemini_api_key", last4: null, updated_by: u.legacySaver },
      { key: "openai_api_key", last4: LEGACY_KEY.slice(-4), updated_by: u.legacySaver },
    ]);
    const logs = await logsSince(0);
    const moved = logs.filter((l) => l.reason === "Migration 021: chuyển API key vào Vault");
    expect(moved.map((l) => [l.action, l.target_id, l.source])).toEqual([
      ["secret.update", "gemini_api_key", "system"],
      ["secret.update", "openai_api_key", "system"],
    ]);
    expect(await mentions("public.admin_audit_log", LEGACY_KEY)).toBe(0);
    expect(await mentions("public.admin_audit_log", LEGACY_SHORT)).toBe(0);
  });

  it("xoá tài khoản từng lưu cài đặt / key không còn lỗi FK (người lưu → NULL)", async () => {
    const temp = await createUser("admin");
    await db.query("UPDATE public.app_settings SET updated_by = $1 WHERE key = 'default_ai_model'", [temp]);
    await setSecret(temp, "dalle_api_key", "sk-temp-dalle-key-0000");
    await db.query("DELETE FROM auth.users WHERE id = $1", [temp]);
    const { rows } = await db.query<{ s: string | null; k: string | null }>(
      `SELECT (SELECT updated_by::text FROM public.app_settings WHERE key = 'default_ai_model') AS s,
              (SELECT updated_by::text FROM public.app_secrets WHERE key = 'dalle_api_key') AS k`
    );
    expect(rows[0]).toEqual({ s: null, k: null });
    await setSecret(u.superAdmin, "dalle_api_key", "");
  });
});

describe("021 · không ai ngoài server đọc được key", () => {
  it("authenticated (kể cả super admin) và anon: không đọc Vault, app_secrets, get_system_secret", async () => {
    for (const uid of [u.superAdmin, u.admin, u.family]) {
      await expect(run(uid, "SELECT decrypted_secret FROM vault.decrypted_secrets")).rejects.toThrow(/permission denied/);
      await expect(run(uid, "SELECT secret FROM vault.secrets")).rejects.toThrow(/permission denied/);
      await expect(run(uid, "SELECT * FROM public.app_secrets")).rejects.toThrow(/permission denied/);
      await expect(run(uid, "SELECT public.get_system_secret('openai_api_key')")).rejects.toThrow(/permission denied/);
      await expect(run(uid, "SELECT vault.create_secret('x')")).rejects.toThrow(/permission denied/);
    }
    await expect(asAnon(db, (tx) => tx.query("SELECT public.get_system_secret('openai_api_key')"))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query("SELECT public.set_system_secret('openai_api_key', 'x')"))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query("SELECT * FROM public.list_system_secrets()"))).rejects.toThrow(/permission denied/);
  });

  it("dòng bí mật trong app_settings chỉ còn chuỗi rỗng — đọc được cũng không lộ gì", async () => {
    const rows = await run<{ value: string }>(u.superAdmin, "SELECT value FROM public.app_settings WHERE is_secret");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.value === "")).toBe(true);
  });

  it("service role: đọc key qua get_system_secret, không truy cập thẳng app_secrets", async () => {
    expect(await serverRead("openai_api_key")).toBe(LEGACY_KEY);
    expect(await serverRead("default_ai_model")).toBeNull();
    await expect(asService("SELECT * FROM public.app_secrets")).rejects.toThrow(/permission denied/);
  });
});

describe("021 · set_system_secret (API chỉ-ghi)", () => {
  it("chỉ secrets.manage (super admin, admin) đặt được; vai trò khác bị từ chối", async () => {
    for (const uid of [u.editor, u.ops, u.support, u.family]) {
      await expect(setSecret(uid, "anthropic_api_key", NEW_KEY)).rejects.toThrow(/Chỉ Super admin \/ Admin đặt được API key/);
    }
    expect(await serverRead("anthropic_api_key")).toBeNull();
  });

  it("đặt mới → đổi → xoá: trả trạng thái (không trả key), Vault dùng lại 1 bản, nhật ký create / update / delete", async () => {
    const from = await lastLogId();
    const vaultBefore = Number((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM vault.secrets")).rows[0].n);

    const created = await setSecret(u.admin, "anthropic_api_key", `  ${NEW_KEY}\t`, "Key mới cho môi trường thử");
    expect(created).toMatchObject({ key: "anthropic_api_key", is_set: true, last4: NEW_KEY.slice(-4) });
    expect(JSON.stringify(created)).not.toContain(NEW_KEY);
    expect(await serverRead("anthropic_api_key")).toBe(NEW_KEY);

    const rotated = await setSecret(u.superAdmin, "anthropic_api_key", ROTATED_KEY);
    expect(rotated).toMatchObject({ is_set: true, last4: ROTATED_KEY.slice(-4) });
    expect(await serverRead("anthropic_api_key")).toBe(ROTATED_KEY);
    expect(Number((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM vault.secrets")).rows[0].n)).toBe(vaultBefore + 1);

    const cleared = await setSecret(u.admin, "anthropic_api_key", "");
    expect(cleared).toEqual({ key: "anthropic_api_key", is_set: false, last4: null, updated_at: null });
    expect(await serverRead("anthropic_api_key")).toBeNull();
    expect(Number((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM vault.secrets")).rows[0].n)).toBe(vaultBefore);

    // Clearing a key that is not set changes nothing and logs nothing.
    await setSecret(u.admin, "anthropic_api_key", "");

    const logs = await logsSince(from);
    expect(logs.map((l) => [l.action, l.actor_id, l.source])).toEqual([
      ["secret.create", u.admin, "db"],
      ["secret.update", u.superAdmin, "db"],
      ["secret.delete", u.admin, "db"],
    ]);
    expect(logs[0]).toMatchObject({
      target_id: "anthropic_api_key", reason: "Key mới cho môi trường thử",
      before: { is_set: false, last4: null }, after: { is_set: true, last4: `…${NEW_KEY.slice(-4)}` },
    });
    expect(logs[1]).toMatchObject({ before: { last4: `…${NEW_KEY.slice(-4)}` }, after: { last4: `…${ROTATED_KEY.slice(-4)}` } });
    for (const key of [NEW_KEY, ROTATED_KEY]) {
      expect(await mentions("public.admin_audit_log", key)).toBe(0);
      expect(await mentions("public.app_secrets", key)).toBe(0);
      expect(await mentions("public.app_settings", key)).toBe(0);
    }
  });

  it("từ chối key lạ / cài đặt thường / key quá dài / có khoảng trắng giữa", async () => {
    await expect(setSecret(u.admin, "khong_co_key", NEW_KEY)).rejects.toThrow(/Không có API key/);
    await expect(setSecret(u.admin, "default_ai_model", NEW_KEY)).rejects.toThrow(/Không có API key/);
    await expect(setSecret(u.admin, "custom_provider_key", "x".repeat(4097))).rejects.toThrow(/quá dài/);
    await expect(setSecret(u.admin, "custom_provider_key", "sk-abc def-123456")).rejects.toThrow(/khoảng trắng/);
    expect(await serverRead("custom_provider_key")).toBeNull();
  });

  it("server / SQL editor (không có người dùng) đặt được, nhật ký nguồn 'system'", async () => {
    const from = await lastLogId();
    await db.query("SELECT public.set_system_secret('anthropic_api_key', $1)", [NEW_KEY]);
    await asService("SELECT public.set_system_secret('anthropic_api_key', '')");
    const logs = await logsSince(from);
    expect(logs.map((l) => [l.action, l.actor_id, l.source])).toEqual([
      ["secret.create", null, "system"],
      ["secret.delete", null, "system"],
    ]);
  });
});

describe("021 · list_system_secrets & bảo vệ app_settings", () => {
  it("admin thấy mọi key: đã đặt chưa, 4 ký tự cuối, ai đặt — không có giá trị", async () => {
    await setSecret(u.admin, "custom_provider_key", NEW_KEY);
    const list = await run<Record<string, unknown>>(u.admin, "SELECT * FROM public.list_system_secrets()");
    expect(list.map((r) => r.key)).toEqual(expect.arrayContaining(["openai_api_key", "gemini_api_key", "custom_provider_key", "dalle_api_key"]));
    expect(list.find((r) => r.key === "custom_provider_key")).toMatchObject({
      is_set: true, last4: NEW_KEY.slice(-4), updated_by_email: expect.stringMatching(/^admin-/),
    });
    expect(list.find((r) => r.key === "gemini_api_key")).toMatchObject({ is_set: true, last4: null });
    expect(list.find((r) => r.key === "dalle_api_key")).toMatchObject({ is_set: false, last4: null });
    expect(list.some((r) => r.key === "default_ai_model")).toBe(false);
    expect(Object.keys(list[0]).sort()).toEqual(["category", "is_set", "key", "label", "last4", "updated_at", "updated_by_email"]);
    expect(JSON.stringify(list)).not.toContain(NEW_KEY);
    expect(JSON.stringify(list)).not.toContain(LEGACY_KEY);

    for (const uid of [u.editor, u.ops, u.family]) {
      await expect(run(uid, "SELECT * FROM public.list_system_secrets()")).rejects.toThrow(/Chỉ Super admin \/ Admin xem được/);
    }
  });

  it("không ai ghi được key thật vào app_settings (kể cả chủ bảng); người dùng API không lật được cờ bí mật", async () => {
    await expect(db.query("UPDATE public.app_settings SET value = 'sk-plain' WHERE key = 'openai_api_key'")).rejects.toThrow(
      /app_settings_secret_not_plaintext/
    );
    await expect(
      db.query("INSERT INTO public.app_settings (key, value, is_secret) VALUES ('new_api_key', 'sk-plain', true)")
    ).rejects.toThrow(/app_settings_secret_not_plaintext/);
    await expect(run(u.superAdmin, "UPDATE public.app_settings SET is_secret = false WHERE key = 'openai_api_key'")).rejects.toThrow(
      /cờ bí mật/
    );
    const { rows } = await db.query<{ is_secret: boolean }>("SELECT is_secret FROM public.app_settings WHERE key = 'openai_api_key'");
    expect(rows[0].is_secret).toBe(true);
    // is_secret is NOT NULL now (019 treated NULL as secret).
    await expect(db.query("INSERT INTO public.app_settings (key, value, is_secret) VALUES ('x_flag', '', NULL)")).rejects.toThrow(/null value/);
  });

  it("xoá hẳn dòng cài đặt (SQL editor) → xoá luôn tham chiếu và bản mã hoá trong Vault", async () => {
    await db.query("INSERT INTO public.app_settings (key, value, label, category, is_secret) VALUES ('temp_api_key', '', 'Tạm', 'ai', true)");
    await db.query("SELECT public.set_system_secret('temp_api_key', $1)", [NEW_KEY]);
    const { rows } = await db.query<{ id: string }>("SELECT vault_secret_id AS id FROM public.app_secrets WHERE key = 'temp_api_key'");
    expect(rows).toHaveLength(1);
    await db.query("DELETE FROM public.app_settings WHERE key = 'temp_api_key'");
    expect((await db.query("SELECT 1 FROM public.app_secrets WHERE key = 'temp_api_key'")).rows).toHaveLength(0);
    expect((await db.query("SELECT 1 FROM vault.secrets WHERE id = $1", [rows[0].id])).rows).toHaveLength(0);
  });
});
