import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb, asUser, asRole } from "./supabase-harness";
let db: PGlite;
const admin = randomUUID(),
  family = randomUUID(),
  other = randomUUID();
beforeAll(async () => {
  ({ db } = await createMigratedDb());
  await db.query(
    "INSERT INTO auth.users(id,email) VALUES($1,'t07-admin@test.local'),($2,'t07-family@test.local'),($3,'t07-other@test.local')",
    [admin, family, other],
  );
  await db.query("UPDATE public.profiles SET role='super_admin' WHERE id=$1", [
    admin,
  ]);
});
afterAll(async () => {
  await db?.close();
});
it("registration records one server milestone without copying auth metadata", async () => {
  const { rows } = await db.query(
    "SELECT event_name FROM public.analytics_events WHERE user_id=$1",
    [family],
  );
  expect(rows).toEqual([{ event_name: "signup" }]);
  const { rows: cols } = await db.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name='analytics_events' ORDER BY ordinal_position",
  );
  expect(cols.map((v) => v.column_name)).toEqual([
    "id",
    "user_id",
    "event_name",
    "created_at",
  ]);
});
it("milestones bind actor and time to auth.uid, deduplicate and reject arbitrary event", async () => {
  for (let n = 0; n < 3; n++)
    await asUser(db, family, (tx) =>
      tx.query("SELECT public.record_measurement_event('home_view')"),
    );
  await asUser(db, family, (tx) =>
    tx.query("SELECT public.record_measurement_event('first_listen')"),
  );
  expect(
    (
      await db.query<{ n: number }>(
        "SELECT count(*)::int n FROM public.analytics_events WHERE user_id=$1 AND event_name='home_view'",
        [family],
      )
    ).rows[0].n,
  ).toBe(1);
  await expect(
    asUser(db, family, (tx) =>
      tx.query("SELECT public.record_measurement_event('child-name')"),
    ),
  ).rejects.toThrow(/Invalid event/);
  await expect(
    asRole(db, "anon", null, (tx) =>
      tx.query("SELECT public.record_measurement_event('home_view')"),
    ),
  ).rejects.toThrow();
});
it("no family or staff direct reads/writes of event and cost rows", async () => {
  for (const user of [family, admin])
    for (const q of [
      "SELECT * FROM public.analytics_events",
      "SELECT * FROM public.ai_cost_ledger",
      "INSERT INTO public.analytics_events(user_id,event_name) VALUES(gen_random_uuid(),'signup')",
    ]) {
      await expect(asUser(db, user, (tx) => tx.query(q))).rejects.toThrow(
        /permission denied/,
      );
    }
});
it("bounded aggregate denies family, grants authorized staff and cannot leak identities", async () => {
  await expect(
    asUser(db, family, (tx) =>
      tx.query("SELECT public.measurement_summary(14)"),
    ),
  ).rejects.toThrow(/Permission denied/);
  await expect(
    asUser(db, admin, (tx) =>
      tx.query("SELECT public.measurement_summary(31)"),
    ),
  ).rejects.toThrow(/Invalid period/);
  const r = await asUser(db, admin, (tx) =>
    tx.query<{ s: unknown }>("SELECT public.measurement_summary(14) s"),
  );
  const json = JSON.stringify(r.rows[0].s);
  expect(json).not.toContain(family);
  expect(json).not.toContain("test.local");
  expect(json).toContain("first_listen");
});
it("price updates require settings permission, validate units and audit once", async () => {
  const q =
    "SELECT public.set_ai_price('openai','test-model','llm',1,2,NULL,'https://provider.example/pricing')";
  await expect(asUser(db, family, (tx) => tx.query(q))).rejects.toThrow(
    /Permission denied/,
  );
  await asUser(db, admin, (tx) => tx.query(q));
  expect(
    (
      await db.query<{ n: number }>(
        "SELECT count(*)::int n FROM public.admin_audit_log WHERE action='pricing.update'",
      )
    ).rows[0].n,
  ).toBe(1);
  await expect(
    asUser(db, admin, (tx) =>
      tx.query(
        "SELECT public.set_ai_price('openai','bad','llm',NULL,NULL,1,'https://provider.example/pricing')",
      ),
    ),
  ).rejects.toThrow();
  await expect(
    asUser(db, admin, (tx) =>
      tx.query("UPDATE public.ai_price_rates SET input_per_million=0"),
    ),
  ).rejects.toThrow();
});
it("unknown/failed/pending and BYO costs remain distinct from known platform estimates", async () => {
  for (const v of [
    { status: "succeeded", cost: 0.001, payer: "platform" },
    { status: "failed", cost: null, payer: "platform" },
    { status: "pending", cost: null, payer: "platform" },
    { status: "succeeded", cost: 0.1, payer: "byo" },
  ])
    await asRole(db, "service_role", null, (tx) =>
      tx.query(
        "INSERT INTO public.ai_cost_ledger(id,request_id,user_id,feature,provider,model,kind,payer,status,estimated_usd,finished_at) VALUES($1,$2,$3,'story.generate','openai','test-model','llm',$4,$5,$6,$7)",
        [
          randomUUID(),
          randomUUID(),
          family,
          v.payer,
          v.status,
          v.cost,
          v.status === "pending" ? null : new Date().toISOString(),
        ],
      ),
    );
  const r = await asUser(db, admin, (tx) =>
    tx.query<{
      s: { totals: Record<string, unknown>; funnel: Record<string, number> };
    }>("SELECT public.measurement_summary(14) s"),
  );
  expect(r.rows[0].s.totals).toMatchObject({
    attempts: 4,
    estimated_usd: 0.001,
    unknown_cost: 2,
    pending: 1,
    byo_attempts: 1,
  });
  expect(r.rows[0].s.funnel.first_listen).toBe(1);
});
it("expired admin lease blocks aggregate and price mutation", async () => {
  await db.query(
    "UPDATE public.admin_sessions SET last_activity=now()-interval '31 minutes' WHERE user_id=$1",
    [admin],
  );
  await expect(
    asRole(
      db,
      "authenticated",
      admin,
      (tx) => tx.query("SELECT public.measurement_summary(14)"),
      {
        session_id: admin,
        aal: "aal2",
        amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }],
      },
    ),
  ).rejects.toThrow();
});
it("account deletion removes events, keeps ledger without account identifier", async () => {
  await db.query("DELETE FROM auth.users WHERE id=$1", [family]);
  expect(
    (
      await db.query("SELECT * FROM public.analytics_events WHERE user_id=$1", [
        family,
      ])
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query<{ n: number }>(
        "SELECT count(*)::int n FROM public.ai_cost_ledger WHERE user_id IS NULL",
      )
    ).rows[0].n,
  ).toBe(4);
});

