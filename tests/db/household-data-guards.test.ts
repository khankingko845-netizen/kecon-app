import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb, asUser, asAnon, asRole } from "./supabase-harness";
let db: PGlite;
const a = randomUUID(),
  b = randomUUID(),
  admin = randomUUID(),
  editor = randomUUID(),
  support = randomUUID();
const story = randomUUID(),
  other = randomUUID(),
  pub = randomUUID(),
  draft = randomUUID(),
  page = randomUUID(),
  pp = randomUUID(),
  voice = randomUUID(),
  vb = randomUUID();
let hA: string, hB: string;
beforeAll(async () => {
  ({ db } = await createMigratedDb({
    stopBefore: "031_household_data_guards.sql",
  }));
  for (const id of [a, b, admin, editor, support])
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [
      id,
      id + "@t08b.test",
    ]);
  for (const [id, role] of [
    [admin, "super_admin"],
    [editor, "editor"],
    [support, "support"],
  ])
    await db.query("UPDATE public.profiles SET role=$2 WHERE id=$1", [
      id,
      role,
    ]);
  hA = (
    await db.query<{ household_id: string }>(
      "SELECT household_id FROM public.profiles WHERE id=$1",
      [a],
    )
  ).rows[0].household_id;
  hB = (
    await db.query<{ household_id: string }>(
      "SELECT household_id FROM public.profiles WHERE id=$1",
      [b],
    )
  ).rows[0].household_id;
  for (const [id, user, platform, published] of [
    [story, a, false, true],
    [other, b, false, false],
    [pub, admin, true, true],
    [draft, admin, true, false],
  ])
    await db.query(
      "INSERT INTO public.stories(id,user_id,title,is_platform_content,is_published,status) VALUES($1,$2,'T08b fixture',$3,$4,$5)",
      [id, user, platform, published, published ? "published" : "draft"],
    );
  for (const [id, parent] of [
    [page, story],
    [pp, pub],
  ])
    await db.query(
      "INSERT INTO public.story_pages(id,story_id,page_number,content) VALUES($1,$2,1,'private content')",
      [id, parent],
    );
  for (const [id, user, ref] of [
    [voice, a, "private-a"],
    [vb, b, "private-b"],
  ])
    await db.query(
      "INSERT INTO public.voice_profiles(id,user_id,name,elevenlabs_voice_id) VALUES($1,$2,'Voice '||$3,$3)",
      [id, user, ref],
    );
  await db.query(
    "INSERT INTO public.family_members(user_id,name,relation,voice_profile_id) VALUES($1,'Private person','parent',$2)",
    [a, voice],
  );
  await db.query(
    "INSERT INTO public.story_characters(story_id,name,voice_id) VALUES($1,'Private animal','private-a')",
    [story],
  );
  await db.query(
    "INSERT INTO public.story_characters(story_id,name) VALUES($1,'Public animal')",
    [pub],
  );
  await db.query(
    "INSERT INTO public.audio_cache(story_page_id,voice_id,audio_url,content_hash) VALUES($1,$2,'https://private.test/a.mp3','a')",
    [page, voice],
  );
  await db.query(
    "INSERT INTO public.audio_cache(story_page_id,audio_url,content_hash) VALUES($1,'https://public.test/p.mp3','p')",
    [pp],
  );
  await db.query(
    "INSERT INTO public.audio_cache(audio_url,content_hash) VALUES('https://legacy.test/orphan.mp3','legacy')",
  );
  await db.query(
    "INSERT INTO public.story_ratings(user_id,story_id,rating) VALUES($1,$2,4)",
    [a, story],
  );
  await db.query(
    "INSERT INTO public.story_reviews(user_id,story_id,content) VALUES($1,$2,'Private review')",
    [a, story],
  );
  for (const table of [
    "story_shares",
    "user_favorites",
    "downloaded_stories",
    "play_sessions",
  ])
    await db.query(
      `INSERT INTO public.${table}(user_id,story_id) VALUES($1,$2)`,
      [a, story],
    );
  await db.query(
    "INSERT INTO public.user_behavior(user_id,story_id,action_type) VALUES($1,$2,'play')",
    [a, story],
  );
  await db.query("INSERT INTO public.reading_streaks(user_id) VALUES($1)", [a]);
  await db.query(
    "INSERT INTO public.push_subscriptions(user_id,endpoint) VALUES($1,'https://private.test/push')",
    [a],
  );
  await db.query("INSERT INTO public.parental_controls(user_id) VALUES($1)", [
    a,
  ]);
  await db.query("INSERT INTO public.daily_usage(user_id) VALUES($1)", [a]);
  await db.query(
    "INSERT INTO public.notifications(user_id,title) VALUES($1,'Private notice')",
    [a],
  );
  await db.query(
    "INSERT INTO public.usage_tracking(user_id,provider,endpoint) VALUES($1,'platform','tts')",
    [a],
  );
  await db.query(
    "INSERT INTO public.default_voices(voice_id,name,language) VALUES('public-vi','Public Vietnamese','vi')",
  );
  await db.exec(
    readFileSync("supabase/migrations/031_household_data_guards.sql", "utf8"),
  );
  await db.query(
    "UPDATE public.app_settings SET value='true' WHERE key='feature.child_push'",
  );
});
afterAll(async () => {
  await db?.close();
});
it("preserves legacy content/provider IDs, derives canonical context and returns no caller-chosen tenant", async () => {
  expect(
    (
      await db.query(
        "SELECT elevenlabs_voice_id FROM public.voice_profiles WHERE id=$1",
        [voice],
      )
    ).rows[0],
  ).toEqual({ elevenlabs_voice_id: "private-a" });
  expect(
    (
      await asUser(db, a, (t) =>
        t.query("SELECT public.current_household_id() h"),
      )
    ).rows[0],
  ).toEqual({ h: hA });
  expect(
    (await asAnon(db, (t) => t.query("SELECT public.current_household_id() h")))
      .rows[0],
  ).toEqual({ h: null });
});
it("published private stories remain private; public platform story must be published, correct status and not trashed", async () => {
  for (const uid of [b, admin, editor, support])
    expect(
      (
        await asUser(db, uid, (t) =>
          t.query("SELECT id FROM public.stories WHERE id=$1", [story]),
        )
      ).rows,
    ).toHaveLength(0);
  expect(
    (
      await asAnon(db, (t) =>
        t.query("SELECT id FROM public.stories ORDER BY id"),
      )
    ).rows,
  ).toEqual([{ id: pub }]);
  expect(
    (
      await asUser(db, b, (t) =>
        t.query("SELECT id FROM public.stories WHERE id=$1", [draft]),
      )
    ).rows,
  ).toHaveLength(0);
});
it.each([
  "story_pages",
  "story_characters",
  "voice_profiles",
  "family_members",
  "audio_cache",
  "story_reviews",
  "story_ratings",
])(
  "private %s metadata cannot be read by other household, anonymous, editor, support or full admin",
  async (table) => {
    const own = await asUser(db, a, (t) =>
      t.query(`SELECT * FROM public.${table}`),
    );
    expect(own.rows.length).toBeGreaterThan(0);
    for (const uid of [b, admin, editor, support]) {
      const rows = (
        await asUser(db, uid, (t) => t.query(`SELECT * FROM public.${table}`))
      ).rows;
      expect(JSON.stringify(rows)).not.toMatch(
        /private-a|Private voice|Private person|Private animal|private\.test|Private review/,
      );
      if (
        [
          "voice_profiles",
          "family_members",
          "story_reviews",
          "story_ratings",
        ].includes(table)
      )
        expect(rows).toHaveLength(
          table === "voice_profiles" && uid === b ? 1 : 0,
        );
    }
    const rows = (
      await asAnon(db, (t) => t.query(`SELECT * FROM public.${table}`))
    ).rows;
    expect(JSON.stringify(rows)).not.toMatch(
      /private-a|Private voice|Private person|Private animal|private\.test|Private review/,
    );
  },
);
it.each([
  "play_sessions",
  "user_behavior",
  "story_shares",
  "user_favorites",
  "downloaded_stories",
  "reading_streaks",
  "push_subscriptions",
  "parental_controls",
  "daily_usage",
  "notifications",
  "usage_tracking",
])(
  "%s is actor-private even to full admin; tokens/endpoint list is not public",
  async (table) => {
    expect(
      (await asUser(db, a, (t) => t.query(`SELECT * FROM public.${table}`)))
        .rows.length,
    ).toBeGreaterThan(0);
    for (const uid of [b, admin])
      expect(
        (await asUser(db, uid, (t) => t.query(`SELECT * FROM public.${table}`)))
          .rows,
      ).toHaveLength(0);
    expect(
      (await asAnon(db, (t) => t.query(`SELECT * FROM public.${table}`))).rows,
    ).toHaveLength(0);
  },
);
it("foreign story/page/character mutations touch no rows; cannot move a page to a foreign parent", async () => {
  for (const table of ["stories", "story_pages", "story_characters"])
    expect(
      (
        await asUser(db, b, (t) =>
          t.query(
            `DELETE FROM public.${table} WHERE ${table === "stories" ? "id" : "story_id"}=$1 RETURNING id`,
            [story],
          ),
        )
      ).rows,
    ).toHaveLength(0);
  await expect(
    asUser(db, a, (t) =>
      t.query("UPDATE public.story_pages SET story_id=$1 WHERE id=$2", [
        other,
        page,
      ]),
    ),
  ).rejects.toThrow();
  expect(
    (
      await db.query("SELECT story_id FROM public.story_pages WHERE id=$1", [
        page,
      ])
    ).rows[0],
  ).toEqual({ story_id: story });
});
it.each([
  "play_sessions",
  "user_behavior",
  "story_ratings",
  "story_reviews",
  "story_shares",
  "user_favorites",
  "downloaded_stories",
])(
  "FK to a foreign story cannot be inserted into own %s, including through trusted SQL",
  async (table) => {
    const extra =
      table === "user_behavior"
        ? ",action_type"
        : table === "story_ratings"
          ? ",rating"
          : table === "story_reviews"
            ? ",content"
            : "";
    const value =
      table === "user_behavior"
        ? ",'play'"
        : table === "story_ratings"
          ? ",4"
          : table === "story_reviews"
            ? ",'Guess'"
            : "";
    const q = `INSERT INTO public.${table}(user_id,story_id${extra}) VALUES($1,$2${value})`;
    await expect(asUser(db, b, (t) => t.query(q, [b, story]))).rejects.toThrow(
      /Invalid content reference/,
    );
    await expect(db.query(q, [b, story])).rejects.toThrow(
      /Invalid content reference/,
    );
  },
);
it("own voice FK cannot be injected into another household or a public platform story; no orphan cache insertion", async () => {
  await expect(
    asUser(db, b, (t) =>
      t.query("UPDATE public.stories SET voice_id=$1 WHERE id=$2", [
        voice,
        other,
      ]),
    ),
  ).rejects.toThrow(/Invalid content reference/);
  await expect(
    asUser(db, b, (t) =>
      t.query(
        "INSERT INTO public.family_members(user_id,name,relation,voice_profile_id) VALUES($1,'Guess','parent',$2)",
        [b, voice],
      ),
    ),
  ).rejects.toThrow(/Invalid content reference/);
  await expect(
    asUser(db, a, (t) =>
      t.query(
        "INSERT INTO public.audio_cache(audio_url,content_hash) VALUES('https://bad.test','bad')",
      ),
    ),
  ).rejects.toThrow(/Invalid content reference/);
  await expect(
    db.query("UPDATE public.stories SET voice_id=$1 WHERE id=$2", [voice, pub]),
  ).rejects.toThrow(/Invalid content reference/);
});
it("same-household associations and public platform favorites/session remain usable", async () => {
  await asUser(db, b, (t) =>
    t.query(
      "INSERT INTO public.user_favorites(user_id,story_id) VALUES($1,$2)",
      [b, pub],
    ),
  );
  await asUser(db, b, (t) =>
    t.query(
      "INSERT INTO public.play_sessions(user_id,story_id,voice_id) VALUES($1,$2,$3)",
      [b, pub, vb],
    ),
  );
  await asUser(db, b, (t) =>
    t.query("UPDATE public.stories SET voice_id=$1 WHERE id=$2", [vb, other]),
  );
});
it("hidden-story counter/XP RPCs cannot target another household; public counter works without admin and delta is bounded", async () => {
  for (const q of [
    "SELECT public.increment_play_count($1)",
    "SELECT public.toggle_like($1,1)",
  ])
    await expect(asUser(db, b, (t) => t.query(q, [story]))).rejects.toThrow(
      /Content unavailable/,
    );
  await expect(
    asUser(db, b, (t) => t.query("SELECT public.award_xp($1,10)", [a])),
  ).rejects.toThrow(/Action unavailable/);
  await expect(
    asUser(db, b, (t) => t.query("SELECT public.toggle_like($1,999)", [pub])),
  ).rejects.toThrow(/Content unavailable/);
  await asUser(db, b, (t) =>
    t.query("SELECT public.increment_play_count($1)", [pub]),
  );
  await asAnon(db, (t) =>
    t.query("SELECT public.increment_play_count($1)", [pub]),
  );
  await asUser(db, b, (t) => t.query("SELECT public.toggle_like($1,1)", [pub]));
  expect(
    (
      await db.query(
        "SELECT play_count,like_count FROM public.stories WHERE id=$1",
        [pub],
      )
    ).rows[0],
  ).toEqual({ play_count: 2, like_count: 1 });
});
it("voice authorization denies another household even for privileged admin; own active/default locale only; no arbitrary legacy ID", async () => {
  const result = async (uid: string, id: string, locale = "vi") =>
    (
      await asUser(db, uid, (t) =>
        t.query<{ r: string }>("SELECT public.authorize_tts_voice($1,$2) r", [
          id,
          locale,
        ]),
      )
    ).rows[0].r;
  expect(await result(a, "private-a")).toBe("allowed");
  expect(await result(b, "private-a")).toBe("unavailable");
  expect(await result(admin, "private-a")).toBe("unavailable");
  expect(await result(b, "public-vi")).toBe("allowed");
  expect(await result(b, "public-vi", "ja")).toBe("unavailable");
  expect(await result(b, "unknown-id")).toBe("unavailable");
  expect(await result(admin, "catalog-new")).toBe("allowed");
  await db.query(
    "UPDATE public.voice_profiles SET is_active=false WHERE id=$1",
    [voice],
  );
  expect(await result(a, "private-a")).toBe("disabled");
  await db.query(
    "UPDATE public.voice_profiles SET is_active=true WHERE id=$1",
    [voice],
  );
  await expect(
    asAnon(db, (t) =>
      t.query("SELECT public.authorize_tts_voice('private-a','vi')"),
    ),
  ).rejects.toThrow();
});
it("membership revocation removes active scope immediately; extra membership does not silently switch canonical tenant", async () => {
  await db.query(
    "INSERT INTO public.household_memberships(household_id,user_id,role) VALUES($1,$2,'parent')",
    [hA, b],
  );
  expect(
    (
      await asUser(db, b, (t) =>
        t.query("SELECT public.current_household_id() h"),
      )
    ).rows[0],
  ).toEqual({ h: hB });
  expect(
    (
      await asUser(db, b, (t) =>
        t.query("SELECT id FROM public.stories WHERE id=$1", [story]),
      )
    ).rows,
  ).toHaveLength(0);
  await db.query(
    "DELETE FROM public.household_memberships WHERE household_id=$1 AND user_id=$2",
    [hB, b],
  );
  expect(
    (
      await asUser(db, b, (t) =>
        t.query("SELECT id FROM public.stories WHERE id=$1", [other]),
      )
    ).rows,
  ).toHaveLength(0);
  await db.query(
    "INSERT INTO public.household_memberships(household_id,user_id,role) VALUES($1,$2,'owner')",
    [hB, b],
  );
});
it("invoker confirmed admin actions and stale AAL1 cannot bypass family isolation or platform MFA", async () => {
  await expect(
    asUser(db, admin, (t) =>
      t.query(
        "SELECT public.admin_confirmed_action('story.trash',ARRAY[$1::text],'T08b negative confirmed action')",
        [story],
      ),
    ),
  ).rejects.toThrow(/không có quyền/);
  expect(
    (
      await asRole(
        db,
        "authenticated",
        admin,
        (t) =>
          t.query(
            "UPDATE public.stories SET title='No' WHERE id=$1 RETURNING id",
            [pub],
          ),
        { aal: "aal1" },
      )
    ).rows,
  ).toHaveLength(0);
  await asUser(db, editor, (t) =>
    t.query("UPDATE public.stories SET title='Platform edit' WHERE id=$1", [
      pub,
    ]),
  );
});
it("private provider IDs cannot be attached to public narrator/last/cast controls or foreign-family cast", async () => {
  for (const field of ["narrator_voice_id", "last_voice_id"])
    await expect(
      db.query(`UPDATE public.stories SET ${field}='private-a' WHERE id=$1`, [
        pub,
      ]),
    ).rejects.toThrow(/Invalid content reference/);
  await expect(
    db.query(
      "INSERT INTO public.story_characters(story_id,name,voice_id) VALUES($1,'Bad','private-a')",
      [pub],
    ),
  ).rejects.toThrow(/Invalid content reference/);
  await expect(
    asUser(db, b, (t) =>
      t.query(
        "INSERT INTO public.story_characters(story_id,name,voice_id) VALUES($1,'Bad','private-a')",
        [other],
      ),
    ),
  ).rejects.toThrow(/Invalid content reference/);
  await expect(
    db.query("UPDATE public.stories SET is_platform_content=true WHERE id=$1", [
      story,
    ]),
  ).rejects.toThrow(/Invalid content reference/);
});
it("known private clone is not a public default and is filtered from admin catalogs; ordinary actor cannot call catalog RPC", async () => {
  await expect(
    db.query(
      "INSERT INTO public.default_voices(voice_id,name) VALUES('private-a','Do not publish')",
    ),
  ).rejects.toThrow(/Invalid content reference/);
  const r = await asUser(db, admin, (t) =>
    t.query<{ ids: string[] }>(
      "SELECT public.allowed_catalog_voice_ids(ARRAY['private-a','private-b','public-vi']) ids",
    ),
  );
  expect(r.rows[0].ids).toEqual(["public-vi"]);
  await expect(
    asUser(db, b, (t) =>
      t.query("SELECT public.allowed_catalog_voice_ids(ARRAY['private-a'])"),
    ),
  ).rejects.toThrow(/Catalog unavailable/);
});
it("clients cannot forge an owned metadata row to steal a foreign or unregistered provider ID; only service-issued receipt binds new clones", async () => {
  for (const ref of ["private-a", "unregistered", "public-vi"])
    await expect(
      asUser(db, b, (t) =>
        t.query(
          "INSERT INTO public.voice_profiles(user_id,name,elevenlabs_voice_id) VALUES($1,'Forged',$2)",
          [b, ref],
        ),
      ),
    ).rejects.toThrow(/server managed/);
  await expect(
    asUser(db, b, (t) =>
      t.query("SELECT public.record_voice_provider_claim($1,'new-b')", [b]),
    ),
  ).rejects.toThrow(/permission denied/);
  await expect(
    asUser(db, b, (t) => t.query("SELECT * FROM public.voice_provider_claims")),
  ).rejects.toThrow(/permission denied/);
  await asRole(db, "service_role", null, (t) =>
    t.query("SELECT public.record_voice_provider_claim($1,'new-b')", [b]),
  );
  await asUser(db, b, (t) =>
    t.query(
      "INSERT INTO public.voice_profiles(user_id,name,elevenlabs_voice_id) VALUES($1,'Registered','new-b')",
      [b],
    ),
  );
  expect(
    (
      await asUser(db, b, (t) =>
        t.query<{ r: string }>(
          "SELECT public.authorize_tts_voice('new-b','vi') r",
        ),
      )
    ).rows[0].r,
  ).toBe("allowed");
  await expect(
    asRole(db, "service_role", null, (t) =>
      t.query("SELECT public.record_voice_provider_claim($1,'new-b')", [a]),
    ),
  ).rejects.toThrow(/Invalid voice receipt/);
});
