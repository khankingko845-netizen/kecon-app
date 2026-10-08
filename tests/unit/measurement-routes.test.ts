import { it, expect, vi, beforeEach } from "vitest";
const state = vi.hoisted(() => ({
  user: true,
  allowed: true,
  calls: [] as { name: string; body: unknown }[],
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.user ? { id: "verified-actor" } : null },
      }),
    },
    rpc: async (name: string, body: unknown) => {
      state.calls.push({ name, body });
      if (name === "has_permission")
        return { data: state.allowed, error: null };
      if (name === "admin_access_status")
        return { data: { state: "ready" }, error: null };
      return { data: { ok: true }, error: null };
    },
  }),
}));
vi.mock("@/lib/admin-audit", () => ({ auditAdmin: async () => null }));
import { POST as eventPost } from "@/app/api/analytics/event/route";
import { GET } from "@/app/api/admin/measurement/route";
import { POST as pricePost } from "@/app/api/admin/pricing/route";
const req = (body: unknown, headers = {}) =>
  new Request("https://kecon.test/api", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
beforeEach(() =>
  Object.assign(state, { user: true, allowed: true, calls: [] }),
);
it("private event API rejects unauthenticated/cross-site and actor/time/free-text injection", async () => {
  state.user = false;
  expect((await eventPost(req({ event: "home_view" }))).status).toBe(401);
  state.user = true;
  expect(
    (
      await eventPost(
        req({ event: "home_view" }, { "sec-fetch-site": "cross-site" }),
      )
    ).status,
  ).toBe(403);
  for (const b of [
    { event: "home_view", user_id: "spoof" },
    { event: "first_listen", created_at: "1900" },
    { event: "child-name" },
    { event: "home_view", name: "private-child" },
  ])
    expect((await eventPost(req(b))).status).toBe(400);
  expect(state.calls).toHaveLength(0);
});
it("event only forwards enum and binds user in Postgres", async () => {
  expect((await eventPost(req({ event: "home_view" }))).status).toBe(200);
  expect(state.calls).toEqual([
    { name: "record_measurement_event", body: { p_event: "home_view" } },
  ]);
});
it("summary rejects unauthorized and unbounded periods before reading the ledger", async () => {
  state.allowed = false;
  expect(
    (await GET(new Request("https://kecon.test/api?days=14"))).status,
  ).toBe(403);
  state.allowed = true;
  for (const days of ["0", "31", "1.5", "bad"])
    expect(
      (await GET(new Request("https://kecon.test/api?days=" + days))).status,
    ).toBe(400);
  expect(state.calls.some((c) => c.name === "measurement_summary")).toBe(false);
  expect((await GET(new Request("https://kecon.test/api?days=7"))).status).toBe(
    200,
  );
  expect(state.calls.at(-1)).toEqual({
    name: "measurement_summary",
    body: { p_days: 7 },
  });
});
it("pricing cannot bypass staff permission, schema or snapshot RPC", async () => {
  const b = {
    provider: "openai",
    model: "model",
    kind: "llm",
    input: 1,
    output: 2,
    unit: null,
    source: "https://provider.example/pricing",
  };
  state.allowed = false;
  expect((await pricePost(req(b))).status).toBe(403);
  state.allowed = true;
  expect((await pricePost(req({ ...b, key: "secret" }))).status).toBe(400);
  expect(
    (
      await pricePost(
        req({ ...b, source: "https://provider.example/?key=secret" }),
      )
    ).status,
  ).toBe(400);
  expect((await pricePost(req(b))).status).toBe(200);
  expect(state.calls.at(-1)).toEqual({
    name: "set_ai_price_v2",
    body: {
      p_provider: "openai",
      p_model: "model",
      p_kind: "llm",
      p_input: 1,
      p_output: 2,
      p_unit: null,
      p_source: b.source,
      p_billing_unit: null,
    },
  });
});
it("Fish pricing requires an explicit byte unit and cannot contaminate other provider contracts", async () => {
  const b = { provider: "fishaudio", model: "s2.1-pro", kind: "tts", input: null, output: null, unit: 0.000015, source: "https://provider.example/pricing" };
  expect((await pricePost(req(b))).status).toBe(400);
  expect((await pricePost(req({ ...b, billingUnit: "characters" }))).status).toBe(400);
  expect((await pricePost(req({ ...b, provider: "elevenlabs", billingUnit: "utf8_bytes" }))).status).toBe(400);
  expect((await pricePost(req({ ...b, billingUnit: "utf8_bytes" }))).status).toBe(200);
  expect(state.calls.at(-1)).toMatchObject({ name: "set_ai_price_v2", body: { p_unit: 0.000015, p_billing_unit: "utf8_bytes" } });
  expect((await pricePost(req({ ...b, unit: 0, billingUnit: "utf8_bytes" }))).status).toBe(200);
});
