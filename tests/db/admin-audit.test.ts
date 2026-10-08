/**
 * Admin v2 · A-03 — nhật ký thao tác (migration 020).
 *
 * - Thao tác của nhân sự trên bảng nhạy cảm tự ghi nhật ký (trigger), kể cả
 *   gọi thẳng PostgREST; API key không bao giờ lộ giá trị trong nhật ký.
 * - Nhật ký chỉ thêm: không ai sửa / xoá / truncate được (kể cả service role
 *   và chủ bảng), không ghi trực tiếp vào bảng được.
 * - Chỉ quyền audit.read xem được; log_admin_action không giả danh được.
 */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@/lib/admin-permissions";
import { AUDIT_ACTIONS } from "@/lib/admin-audit";
import { asAnon, asRole, asUser, createMigratedDb } from "./supabase-harness";

type LogRow = {
  id: number;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  ip: string | null;
  user_agent: string | null;
  source: string;
};

const SECRET = "sk-live-SHOULD-NEVER-BE-LOGGED";
let db: PGlite;
const u = {} as Record<"superAdmin" | "admin" | "editor" | "ops" | "family", string>;

async function createUser(role: UserRole = "user"): Promise<string> {
  const id = randomUUID();
  await db.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [id, `${role}-${id.slice(0, 8)}@test.local`]);
  if (role !== "user") await db.query("UPDATE public.profiles SET role = $2 WHERE id = $1", [id, role]);
  return id;
}

/** All log rows (read as superuser) newer than `afterId`. */
async function logsSince(afterId: number): Promise<LogRow[]> {
  const { rows } = await db.query<LogRow>("SELECT * FROM public.admin_audit_log WHERE id > $1 ORDER BY id", [afterId]);
  return rows;
}
async function lastId(): Promise<number> {
  const { rows } = await db.query<{ id: number | null }>("SELECT max(id) AS id FROM public.admin_audit_log");
  return Number(rows[0].id ?? 0);
}
const run = (uid: string, sql: string, params: unknown[] = []) => asUser(db, uid, async(tx) => {await tx.query("SELECT set_config('app.admin_reason','Audit suite confirmed action',true)");return tx.query(sql, params);});
const asServiceRole = (sql: string) => asRole(db, "service_role" as "authenticated", null, (tx) => tx.query(sql));

beforeAll(async () => {
  ({ db } = await createMigratedDb());
  u.superAdmin = await createUser("super_admin");
  u.admin = await createUser("admin");
  u.editor = await createUser("editor");
  u.ops = await createUser("ops");
  u.family = await createUser();
});

afterAll(async () => {
  await db?.close();
});

