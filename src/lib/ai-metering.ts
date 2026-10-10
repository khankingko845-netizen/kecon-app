/** Server only. The ledger stores an allowlist, never request/response bodies, URLs, keys, voice IDs or error messages. */
import { guardMeasuredFeature } from "@/lib/feature-flags-server";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/server-settings";
import { estimateUsd, type Price } from "@/lib/measurement-types";
import type { FetchLike } from "@/lib/llm";
export class MeteringUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeteringUnavailableError";
  }
}
type Context = {
  userId: string;
  requestId: string;
  feature: string;
  byo: boolean;
};
export const aiContext = new AsyncLocalStorage<Context>();
export function withAiContext(
  feature: string,
  handler: (r: NextRequest) => Promise<Response>,
) {
  return async (r: NextRequest) => {
    if (r.headers.get("sec-fetch-site") === "cross-site")
      return Response.json({ error: "Forbidden" }, { status: 403 });
    const db = await createClient();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    let byo = false;
    let body: Record<string, unknown> = {};
    try {
      body = r.headers.get("content-type")?.includes("multipart/form-data")
        ? Object.fromEntries((await r.clone().formData()).entries())
        : await r.clone().json();
      byo = Boolean(String(body?.apiKey ?? "").trim());
    } catch {
      /* validation remains in handler */
    }
    const denied = await guardMeasuredFeature(db, feature, body);
    if (denied) return denied;
    return aiContext.run(
      { userId: user.id, requestId: randomUUID(), feature, byo },
      () => handler(r),
    );
  };
}
export type MeterMeta = {
  provider: string;
  model: string;
  kind: "llm" | "image" | "tts" | "clone" | "ambient";
  units?: number;
  payer?: "platform" | "byo";
  billingUnit?: "utf8_bytes";
  usageVersion?: 2;
};
const safeModel = (v: string) =>
  /^[A-Za-z0-9_.:/-]{1,120}$/.test(v) ? v : "unknown";
const token = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 1e9
    ? v
    : null;
export function meteredFetch(
  meta: MeterMeta,
  fetchImpl: FetchLike = fetch,
): FetchLike {
  return async (url, init) => {
    const ctx = aiContext.getStore();
    if (!ctx) throw new MeteringUnavailableError("Thiếu ngữ cảnh đo lường AI");
    const db = getServiceClient();
    if (!db) throw new MeteringUnavailableError("Sổ chi phí AI chưa sẵn sàng");
    if (
      meta.provider === "fishaudio" &&
      (meta.kind !== "tts" ||
        meta.billingUnit !== "utf8_bytes" ||
        meta.usageVersion !== 2 ||
        !Number.isSafeInteger(meta.units) ||
        meta.units! < 0 ||
        meta.units! > 1e9)
    )
      throw new MeteringUnavailableError("Đơn vị đo Fish chưa hợp lệ");
    const model = safeModel(meta.model),
      id = randomUUID(),
      start = Date.now();
    const rate = await db
      .from("ai_price_rates")
      .select("input_per_million,output_per_million,unit_usd,source,updated_at,billing_unit,price_version")
      .eq("provider", meta.provider)
      .eq("model", model)
      .eq("kind", meta.kind)
      .maybeSingle();
    if (rate.error)
      throw new MeteringUnavailableError("Không đọc được đơn giá AI");
    const price = rate.data as Price | null;
    const begin = await db.from("ai_cost_ledger").insert({
      id,
      request_id: ctx.requestId,
      user_id: ctx.userId,
      feature: ctx.feature,
      provider: meta.provider,
      model,
      kind: meta.kind,
      payer: meta.payer ?? (ctx.byo ? "byo" : "platform"),
      units: meta.units ?? null,
      billing_unit: meta.billingUnit ?? null,
      usage_version: meta.usageVersion ?? 1,
      price_snapshot: price,
    });
    if (begin.error)
      throw new MeteringUnavailableError(
        "Không ghi được sổ chi phí AI; chưa gọi nhà cung cấp",
      );
    let res: Response | undefined,
      input: number | null = null,
      output: number | null = null;
    try {
      res = await fetchImpl(url, init);
      if (meta.kind === "llm" && res.ok) {
        try {
          const b = await res.clone().json();
          const u = b.usage ?? b.usageMetadata;
          input = token(
            u?.prompt_tokens ?? u?.input_tokens ?? u?.promptTokenCount,
          );
          output = token(
            u?.completion_tokens ?? u?.output_tokens ?? u?.candidatesTokenCount,
          );
          // Gemini bills generated thinking tokens as output, separately reported from candidates.
          if (
            meta.provider === "gemini" &&
            u?.thoughtsTokenCount !== undefined
          ) {
            const thought = token(u.thoughtsTokenCount);
            output =
              output !== null && thought !== null && output + thought <= 1e9
                ? output + thought
                : null;
          }
        } catch {
          /* Missing/malformed usage remains unknown, not zero */
        }
      }
      return res;
    } finally {
      const patch = {
        status: res?.ok ? "succeeded" : "failed",
        http_status: res?.status ?? null,
        input_tokens: input,
        output_tokens: output,
        estimated_usd: res?.ok
          ? estimateUsd(meta.kind, price, input, output, meta.units ?? null, meta)
          : null,
        finished_at: new Date().toISOString(),
        duration_ms: Math.max(0, Date.now() - start),
      };
      // A failed finalization leaves the already-persisted pending attempt visible; no dropped paid call.
      let done = false;
      for (let n = 0; n < 2 && !done; n++) {
        try {
          const out = await db
            .from("ai_cost_ledger")
            .update(patch)
            .eq("id", id);
          done = !out.error;
        } catch {
          /* never log provider/body/error details */
        }
      }
      if (!done) console.error("[ai-metering] completion pending", id);
    }
  };
}
