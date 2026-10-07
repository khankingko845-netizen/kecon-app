import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb, asUser, asRole, asAnon } from "./supabase-harness";
import { DEFAULT_FEATURE_FLAGS } from "@/lib/feature-flags";
let db: PGlite;
const admin = randomUUID(),
  family = randomUUID(),
  editor = randomUUID(),
  ops = randomUUID();
const reason = "Kiểm thử cờ tính năng T06";
const set = "SELECT public.set_feature_flag($1,$2,$3,$4) changed";
beforeAll(async () => {
  ({ db } = await createMigratedDb());
  for (const [id, role] of [
    [admin, "super_admin"],
    [family, "user"],
    [editor, "editor"],
    [ops, "ops"],
  ]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [
      id,
      role + "@t06.test",
    ]);
    if (role !== "user")
      await db.query("UPDATE public.profiles SET role=$1 WHERE id=$2", [
        role,
        id,
      ]);
  }
});
afterAll(async () => {
  await db?.close();
});
it("allowlisted public RPC returns exactly safe booleans with v1 defaults", async () => {
  const r = await asAnon(db, (tx) =>
    tx.query<{ flags: unknown }>("SELECT public.public_feature_flags() flags"),
  );
  expect(r.rows[0].flags).toEqual(DEFAULT_FEATURE_FLAGS);
  expect(
    (
      await asAnon(db, (tx) =>
        tx.query<{ v: boolean }>(
          "SELECT public.feature_enabled('elevenlabs_api_key') v",
        ),
      )
    ).rows[0].v,
  ).toBe(false);
});
it("family/editor and AAL1 staff cannot mutate flags", async () => {
  for (const u of [family, editor])
    await expect(
      asUser(db, u, (tx) =>
        tx.query(set, ["gamification", true, false, reason]),
      ),
    ).rejects.toThrow(/Permission denied/);
  await expect(
    asRole(
      db,
      "authenticated",
      admin,
      (tx) => tx.query(set, ["gamification", true, false, reason]),
      { aal: "aal1" },
    ),
  ).rejects.toThrow(/Permission denied/);
  await expect(
    asAnon(db, (tx) => tx.query(set, ["gamification", true, false, reason])),
  ).rejects.toThrow(/permission denied/);
});
it("authenticated manager changes one boolean with one audit, stale expected value conflicts", async () => {
  const before = (
    await db.query<{ n: number }>(
      "SELECT count(*)::int n FROM public.admin_audit_log WHERE action='flag.update'",
    )
  ).rows[0].n;
  const r = await asUser(db, admin, (tx) =>
    tx.query<{ changed: boolean }>(set, ["gamification", true, false, reason]),
  );
  expect(r.rows[0].changed).toBe(true);
  const audit = (
    await db.query<{ before: unknown; after: unknown; reason: string }>(
      "SELECT before,after,reason FROM public.admin_audit_log WHERE action='flag.update' ORDER BY created_at DESC LIMIT 1",
    )
  ).rows[0];
  expect(audit).toEqual({
    before: { enabled: false },
    after: { enabled: true },
    reason,
  });
  expect(
    (
      await db.query<{ n: number }>(
        "SELECT count(*)::int n FROM public.admin_audit_log WHERE action='flag.update'",
      )
    ).rows[0].n,
  ).toBe(before + 1);
  await expect(
    asUser(db, admin, (tx) =>
      tx.query(set, ["gamification", false, false, reason]),
    ),
  ).rejects.toThrow(/reload/);
  const noop = await asUser(db, admin, (tx) =>
    tx.query<{ changed: boolean }>(set, ["gamification", true, true, reason]),
  );
  expect(noop.rows[0].changed).toBe(false);
  expect(
    (
      await db.query<{ n: number }>(
        "SELECT count(*)::int n FROM public.admin_audit_log WHERE action='flag.update'",
      )
    ).rows[0].n,
  ).toBe(before + 1);
});
it("missing/short reasons, null or unknown names fail even direct RPC", async () => {
  for (const why of [null, "short"])
    await expect(
      asUser(db, admin, (tx) =>
        tx.query(set, ["gamification", false, true, why]),
      ),
    ).rejects.toThrow();
  for (const key of [null, "evil"])
    await expect(
      asUser(db, admin, (tx) => tx.query(set, [key, true, false, reason])),
    ).rejects.toThrow(/Unknown feature/);
});
it("direct updates cannot bypass reason or rename flag outside its namespace", async () => {
  await expect(
    asUser(db, admin, (tx) =>
      tx.query(
        "UPDATE public.app_settings SET value='false' WHERE key='feature.gamification'",
      ),
    ),
  ).rejects.toThrow();
  await expect(
    db.query(
      "UPDATE public.app_settings SET key='not_a_flag' WHERE key='feature.gamification'",
    ),
  ).rejects.toThrow(/immutable/);
  await expect(
    db.query(
      "UPDATE public.app_settings SET category=NULL WHERE key='feature.gamification'",
    ),
  ).rejects.toThrow();
  await expect(
    db.query(
      "UPDATE public.app_settings SET value='yes' WHERE key='feature.gamification'",
    ),
  ).rejects.toThrow();
});
it("raw REST tables are closed when optional gamification and push flags are off", async () => {
  await asUser(db, admin, (tx) =>
    tx.query(set, ["gamification", false, true, reason]),
  );
  for (const table of [
    "badge_definitions",
    "user_badges",
    "daily_challenges",
    "user_challenge_progress",
    "push_subscriptions",
  ]) {
    const r = await asUser(db, family, (tx) =>
      tx.query("SELECT * FROM public." + table),
    );
    expect(r.rows).toEqual([]);
  }
});
it("system SQL changes are still audited and normal settings audit is not broken", async () => {
  await db.query(
    "UPDATE public.app_settings SET value='true' WHERE key='feature.multilingual'",
  );
  const a = (
    await db.query<{ actor_id: string | null; after: unknown }>(
      "SELECT actor_id,after FROM public.admin_audit_log WHERE action='flag.update' AND target_id='feature.multilingual' ORDER BY created_at DESC LIMIT 1",
    )
  ).rows[0];
  expect(a).toEqual({ actor_id: null, after: { enabled: true } });
  const r = await asUser(db, admin, (tx) =>
    tx.query(
      "UPDATE public.app_settings SET value='s1' WHERE key='fishaudio_model_id' RETURNING key",
    ),
  );
  expect(r.rows).toHaveLength(1);
  expect(
    (
      await db.query(
        "SELECT * FROM public.admin_audit_log WHERE action='setting.update' AND target_id='fishaudio_model_id'",
      )
    ).rows,
  ).toHaveLength(1);
});

