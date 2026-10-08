import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb, asUser, asAnon } from "./supabase-harness";
let db: PGlite;
const a = randomUUID(),
  b = randomUUID(),
  admin = randomUUID(),
  pub = randomUUID(),
  priv = randomUUID(),
  draft = randomUUID();
type Link = {
  id: string;
  story_id: string;
  share_token: string;
  expires_at: string;
  is_active: boolean;
  view_count: number;
};
const issue = (actor = a, id = pub, hours = 24) =>
  asUser(
    db,
    actor,
    async (tx) =>
      (
        await tx.query<{ link: Link }>(
          "SELECT public.issue_platform_story_link($1,$2) AS link",
          [id, hours],
        )
      ).rows[0].link,
  );
const resolve = (token: string) =>
  asAnon(
    db,
    async (tx) =>
      (
        await tx.query<{ result: unknown }>(
          "SELECT public.resolve_platform_story_link($1) AS result",
          [token],
        )
      ).rows[0].result,
  );
beforeAll(async () => {
  ({ db } = await createMigratedDb());
  for (const id of [a, b, admin])
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [
      id,
      id + "@t09.test",
    ]);
  await db.query("UPDATE profiles SET role='super_admin' WHERE id=$1", [admin]);
  for (const [id, owner, platform, published] of [
    [pub, admin, true, true],
    [priv, a, false, true],
    [draft, admin, true, false],
  ])
    await db.query(
      "INSERT INTO stories(id,user_id,title,is_platform_content,is_published,status) VALUES($1,$2,'Story',$3,$4,$5)",
      [id, owner, platform, published, published ? "published" : "draft"],
    );
  await db.query(
    "INSERT INTO story_pages(story_id,page_number,content,audio_url,illustration_url) VALUES($1,1,'Câu chuyện công khai','https://private.test/voice','https://private.test/photo')",
    [pub],
  );
});
afterAll(() => db.close());
it("anon cannot issue; private own/foreign story and platform draft cannot be shared", async () => {
  await expect(
    asAnon(db, (tx) =>
      tx.query("SELECT issue_platform_story_link($1,24)", [pub]),
    ),
  ).rejects.toThrow();
  for (const [u, s] of [
    [a, priv],
    [b, priv],
    [a, draft],
  ])
    await expect(issue(u, s)).rejects.toThrow();
});
it("server generates high entropy token, stores only hash; response is bounded text-only", async () => {
  const l = await issue();
  expect(l.share_token).toMatch(/^[a-f0-9]{64}$/);
  expect(new Date(l.expires_at).getTime()).toBeGreaterThan(Date.now());
  const stored = (
    await db.query<{ token_hash: string }>(
      "SELECT token_hash FROM story_share_links WHERE id=$1",
      [l.id],
    )
  ).rows[0];
  expect(stored.token_hash).not.toBe(l.share_token);
  const r = await resolve(l.share_token);
  expect(r).toMatchObject({
    story: { id: pub, title: "Story" },
    pages: [{ page_number: 1, content: "Câu chuyện công khai" }],
  });
  expect(JSON.stringify(r)).not.toMatch(
    /private\.test|voice_id|user_id|household_id|share_token|scene_description/,
  );
});
it("raw table hashes inaccessible; ordinary story ACL is not widened", async () => {
  for (const u of [a, b])
    await expect(
      asUser(db, u, (tx) => tx.query("SELECT * FROM story_share_links")),
    ).rejects.toThrow();
  await expect(
    asAnon(db, (tx) => tx.query("SELECT * FROM story_share_links")),
  ).rejects.toThrow();
  expect(
    (
      await asAnon(db, (tx) =>
        tx.query("SELECT id FROM stories WHERE id=$1", [priv]),
      )
    ).rows,
  ).toEqual([]);
});
it("only issuer can list/revoke; own revoke is idempotent and closes resolver", async () => {
  const l = await issue();
  const list = await asUser(db, a, (tx) =>
    tx.query<{ links: unknown[] }>(
      "SELECT list_platform_story_links($1) AS links",
      [pub],
    ),
  );
  expect(JSON.stringify(list.rows)).not.toContain("token_hash");
  expect(JSON.stringify(list.rows)).not.toContain(l.share_token);
  expect(
    (
      await asUser(db, b, (tx) =>
        tx.query<{ v: boolean }>("SELECT revoke_platform_story_link($1) AS v", [
          l.id,
        ]),
      )
    ).rows[0].v,
  ).toBe(false);
  expect(await resolve(l.share_token)).not.toBeNull();
  for (let i = 0; i < 2; i++)
    expect(
      (
        await asUser(db, a, (tx) =>
          tx.query<{ v: boolean }>(
            "SELECT revoke_platform_story_link($1) AS v",
            [l.id],
          ),
        )
      ).rows[0].v,
    ).toBe(true);
  expect(await resolve(l.share_token)).toBeNull();
});
it("expired links fail closed, never refresh TTL by resolving", async () => {
  const l = await issue();
  await db.query(
    "UPDATE story_share_links SET expires_at=now()-interval '1 second' WHERE id=$1",
    [l.id],
  );
  expect(await resolve(l.share_token)).toBeNull();
});
it("unpublish/trash closes existing links immediately at DB resolution", async () => {
  const l = await issue();
  await db.query("UPDATE stories SET is_published=false WHERE id=$1", [pub]);
  expect(await resolve(l.share_token)).toBeNull();
  await db.query(
    "UPDATE stories SET is_published=true,deleted_at=now() WHERE id=$1",
    [pub],
  );
  expect(await resolve(l.share_token)).toBeNull();
  await db.query("UPDATE stories SET deleted_at=null WHERE id=$1", [pub]);
});
it("issuer membership revocation closes issuance and resolution", async () => {
  const l = await issue(b);
  const m = (
    await db.query<{ household_id: string; role: string }>(
      "DELETE FROM household_memberships WHERE user_id=$1 RETURNING household_id,role",
      [b],
    )
  ).rows[0];
  await expect(issue(b)).rejects.toThrow();
  expect(await resolve(l.share_token)).toBeNull();
  await db.query(
    "INSERT INTO household_memberships(household_id,user_id,role) VALUES($1,$2,$3)",
    [m.household_id, b, m.role],
  );
});
it.each([-1, 0, 2, 169, 999])(
  "TTL %i is rejected, not unlimited",
  async (hours) => {
    await expect(issue(a, pub, hours)).rejects.toThrow();
  },
);
it.each([
  "",
  "bad",
  "a".repeat(63),
  "a".repeat(65),
  "A".repeat(64),
  "' OR 1=1 --",
])("invalid/unknown token returns no data", async (token) => {
  expect(await resolve(token)).toBeNull();
});
it("active per-story issuer limit is enforced", async () => {
  await db.query("DELETE FROM story_share_links WHERE user_id=$1", [a]);
  for (let i = 0; i < 10; i++) await issue();
  await expect(issue()).rejects.toThrow();
});

it("reclassifying published platform content to private closes bearer access", async () => {
  const l = await issue(b);
  await db.query("UPDATE stories SET is_platform_content=false WHERE id=$1", [
    pub,
  ]);
  expect(await resolve(l.share_token)).toBeNull();
  await db.query("UPDATE stories SET is_platform_content=true WHERE id=$1", [
    pub,
  ]);
});
it("oversized pages fail closed rather than returning a partial story", async () => {
  const l = await issue(b);
  await db.query(
    "UPDATE story_pages SET content=repeat('x',10001) WHERE story_id=$1",
    [pub],
  );
  expect(await resolve(l.share_token)).toBeNull();
  await db.query(
    "UPDATE story_pages SET content='Câu chuyện công khai' WHERE story_id=$1",
    [pub],
  );
});
it("issuer account deletion cascades only its links, not the platform story", async () => {
  const c = randomUUID();
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [
    c,
    c + "@t09.test",
  ]);
  const l = await issue(c);
  await db.query("DELETE FROM auth.users WHERE id=$1", [c]);
  expect(await resolve(l.share_token)).toBeNull();
  expect(
    (await db.query("SELECT id FROM stories WHERE id=$1", [pub])).rows,
  ).toHaveLength(1);
});
