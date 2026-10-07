/**
 * Admin v2 · A-02 — RBAC theo quyền hạn (migration 019).
 *
 * - Danh mục vai trò / quyền trong DB khớp src/lib/admin-permissions.ts.
 * - Vai trò cũ (admin, super_admin) vẫn làm được như trước khi chuyển.
 * - Vai trò hẹp chỉ làm đúng phần việc: biên tập không đọc được API key,
 *   không đổi được vai trò, không đụng truyện riêng của gia đình.
 */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_PERMISSIONS, ROLE_PERMISSIONS, STAFF_ROLES, type UserRole } from "@/lib/admin-permissions";
import { applyMigrationFile, asAnon, asUser, createMigratedDb, listMigrations, type Tx } from "./supabase-harness";

const RBAC_MIGRATION = "019_admin_rbac.sql";
const SECRET = "sk-test-secret";

let db: PGlite;
const u = {} as Record<"legacyAdmin" | "legacySuper" | "family" | "family2" | "editor" | "ops" | "moderator" | "support" | "analyst", string>;
let familyStory: string;
let platformStory: string;

async function createUser(role: UserRole = "user"): Promise<string> {
  const id = randomUUID();
  await db.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [id, `${id}@test.local`]);
  if (role !== "user") await db.query("UPDATE public.profiles SET role = $2 WHERE id = $1", [id, role]);
  return id;
}

async function createStory(owner: string, platform: boolean, title: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO public.stories (user_id, title, is_platform_content) VALUES ($1, $2, $3) RETURNING id",
    [owner, title, platform]
  );
  await db.query("INSERT INTO public.story_pages (story_id, page_number, content) VALUES ($1, 1, 'Trang 1')", [rows[0].id]);
  return rows[0].id;
}

/** Run as a signed-in user and return the rows. */
const rows = <T = Record<string, unknown>>(uid: string, sql: string, params: unknown[] = []) =>
  asUser(db, uid, async (tx) => {await tx.query("SELECT set_config('app.admin_reason','RBAC suite confirmed action',true)");return (await tx.query<T>(sql, params)).rows;});
/** Run a write as a signed-in user and return how many rows it touched (RLS hides rows silently). */
const affected = (uid: string, sql: string, params: unknown[] = []) =>
  asUser(db, uid, async (tx) => {await tx.query("SELECT set_config('app.admin_reason','RBAC suite confirmed action',true)");return (await tx.query(sql, params)).affectedRows ?? 0;});
/** Run inside a transaction that is always rolled back (keeps fixtures intact). */
async function dryRun<T>(uid: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out: T | undefined;
  await asUser(db, uid, async (tx) => {
    await tx.query("SELECT set_config('app.admin_reason','RBAC suite confirmed action',true)");
    out = await fn(tx);
    await tx.rollback();
  });
  return out as T;
}

const perms = async (uid: string) =>
  (await rows<{ p: string[] }>(uid, "SELECT public.my_admin_permissions() AS p"))[0].p;
const can = async (uid: string, permission: string) =>
  (await rows<{ ok: boolean }>(uid, "SELECT public.has_permission($1) AS ok", [permission]))[0].ok;
const sorted = (list: readonly string[]) => [...list].sort();

beforeAll(async () => {
  // Data trước 019: một admin + một super_admin cũ, một gia đình có truyện riêng, API key đã đặt.
  ({ db } = await createMigratedDb({ stopBefore: RBAC_MIGRATION }));
  u.legacyAdmin = await createUser("admin" as UserRole);
  u.legacySuper = await createUser("super_admin" as UserRole);
  u.family = await createUser();
  u.family2 = await createUser();
  familyStory = await createStory(u.family, false, "Truyện riêng của bé");
  await db.query("UPDATE public.app_settings SET value = $1 WHERE key = 'openai_api_key'", [SECRET]);
  for (const file of listMigrations().filter((f) => f >= RBAC_MIGRATION)) {
    await applyMigrationFile(db, file);
  }
  u.editor = await createUser("editor");
  u.ops = await createUser("ops");
  u.moderator = await createUser("moderator");
  u.support = await createUser("support");
  u.analyst = await createUser("analyst");
  platformStory = await createStory(u.legacyAdmin, true, "Truyện nền tảng");
});

afterAll(async () => {
  await db?.close();
});

