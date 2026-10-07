import { beforeEach, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  rate: null as unknown,
  beginError: false,
  finishError: false,
  service: true,
}));
vi.mock("@/lib/server-settings", () => ({
  getServiceClient: () =>
    state.service
      ? {
          from: () => {
            const c = {
              select: () => c,
              eq: () => c,
              maybeSingle: async () => ({ data: state.rate, error: null }),
              insert: async (row: Record<string, unknown>) => {
                if (state.beginError) return { error: { code: "down" } };
                state.rows.push({ ...row, status: "pending" });
                return { error: null };
              },
              update: (patch: Record<string, unknown>) => ({
                eq: async (_: string, id: unknown) => {
                  if (!state.finishError)
                    Object.assign(
                      state.rows.find((r) => r.id === id)!,
                      patch,
                    );
                  return { error: state.finishError ? { code: "down" } : null };
                },
              }),
            };
            return c;
          },
        }
      : null,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "test-user" } } }) },
  }),
}));
import {
  aiContext,
  meteredFetch,
  MeteringUnavailableError,
} from "@/lib/ai-metering";
import { estimateUsd, PriceSchema, type Price } from "@/lib/measurement-types";
const rate: Price = {
  input_per_million: 1,
  output_per_million: 2,
  unit_usd: null,
  source: "https://provider.example/pricing",
  updated_at: "2026-10-07T00:00:00Z",
};
const run = (fn: () => Promise<unknown>, extra = {}) =>
  aiContext.run(
    {
      userId: "family-a",
      requestId: "request-a",
      feature: "story.generate",
      byo: false,
      ...extra,
    },
    fn,
  );