describe("020 · ghi tự động thao tác của nhân sự", () => {
  it("đổi vai trò: ghi người làm (email + vai trò), trước → sau, IP + trình duyệt từ request", async () => {
    const from = await lastId();
    await run(u.superAdmin, "UPDATE public.profiles SET role = 'editor' WHERE id = $1", [u.family]);
    await run(u.superAdmin, "UPDATE public.profiles SET role = 'user' WHERE id = $1", [u.family]);
    const logs = await logsSince(from);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({
      actor_id: u.superAdmin,
      actor_role: "super_admin",
      action: "user.role_change",
      target_type: "user",
      target_id: u.family,
      before: { role: "user" },
      after: { role: "editor" },
      source: "db",
    });
    expect(logs[0].actor_email).toMatch(/^super_admin-/);

    const before = await lastId();
    await db.transaction(async (tx) => {
      await tx.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u.superAdmin, role: "authenticated",session_id:u.superAdmin,aal:"aal2",amr:[{method:"totp",timestamp:Math.floor(Date.now()/1000)}] })]);
      await tx.query("SELECT set_config('request.headers', $1, true)", [
        JSON.stringify({ "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "Vitest/1.0" }),
      ]);
      await tx.exec("SET LOCAL ROLE authenticated");
      await tx.query("SELECT set_config('app.admin_reason','Audit header confirmed change',true)");
      await tx.query("UPDATE public.profiles SET role = 'support' WHERE id = $1", [u.family]);
      await tx.query("UPDATE public.profiles SET role = 'user' WHERE id = $1", [u.family]);
    });
    const [withIp] = await logsSince(before);
    expect(withIp).toMatchObject({ ip: "203.0.113.7", user_agent: "Vitest/1.0" });
  });

  it("đổi vai trò bằng SQL editor / service role vẫn được ghi (nguồn 'system')", async () => {
    const from = await lastId();
    await db.query("UPDATE public.profiles SET role = 'analyst' WHERE id = $1", [u.family]);
    await db.query("UPDATE public.profiles SET role = 'user' WHERE id = $1", [u.family]);
    const logs = await logsSince(from);
    expect(logs.map((l) => [l.action, l.source, l.actor_id])).toEqual([
      ["user.role_change", "system", null],
      ["user.role_change", "system", null],
    ]);
  });

  it("gia đình tự sửa hồ sơ của mình: không ghi; nhân sự sửa hồ sơ người khác: chỉ ghi tên cột", async () => {
    const from = await lastId();
    await run(u.family, "UPDATE public.profiles SET child_name = 'Bống' WHERE id = $1", [u.family]);
    expect(await logsSince(from)).toEqual([]);

    await run(u.admin, "UPDATE public.profiles SET child_name = 'Bin', display_name = 'Mẹ Bin' WHERE id = $1", [u.family]);
    const logs = await logsSince(from);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: "user.update", before: null, after: { fields: ["child_name", "display_name"] } });
    expect(JSON.stringify(logs[0])).not.toContain("Bin");
  });

  it("đặt / xoá API key (021: qua Vault): ghi 'secret.*' nhưng không bao giờ chép giá trị key", async () => {
    const from = await lastId();
    await run(u.admin, "SELECT public.set_system_secret('openai_api_key', $1)", [SECRET]);
    await run(u.admin, "SELECT public.set_system_secret('openai_api_key', '', 'Audit suite cleared test key')");
    const logs = await logsSince(from);
    expect(logs.map((l) => l.action)).toEqual(["secret.create", "secret.delete"]);
    expect(logs[0]).toMatchObject({
      actor_id: u.admin, target_type: "setting", target_id: "openai_api_key", source: "db",
      before: { is_set: false, last4: null }, after: { is_set: true, last4: `…${SECRET.slice(-4)}` },
    });
    expect(logs[1]).toMatchObject({ before: { is_set: true, last4: `…${SECRET.slice(-4)}` }, after: { is_set: false, last4: null } });
    // Writing a key straight into app_settings is refused (CHECK) — it would sit there in plain text.
    await expect(run(u.admin, "UPDATE public.app_settings SET value = $1 WHERE key = 'openai_api_key'", [SECRET])).rejects.toThrow(
      /app_settings_secret_not_plaintext/
    );
    const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.admin_audit_log WHERE row_to_json(admin_audit_log)::text LIKE $1", [`%${SECRET}%`]);
    expect(rows[0].n).toBe(0);
  });

  it("cài đặt thường: ghi đủ giá trị trước → sau; chỉ đổi cột tự động thì không ghi", async () => {
    const from = await lastId();
    await run(u.ops, "UPDATE public.app_settings SET value = 'gpt-4.1-mini' WHERE key = 'default_ai_model'");
    await run(u.ops, "UPDATE public.app_settings SET updated_at = now() WHERE key = 'default_ai_model'");
    await run(u.ops, "INSERT INTO public.app_settings (key, value, is_secret) VALUES ('audit_flag', '1', false)");
    const logs = await logsSince(from);
    expect(logs.map((l) => l.action)).toEqual(["setting.update", "setting.create"]);
    expect(logs[0]).toMatchObject({ actor_role: "ops", before: { value: "gpt-4o-mini" }, after: { value: "gpt-4.1-mini" } });
  });

  it("truyện nền tảng: tạo / sửa / thùng rác / khôi phục / xoá đều ghi; đổi bộ đếm thì không", async () => {
    const from = await lastId();
    const { rows } = await run(
      u.editor,
      "INSERT INTO public.stories (user_id, title, is_platform_content) VALUES ($1, 'Tấm Cám', true) RETURNING id",
      [u.editor]
    );
    const id = (rows[0] as { id: string }).id;
    await run(u.editor, "UPDATE public.stories SET title = 'Tấm Cám (bản mới)', is_published = true WHERE id = $1", [id]);
    await run(u.editor, "UPDATE public.stories SET play_count = play_count + 1 WHERE id = $1", [id]);
    await run(u.editor, "UPDATE public.stories SET deleted_at = now() WHERE id = $1", [id]);
    await run(u.editor, "UPDATE public.stories SET deleted_at = NULL WHERE id = $1", [id]);
    await run(u.editor, "DELETE FROM public.stories WHERE id = $1", [id]);
    const logs = await logsSince(from);
    expect(logs.map((l) => l.action)).toEqual(["story.create", "story.update", "story.trash", "story.restore", "story.delete"]);
    expect(logs.every((l) => l.target_id === id && l.actor_role === "editor")).toBe(true);
    expect(logs[0].after).toMatchObject({ title: "Tấm Cám", is_platform_content: true });
    expect(logs[1]).toMatchObject({ before: { title: "Tấm Cám", is_published: false }, after: { title: "Tấm Cám (bản mới)", is_published: true } });
    expect(logs[4].before).toMatchObject({ title: "Tấm Cám (bản mới)" });
    expect(logs[4].before).not.toHaveProperty("embedding");
  });

  it("T08b: admin không sửa truyện gia đình; gia đình hoặc nhân sự sửa truyện riêng của mình không ghi", async () => {
    const { rows } = await db.query<{ id: string }>(
      "INSERT INTO public.stories (user_id, title) VALUES ($1, 'Truyện của bé') RETURNING id",
      [u.family]
    );
    const familyStory = rows[0].id;
    const { rows: own } = await db.query<{ id: string }>(
      "INSERT INTO public.stories (user_id, title) VALUES ($1, 'Truyện riêng của admin') RETURNING id",
      [u.admin]
    );
    const from = await lastId();
    await run(u.family, "UPDATE public.stories SET title = 'Truyện của Bống' WHERE id = $1", [familyStory]);
    await run(u.admin, "UPDATE public.stories SET title = 'Truyện của tôi' WHERE id = $1", [own[0].id]);
    expect(await logsSince(from)).toEqual([]);
    await run(u.admin, "UPDATE public.stories SET status = 'archived' WHERE id = $1", [familyStory]);
    const logs = await logsSince(from);
    expect(logs).toHaveLength(0);
    expect((await db.query("SELECT status FROM public.stories WHERE id=$1",[familyStory])).rows[0]).toEqual({status:"draft"});
  });

  it("danh mục, mẫu truyện (chỉ ghi số trang), giọng mặc định", async () => {
    const from = await lastId();
    await run(u.editor, "INSERT INTO public.story_categories (id, label) VALUES ('audit_cat', 'Thử')");
    await run(u.editor, "UPDATE public.story_categories SET label = 'Thử 2' WHERE id = 'audit_cat'");
    await run(u.editor, "DELETE FROM public.story_categories WHERE id = 'audit_cat'");
    await run(u.editor, `INSERT INTO public.story_templates (title, pages) VALUES ('Mẫu', '[{"content":"Ngày xửa ngày xưa"},{"content":"…"}]')`);
    await run(u.ops, "INSERT INTO public.default_voices (voice_id, name) VALUES ('v-audit', 'Giọng thử')");
    const logs = await logsSince(from);
    expect(logs.map((l) => l.action)).toEqual([
      "category.create",
      "category.update",
      "category.delete",
      "template.create",
      "default_voice.create",
    ]);
    expect(logs[1]).toMatchObject({ target_id: "audit_cat", before: { label: "Thử" }, after: { label: "Thử 2" } });
    expect(logs[3].after).toMatchObject({ title: "Mẫu", pages: 2 });
    expect(JSON.stringify(logs[3])).not.toContain("Ngày xửa");
  });

  it("mọi hành động trigger ghi ra đều có nhãn trong AUDIT_ACTIONS", async () => {
    const { rows } = await db.query<{ action: string }>("SELECT DISTINCT action FROM public.admin_audit_log");
    for (const { action } of rows) expect(Object.keys(AUDIT_ACTIONS), action).toContain(action);
  });
});

