/**
 * BYO-key policy (T05).
 *
 * Normal users never send provider keys: the platform key + usage quota is
 * the product. Only admins may pass their own key (for testing providers).
 * Self-hosted/dev setups can re-enable BYO for everyone with ALLOW_BYO_KEYS=1.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const ADMIN_ROLES = ["admin", "super_admin"] as const;

export function byoKeysOpenToAll(): boolean {
  return process.env.ALLOW_BYO_KEYS === "1";
}

export async function isAdminUser(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  return Boolean(data && (ADMIN_ROLES as readonly string[]).includes(data.role));
}

/**
 * Returns a 403 Response when the caller supplied their own key but is not
 * allowed to; `null` when the request may continue.
 */
export async function rejectByoKeyUnlessAllowed(
  supabase: SupabaseClient,
  userId: string,
  userKey: string | null | undefined
): Promise<Response | null> {
  if (!userKey?.trim()) return null;
  if (byoKeysOpenToAll()) return null;
  if (await isAdminUser(supabase, userId)) return null;
  return Response.json(
    {
      error: "API key riêng chỉ dành cho admin. Ứng dụng dùng key của hệ thống — hãy xoá key trong Cài đặt rồi thử lại.",
      code: "byo_key_disabled",
    },
    { status: 403 }
  );
}
