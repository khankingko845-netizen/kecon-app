/**
 * T11 · Server-side consent check for API routes that collect or share personal
 * data (migration 042, docs/parent-consent.md). Paid AI / voice routes are covered
 * by guardUsage → consume_usage; this guard is for the rest (first-party events,
 * push registration, share links, avatar upload).
 *
 * Call it after authenticating the user and validating the body, right before
 * the write. Fails closed: no answer from the database → 503, never "allowed".
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const CONSENT_REQUIRED_CODE = "consent_required";

export function consentRequiredResponse(): Response {
  return Response.json(
    {
      error: "Bố mẹ cần đồng ý chính sách quyền riêng tư của KểCon trước khi dùng tính năng này.",
      code: CONSENT_REQUIRED_CODE,
    },
    { status: 403, headers: { "Cache-Control": "private, no-store" } },
  );
}

/** `null` when the signed-in parent holds a valid consent, otherwise the Response to return. */
export async function requireConsent(supabase: SupabaseClient): Promise<Response | null> {
  const { data, error } = await supabase.rpc("consent_check");
  if (error || typeof data !== "boolean") {
    if (error) console.error("[consent-guard]", error.message);
    return Response.json(
      { error: "Không kiểm tra được đồng ý của bố mẹ. Vui lòng thử lại.", code: "consent_check_failed" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return data ? null : consentRequiredResponse();
}
