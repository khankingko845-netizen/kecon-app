import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb, asUser, asRole } from "./supabase-harness";
let db: PGlite;
const admin = randomUUID(), family = randomUUID(), legacyId = randomUUID();
let legacy: unknown;
const snapshot = { unit_usd: 0.000015, billing_unit: "utf8_bytes", price_version: 2 };
const priceSql = "SELECT public.set_ai_price_v2('fishaudio','r01-test','tts',NULL,NULL,$1,'https://provider.example/pricing',$2)";
beforeAll(async () => {
  ({ db } = await createMigratedDb({ stopBefore: "029_fish_utf8_billing.sql" }));
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,'r01-admin@test.local'),($2,'r01-family@test.local')", [admin, family]);
  await db.query("UPDATE public.profiles SET role='super_admin' WHERE id=$1", [admin]);
  await db.query("INSERT INTO public.ai_price_rates(provider,model,kind,unit_usd,source) VALUES('fishaudio','r01-legacy','tts',0.00004,'https://provider.example/old')");
  await db.query("INSERT INTO public.ai_cost_ledger(id,request_id,user_id,feature,provider,model,kind,payer,status,units,estimated_usd,finished_at,price_snapshot) VALUES($1,$2,$3,'voice.tts','fishaudio','r01-legacy','tts','platform','succeeded',17,0.00068,now(),$4)", [legacyId, randomUUID(), family, JSON.stringify({ unit_usd: 0.00004, source: "https://provider.example/old" })]);
  legacy = (await db.query("SELECT units,estimated_usd,price_snapshot FROM public.ai_cost_ledger WHERE id=$1", [legacyId])).rows;
  await db.exec(readFileSync("supabase/migrations/029_fish_utf8_billing.sql", "utf8"));
});
afterAll(async () => { await db?.close(); });
it("migration keeps historical usage, estimate and snapshot intact; price remains unconfirmed", async () => {
  expect((await db.query("SELECT units,estimated_usd,price_snapshot FROM public.ai_cost_ledger WHERE id=$1", [legacyId])).rows).toEqual(legacy);
  expect((await db.query("SELECT billing_unit,price_version FROM public.ai_price_rates WHERE model='r01-legacy'")).rows).toEqual([{ billing_unit: null, price_version: 1 }]);
});
it("old Fish price RPC rejects ambiguous writes, including updates to a confirmed price", async () => {
  await expect(asUser(db, admin, tx => tx.query("SELECT public.set_ai_price('fishaudio','r01-test','tts',NULL,NULL,0.01,'https://provider.example/pricing')"))).rejects.toThrow(/UTF-8/);
});
it("v2 requires permission and AAL2; direct client writes and raw ledger reads stay denied", async () => {
  await expect(asUser(db, family, tx => tx.query(priceSql, [0.000015, "utf8_bytes"]))).rejects.toThrow(/Permission denied/);
  await expect(asRole(db, "authenticated", admin, tx => tx.query(priceSql, [0.000015, "utf8_bytes"]), { aal: "aal1" })).rejects.toThrow();
  for (const user of [admin, family]) {
    await expect(asUser(db, user, tx => tx.query("UPDATE public.ai_price_rates SET unit_usd=0"))).rejects.toThrow();
    await expect(asUser(db, user, tx => tx.query("SELECT * FROM public.ai_cost_ledger"))).rejects.toThrow();
  }
});
it("explicit byte price is versioned and creates one atomic audit", async () => {
  await asUser(db, admin, tx => tx.query(priceSql, [0.000015, "utf8_bytes"]));
  const rows = (await db.query("SELECT unit_usd,billing_unit,price_version FROM public.ai_price_rates WHERE model='r01-test'")).rows;
  expect(rows).toEqual([{ unit_usd: "0.000015000000", billing_unit: "utf8_bytes", price_version: 2 }]);
  const audits = (await db.query<{ n: number }>("SELECT count(*)::int n FROM public.admin_audit_log WHERE target_id='fishaudio:r01-test:tts' AND action='pricing.update'")).rows;
  expect(audits[0].n).toBe(1);
});
it("wrong unit/provider/kind, missing unit, high precision and invalid sources cannot become a confirmed price", async () => {
  for (const unit of ["characters", null, "bytes"]) await expect(asUser(db, admin, tx => tx.query(priceSql, [0.000015, unit]))).rejects.toThrow();
  for (const q of [
    "SELECT public.set_ai_price_v2('elevenlabs','m','tts',NULL,NULL,1,'https://provider.example/pricing','utf8_bytes')",
    "SELECT public.set_ai_price_v2('fishaudio','m','clone',NULL,NULL,1,'https://provider.example/pricing','utf8_bytes')",
    "SELECT public.set_ai_price_v2('fishaudio','m','tts',NULL,NULL,1,'https://provider.example/?key=secret','utf8_bytes')"
  ]) await expect(asUser(db, admin, tx => tx.query(q))).rejects.toThrow();
  await expect(asUser(db, admin, tx => tx.query(priceSql, [0.0000000000001, "utf8_bytes"]))).rejects.toThrow(/precision/);
});
async function insertFish(units: number, cost: number | null, price: unknown = snapshot) {
  return asRole(db, "service_role", null, tx => tx.query("INSERT INTO public.ai_cost_ledger(id,request_id,user_id,feature,provider,model,kind,payer,status,units,estimated_usd,finished_at,price_snapshot,billing_unit,usage_version) VALUES($1,$2,$3,'voice.tts','fishaudio','r01-test','tts','platform','succeeded',$4,$5,now(),$6,'utf8_bytes',2)", [randomUUID(), randomUUID(), family, units, cost, JSON.stringify(price)]));
}
it("v2 usage must be integral bytes; incompatible or missing price snapshots cannot justify known cost", async () => {
  await expect(insertFish(2.5, null)).rejects.toThrow();
  await expect(insertFish(25, 0.001, { unit_usd: 0.01 })).rejects.toThrow();
  await expect(insertFish(25, 0, null)).rejects.toThrow();
  await insertFish(25, null, null);
});
it("aggregates quarantine historical character estimates, while valid new bytes and explicit zero are included", async () => {
  await insertFish(25, 0.000375);
  await insertFish(25, 0, { ...snapshot, unit_usd: 0 });
  const r = await asUser(db, admin, tx => tx.query<{ s: { totals: Record<string, unknown> } }>("SELECT public.measurement_summary(14) s"));
  expect(r.rows[0].s.totals).toMatchObject({ attempts: 4, estimated_usd: 0.000375, unknown_cost: 2, legacy_unit_attempts: 1 });
  expect((await db.query("SELECT units,estimated_usd,price_snapshot FROM public.ai_cost_ledger WHERE id=$1", [legacyId])).rows).toEqual(legacy);
});
it("changing price affects no prior snapshots; non-Fish legacy RPC still works and is audited", async () => {
  await asUser(db, admin, tx => tx.query(priceSql, [0, "utf8_bytes"]));
  await asUser(db, admin, tx => tx.query("SELECT public.set_ai_price_v2('openai','r01-llm','llm',1,2,NULL,'https://provider.example/pricing',NULL)"));
  expect((await db.query("SELECT price_version,billing_unit FROM public.ai_price_rates WHERE model='r01-llm'")).rows).toEqual([{ price_version: 1, billing_unit: null }]);
  expect((await db.query("SELECT units,estimated_usd,price_snapshot FROM public.ai_cost_ledger WHERE id=$1", [legacyId])).rows).toEqual(legacy);
});