describe("020 · nhật ký chỉ thêm", () => {
  it("nhân sự (kể cả super_admin) không sửa / xoá / ghi thẳng vào bảng được", async () => {
    for (const uid of [u.superAdmin, u.admin]) {
      await expect(run(uid, "UPDATE public.admin_audit_log SET action = 'story.update'")).rejects.toThrow(/permission denied/);
      await expect(run(uid, "DELETE FROM public.admin_audit_log")).rejects.toThrow(/permission denied/);
      await expect(
        run(uid, "INSERT INTO public.admin_audit_log (action) VALUES ('story.update')")
      ).rejects.toThrow(/permission denied/);
      await expect(run(uid, "TRUNCATE public.admin_audit_log")).rejects.toThrow(/permission denied/);
    }
  });

  it("service role cũng không sửa / xoá được", async () => {
    await expect(asServiceRole("UPDATE public.admin_audit_log SET reason = 'x'")).rejects.toThrow(/permission denied/);
    await expect(asServiceRole("DELETE FROM public.admin_audit_log")).rejects.toThrow(/permission denied/);
    await expect(asServiceRole("TRUNCATE public.admin_audit_log")).rejects.toThrow(/permission denied/);
  });

  it("chủ bảng (postgres) cũng bị trigger chặn sửa / xoá / truncate", async () => {
    const n = await lastId();
    expect(n).toBeGreaterThan(0);
    await expect(db.query("UPDATE public.admin_audit_log SET reason = 'sửa' WHERE id = $1", [n])).rejects.toThrow(/chỉ được thêm/);
    await expect(db.query("DELETE FROM public.admin_audit_log WHERE id = $1", [n])).rejects.toThrow(/chỉ được thêm/);
    await expect(db.query("TRUNCATE public.admin_audit_log")).rejects.toThrow(/chỉ được thêm/);
    expect(await lastId()).toBe(n);
  });

  it("xoá tài khoản nhân sự không làm mất / sửa nhật ký của họ", async () => {
    const temp = await createUser("ops");
    await run(temp, "UPDATE public.app_settings SET value = 'x' WHERE key = 'audit_flag'");
    const { rows: before } = await db.query<LogRow>("SELECT * FROM public.admin_audit_log WHERE actor_id = $1", [temp]);
    expect(before).toHaveLength(1);
    await db.query("DELETE FROM auth.users WHERE id = $1", [temp]);
    const { rows: after } = await db.query<LogRow>("SELECT * FROM public.admin_audit_log WHERE actor_id = $1", [temp]);
    expect(after).toEqual(before);
  });
});