describe("019 · danh mục vai trò / quyền hạn", () => {
  it("vai trò trong DB khớp STAFF_ROLES (đúng thứ tự hiển thị)", async () => {
    const { rows: r } = await db.query<{ key: string }>("SELECT key FROM public.admin_roles ORDER BY sort_order");
    expect(r.map((x) => x.key)).toEqual([...STAFF_ROLES]);
  });

  it("quyền hạn trong DB khớp ADMIN_PERMISSIONS", async () => {
    const { rows: r } = await db.query<{ key: string }>("SELECT key FROM public.admin_permissions ORDER BY key");
    expect(r.map((x) => x.key)).toEqual(sorted(ADMIN_PERMISSIONS));
  });

  it("quyền của từng vai trò khớp ROLE_PERMISSIONS", async () => {
    for (const role of STAFF_ROLES) {
      const { rows: r } = await db.query<{ permission: string }>(
        "SELECT permission FROM public.admin_role_permissions WHERE role = $1 ORDER BY permission",
        [role]
      );
      expect(r.map((x) => x.permission), role).toEqual(sorted(ROLE_PERMISSIONS[role]));
    }
  });

  it("super_admin có mọi quyền; admin cũ có mọi quyền trừ roles.manage", () => {
    expect(sorted(ROLE_PERMISSIONS.super_admin)).toEqual(sorted(ADMIN_PERMISSIONS));
    expect(ROLE_PERMISSIONS.admin).not.toContain("roles.manage");
    expect(ROLE_PERMISSIONS.admin).toHaveLength(ADMIN_PERMISSIONS.length - 1);
  });

  it("chỉ vai trò super_admin / admin có secrets.manage và roles.manage chỉ ở super_admin", () => {
    const withSecrets = STAFF_ROLES.filter((r) => ROLE_PERMISSIONS[r].includes("secrets.manage"));
    const withRoles = STAFF_ROLES.filter((r) => ROLE_PERMISSIONS[r].includes("roles.manage"));
    expect(withSecrets).toEqual(["super_admin", "admin"]);
    expect(withRoles).toEqual(["super_admin"]);
  });

  it("CHECK profiles.role nhận đủ vai trò mới, từ chối vai trò lạ", async () => {
    const id = await createUser();
    for (const role of ["user", ...STAFF_ROLES]) {
      await db.query("UPDATE public.profiles SET role = $2 WHERE id = $1", [id, role]);
    }
    await expect(db.query("UPDATE public.profiles SET role = 'root' WHERE id = $1", [id])).rejects.toThrow(
      /profiles_role_check/
    );
  });

  it("người đã đăng nhập đọc được danh mục nhưng không tự cấp quyền được", async () => {
    expect((await rows(u.family, "SELECT key FROM public.admin_roles")).length).toBe(STAFF_ROLES.length);
    await expect(
      rows(u.editor, "INSERT INTO public.admin_role_permissions (role, permission) VALUES ('editor', 'secrets.manage')")
    ).rejects.toThrow(/permission denied/);
    await expect(rows(u.editor, "UPDATE public.profiles SET role = 'super_admin' WHERE id = $1", [u.editor])).rejects.toThrow(
      /Chỉ super_admin/
    );
  });

  it("anon không gọi được hàm quyền", async () => {
    await expect(asAnon(db, (tx) => tx.query("SELECT public.has_permission('dashboard.view')"))).rejects.toThrow(
      /permission denied/
    );
    await expect(asAnon(db, (tx) => tx.query("SELECT public.my_admin_permissions()"))).rejects.toThrow(/permission denied/);
  });

  it("my_admin_permissions trả về danh sách đã sắp xếp; gia đình = rỗng", async () => {
    expect(await perms(u.editor)).toEqual(sorted(ROLE_PERMISSIONS.editor));
    expect(await perms(u.family)).toEqual([]);
    expect(await can(u.family, "dashboard.view")).toBe(false);
    expect(await can(u.editor, "stories.write")).toBe(true);
    expect(await can(u.editor, "secrets.manage")).toBe(false);
    expect(await can(u.editor, "khong.ton.tai")).toBe(false);
  });
});

