/**
 * Server-side usage guard: rate limit + plan quota, enforced in Postgres
 * via the `consume_usage` RPC (migration 016_security_hardening.sql).
 *
 * Call it in API routes after authenticating the user and resolving the
 * provider key, before calling any paid external API.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type UsageKind = "story" | "ai" | "tts" | "voice_clone" | "illustration";

interface UsageResult {
  allowed: boolean;
  reason?: "rate_limited" | "quota_exceeded" | "unauthenticated" | "invalid_kind";
  plan?: string | null;
  used?: number;
  limit?: number | null;
  retry_after?: number;
}

const KIND_LABEL: Record<UsageKind, string> = {
  story: "tạo truyện AI",
  ai: "AI",
  tts: "đọc truyện",
  voice_clone: "clone giọng",
  illustration: "minh hoạ AI",
};

// PostgREST / Postgres codes for "function does not exist" (migration chưa chạy)
const MISSING_FUNCTION_CODES = new Set(["PGRST202", "42883"]);
let warnedMissingFunction = false;

/**
 * Returns `null` when the request may proceed, otherwise a Response to return.
 * @param byo true when the caller supplied their own API key (skips plan quota, keeps rate limit)
 */
export async function guardUsage(
  supabase: SupabaseClient,
  kind: UsageKind,
  opts: { byo?: boolean; amount?: number } = {}
): Promise<Response | null> {
  const { data, error } = await supabase.rpc("consume_usage", {
    p_kind: kind,
    p_amount: opts.amount ?? 1,
    p_byo: Boolean(opts.byo),
  });

  if (error) {
    if (MISSING_FUNCTION_CODES.has(error.code ?? "")) {
      if (!warnedMissingFunction) {
        console.error(
          "[usage-guard] consume_usage() chưa tồn tại — hãy chạy migration 016_security_hardening.sql. Request dùng key nền tảng sẽ bị chặn cho tới khi chạy migration (đặt USAGE_GUARD_FAIL_OPEN=1 để tạm bỏ qua)."
        );
        warnedMissingFunction = true;
      }
      // BYO-key requests cost the platform nothing → allow.
      // Platform-key requests fail closed unless explicitly opted out.
      if (opts.byo || process.env.USAGE_GUARD_FAIL_OPEN === "1") return null;
      return Response.json(
        {
          error: "Hệ thống chưa sẵn sàng kiểm tra hạn mức (thiếu migration 016). Vui lòng báo admin.",
          code: "usage_guard_unavailable",
        },
        { status: 503 }
      );
    }
    console.error("[usage-guard]", error.message);
    return Response.json(
      { error: "Không kiểm tra được hạn mức sử dụng. Vui lòng thử lại.", code: "usage_check_failed" },
      { status: 503 }
    );
  }

  const result = (data ?? {}) as UsageResult;
  if (result.allowed) return null;

  switch (result.reason) {
    case "rate_limited":
      return Response.json(
        { error: "Bạn thao tác quá nhanh, vui lòng thử lại sau 1 phút.", code: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(result.retry_after ?? 60) } }
      );
    case "quota_exceeded":
      return Response.json(
        {
          error: `Bạn đã dùng hết hạn mức ${KIND_LABEL[kind]} của gói hiện tại (${result.used}/${result.limit}). Nâng cấp gói hoặc dùng API key riêng để tiếp tục.`,
          code: "quota_exceeded",
          plan: result.plan,
          used: result.used,
          limit: result.limit,
        },
        { status: 402 }
      );
    case "unauthenticated":
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    default:
      return Response.json({ error: "Yêu cầu không hợp lệ" }, { status: 400 });
  }
}
