import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole, createMigratedDb } from "./supabase-harness";
let db: PGlite;
let uid: string;
let sid: string;
let other: string;
let proof: number;
let platformId: string;
const claims = (extra: Record<string, unknown> = {}) => ({
  session_id: sid,
  aal: "aal2",
  amr: [{ method: "totp", timestamp: proof }],
  ...extra,
});
const call = async (
  sql: string,
  params: unknown[] = [],
  extra: Record<string, unknown> = {},
) =>
  asRole(
    db,
    "authenticated",
    uid,
    async (tx) => (await tx.query<{ r: unknown }>(sql, params)).rows[0]?.r,
    claims(extra),
  );
const status = () =>
  call("SELECT public.admin_access_status() AS r") as Promise<{
    state: string;
    expires_at: string | null;
  }>;
beforeAll(async () => {
  ({ db } = await createMigratedDb());
  uid = randomUUID();
  sid = randomUUID();
  other = randomUUID();
  platformId = randomUUID();
  proof = Math.floor(Date.now() / 1000) - 10;
  await db.query(
    "INSERT INTO auth.users(id,email) VALUES($1,'mfa@test.local'),($2,'other@test.local')",
    [uid, other],
  );
  await db.query("UPDATE public.profiles SET role='super_admin' WHERE id=$1", [
    uid,
  ]);
  await db.query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)", [
    sid,
    uid,
  ]);
  await db.query(
    "INSERT INTO public.stories(id,user_id,title,is_platform_content) VALUES($1,$2,'QA platform',true)",
    [platformId, uid],
  );
  await db.query(
    "INSERT INTO public.story_pages(story_id,page_number,content) VALUES($1,1,'QA page')",
    [platformId],
  );
  await db.query(
    "INSERT INTO auth.mfa_factors(id,user_id,status,factor_type) VALUES($1,$1,'verified','totp')",
    [uid],
  );
});
afterAll(async () => db?.close());
describe("025 · MFA + server idle session", () => {
  it("aal1 cannot open a writer session or use permissions", async () => {
    expect(
      await call("SELECT public.has_permission('settings.write') AS r", [], {
        aal: "aal1",
      }),
    ).toBe(false);
    expect(
      await call("SELECT public.open_admin_session() AS r", [], {
        aal: "aal1",
      }),
    ).toMatchObject({ state: "mfa_required" });
  });
  it("JWT aal2 alone is not an admin session", async () => {
    expect(await status()).toMatchObject({ state: "session_required" });
    expect(await call("SELECT public.is_admin() AS r")).toBe(false);
  });
  it("old MFA proof cannot open a fresh session", async () => {
    expect(
      await call("SELECT public.open_admin_session() AS r", [], {
        amr: [{ method: "totp", timestamp: proof - 600 }],
      }),
    ).toMatchObject({ state: "mfa_required" });
  });
  it("session ID must belong to the caller", async () => {
    expect(
      await call("SELECT public.open_admin_session() AS r", [], {
        session_id: randomUUID(),
      }),
    ).toMatchObject({ state: "session_required" });
    await db.query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)", [
      other,
      other,
    ]);
    expect(
      await call("SELECT public.open_admin_session() AS r", [], {
        session_id: other,
      }),
    ).toMatchObject({ state: "session_required" });
  });
  it("verified TOTP opens session, permissions and is_admin agree", async () => {
    expect(await call("SELECT public.open_admin_session() AS r")).toMatchObject(
      { state: "ready" },
    );
    expect(
      await call("SELECT public.has_permission('secrets.manage') AS r"),
    ).toBe(true);
    expect(await call("SELECT public.is_admin() AS r")).toBe(true);
  });
  it("does not leak MFA secret / OTP into audit", async () => {
    const x = await db.query<{ action: string; after: unknown }>(
      "SELECT action, after FROM public.admin_audit_log WHERE actor_id=$1 AND action='admin_session.open'",
      [uid],
    );
    expect(x.rows).toHaveLength(1);
    expect(JSON.stringify(x.rows)).not.toMatch(/totp|secret|code|timestamp/);
  });
  it("cannot overwrite another session or edit the session table", async () => {
    await expect(
      asRole(
        db,
        "authenticated",
        uid,
        (tx) =>
          tx.query("UPDATE public.admin_sessions SET last_activity=now()"),
        claims(),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("touch returns server expiry while active", async () => {
    const a = await status();
    const b = (await call("SELECT public.touch_admin_session() AS r")) as {
      state: string;
      expires_at: string;
    };
    expect(b.state).toBe("ready");
    expect(Date.parse(b.expires_at)).toBeGreaterThanOrEqual(
      Date.parse(a.expires_at!),
    );
  });
  it("30 minutes inactive blocks RPC and direct RLS writes", async () => {
    await db.query(
      "UPDATE public.admin_sessions SET last_activity=now()-interval '31 minutes' WHERE session_id=$1",
      [sid],
    );
    expect(await status()).toMatchObject({ state: "session_expired" });
    expect(
      await call("SELECT public.has_permission('settings.write') AS r"),
    ).toBe(false);
    expect(await call("SELECT public.is_admin() AS r")).toBe(false);
    const n = await asRole(
      db,
      "authenticated",
      uid,
      (tx) =>
        tx.query(
          "UPDATE public.app_settings SET value='bad' WHERE key='default_ai_provider'",
        ),
      claims(),
    );
    expect(n.affectedRows ?? 0).toBe(0);
  });
  it("expired owner cannot write platform story/page through owner policy", async () => {
    await expect(
      asRole(
        db,
        "authenticated",
        uid,
        (tx) =>
          tx.query("UPDATE public.stories SET title='bad' WHERE id=$1", [
            platformId,
          ]),
        claims(),
      ),
    ).rejects.toThrow(/truyện nền tảng/);
    await expect(
      asRole(
        db,
        "authenticated",
        uid,
        (tx) =>
          tx.query(
            "UPDATE public.story_pages SET content='bad' WHERE story_id=$1",
            [platformId],
          ),
        claims(),
      ),
    ).rejects.toThrow(/truyện nền tảng/);
  });
  it("expired secret RPC is blocked directly", async () => {
    await expect(
      asRole(
        db,
        "authenticated",
        uid,
        (tx) => tx.query("SELECT public.list_system_secrets()"),
        claims(),
      ),
    ).rejects.toThrow(/quyền|admin|Admin/);
  });
  it("touch / reopen with stale MFA cannot revive an expired session", async () => {
    expect(
      await call("SELECT public.touch_admin_session() AS r"),
    ).toMatchObject({ state: "session_expired" });
    expect(await call("SELECT public.open_admin_session() AS r")).toMatchObject(
      { state: "mfa_required" },
    );
  });
  it("expired super admin cannot change own plan through owner policy", async () => {
    await expect(
      asRole(
        db,
        "authenticated",
        uid,
        (tx) =>
          tx.query(
            "UPDATE public.profiles SET current_plan='pro' WHERE id=$1",
            [uid],
          ),
        claims(),
      ),
    ).rejects.toThrow(/gói cước/);
  });
  it("fresh TOTP reopens; explicit close blocks same JWT", async () => {
    proof += 5;
    expect(await call("SELECT public.open_admin_session() AS r")).toMatchObject(
      { state: "ready" },
    );
    expect(
      await call("SELECT public.has_permission('roles.manage') AS r", [], {
        amr: [{ method: "totp", timestamp: proof - 5 }],
      }),
    ).toBe(false);
    expect(
      await call("SELECT public.close_admin_session() AS r"),
    ).toMatchObject({ state: "session_expired" });
    expect(await call("SELECT public.open_admin_session() AS r")).toMatchObject(
      { state: "mfa_required" },
    );
  });
  it("removed factor blocks aal2, logout removes DB session", async () => {
    proof += 2;
    expect(await call("SELECT public.open_admin_session() AS r")).toMatchObject(
      { state: "ready" },
    );
    const extra = randomUUID();
    await db.query(
      "INSERT INTO auth.mfa_factors(id,user_id,status,factor_type) VALUES($1,$2,'verified','totp')",
      [extra, uid],
    );
    await db.query("DELETE FROM auth.mfa_factors WHERE id=$1", [uid]);
    expect(
      (
        await db.query<{ closed: boolean }>(
          "SELECT closed FROM public.admin_sessions WHERE session_id=$1",
          [sid],
        )
      ).rows[0].closed,
    ).toBe(true);
    expect(
      await call("SELECT public.has_permission('roles.manage') AS r"),
    ).toBe(false);
    await db.query("DELETE FROM auth.sessions WHERE id=$1", [sid]);
    expect(await status()).toMatchObject({ state: "session_required" });
  });
  it("read-only analyst is exempt from TOTP, still has idle gate", async () => {
    await db.query("UPDATE public.profiles SET role='analyst' WHERE id=$1", [
      other,
    ]);
    const c = {
      session_id: other,
      aal: "aal1",
      amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }],
    };
    const x = await asRole(
      db,
      "authenticated",
      other,
      (tx) =>
        tx.query<{ r: { state: string; requires_mfa: boolean } }>(
          "SELECT public.open_admin_session() AS r",
        ),
      c,
    );
    expect(x.rows[0].r).toMatchObject({ state: "ready", requires_mfa: false });
    expect(
      await asRole(
        db,
        "authenticated",
        other,
        async (tx) =>
          (
            await tx.query<{ r: boolean }>(
              "SELECT public.has_permission('settings.write') AS r",
            )
          ).rows[0].r,
        c,
      ),
    ).toBe(false);
  });
  it("MFA requirement follows writer roles, read-only exemptions stay narrow", async () => {
    for (const role of [
      "super_admin",
      "admin",
      "ops",
      "editor",
      "moderator",
      "support",
      "analyst",
    ]) {
      await db.query("UPDATE public.profiles SET role=$1 WHERE id=$2", [
        role,
        other,
      ]);
      const x = await asRole(
        db,
        "authenticated",
        other,
        (tx) =>
          tx.query<{ r: { requires_mfa: boolean } }>(
            "SELECT public.admin_access_status() AS r",
          ),
        { session_id: other, aal: "aal1" },
      );
      expect(x.rows[0].r.requires_mfa, role).toBe(
        !["support", "analyst"].includes(role),
      );
    }
  });
  it("anon cannot call bootstrap RPC", async () => {
    await expect(
      asRole(db, "anon", null, (tx) =>
        tx.query("SELECT public.open_admin_session()"),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