describe("019 · vai trò cũ vẫn chạy", () => {
  it("admin / super_admin cũ được chuyển sang quyền tương ứng", async () => {
    expect(await perms(u.legacyAdmin)).toEqual(sorted(ROLE_PERMISSIONS.admin));
    expect(await perms(u.legacySuper)).toEqual(sorted(ADMIN_PERMISSIONS));
  });

  it("is_admin() giữ nguyên nghĩa cũ (admin/super_admin), vai trò hẹp không phải admin", async () => {
    const isAdmin = async (uid: string) => (await rows<{ ok: boolean }>(uid, "SELECT public.is_admin() AS ok"))[0].ok;
    expect(await isAdmin(u.legacyAdmin)).toBe(true);
    expect(await isAdmin(u.legacySuper)).toBe(true);
    expect(await isAdmin(u.editor)).toBe(false);
    expect(await isAdmin(u.ops)).toBe(false);
  });

  it("admin cũ: thấy + đặt API key (021: key cũ đã vào Vault), đọc mọi tài khoản và truyện của gia đình", async () => {
    // A-04: the plaintext key set before 019 now lives in Vault — only "set" + last 4 chars are visible.
    const secret = await rows<{ value: string }>(u.legacyAdmin, "SELECT value FROM public.app_settings WHERE key = 'openai_api_key'");
    expect(secret).toEqual([{ value: "" }]);
    const status = await rows<{ key: string; is_set: boolean; last4: string }>(
      u.legacyAdmin,
      "SELECT key, is_set, last4 FROM public.list_system_secrets() WHERE key = 'openai_api_key'"
    );
    expect(status).toEqual([{ key: "openai_api_key", is_set: true, last4: SECRET.slice(-4) }]);
    expect(
      await dryRun(u.legacyAdmin, async (tx) =>
        (await tx.query<{ r: { is_set: boolean } }>("SELECT public.set_system_secret('openai_api_key', 'sk-new-key-123456') AS r")).rows[0].r.is_set
      )
    ).toBe(true);
    expect(await rows(u.legacyAdmin, "SELECT id FROM public.profiles WHERE id = $1", [u.family])).toHaveLength(1);
    expect(await rows(u.legacyAdmin, "SELECT id FROM public.stories WHERE id = $1", [familyStory])).toHaveLength(1);
  });

  it("admin cũ không đổi được vai trò (như trước 019)", async () => {
    await expect(rows(u.legacyAdmin, "UPDATE public.profiles SET role = 'editor' WHERE id = $1", [u.family])).rejects.toThrow(
      /Chỉ super_admin/
    );
  });

  it("super_admin đổi vai trò người khác, không tự đổi vai trò của mình, không gán vai trò lạ", async () => {
    expect(await affected(u.legacySuper, "UPDATE public.profiles SET role = 'editor' WHERE id = $1", [u.family2])).toBe(1);
    expect(await perms(u.family2)).toEqual(sorted(ROLE_PERMISSIONS.editor));
    expect(await affected(u.legacySuper, "UPDATE public.profiles SET role = 'user' WHERE id = $1", [u.family2])).toBe(1);
    expect(await perms(u.family2)).toEqual([]);
    await expect(rows(u.legacySuper, "UPDATE public.profiles SET role = 'admin' WHERE id = $1", [u.legacySuper])).rejects.toThrow(
      /Không tự đổi vai trò/
    );
    await expect(rows(u.legacySuper, "UPDATE public.profiles SET role = 'root' WHERE id = $1", [u.family2])).rejects.toThrow(
      /profiles_role_check/
    );
  });
});

