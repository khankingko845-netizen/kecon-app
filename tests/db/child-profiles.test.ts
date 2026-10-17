import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applyMigrationFile, asAnon, asUser, createMigratedDb, grantParentConsent, listMigrations } from "./supabase-harness";

// T10 (docs/child-profiles.md): 1–5 child profiles per household replace
// profiles.child_name/child_age (044 expand + backfill, 045 drops the old columns). Only
// household members read/change them; the household and creator are server-derived; age comes
// from the birth year; adding/changing needs the parent's consent (T11), deleting never does.
let db: PGlite;
/** State between 044 and 045: the legacy columns after the backfill / after a new signup. */
let legacyAfter044: unknown[] = [];
let signupAfter044: unknown[] = [];
const mom = randomUUID(), // name + age (legacy), consented
  dad = randomUUID(), // another household, age only (legacy), consented
  nameOnly = randomUUID(), // legacy name without age
  empty = randomUUID(), // no child data
  fresh = randomUUID(); // never accepted the parent policy
const YEAR = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric" }).format(new Date()));
type Row = { id: string; household_id: string; display_name: string; birth_year: number | null; interests: string[]; created_by: string | null };
const hh = async (uid: string) =>
  (await db.query<{ h: string }>("SELECT household_id h FROM public.profiles WHERE id=$1", [uid])).rows[0].h;
const rows = async (uid: string) =>
  (await asUser(db, uid, (tx) => tx.query<Row>("SELECT id,household_id,display_name,birth_year,interests,created_by FROM public.child_profiles ORDER BY created_at, display_name"))).rows;
const add = (uid: string, name: string, year: number | null = YEAR - 4, interests: string[] = []) =>
  asUser(db, uid, (tx) =>
    tx.query<Row>("INSERT INTO public.child_profiles(display_name,birth_year,interests) VALUES($1,$2,$3) RETURNING *", [name, year, interests]),
  ).then((r) => r.rows[0]);
const all = async () => (await db.query<Row>("SELECT * FROM public.child_profiles ORDER BY created_at")).rows;

beforeAll(async () => {
  ({ db } = await createMigratedDb({ stopBefore: "044_child_profiles.sql" }));
  const meta = (o: Record<string, unknown>) => JSON.stringify(o);
  await db.query(
    `INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
      ($1,'t10-mom@test.local',$6),($2,'t10-dad@test.local',$7),($3,'t10-name@test.local',$8),($4,'t10-empty@test.local','{}'),($5,'t10-fresh@test.local','{}')`,
    [mom, dad, nameOnly, empty, fresh, meta({ child_name: "  Bin  ", child_age: 4 }), meta({ child_age: 7 }), meta({ child_name: "Na" })],
  );
  await applyMigrationFile(db, "044_child_profiles.sql");
  legacyAfter044 = (await db.query("SELECT child_name,child_age FROM public.profiles WHERE id=$1", [mom])).rows;
  const between = randomUUID();
  await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'t10-between@test.local',$2)", [
    between,
    meta({ family_name: "Nhà Giữa", child_name: "Tí", child_age: 6 }),
  ]);
  signupAfter044 = (await db.query("SELECT family_name,child_name,child_age FROM public.profiles WHERE id=$1", [between])).rows;
  // 045 (contract) and anything after it.
  for (const file of listMigrations().filter((f) => f > "044_child_profiles.sql")) await applyMigrationFile(db, file);
  for (const uid of [mom, dad, nameOnly, empty]) await grantParentConsent(db, uid);
});
afterAll(async () => {
  await db?.close();
});

describe("044 · backfill from profiles.child_name/child_age", () => {
  it("one child profile per account that had child data; age → birth year; age-only → 'Bé'; name-only keeps no year", async () => {
    const byHome = new Map((await all()).map((r) => [r.household_id, r]));
    expect(byHome.size).toBe(3);
    expect(byHome.get(await hh(mom))).toMatchObject({ display_name: "Bin", birth_year: YEAR - 4, interests: [], created_by: null });
    expect(byHome.get(await hh(dad))).toMatchObject({ display_name: "Bé", birth_year: YEAR - 7 });
    expect(byHome.get(await hh(nameOnly))).toMatchObject({ display_name: "Na", birth_year: null });
    expect(byHome.has(await hh(empty))).toBe(false);
    expect(byHome.has(await hh(fresh))).toBe(false);
    // 044 left the legacy columns untouched (045 dropped them afterwards).
    expect(legacyAfter044).toEqual([{ child_name: "  Bin  ", child_age: 4 }]);
  });

  it("signup no longer copies child data: profile + household are created, no child profile", async () => {
    // Between 044 and 045 the old columns stayed empty for new accounts.
    expect(signupAfter044).toEqual([{ family_name: "Nhà Giữa", child_name: null, child_age: null }]);
    const uid = randomUUID();
    await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'t10-new@test.local',$2)", [
      uid,
      JSON.stringify({ family_name: "Nhà Mới", child_name: "Mít", child_age: 5 }),
    ]);
    expect((await db.query("SELECT family_name FROM public.profiles WHERE id=$1", [uid])).rows).toEqual([{ family_name: "Nhà Mới" }]);
    expect(await hh(uid)).toBeTruthy();
    expect((await db.query<{ n: number }>("SELECT count(*)::int n FROM public.child_profiles WHERE household_id=$1", [await hh(uid)])).rows[0].n).toBe(0);
  });
});