it("ops with valid MFA lease can manage flags per existing RBAC; expired lease cannot", async () => {
  await asUser(db, ops, (tx) =>
    tx.query(set, ["book_scan", true, false, reason]),
  );
  await db.query(
    "UPDATE public.admin_sessions SET last_activity=now()-interval '31 minutes' WHERE user_id=$1",
    [ops],
  );
  await expect(
    asRole(
      db,
      "authenticated",
      ops,
      (tx) => tx.query(set, ["book_scan", false, true, reason]),
      { session_id: ops, aal: "aal2" },
    ),
  ).rejects.toThrow(/Permission denied/);
});

it("disabled push still permits owner-only unsubscribe through narrow cleanup RPC", async()=>{
 const endpoint="https://push.test/cleanup";
 await db.query("INSERT INTO public.push_subscriptions(user_id,endpoint,keys,subscription_json) VALUES($1,$2,'{}','{}')",[family,endpoint]);
 await asUser(db,editor,tx=>tx.query("SELECT public.unsubscribe_push($1)",[endpoint]));
 expect((await db.query<{n:number}>("SELECT count(*)::int n FROM public.push_subscriptions WHERE endpoint=$1",[endpoint])).rows[0].n).toBe(1);
 await asUser(db,family,tx=>tx.query("SELECT public.unsubscribe_push($1)",[endpoint]));
 expect((await db.query<{n:number}>("SELECT count(*)::int n FROM public.push_subscriptions WHERE endpoint=$1",[endpoint])).rows[0].n).toBe(0);
 await expect(asAnon(db,tx=>tx.query("SELECT public.unsubscribe_push($1)",[endpoint]))).rejects.toThrow();
});
