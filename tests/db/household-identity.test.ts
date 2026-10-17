import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb, asUser, asRole } from "./supabase-harness";
let db: PGlite;
const a = randomUUID(), b = randomUUID(), story = randomUUID(), page = randomUUID(), voice = randomUUID(), person = randomUUID();
let hA: string, hB: string;
beforeAll(async () => {
  ({ db } = await createMigratedDb({ stopBefore: "030_household_identity_expand.sql" }));
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,'t08a-a@test.local'),($2,'t08a-b@test.local')", [a, b]);
  await db.query("INSERT INTO public.stories(id,user_id,title) VALUES($1,$2,'Truyện riêng')", [story, a]);
  await db.query("INSERT INTO public.story_pages(id,story_id,page_number,content) VALUES($1,$2,1,'Nội dung riêng')", [page, story]);
  await db.query("INSERT INTO public.voice_profiles(id,user_id,name,elevenlabs_voice_id) VALUES($1,$2,'Giọng riêng','original-provider-id')", [voice, a]);
  await db.query("INSERT INTO public.family_members(id,user_id,name,relation,voice_profile_id) VALUES($1,$2,'Ông bà','grandparent',$3)", [person, a, voice]);
  await db.exec(readFileSync("supabase/migrations/030_household_identity_expand.sql", "utf8"));
  hA = (await db.query<{ household_id: string }>("SELECT household_id FROM public.profiles WHERE id=$1", [a])).rows[0].household_id;
  hB = (await db.query<{ household_id: string }>("SELECT household_id FROM public.profiles WHERE id=$1", [b])).rows[0].household_id;
});
afterAll(async () => { await db?.close(); });
it("backfills one owner household per existing account, preserving private content and provider IDs", async () => {
  expect(hA).not.toBe(hB);
  expect((await db.query<{ n: number }>("SELECT count(*)::int n FROM public.households")).rows[0].n).toBe(2);
  for (const [table, id] of [["stories", story], ["story_pages", page], ["voice_profiles", voice], ["family_members", person]]) expect((await db.query(`SELECT household_id FROM public.${table} WHERE id=$1`, [id])).rows).toEqual([{ household_id: hA }]);
  expect((await db.query("SELECT content FROM public.story_pages WHERE id=$1", [page])).rows).toEqual([{ content: "Nội dung riêng" }]);
  expect((await db.query("SELECT elevenlabs_voice_id FROM public.voice_profiles WHERE id=$1", [voice])).rows).toEqual([{ elevenlabs_voice_id: "original-provider-id" }]);
});
it("two households cannot read each other's new identity/membership tables, including anonymous callers", async () => {
  for (const [user, h] of [[a, hA], [b, hB]]) {
    const homes = await asUser(db, user, tx => tx.query("SELECT id FROM public.households"));expect(homes.rows).toEqual([{ id: h }]);
    const memberships = await asUser(db, user, tx => tx.query("SELECT household_id,user_id,role FROM public.household_memberships"));expect(memberships.rows).toEqual([{ household_id: h, user_id: user, role: "owner" }]);
  }
  await expect(asRole(db, "anon", null, tx => tx.query("SELECT * FROM public.households"))).rejects.toThrow();
});
it("membership helper and self-context bind authenticated actor; caller cannot select another household", async () => {
  const r = await asUser(db, a, tx => tx.query<{ own: boolean; other: boolean; ctx: unknown }>("SELECT public.is_household_member($1) own, public.is_household_member($2) other, public.my_household_context() ctx", [hA, hB]));
  expect(r.rows[0]).toEqual({ own: true, other: false, ctx: { household_id: hA, role: "owner" } });
  await expect(asRole(db, "anon", null, tx => tx.query("SELECT public.my_household_context()"))).rejects.toThrow();
});
it("clients cannot insert memberships, change roles/owner or create houses by direct RPC", async () => {
  for (const q of ["INSERT INTO public.households(owner_user_id) VALUES('"+a+"')", "UPDATE public.households SET owner_user_id='"+b+"'", "INSERT INTO public.household_memberships(household_id,user_id,role) VALUES('"+hB+"','"+a+"','owner')", "UPDATE public.household_memberships SET role='parent'", "DELETE FROM public.household_memberships", "SELECT public.ensure_default_household('"+b+"')"])
    await expect(asUser(db, a, tx => tx.query(q))).rejects.toThrow();
});
it("profile identity cannot be forged or cleared, while ordinary profile edits still work", async () => {
  await expect(asUser(db, a, tx => tx.query("UPDATE public.profiles SET household_id=$1 WHERE id=$2", [hB, a]))).rejects.toThrow(/server managed/);
  await asUser(db, a, tx => tx.query("UPDATE public.profiles SET household_id=NULL,display_name='Mới' WHERE id=$1", [a]));
  expect((await db.query("SELECT household_id,display_name FROM public.profiles WHERE id=$1", [a])).rows).toEqual([{ household_id: hA, display_name: "Mới" }]);
});
it("legacy writes derive identity server-side and reject foreign household metadata without widening old ACL", async () => {
  const id = randomUUID();
  await asUser(db, a, tx => tx.query("INSERT INTO public.stories(id,user_id,title) VALUES($1,$2,'Mới')", [id, a]));
  expect((await db.query("SELECT household_id FROM public.stories WHERE id=$1", [id])).rows).toEqual([{ household_id: hA }]);
  await expect(asUser(db, a, tx => tx.query("UPDATE public.stories SET household_id=$1 WHERE id=$2", [hB, id]))).rejects.toThrow(/scope mismatch/);
  await expect(asUser(db, a, tx => tx.query("INSERT INTO public.voice_profiles(user_id,name,household_id) VALUES($1,'Sai',$2)", [a, hB]))).rejects.toThrow(/scope mismatch/);
  for (const table of ["stories", "story_pages", "voice_profiles", "family_members"]) expect((await asUser(db, b, tx => tx.query(`SELECT id FROM public.${table}`))).rows).toHaveLength(0);
});
it("pages derive their parent scope and platform reclassification propagates atomically", async () => {
  await expect(asUser(db, a, tx => tx.query("UPDATE public.story_pages SET household_id=$1 WHERE id=$2", [hB, page]))).rejects.toThrow(/scope mismatch/);
  await db.query("UPDATE public.stories SET is_platform_content=true WHERE id=$1", [story]);
  expect((await db.query("SELECT household_id FROM public.stories WHERE id=$1", [story])).rows).toEqual([{ household_id: null }]);
  expect((await db.query("SELECT household_id FROM public.story_pages WHERE id=$1", [page])).rows).toEqual([{ household_id: null }]);
  await db.query("UPDATE public.stories SET is_platform_content=false WHERE id=$1", [story]);
  expect((await db.query("SELECT household_id FROM public.story_pages WHERE id=$1", [page])).rows).toEqual([{ household_id: hA }]);
});
it("new signup automatically creates household before profile NOT NULL check; maintenance ensure is idempotent", async () => {
  const c = randomUUID();await db.query("INSERT INTO auth.users(id,email) VALUES($1,'t08a-c@test.local')", [c]);
  const context = (await asUser(db, c, tx => tx.query<{ ctx: { household_id: string } }>("SELECT public.my_household_context() ctx"))).rows[0].ctx;
  await asRole(db, "service_role", null, tx => tx.query("SELECT public.ensure_default_household($1)", [c]));
  expect((await db.query<{ n: number }>("SELECT count(*)::int n FROM public.households WHERE owner_user_id=$1", [c])).rows[0].n).toBe(1);
  await db.query("DELETE FROM auth.users WHERE id=$1", [c]);
  expect((await db.query("SELECT id FROM public.households WHERE id=$1", [context.household_id])).rows).toHaveLength(0);
});
it("account deletion cascades only its default household and private rows, keeping another household", async () => {
  await db.query("DELETE FROM auth.users WHERE id=$1", [a]);
  expect((await db.query("SELECT id FROM public.households")).rows).toEqual([{ id: hB }]);
  expect((await db.query("SELECT id FROM public.stories")).rows).toHaveLength(0);
  expect((await db.query("SELECT id FROM public.story_pages")).rows).toHaveLength(0);
});
