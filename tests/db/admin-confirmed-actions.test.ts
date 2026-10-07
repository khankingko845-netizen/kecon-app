import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, asUser, createMigratedDb } from "./supabase-harness";
let db: PGlite;
const admin = randomUUID(),
  target = randomUUID();
beforeAll(async () => {
  ({ db } = await createMigratedDb());
  await db.query(
    "INSERT INTO auth.users(id,email) VALUES($1,'confirm-admin@test.local'),($2,'confirm-user@test.local')",
    [admin, target],
  );
  await db.query("UPDATE public.profiles SET role='super_admin' WHERE id=$1", [
    admin,
  ]);
});
afterAll(async () => {
  await db?.close();
});
it("role change needs a reason and records it once in the existing audit", async () => {
  await expect(
    asUser(db, admin, (tx) =>
      tx.query(
        "SELECT public.admin_confirmed_action('role.change',ARRAY[$1::text],$2,'editor')",
        [target, ""],
      ),
    ),
  ).rejects.toThrow();
  await asUser(db, admin, (tx) =>
    tx.query(
      "SELECT public.admin_confirmed_action('role.change',ARRAY[$1::text],$2,'editor')",
      [target, "Phân công biên tập kho truyện"],
    ),
  );
  expect(
    (
      await db.query<{ role: string }>(
        "SELECT role FROM public.profiles WHERE id=$1",
        [target],
      )
    ).rows[0].role,
  ).toBe("editor");
  const rows = (
    await db.query<{ reason: string }>(
      "SELECT reason FROM public.admin_audit_log WHERE actor_id=$1 AND target_id=$2 AND action='user.role_change'",
      [admin, target],
    )
  ).rows;
  expect(rows).toEqual([{ reason: "Phân công biên tập kho truyện" }]);
});
it("direct role mutation cannot bypass the reason, including an active super admin", async () => {
  await expect(
    asUser(db, admin, (tx) =>
      tx.query("UPDATE public.profiles SET role='user' WHERE id=$1", [target]),
    ),
  ).rejects.toThrow(/Lý do/);
});
it("categories use text slugs and a successful delete has a single audited reason", async () => {
  await db.query(
    "INSERT INTO public.story_categories(id,label) VALUES('a15_text_slug','Danh mục QA')",
  );
  await asUser(db, admin, (tx) =>
    tx.query(
      "SELECT public.admin_confirmed_action('category.delete',ARRAY['a15_text_slug'],$1)",
      ["Dọn danh mục thử nghiệm A15"],
    ),
  );
  const rows = (
    await db.query<{ reason: string }>(
      "SELECT reason FROM public.admin_audit_log WHERE actor_id=$1 AND target_id='a15_text_slug' AND action='category.delete'",
      [admin],
    )
  ).rows;
  expect(rows).toEqual([{ reason: "Dọn danh mục thử nghiệm A15" }]);
});
it("a partially missing batch rolls back every delete and its audit rows", async () => {
  await db.query(
    "INSERT INTO public.story_categories(id,label) VALUES('a15_keep','Giữ lại')",
  );
  await expect(
    asUser(db, admin, (tx) =>
      tx.query(
        "SELECT public.admin_confirmed_action('category.delete',ARRAY['a15_keep','a15_missing'],$1)",
        ["Không được xoá một phần batch"],
      ),
    ),
  ).rejects.toThrow(/Đối tượng/);
  expect(
    (
      await db.query(
        "SELECT id FROM public.story_categories WHERE id='a15_keep'",
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await db.query(
        "SELECT id FROM public.admin_audit_log WHERE target_id='a15_keep' AND action='category.delete'",
      )
    ).rows,
  ).toHaveLength(0);
});
it("rejects duplicate targets, unsupported action and self role changes", async () => {
  for (const [action, ids, role] of [
    ["category.delete", ["a15_keep", "a15_keep"], null],
    ["delete_everything", ["a15_keep"], null],
    ["role.change", [admin], "user"],
  ] as const) {
    await expect(
      asUser(db, admin, (tx) =>
        tx.query("SELECT public.admin_confirmed_action($1,$2::text[],$3,$4)", [
          action,
          ids,
          "Kiểm tra đầu vào không hợp lệ",
          role,
        ]),
      ),
    ).rejects.toThrow();
  }
});
it("editor cannot use the role action or delete a curated voice", async () => {
  await expect(
    asUser(db, target, (tx) =>
      tx.query(
        "SELECT public.admin_confirmed_action('role.change',ARRAY[$1::text],$2,'user')",
        [admin, "Không được nâng quyền người dùng"],
      ),
    ),
  ).rejects.toThrow(/Không có quyền/);
  await expect(
    asUser(db, target, (tx) =>
      tx.query(
        "SELECT public.admin_confirmed_action('default_voice.delete',ARRAY[$1::text],$2)",
        [randomUUID(), "Không được quản lý giọng mặc định"],
      ),
    ),
  ).rejects.toThrow(/Không có quyền/);
});
it("requires a reason for secret/pool deletion without logging the secret", async () => {
  await asUser(db, admin, (tx) =>
    tx.query(
      "SELECT public.set_system_secret('openai_api_key','sk-qa-a15-private-key')",
    ),
  );
  await expect(
    asUser(db, admin, (tx) =>
      tx.query("SELECT public.set_system_secret('openai_api_key','')"),
    ),
  ).rejects.toThrow(/Lý do/);
  await asUser(db, admin, (tx) =>
    tx.query("SELECT public.set_system_secret('openai_api_key','',$1)", [
      "Xoá key thử nghiệm kiểm tra A15",
    ]),
  );
  const logs = await db.query<{
    reason: string;
    before: unknown;
    after: unknown;
  }>(
    "SELECT reason,before,after FROM public.admin_audit_log WHERE actor_id=$1 AND action='secret.delete'",
    [admin],
  );
  expect(logs.rows[0].reason).toBe("Xoá key thử nghiệm kiểm tra A15");
  expect(JSON.stringify(logs.rows)).not.toContain("sk-qa-a15-private-key");
});
it("DB denies AAL1 and an expired admin lease even with a valid reason", async () => {
  const proof = Math.floor(Date.now() / 1000);
  for (const claims of [
    {
      session_id: admin,
      aal: "aal1",
      amr: [{ method: "totp", timestamp: proof }],
    },
    {
      session_id: randomUUID(),
      aal: "aal2",
      amr: [{ method: "totp", timestamp: proof }],
    },
  ]) {
    await expect(
      asRole(
        db,
        "authenticated",
        admin,
        (tx) =>
          tx.query(
            "SELECT public.admin_confirmed_action('category.delete',ARRAY['a15_keep'],$1)",
            ["Kiểm tra phiên bị khoá A15"],
          ),
        claims,
      ),
    ).rejects.toThrow(/Không có quyền/);
  }
  expect(
    (
      await db.query(
        "SELECT id FROM public.story_categories WHERE id='a15_keep'",
      )
    ).rows,
  ).toHaveLength(1);
});
it("an editor batch containing an inaccessible family story rolls back platform story and audit", async () => {
  const platform = randomUUID(),
    family = randomUUID();
  await db.query(
    "INSERT INTO public.stories(id,user_id,title,is_platform_content) VALUES($1,$3,'QA platform',true),($2,$3,'QA private',false)",
    [platform, family, admin],
  );
  await expect(
    asUser(db, target, (tx) =>
      tx.query(
        "SELECT public.admin_confirmed_action('story.trash',$1::text[],$2)",
        [[platform, family], "Kiểm tra RLS batch không trọn vẹn"],
      ),
    ),
  ).rejects.toThrow(/Đối tượng/);
  expect(
    (
      await db.query(
        "SELECT id FROM public.stories WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL",
        [[platform, family]],
      )
    ).rows,
  ).toHaveLength(2);
  expect(
    (
      await db.query(
        "SELECT id FROM public.admin_audit_log WHERE target_id=$1 AND action='story.trash'",
        [platform],
      )
    ).rows,
  ).toHaveLength(0);
});