describe("045 · contract: profiles.child_name/child_age are gone", () => {
  it("the columns no longer exist; the backfilled child profiles stay; old writes fail loudly", async () => {
    const cols = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name IN ('child_name','child_age')");
    expect(cols.rows).toEqual([]);
    expect((await all()).filter((r) => r.created_by === null).map((r) => r.display_name).sort()).toEqual(["Bin", "Bé", "Na"]);
    await expect(asUser(db, mom, (tx) => tx.query("UPDATE public.profiles SET child_age = 5 WHERE id = $1", [mom]))).rejects.toThrow(/child_age/);
  });
});

describe("044 · household boundary (RLS, two households)", () => {
  it("members see only their own household's children; anon sees nothing", async () => {
    expect((await rows(mom)).map((r) => r.display_name)).toEqual(["Bin"]);
    expect((await rows(dad)).map((r) => r.display_name)).toEqual(["Bé"]);
    expect(await rows(empty)).toEqual([]);
    await expect(asAnon(db, (tx) => tx.query("SELECT * FROM public.child_profiles"))).rejects.toThrow();
  });

  it("another household cannot update or delete them (0 rows), the owner can", async () => {
    const bin = (await rows(mom))[0];
    const upd = await asUser(db, dad, (tx) => tx.query("UPDATE public.child_profiles SET display_name='Hack' WHERE id=$1", [bin.id]));
    const del = await asUser(db, dad, (tx) => tx.query("DELETE FROM public.child_profiles WHERE id=$1", [bin.id]));
    expect([upd.affectedRows, del.affectedRows]).toEqual([0, 0]);
    expect((await rows(mom))[0]).toMatchObject({ id: bin.id, display_name: "Bin" });
    const own = await asUser(db, mom, (tx) => tx.query<Row>("UPDATE public.child_profiles SET display_name='Bin Bin', interests=$2 WHERE id=$1 RETURNING *", [bin.id, ["Khủng long"]]));
    expect(own.rows[0]).toMatchObject({ display_name: "Bin Bin", interests: ["Khủng long"] });
  });

  it("household and creator are server-derived: no forging a foreign household, no moving a profile", async () => {
    const mine = await add(mom, "Na");
    const dadHome = await hh(dad);
    expect(mine).toMatchObject({ household_id: await hh(mom), created_by: mom });
    await expect(
      asUser(db, mom, (tx) => tx.query("INSERT INTO public.child_profiles(household_id,display_name) VALUES($1,'Lạ')", [dadHome])),
    ).rejects.toThrow(/household_scope/);
    await expect(asUser(db, mom, (tx) => tx.query("UPDATE public.child_profiles SET household_id=$1 WHERE id=$2", [dadHome, mine.id]))).rejects.toThrow();
    await expect(asUser(db, mom, (tx) => tx.query("INSERT INTO public.child_profiles(display_name,created_by) VALUES('Giả',$1)", [dad]))).rejects.toThrow();
    await expect(asUser(db, mom, (tx) => tx.query("INSERT INTO public.child_profiles(id,display_name) VALUES($1,'Giả')", [randomUUID()]))).rejects.toThrow();
    // Even service-level edits keep the identity columns fixed.
    await expect(db.query("UPDATE public.child_profiles SET household_id=$1 WHERE id=$2", [dadHome, mine.id])).rejects.toThrow(/household_scope/);
    expect((await rows(dad)).map((r) => r.display_name)).toEqual(["Bé"]);
  });
});