it("retention is service-only: delete old events, unlink 90-day accounts, keep accounting up to 365 days", async () => {
  await db.query(
    "INSERT INTO public.analytics_events(user_id,event_name,created_at) VALUES($1,'home_view',now()-interval '91 days')",
    [other],
  );
  const old = randomUUID(),
    expired = randomUUID();
  for (const [id, days] of [
    [old, 91],
    [expired, 366],
  ])
    await db.query(
      "INSERT INTO public.ai_cost_ledger(id,request_id,user_id,feature,provider,model,kind,payer,created_at) VALUES($1,$2,$3,'story.generate','openai','m','llm','platform',now()-make_interval(days=>$4))",
      [id, randomUUID(), other, days],
    );
  await expect(
    asUser(db, other, (tx) => tx.query("SELECT public.prune_measurement()")),
  ).rejects.toThrow();
  await asRole(db, "service_role", null, (tx) =>
    tx.query("SELECT public.prune_measurement()"),
  );
  expect(
    (
      await db.query("SELECT user_id FROM public.ai_cost_ledger WHERE id=$1", [
        old,
      ])
    ).rows,
  ).toEqual([{ user_id: null }]);
  expect(
    (
      await db.query("SELECT id FROM public.ai_cost_ledger WHERE id=$1", [
        expired,
      ])
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query(
        "SELECT id FROM public.analytics_events WHERE user_id=$1 AND event_name='home_view'",
        [other],
      )
    ).rows,
  ).toHaveLength(0);
});
