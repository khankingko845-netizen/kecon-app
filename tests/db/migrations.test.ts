import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asRole, asUser, createMigratedDb, listMigrations, type Tx } from "./supabase-harness";

type Usage = {
  allowed: boolean;
  reason?: string;
  plan?: string | null;
  used?: number | null;
  limit?: number | null;
  retry_after?: number;
};

let db: PGlite;
let applied: string[] = [];

beforeAll(async () => {
  // Throws (→ every test in this file fails) if any migration errors.
  ({ db, applied } = await createMigratedDb());
});

afterAll(async () => {
  await db?.close();
});

// ── helpers (run as superuser unless noted) ─────────────────────────────────
async function createUser(opts: { role?: string; plan?: string } = {}): Promise<string> {
  const id = randomUUID();
  await db.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [id, `${id}@test.local`]);
  if (opts.role) await db.query("UPDATE public.profiles SET role = $2 WHERE id = $1", [id, opts.role]);
  if (opts.plan) await db.query("UPDATE public.profiles SET current_plan = $2 WHERE id = $1", [id, opts.plan]);
  return id;
}

async function consume(uid: string, kind: string, amount = 1, byo = false): Promise<Usage> {
  return asUser(db, uid, async (tx) => {
    const { rows } = await tx.query<{ r: Usage }>("SELECT public.consume_usage($1, $2, $3) AS r", [kind, amount, byo]);
    return rows[0].r;
  });
}

/** Pretend a minute has passed: moves this user's usage_tracking rows out of the rate-limit window. */
async function advanceMinute(uid: string) {
  await db.query(
    "UPDATE public.usage_tracking SET created_at = created_at - interval '2 minutes' WHERE user_id = $1",
    [uid]
  );
}

async function usageRow(uid: string) {
  const { rows } = await db.query<{
    stories_created: number;
    tts_generated: number;
    voices_cloned: number;
    illustrations_generated: number;
  }>(
    `SELECT stories_created, tts_generated, voices_cloned, illustrations_generated
       FROM public.usage_limits WHERE user_id = $1 AND period_start = date_trunc('month', now())::date`,
    [uid]
  );
  return rows[0];
}

async function profile(uid: string) {
  const { rows } = await db.query<{ role: string; current_plan: string; display_name: string }>(
    "SELECT role, current_plan, display_name FROM public.profiles WHERE id = $1",
    [uid]
  );
  return rows[0];
}

const affected = async (tx: Tx, sql: string, params: unknown[]) => (await tx.query(sql, params)).affectedRows ?? 0;

