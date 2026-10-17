import type { SupabaseClient } from "@supabase/supabase-js";
import { it, expect, vi } from "vitest";
import { authorizedVoiceCatalog } from "@/lib/voice-catalog-access";
const db = (data: unknown, error: unknown = null) =>
  ({ rpc: vi.fn(async () => ({ data, error })) }) as unknown as SupabaseClient;
const rows = [
  { voice_id: "private", name: "Private person" },
  { voice_id: "public", name: "Public" },
];
it("filters whole foreign metadata row before returning provider catalog", async () => {
  const d = db(["public"]);
  expect(await authorizedVoiceCatalog(d, rows)).toEqual({ voices: [rows[1]] });
  expect(d.rpc).toHaveBeenCalledWith("allowed_catalog_voice_ids", {
    p_voice_ids: ["private", "public"],
  });
});
it("empty catalog needs no private lookup", async () => {
  const d = db(null);
  expect(await authorizedVoiceCatalog(d, [])).toEqual({ voices: [] });
  expect(d.rpc).not.toHaveBeenCalled();
});
it("malformed authorization/error/extra ID fail closed, not an unfiltered list", async () => {
  for (const d of [
    db(null),
    db(["unexpected"]),
    db([true]),
    db(["private"], { message: "secret" }),
  ]) {
    const r = await authorizedVoiceCatalog(d, rows);
    expect("response" in r).toBe(true);
    if ("response" in r) {
      expect(r.response.status).toBe(503);
      expect(await r.response.text()).not.toContain("secret");
    }
  }
});
it("bounded list rejects provider corruption or excessive response", async () => {
  for (const rows of [
    [{ voice_id: "" }],
    Array.from({ length: 1001 }, () => ({ voice_id: "v" })),
  ])
    expect("response" in (await authorizedVoiceCatalog(db(["v"]), rows))).toBe(
      true,
    );
});