describe("020 · đọc nhật ký & log_admin_action", () => {
  it("chỉ audit.read (super_admin, admin) đọc được; editor / ops / gia đình không thấy dòng nào", async () => {
    const count = async (uid: string) =>
      Number(((await run(uid, "SELECT count(*)::int AS n FROM public.admin_audit_log")).rows[0] as { n: number }).n);
    expect(await count(u.superAdmin)).toBeGreaterThan(0);
    expect(await count(u.admin)).toBeGreaterThan(0);
    expect(await count(u.editor)).toBe(0);
    expect(await count(u.ops)).toBe(0);
    expect(await count(u.family)).toBe(0);
    await expect(asAnon(db, (tx) => tx.query("SELECT count(*) FROM public.admin_audit_log"))).rejects.toThrow(/permission denied/);
  });

  it("nhân sự ghi thao tác API; người ghi luôn là chính mình, IP do server truyền", async () => {
    const from = await lastId();
    await run(u.ops, "SELECT public.log_admin_action('push.send', 'push', NULL, NULL, $1::jsonb, 'Thông báo bảo trì', '198.51.100.9', 'Next.js')", [
      JSON.stringify({ title: "Bảo trì", recipients: "all" }),
    ]);
    const [log] = await logsSince(from);
    expect(log).toMatchObject({
      actor_id: u.ops,
      actor_role: "ops",
      action: "push.send",
      source: "api",
      reason: "Thông báo bảo trì",
      ip: "198.51.100.9",
      after: { title: "Bảo trì", recipients: "all" },
    });
  });

  it("gia đình / anon không ghi được; hành động sai định dạng bị từ chối", async () => {
    await expect(run(u.family, "SELECT public.log_admin_action('push.send')")).rejects.toThrow(/Chỉ nhân sự/);
    await expect(asAnon(db, (tx) => tx.query("SELECT public.log_admin_action('push.send')"))).rejects.toThrow(/permission denied/);
    await expect(run(u.ops, "SELECT public.log_admin_action('DROP TABLE')")).rejects.toThrow(/admin_audit_log_action_check/);
  });

  it("hàm nội bộ audit_write không gọi trực tiếp được", async () => {
    await expect(
      run(u.superAdmin, "SELECT public.audit_write('user.role_change', 'user', 'x', NULL, NULL, NULL, NULL, NULL, 'db')")
    ).rejects.toThrow(/permission denied/);
  });
});