// ────────────────────────────────────────────────────────────────────────────
describe("migrations", () => {
  it("áp dụng toàn bộ supabase/migrations theo thứ tự, không lỗi", () => {
    const files = listMigrations();
    expect(files.length).toBeGreaterThan(0);
    expect(applied).toEqual(files);
  });

  it("số thứ tự migration không trùng nhau", () => {
    const prefixes = listMigrations().map((f) => f.split("_")[0]);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("mọi bảng trong schema public đều bật RLS", async () => {
    const { rows } = await db.query<{ table: string }>(
      `SELECT c.relname AS table FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
        ORDER BY 1`
    );
    expect(rows.map((r) => r.table)).toEqual([]);
  });

  it("đăng ký user mới tạo profile mặc định role=user, gói free", async () => {
    const uid = await createUser();
    expect(await profile(uid)).toMatchObject({ role: "user", current_plan: "free" });
  });
});

describe("016 · profiles: chặn leo thang đặc quyền", () => {
  it("user không tự nâng role", async () => {
    const uid = await createUser();
    await expect(
      asUser(db, uid, (tx) => tx.query("UPDATE public.profiles SET role = 'super_admin' WHERE id = $1", [uid]))
    ).rejects.toThrow(/super_admin/);
    expect((await profile(uid)).role).toBe("user");
  });

  it("user không tự đổi current_plan", async () => {
    const uid = await createUser();
    await expect(
      asUser(db, uid, (tx) => tx.query("UPDATE public.profiles SET current_plan = 'pro' WHERE id = $1", [uid]))
    ).rejects.toThrow(/gói cước/);
    expect((await profile(uid)).current_plan).toBe("free");
  });

  it("user vẫn sửa được thông tin hồ sơ thường", async () => {
    const uid = await createUser();
    const n = await asUser(db, uid, (tx) =>
      affected(tx, "UPDATE public.profiles SET display_name = 'Bố Bin' WHERE id = $1", [uid])
    );
    expect(n).toBe(1);
    expect((await profile(uid)).display_name).toBe("Bố Bin");
  });

  it("user tự INSERT profile với role/gói cao → bị ép về user/free", async () => {
    const uid = await createUser();
    await db.query("DELETE FROM public.profiles WHERE id = $1", [uid]);
    await asUser(db, uid, (tx) =>
      tx.query(
        "INSERT INTO public.profiles (id, display_name, role, current_plan) VALUES ($1, 'x', 'super_admin', 'pro')",
        [uid]
      )
    );
    expect(await profile(uid)).toMatchObject({ role: "user", current_plan: "free" });
  });

  it("admin đổi được gói của user nhưng không đổi được role", async () => {
    const admin = await createUser({ role: "admin" });
    const uid = await createUser();
    await asUser(db, admin, (tx) => tx.query("UPDATE public.profiles SET current_plan = 'plus' WHERE id = $1", [uid]));
    expect((await profile(uid)).current_plan).toBe("plus");

    await expect(
      asUser(db, admin, (tx) => tx.query("UPDATE public.profiles SET role = 'admin' WHERE id = $1", [uid]))
    ).rejects.toThrow(/super_admin/);
  });

  it("super_admin đổi được role của người khác", async () => {
    const superAdmin = await createUser({ role: "super_admin" });
    const uid = await createUser();
    await asUser(db, superAdmin, (tx) => tx.query("UPDATE public.profiles SET role = 'admin' WHERE id = $1", [uid]));
    expect((await profile(uid)).role).toBe("admin");
  });
});

describe("016 · usage_limits / usage_tracking / user_subscriptions: user chỉ được đọc", () => {
  it("user không sửa/xoá/thêm được usage_limits", async () => {
    const uid = await createUser();
    await consume(uid, "story");

    await asUser(db, uid, async (tx) => {
      expect(await affected(tx, "UPDATE public.usage_limits SET stories_created = 0 WHERE user_id = $1", [uid])).toBe(0);
      expect(await affected(tx, "DELETE FROM public.usage_limits WHERE user_id = $1", [uid])).toBe(0);
    });
    await expect(
      asUser(db, uid, (tx) =>
        tx.query("INSERT INTO public.usage_limits (user_id, period_start) VALUES ($1, '2000-01-01')", [uid])
      )
    ).rejects.toThrow(/row-level security/);
    expect((await usageRow(uid)).stories_created).toBe(1);
  });

  it("user không ghi/xoá được usage_tracking (không tự reset rate limit)", async () => {
    const uid = await createUser();
    await consume(uid, "tts");

    await expect(
      asUser(db, uid, (tx) =>
        tx.query("INSERT INTO public.usage_tracking (user_id, provider, endpoint) VALUES ($1, 'x', 'tts')", [uid])
      )
    ).rejects.toThrow(/row-level security/);
    const deleted = await asUser(db, uid, (tx) => affected(tx, "DELETE FROM public.usage_tracking WHERE user_id = $1", [uid]));
    expect(deleted).toBe(0);
  });

  it("user đọc được hạn mức và lịch sử của chính mình", async () => {
    const uid = await createUser();
    await consume(uid, "story");
    const counts = await asUser(db, uid, async (tx) => ({
      limits: (await tx.query("SELECT 1 FROM public.usage_limits WHERE user_id = $1", [uid])).rows.length,
      tracking: (await tx.query("SELECT 1 FROM public.usage_tracking WHERE user_id = $1", [uid])).rows.length,
    }));
    expect(counts).toEqual({ limits: 1, tracking: 1 });
  });

  it("user không tự tạo subscription trả phí", async () => {
    const uid = await createUser();
    await expect(
      asUser(db, uid, (tx) =>
        tx.query("INSERT INTO public.user_subscriptions (user_id, plan_id, status) VALUES ($1, 'pro', 'active')", [uid])
      )
    ).rejects.toThrow(/row-level security/);
  });
});

describe("016 · consume_usage()", () => {
  it("anon không execute được", async () => {
    await expect(asAnon(db, (tx) => tx.query("SELECT public.consume_usage('story')"))).rejects.toThrow(
      /permission denied for function consume_usage/
    );
  });

  it("authenticated nhưng không có uid → unauthenticated; kind lạ → invalid_kind", async () => {
    const noUid = await asRole(db, "authenticated", null, async (tx) => {
      const { rows } = await tx.query<{ r: Usage }>("SELECT public.consume_usage('story') AS r");
      return rows[0].r;
    });
    expect(noUid).toEqual({ allowed: false, reason: "unauthenticated" });

    const uid = await createUser();
    expect(await consume(uid, "bitcoin_mining")).toEqual({ allowed: false, reason: "invalid_kind" });
  });

  it("gói free: 5 truyện/tháng, truyện thứ 6 bị quota_exceeded", async () => {
    const uid = await createUser();
    for (let i = 1; i <= 5; i++) {
      expect(await consume(uid, "story")).toMatchObject({ allowed: true, plan: "free", used: i, limit: 5 });
      await advanceMinute(uid); // tránh rate limit story (5/phút)
    }
    expect(await consume(uid, "story")).toMatchObject({
      allowed: false,
      reason: "quota_exceeded",
      plan: "free",
      used: 5,
      limit: 5,
    });
    expect((await usageRow(uid)).stories_created).toBe(5);
  });

  it("BYO key bỏ qua hạn mức gói và không trừ hạn mức", async () => {
    const uid = await createUser();
    await db.query(
      "INSERT INTO public.usage_limits (user_id, stories_created) VALUES ($1, 5)",
      [uid]
    );
    expect(await consume(uid, "story")).toMatchObject({ allowed: false, reason: "quota_exceeded" });
    expect(await consume(uid, "story", 1, true)).toMatchObject({ allowed: true });
    expect((await usageRow(uid)).stories_created).toBe(5);

    const { rows } = await db.query<{ provider: string }>(
      "SELECT provider FROM public.usage_tracking WHERE user_id = $1",
      [uid]
    );
    expect(rows.map((r) => r.provider)).toEqual(["byo"]);
  });

  it("BYO vẫn bị rate limit (story: 5/phút)", async () => {
    const uid = await createUser();
    for (let i = 0; i < 5; i++) expect((await consume(uid, "story", 1, true)).allowed).toBe(true);
    expect(await consume(uid, "story", 1, true)).toEqual({ allowed: false, reason: "rate_limited", retry_after: 60 });

    await advanceMinute(uid);
    expect((await consume(uid, "story", 1, true)).allowed).toBe(true);
  });

  it("rate limit tính theo đơn vị chi phí (illustration: 20 đơn vị/phút)", async () => {
    const uid = await createUser();
    expect((await consume(uid, "illustration", 15)).allowed).toBe(true);
    expect(await consume(uid, "illustration", 10)).toMatchObject({ allowed: false, reason: "rate_limited" });
    expect((await consume(uid, "illustration", 5)).allowed).toBe(true); // 15 + 5 = 20 vừa đủ
    expect(await consume(uid, "illustration", 1)).toMatchObject({ reason: "rate_limited" });
    expect((await usageRow(uid)).illustrations_generated).toBe(20);
  });

  it("p_amount bị kẹp trong [1, 50] (không âm để 'hoàn' hạn mức)", async () => {
    const uid = await createUser();
    await consume(uid, "tts", -100);
    await consume(uid, "tts", 0);
    expect((await usageRow(uid)).tts_generated).toBe(2);

    expect((await consume(uid, "tts", 1000)).allowed).toBe(true); // tính 50
    expect((await usageRow(uid)).tts_generated).toBe(52);
    expect(await consume(uid, "tts", 9)).toMatchObject({ reason: "rate_limited" }); // 52 + 9 > 60
  });

  it("voice_clone: gói free 1 giọng; xoá voice_profiles không reset được hạn mức", async () => {
    const uid = await createUser();
    expect(await consume(uid, "voice_clone")).toMatchObject({ allowed: true, used: 1, limit: 1 });

    await asUser(db, uid, async (tx) => {
      await tx.query("INSERT INTO public.voice_profiles (user_id, name) VALUES ($1, 'Mẹ')", [uid]);
      await tx.query("DELETE FROM public.voice_profiles WHERE user_id = $1", [uid]);
    });
    await advanceMinute(uid);
    expect(await consume(uid, "voice_clone")).toMatchObject({ allowed: false, reason: "quota_exceeded", used: 1 });
  });

  it("voice_clone: số giọng đang có cũng tính vào hạn mức", async () => {
    const uid = await createUser();
    await db.query("INSERT INTO public.voice_profiles (user_id, name) VALUES ($1, 'Bố')", [uid]);
    expect(await consume(uid, "voice_clone")).toMatchObject({ allowed: false, reason: "quota_exceeded", used: 1, limit: 1 });
  });

  it.each(["expired_period", "cancelled"])("gói pro hết hạn (%s) → quay về hạn mức free", async (kind) => {
    const uid = await createUser({ plan: "pro" });
    await db.query(
      `INSERT INTO public.user_subscriptions (user_id, plan_id, status, current_period_end)
       VALUES ($1, 'pro', $2, $3)`,
      kind === "cancelled"
        ? [uid, "cancelled", new Date(Date.now() + 20 * 86_400_000).toISOString()]
        : [uid, "active", new Date(Date.now() - 86_400_000).toISOString()]
    );
    await db.query("INSERT INTO public.usage_limits (user_id, stories_created) VALUES ($1, 5)", [uid]);

    expect(await consume(uid, "story")).toMatchObject({ allowed: false, reason: "quota_exceeded", plan: "free", limit: 5 });
  });

  it("gói đang active quyết định hạn mức (plus: 30 truyện, pro: không giới hạn)", async () => {
    const plusUser = await createUser();
    await db.query("INSERT INTO public.user_subscriptions (user_id, plan_id) VALUES ($1, 'plus')", [plusUser]);
    await db.query("INSERT INTO public.usage_limits (user_id, stories_created) VALUES ($1, 10)", [plusUser]);
    expect(await consume(plusUser, "story")).toMatchObject({ allowed: true, plan: "plus", used: 11, limit: 30 });

    const proUser = await createUser();
    await db.query("INSERT INTO public.user_subscriptions (user_id, plan_id) VALUES ($1, 'pro')", [proUser]);
    await db.query("INSERT INTO public.usage_limits (user_id, stories_created) VALUES ($1, 500)", [proUser]);
    expect(await consume(proUser, "story")).toMatchObject({ allowed: true, plan: "pro", limit: null });
  });

  it("admin: không áp hạn mức gói, rate limit ×5", async () => {
    const admin = await createUser({ role: "admin" });
    await db.query("INSERT INTO public.usage_limits (user_id, stories_created) VALUES ($1, 100)", [admin]);
    for (let i = 0; i < 25; i++) expect((await consume(admin, "story")).allowed).toBe(true);
    expect(await consume(admin, "story")).toMatchObject({ reason: "rate_limited" });
  });
});