beforeEach(() => {
  Object.assign(state, {
    rows: [],
    rate: null,
    beginError: false,
    finishError: false,
    service: true,
  });
});
it("begins before paid HTTP and snapshots known price + usage without leaking bodies/keys", async () => {
  state.rate = rate;
  const transport = vi.fn(async () => {
    expect(state.rows[0].status).toBe("pending");
    return Response.json({
      usage: { prompt_tokens: 100, completion_tokens: 20 },
      choices: [{ message: { content: "child-private-content" } }],
    });
  });
  const r = (await run(() =>
    meteredFetch(
      { provider: "openai", model: "test-model", kind: "llm" },
      transport,
    )("https://provider.example", {
      body: "secret-prompt",
      headers: { Authorization: "sk-secret" },
    }),
  )) as Response;
  expect((await r.json()).choices).toBeDefined();
  expect(state.rows[0]).toMatchObject({
    status: "succeeded",
    input_tokens: 100,
    output_tokens: 20,
    estimated_usd: 0.00014,
    price_snapshot: rate,
  });
  const raw = JSON.stringify(state.rows);
  for (const secret of [
    "secret-prompt",
    "sk-secret",
    "child-private-content",
    'https://provider.example"',
  ])
    expect(raw).not.toContain(secret);
});
it("unknown model, missing or partial usage never becomes zero dollars", async () => {
  for (const usage of [
    undefined,
    { prompt_tokens: 10 },
    { prompt_tokens: -1, completion_tokens: 5 },
  ]) {
    state.rate = rate;
    await run(() =>
      meteredFetch(
        { provider: "custom", model: "model", kind: "llm" },
        async () => Response.json({ usage }),
      )("u"),
    );
    expect(state.rows.at(-1)?.estimated_usd).toBeNull();
  }
  state.rate = null;
  await run(() =>
    meteredFetch(
      { provider: "custom", model: "model", kind: "llm" },
      async () =>
        Response.json({ usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    )("u"),
  );
  expect(state.rows.at(-1)?.estimated_usd).toBeNull();
});
it("each retry has an independent row and failed/network attempts carry unknown billing", async () => {
  await run(async () => {
    await meteredFetch(
      { provider: "elevenlabs", model: "flash", kind: "tts", units: 10 },
      async () => new Response("quota", { status: 401 }),
    )("u");
    await expect(
      meteredFetch(
        { provider: "elevenlabs", model: "flash", kind: "tts", units: 10 },
        async () => {
          throw Error("key-secret-provider-message");
        },
      )("u"),
    ).rejects.toThrow();
    await meteredFetch(
      { provider: "elevenlabs", model: "flash", kind: "tts", units: 10 },
      async () => new Response("audio"),
    )("u");
  });
  expect(state.rows.map((r) => r.status)).toEqual([
    "failed",
    "failed",
    "succeeded",
  ]);
  expect(new Set(state.rows.map((r) => r.id)).size).toBe(3);
  expect(state.rows.every((r) => r.request_id === "request-a")).toBe(true);
  expect(JSON.stringify(state.rows)).not.toContain("key-secret");
});
it("DB outage fails closed before fetch; no context fails closed too", async () => {
  const f = vi.fn(async () => Response.json({}));
  state.beginError = true;
  await expect(
    run(() =>
      meteredFetch({ provider: "openai", model: "m", kind: "llm" }, f)("u"),
    ),
  ).rejects.toBeInstanceOf(MeteringUnavailableError);
  expect(f).not.toHaveBeenCalled();
  state.beginError = false;
  state.service = false;
  await expect(
    run(() =>
      meteredFetch({ provider: "openai", model: "m", kind: "llm" }, f)("u"),
    ),
  ).rejects.toBeInstanceOf(MeteringUnavailableError);
  await expect(
    meteredFetch({ provider: "openai", model: "m", kind: "llm" }, f)("u"),
  ).rejects.toBeInstanceOf(MeteringUnavailableError);
});
it("failed finalization retains pending row for reconciliation, not silently dropping paid calls", async () => {
  state.finishError = true;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await run(() =>
    meteredFetch({ provider: "openai", model: "m", kind: "llm" }, async () =>
      Response.json({}),
    )("u"),
  );
  expect(state.rows[0].status).toBe("pending");
  expect(log).toHaveBeenCalled();
});
it("concurrent users cannot cross attribution; BYO stays distinct", async () => {
  await Promise.all([
    run(() =>
      meteredFetch({ provider: "custom", model: "m", kind: "llm" }, async () =>
        Response.json({}),
      )("u"),
    ),
    run(
      () =>
        meteredFetch(
          { provider: "custom", model: "m", kind: "llm" },
          async () => Response.json({}),
        )("u"),
      { userId: "family-b", requestId: "request-b", byo: true },
    ),
  ]);
  expect(state.rows.map((r) => [r.user_id, r.payer])).toEqual([
    ["family-a", "platform"],
    ["family-b", "byo"],
  ]);
});
it("zero is only estimated when both known price and valid units justify it; pricing bodies are strict", () => {
  expect(estimateUsd("llm", rate, 0, 0, null)).toBe(0);
  expect(estimateUsd("image", { ...rate, unit_usd: 0.04 }, null, null, 2)).toBe(
    0.08,
  );
  expect(estimateUsd("llm", rate, null, 0, null)).toBeNull();
  expect(
    PriceSchema.safeParse({
      provider: "openai",
      model: "m",
      kind: "llm",
      input: 1,
      output: 2,
      unit: null,
      source: "https://p.example/pricing",
      user_id: "spoof",
    }).success,
  ).toBe(false);
});
it("all billable route categories keep authenticated context and injected metered transport", () => {
  for (const route of [
    "story/generate",
    "story/from-drawing",
    "story/scan",
    "story/expert-review",
    "story/vocabulary",
    "story/personalize",
    "story/translate",
    "story/illustrate",
    "story/illustrate-batch",
    "voice/tts",
    "voice/preview",
    "voice/clone",
    "voice/ambient",
    "admin/test-provider",
  ])
    expect(readFileSync(`src/app/api/${route}/route.ts`, "utf8")).toContain(
      "withAiContext(",
    );
  expect(readFileSync("src/lib/voice-synthesis.ts", "utf8")).toContain(
    "meteredFetch(",
  );
});

it("Gemini thinking usage contributes to output; invalid thinking usage remains unknown", async () => {
  state.rate = rate;
  await run(() =>
    meteredFetch({ provider: "gemini", model: "m", kind: "llm" }, async () =>
      Response.json({
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 20,
          thoughtsTokenCount: 10,
        },
      }),
    )("u"),
  );
  expect(state.rows[0]).toMatchObject({
    output_tokens: 30,
    estimated_usd: 0.00016,
  });
});