describe("019 · biên tập (editor)", () => {
  it("không đọc được API key (dòng bí mật), vẫn đọc cài đặt thường", async () => {
    expect(await rows(u.editor, "SELECT key FROM public.app_settings WHERE is_secret")).toEqual([]);
    expect(await rows(u.editor, "SELECT value FROM public.app_settings WHERE key = 'openai_api_key'")).toEqual([]);
    expect((await rows(u.editor, "SELECT key FROM public.app_settings WHERE NOT is_secret")).length).toBeGreaterThan(0);
  });

  it("không sửa / thêm được cài đặt nào", async () => {
    expect(await affected(u.editor, "UPDATE public.app_settings SET value = 'x' WHERE key = 'openai_api_key'")).toBe(0);
    expect(await affected(u.editor, "UPDATE public.app_settings SET value = 'x' WHERE key = 'default_ai_model'")).toBe(0);
    await expect(
      rows(u.editor, "INSERT INTO public.app_settings (key, value, is_secret) VALUES ('editor_key', 'x', false)")
    ).rejects.toThrow(/row-level security/);
  });

  it("không đổi được vai trò (của mình hay người khác), không xem tài khoản khác", async () => {
    await expect(rows(u.editor, "UPDATE public.profiles SET role = 'admin' WHERE id = $1", [u.editor])).rejects.toThrow(
      /Chỉ super_admin/
    );
    expect(await affected(u.editor, "UPDATE public.profiles SET role = 'editor' WHERE id = $1", [u.family])).toBe(0);
    expect(await rows(u.editor, "SELECT id FROM public.profiles WHERE id = $1", [u.family])).toEqual([]);
  });

  it("tạo / sửa / xoá truyện nền tảng và trang truyện", async () => {
    await dryRun(u.editor, async (tx) => {
      const { rows: created } = await tx.query<{ id: string }>(
        "INSERT INTO public.stories (user_id, title, is_platform_content) VALUES ($1, 'Mới', true) RETURNING id",
        [u.editor]
      );
      const id = created[0].id;
      await tx.query("INSERT INTO public.story_pages (story_id, page_number, content) VALUES ($1, 1, 'A')", [id]);
      expect((await tx.query("UPDATE public.story_pages SET content = 'B' WHERE story_id = $1", [id])).affectedRows).toBe(1);
      expect((await tx.query("DELETE FROM public.stories WHERE id = $1", [id])).affectedRows).toBe(1);
    });
    await dryRun(u.editor, async (tx) => {
      // Truyện nền tảng do người khác tạo
      expect((await tx.query("UPDATE public.stories SET title = 'Sửa' WHERE id = $1", [platformStory])).affectedRows).toBe(1);
      expect((await tx.query("SELECT id FROM public.story_pages WHERE story_id = $1", [platformStory])).rows).toHaveLength(1);
      expect((await tx.query("UPDATE public.story_pages SET content = 'Sửa' WHERE story_id = $1", [platformStory])).affectedRows).toBe(1);
      expect((await tx.query("DELETE FROM public.stories WHERE id = $1", [platformStory])).affectedRows).toBe(1);
    });
  });

  it("không đọc / sửa được truyện riêng của gia đình, không biến nó thành truyện nền tảng", async () => {
    expect(await rows(u.editor, "SELECT id FROM public.stories WHERE id = $1", [familyStory])).toEqual([]);
    expect(await rows(u.editor, "SELECT id FROM public.story_pages WHERE story_id = $1", [familyStory])).toEqual([]);
    expect(await affected(u.editor, "UPDATE public.stories SET is_platform_content = true WHERE id = $1", [familyStory])).toBe(0);
    expect(await affected(u.editor, "DELETE FROM public.stories WHERE id = $1", [familyStory])).toBe(0);
  });

  it("quản lý danh mục và mẫu truyện", async () => {
    await dryRun(u.editor, async (tx) => {
      await tx.query("INSERT INTO public.story_categories (id, label) VALUES ('rbac_test', 'Thử')");
      expect((await tx.query("UPDATE public.story_categories SET label = 'Thử 2' WHERE id = 'rbac_test'")).affectedRows).toBe(1);
      expect((await tx.query("DELETE FROM public.story_categories WHERE id = 'rbac_test'")).affectedRows).toBe(1);
      await tx.query("INSERT INTO public.story_templates (title) VALUES ('Mẫu thử')");
    });
  });

  it("không quản lý giọng mặc định, không xem số liệu tổng hợp", async () => {
    await expect(
      rows(u.editor, "INSERT INTO public.default_voices (voice_id, name) VALUES ('v1', 'Giọng thử')")
    ).rejects.toThrow(/row-level security/);
    await expect(rows(u.editor, "SELECT public.admin_usage_summary()")).rejects.toThrow(/Không có quyền xem số liệu/);
  });
});