describe("044 · limits, consent and validation", () => {
  it("at most 5 child profiles per household; the other household is unaffected", async () => {
    const before = (await rows(mom)).length; // Bin Bin + Na
    for (let i = before; i < 5; i++) await add(mom, `Bé ${i + 1}`);
    await expect(add(mom, "Bé thứ 6")).rejects.toThrow(/child_profile_limit/);
    expect((await rows(mom)).length).toBe(5);
    expect((await add(dad, "Su")).display_name).toBe("Su");
    // Deleting one frees a slot.
    const last = (await rows(mom)).at(-1)!;
    await asUser(db, mom, (tx) => tx.query("DELETE FROM public.child_profiles WHERE id=$1", [last.id]));
    expect((await add(mom, "Bé mới")).display_name).toBe("Bé mới");
  });

  it("adding or changing a child needs the parent's active consent; deleting does not", async () => {
    await expect(add(fresh, "Tí")).rejects.toThrow(/consent_required/);
    const su = (await rows(dad)).find((r) => r.display_name === "Su")!;
    await db.query("UPDATE public.consents SET withdrawn_at=now(), withdraw_method='account_holder' WHERE user_id=$1", [dad]);
    await expect(add(dad, "Tèo")).rejects.toThrow(/consent_required/);
    await expect(asUser(db, dad, (tx) => tx.query("UPDATE public.child_profiles SET display_name='Đổi' WHERE id=$1", [su.id]))).rejects.toThrow(/consent_required/);
    const del = await asUser(db, dad, (tx) => tx.query("DELETE FROM public.child_profiles WHERE id=$1", [su.id]));
    expect(del.affectedRows).toBe(1);
    await grantParentConsent(db, dad);
    await db.query("DELETE FROM public.consents WHERE user_id=$1 AND withdrawn_at IS NOT NULL", [dad]);
    expect((await add(dad, "Tèo")).display_name).toBe("Tèo");
  });

  it("name is NFC, trimmed and single-spaced; bad names, years and interests are rejected; interests are de-duplicated", async () => {
    const decomposed = "Me\u0301o   con "; // "Méo con" with a combining accent
    const r = await add(nameOnly, decomposed, YEAR, ["  Khủng   long ", "khủng long", "Vũ trụ", ""]);
    expect(r).toMatchObject({ display_name: "Méo con".normalize("NFC"), birth_year: YEAR, interests: ["Khủng long", "Vũ trụ"] });
    await expect(add(nameOnly, "   ")).rejects.toThrow(/invalid_child_name/);
    await expect(add(nameOnly, "x".repeat(41))).rejects.toThrow();
    await expect(add(nameOnly, "Bé\u0007")).rejects.toThrow(/invalid_child_name/);
    await expect(add(nameOnly, "Tương lai", YEAR + 1)).rejects.toThrow(/invalid_birth_year/);
    await expect(add(nameOnly, "Lớn quá", YEAR - 19)).rejects.toThrow(/invalid_birth_year/);
    await expect(add(nameOnly, "Nhiều", YEAR, ["a", "b", "c", "d", "e", "f"])).rejects.toThrow();
    await expect(add(nameOnly, "Dài", YEAR, ["x".repeat(25)])).rejects.toThrow(/invalid_child_interest/);
    // A legacy birth year that is now out of range does not block renaming.
    await db.query("UPDATE public.child_profiles SET birth_year=$1 WHERE id=$2", [YEAR - 18, r.id]);
    const renamed = await asUser(db, nameOnly, (tx) => tx.query<Row>("UPDATE public.child_profiles SET display_name='Mèo' WHERE id=$1 RETURNING *", [r.id]));
    expect(renamed.rows[0]).toMatchObject({ display_name: "Mèo", birth_year: YEAR - 18 });
  });
});

describe("044 · account deletion", () => {
  it("deleting the account removes its household's child profiles, not other households'", async () => {
    const other = (await rows(dad)).length;
    expect((await rows(nameOnly)).length).toBeGreaterThan(0);
    const home = await hh(nameOnly);
    await db.query("DELETE FROM auth.users WHERE id=$1", [nameOnly]);
    expect((await db.query<{ n: number }>("SELECT count(*)::int n FROM public.child_profiles WHERE household_id=$1", [home])).rows[0].n).toBe(0);
    expect((await rows(dad)).length).toBe(other);
  });

  it("a creator who leaves only loses the creator link (SET NULL), even without consent; the profile stays", async () => {
    // A row in dad's household created by another account (T09 members later): deleting that account keeps the child.
    const helper = randomUUID();
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'t10-helper@test.local')", [helper]);
    const { rows: [ty] } = await db.query<{ id: string; updated_at: string }>(
      "INSERT INTO public.child_profiles(household_id,display_name,created_by) VALUES($1,'Tý',$2) RETURNING id,updated_at",
      [await hh(dad), helper],
    );
    // Deleted while auth.uid() is that (unconsented) account, e.g. a future in-app deletion RPC.
    await asUser(db, helper, async (tx) => {
      await tx.query("RESET ROLE");
      expect((await tx.query<{ u: string }>("SELECT auth.uid() u")).rows[0].u).toBe(helper);
      await tx.query("DELETE FROM auth.users WHERE id=$1", [helper]);
    });
    expect((await db.query("SELECT display_name,created_by,updated_at FROM public.child_profiles WHERE id=$1", [ty.id])).rows).toEqual([
      { display_name: "Tý", created_by: null, updated_at: ty.updated_at },
    ]);
  });
});