describe("019 · vận hành (ops)", () => {
  it("sửa được cài đặt thường nhưng không đọc / sửa API key", async () => {
    expect(
      await dryRun(u.ops, async (tx) =>
        (await tx.query("UPDATE public.app_settings SET value = 'gpt-x' WHERE key = 'default_ai_model'")).affectedRows
      )
    ).toBe(1);
    expect(await rows(u.ops, "SELECT key FROM public.app_settings WHERE key = 'openai_api_key'")).toEqual([]);
    expect(await affected(u.ops, "UPDATE public.app_settings SET value = 'x' WHERE key = 'openai_api_key'")).toBe(0);
    expect(await affected(u.ops, "UPDATE public.app_settings SET is_secret = false WHERE key = 'openai_api_key'")).toBe(0);
  });

  it("không biến cài đặt thường thành bí mật, không thêm key bí mật", async () => {
    await expect(
      rows(u.ops, "UPDATE public.app_settings SET is_secret = true WHERE key = 'default_ai_model'")
    ).rejects.toThrow(/row-level security|cờ bí mật/);
    await expect(
      rows(u.ops, "INSERT INTO public.app_settings (key, value, is_secret) VALUES ('ops_api_key', 'x', true)")
    ).rejects.toThrow(/row-level security/);
    await dryRun(u.ops, (tx) => tx.query("INSERT INTO public.app_settings (key, value, is_secret) VALUES ('ops_flag', '1', false)"));
  });

  it("quản lý giọng mặc định, không ghi truyện nền tảng", async () => {
    await dryRun(u.ops, (tx) => tx.query("INSERT INTO public.default_voices (voice_id, name) VALUES ('v1', 'Giọng thử')"));
    await expect(
      rows(u.ops, "INSERT INTO public.stories (user_id, title, is_platform_content) VALUES ($1, 'X', true)", [u.ops])
    ).rejects.toThrow(/truyện nền tảng/);
  });
});

describe("019 · kiểm duyệt / hỗ trợ / phân tích", () => {
  it("kiểm duyệt: xem truyện nền tảng + trang, không sửa được", async () => {
    expect(await rows(u.moderator, "SELECT id FROM public.stories WHERE id = $1", [platformStory])).toHaveLength(1);
    expect(await rows(u.moderator, "SELECT id FROM public.story_pages WHERE story_id = $1", [platformStory])).toHaveLength(1);
    expect(await affected(u.moderator, "UPDATE public.stories SET title = 'x' WHERE id = $1", [platformStory])).toBe(0);
    expect(await rows(u.moderator, "SELECT id FROM public.stories WHERE id = $1", [familyStory])).toEqual([]);
  });

  it("hỗ trợ: xem danh sách tài khoản, không sửa được", async () => {
    expect(await rows(u.support, "SELECT id FROM public.profiles WHERE id = $1", [u.family])).toHaveLength(1);
    expect(await affected(u.support, "UPDATE public.profiles SET display_name = 'x' WHERE id = $1", [u.family])).toBe(0);
    expect(await rows(u.support, "SELECT key FROM public.app_settings WHERE is_secret")).toEqual([]);
  });

  it("phân tích: số liệu tổng hợp, không thấy truyện riêng của gia đình", async () => {
    const [{ s }] = await rows<{ s: Record<string, number> }>(u.analyst, "SELECT public.admin_usage_summary() AS s");
    expect(s).toMatchObject({ total_sessions: expect.any(Number), recent_signups: expect.any(Number) });
    expect(await rows(u.analyst, "SELECT id FROM public.stories WHERE id = $1", [familyStory])).toEqual([]);
    expect(await rows(u.analyst, "SELECT id FROM public.profiles WHERE id = $1", [u.family])).toEqual([]);
  });
});

describe("019 · gia đình không tự gắn cờ truyện nền tảng", () => {
  it("không tạo / chuyển truyện của mình thành truyện nền tảng; sửa truyện riêng vẫn bình thường", async () => {
    await expect(
      rows(u.family, "INSERT INTO public.stories (user_id, title, is_platform_content) VALUES ($1, 'X', true)", [u.family])
    ).rejects.toThrow(/truyện nền tảng/);
    await expect(
      rows(u.family, "UPDATE public.stories SET is_platform_content = true WHERE id = $1", [familyStory])
    ).rejects.toThrow(/truyện nền tảng/);
    expect(
      await dryRun(u.family, async (tx) =>
        (await tx.query("UPDATE public.stories SET title = 'Tên mới' WHERE id = $1", [familyStory])).affectedRows
      )
    ).toBe(1);
  });
});
